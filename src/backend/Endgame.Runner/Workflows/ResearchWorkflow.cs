using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Research ends in a verdict (spec, <i>the factory</i>). Code fans out contractors on three strands —
/// existing products, the gap, demand — in parallel; a judge argues the case against the idea first and
/// writes the verdict; then code applies the rules a flattering model would bend: every product found
/// is named, no evidence of demand is a reason not to build, and a red line is a do-not-build that no
/// argument changes. A do-not-build waits for the owner.
/// </summary>
public sealed class ResearchWorkflow : IWorkflow
{
    public static readonly (string Id, string Strand)[] Strands =
    [
        ("existing", "Existing products: find every product, service or open-source project that already does this or a large part of it. Name each, with its price and its users where you can."),
        ("gap", "The gap: what do existing products leave undone, done badly, or priced out of reach for the people this is for? Look for complaints, reviews and forum threads."),
        ("demand", "Demand: evidence that real people want this and would pay — searches, communities, waiting lists, people paying for workarounds. Say plainly if you find none."),
    ];

    public string Kind => RunKinds.Research;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        if (run.Run.IdeaId is not { } ideaId)
        {
            return WorkflowOutcome.Failure("A research run belongs to an idea, and this one has none.");
        }

        var owner = run.OwnerMessage();
        var idea = Json.Str(owner, "text") ?? run.Run.Title;
        var constraints = Json.Str(owner, "constraints") is { Length: > 0 } c ? c : "none";
        var change = Json.Str(owner, "change") is { Length: > 0 } ch ? $"The owner asked for this change after the last verdict: {ch}" : "";

        // Contractors, in parallel, each with its own context.
        var strands = Strands.Take(Math.Clamp(run.Options.ResearchContractors, 1, Strands.Length)).ToList();
        var reports = await Task.WhenAll(strands.Select(async s =>
        {
            var prompt = RunnerResources.Prompt("research-contractor", new Dictionary<string, string> { ["idea"] = idea, ["constraints"] = constraints, ["strand"] = s.Strand });
            var agent = run.Agents.Researcher(run, $"contractor-{s.Id}", prompt);
            var result = await WorkflowSupport.RunAgentAsync(run, agent, NoWorkspace.Instance, "Research your strand now, then reply with the JSON object.", cancellationToken);
            return (s.Id, Result: result, Report: WorkflowSupport.JsonAnswer(result.FinalText));
        }));
        foreach (var (_, result, _) in reports)
        {
            if (WorkflowOutcome.FromAgent(result) is { } stopped)
            {
                return stopped;
            }
        }

        var research = new JsonObject();
        foreach (var (id, result, report) in reports)
        {
            research[id] = report?.DeepClone() ?? new JsonObject { ["findings"] = new JsonArray(), ["error"] = $"This contractor returned no usable report ({result.StopReason})." };
        }

        var judgePrompt = RunnerResources.Prompt("research-judge", new Dictionary<string, string>
        {
            ["idea"] = idea,
            ["constraints"] = constraints,
            ["change"] = change,
            ["research"] = research.ToJsonString(Json.Compact),
        });
        var judge = await WorkflowSupport.RunAgentAsync(run, run.Agents.Researcher(run, "judge", judgePrompt), NoWorkspace.Instance, "Weigh the research and reply with the verdict as the JSON object.", cancellationToken);
        if (WorkflowOutcome.FromAgent(judge) is { } judgeStopped)
        {
            return judgeStopped;
        }

        var verdict = WorkflowSupport.JsonAnswer(judge.FinalText);
        if (verdict is null)
        {
            return WorkflowOutcome.Failure("The research could not reach a verdict: the judge gave no verdict document.");
        }

        var applied = VerdictRules.Apply(verdict, research, strands.Count);
        await run.Journal.OnceAsync("verdict", () => Task.FromResult(applied.DeepClone().AsObject()), cancellationToken);
        await run.ControlPlane.RecordVerdictAsync(ideaId, applied, cancellationToken);
        var outcome = Json.Str(applied, "outcome");
        var headline = Json.Str(applied, "headline") ?? "";
        var message = outcome switch
        {
            "do-not-build" => $"Verdict: do not build. {headline} Nothing will be built unless you overrule it.",
            "change" => $"Verdict: build it, changed. {headline}",
            _ => $"Verdict: build. {headline}",
        };
        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "researcher", ["text"] = message, ["verdict"] = outcome }, cancellationToken);
        return WorkflowOutcome.Success(message);
    }
}

/// <summary>The verdict rules code enforces whatever the judge wrote.</summary>
public static class VerdictRules
{
    public static JsonObject Apply(JsonObject verdict, JsonObject research, int contractors)
    {
        ArgumentNullException.ThrowIfNull(verdict);
        ArgumentNullException.ThrowIfNull(research);
        var v = verdict.DeepClone().AsObject();
        var reasons = new List<string>();
        var outcome = (Json.Str(v, "outcome") ?? "").Replace('_', '-').ToLowerInvariant();
        if (!Verdicts.All.Contains(outcome))
        {
            reasons.Add($"The judge's outcome '{outcome}' is not a verdict; an unreadable verdict is treated as do not build.");
            outcome = Verdicts.DoNotBuild;
        }

        // Every product the research found is named, whether the judge mentioned it or not.
        var existing = v["existing"] as JsonObject ?? new JsonObject();
        var named = Json.Strings(existing, "products").ToList();
        foreach (var strand in research.Select(kv => kv.Value).OfType<JsonObject>())
        {
            foreach (var product in Json.Strings(strand, "products"))
            {
                if (!named.Contains(product, StringComparer.OrdinalIgnoreCase))
                {
                    named.Add(product);
                }
            }
        }

        existing["products"] = Json.Array(named);
        existing["evidence"] = Json.Str(existing, "evidence") ?? (named.Count == 0 ? "The research found no existing product that does this." : "");
        v["existing"] = existing;

        // Missing evidence of demand is a reason not to build.
        var demand = v["demand"] as JsonObject ?? new JsonObject();
        var demandEvidence = Json.Str(demand, "evidence")?.Trim() ?? "";
        var demandFindings = (research["demand"] as JsonObject)?["findings"] as JsonArray;
        var noDemand = demandEvidence.Length == 0 || (demandFindings is not null && demandFindings.Count == 0);
        if (noDemand && outcome == Verdicts.Build)
        {
            reasons.Add("No evidence of demand was found, and missing demand counts against building, so the verdict is do not build.");
            outcome = Verdicts.DoNotBuild;
        }

        demand["evidence"] = demandEvidence.Length > 0 ? demandEvidence : "No evidence of demand was found.";
        v["demand"] = demand;
        v["gap"] ??= new JsonObject { ["evidence"] = "" };

        // A red line is never built, whatever the market says.
        if (v["redLines"] is JsonObject lines && Json.Bool(lines, "breached") == true)
        {
            reasons.Add($"The idea crosses a red line ({Json.Str(lines, "line") ?? "unnamed"}): FrostAura never builds it.");
            outcome = Verdicts.DoNotBuild;
            v["redLine"] = lines.DeepClone();
        }

        v["outcome"] = outcome;
        if (string.IsNullOrWhiteSpace(Json.Str(v, "summary")))
        {
            v["summary"] = Json.Str(v, "against") ?? "The research reached this verdict.";
        }

        if (reasons.Count > 0)
        {
            v["summary"] = $"{Json.Str(v, "summary")} {string.Join(" ", reasons)}";
            v["rulesApplied"] = Json.Array(reasons);
        }

        v["wouldChange"] ??= "New evidence of demand or of a gap the existing products leave.";
        v["method"] = new JsonObject
        {
            ["contractors"] = contractors,
            ["strands"] = Json.Array(research.Select(kv => kv.Key)),
            ["sources"] = Json.Array(research.Select(kv => kv.Value).OfType<JsonObject>().SelectMany(s => Json.Strings(s, "sources")).Distinct(StringComparer.Ordinal).Take(40)),
            ["argued"] = "against first",
        };
        return v;
    }
}
