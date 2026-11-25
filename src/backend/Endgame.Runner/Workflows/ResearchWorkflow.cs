using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Research ends in a verdict (spec, <i>the factory</i>). The organisation's researcher (hired when research
/// first reaches its scope) briefs one contractor per strand — existing products, the gap, demand — and
/// they work in parallel, each with its own context and a search budget sized from the estimate. Their
/// sources are pooled and deduplicated. The researcher then judges, arguing against the idea first, and
/// code turns the judgement into the one verdict document ARCH-004 defines, applying the rules a
/// flattering model would bend: every product found is named, no evidence of demand is not a build, a red
/// line is a do-not-build. A document the control plane refuses goes back to the judge once, with its
/// faults. After a build or change verdict auto-mode decides; a do-not-build waits for the owner.
/// </summary>
public sealed class ResearchWorkflow : IWorkflow
{
    public static readonly (string Id, string Title, string Strand)[] Strands =
    [
        ("existing", "Looked for existing products", "Existing products: find every product, service or open-source project that already does this or a large part of it. Name each, say what it does, and give its price and its users where you can."),
        ("gap", "Looked for what they leave undone", "The gap: what do existing products leave undone, do badly, or price out of reach for the people this is for? Look for complaints, reviews and forum threads."),
        ("demand", "Looked for evidence people will pay", "Demand: evidence that real people want this and would pay — searches, communities, waiting lists, people paying for workarounds. Say plainly if you find none."),
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

        // The researcher: hired the first time research reaches this scope.
        var researcher = await Workforce.HireAsync(run, new Need(
            "stage", $"stage:research:{run.Run.Scope}", run.Run.Scope, "Iris", "Market researcher",
            "Research product ideas before anything is built: who already does it, what gap is left, and whether people would pay. Argue the case against first.",
            run.Options.ResearchTaskType, ["notes", "remember"], run.Options.MonthlyCredits.GetValueOrDefault("researcher", 400m),
            "Research has reached this part of the organisation, and every idea is researched before anything is built."), cancellationToken);

        // The search budget, sized from the estimate shown to the owner before research began.
        var strands = Strands.Take(Math.Clamp(run.Options.ResearchContractors, 1, Strands.Length)).ToList();
        var estimate = Estimator.Latest(run.History);
        var slice = estimate is { } e ? decimal.Round(e * run.Options.ResearchStrandShare / strands.Count, 4) : (decimal?)null;
        var searches = slice is { } s
            ? Math.Clamp((int)Math.Floor(s / Math.Max(0.01m, run.Options.ResearchSearchCredits)), run.Options.ResearchMinimumSearches, run.Options.ResearchSearchesPerStrand)
            : run.Options.ResearchSearchesPerStrand;
        await Workforce.SayAsync(run, "researcher", "Research started",
            $"{strands.Count} researchers are looking, at the same time, at who already does this, what they leave undone, and whether people would pay for it, with up to {searches} web searches each.",
            cancellationToken, "research.started");

        // The contractors, in parallel, each with its own context; their sources go into one pool.
        var pool = new SourcePool();
        var reports = await Task.WhenAll(strands.Select(strand => StrandAsync(run, strand, idea, constraints, researcher, searches, slice, pool, cancellationToken)));
        foreach (var report in reports)
        {
            if (WorkflowOutcome.FromAgent(report.Result) is { } stopped)
            {
                return stopped;
            }
        }

        var research = new JsonObject();
        foreach (var report in reports)
        {
            research[report.Id] = report.Report?.DeepClone() ?? new JsonObject { ["findings"] = new JsonArray(), ["error"] = $"This contractor returned no usable report ({report.Result.StopReason})." };
        }

        research["sharedSources"] = Json.Array(pool.All);

        // The researcher judges; code makes the one verdict document, and the control plane checks it.
        var judgePrompt = RunnerResources.Prompt("research-judge", new Dictionary<string, string>
        {
            ["idea"] = idea,
            ["constraints"] = constraints,
            ["change"] = change,
            ["research"] = research.ToJsonString(Json.Compact),
        });
        var memory = await Workforce.MemoryBlockAsync(run, researcher, run.Run.Scope, cancellationToken);
        var context = new VerdictContext(idea, reports.Select(r => r.Strand).ToList(), pool.All, run.Run.Scope);
        JsonObject? verdict = null;
        IReadOnlyList<string> faults = [];
        for (var attempt = 0; attempt < 2 && verdict is null; attempt++)
        {
            var task = attempt == 0
                ? "Weigh the research and reply with the verdict as the JSON object."
                : $"Your last verdict could not be recorded. Fix exactly these faults and reply with the whole JSON object again:\n- {string.Join("\n- ", faults)}";
            var judgeAgent = AgentFactory.As(run, run.Agents.Researcher(run, attempt == 0 ? "judge" : "judge-corrected", judgePrompt) with
            {
                Limits = new AgentLimits { MaxSteps = 4, MaxOutputTokens = 8000, MaxSearchesPerCall = 0 },
            }, researcher, memory, canRemember: false);
            var judge = await WorkflowSupport.RunAgentAsync(run, judgeAgent, NoWorkspace.Instance, task, cancellationToken);
            if (WorkflowOutcome.FromAgent(judge) is { } judgeStopped)
            {
                return judgeStopped;
            }

            var (document, problems) = VerdictBuilder.Build(WorkflowSupport.JsonAnswer(judge.FinalText), context);
            if (document is null || problems.Count > 0)
            {
                faults = problems.Count > 0 ? problems : ["The reply was not a JSON object."];
                continue;
            }

            try
            {
                if (!run.Journal.Done("verdict.recorded"))
                {
                    await run.ControlPlane.RecordVerdictAsync(ideaId, document, cancellationToken);
                    await run.Journal.RecordAsync("verdict.recorded", new JsonObject(), cancellationToken);
                }

                verdict = document;
            }
            catch (VerdictRefusedException refused)
            {
                faults = refused.Errors;
            }
            catch (ServiceProblemException conflict) when (conflict.Status == System.Net.HttpStatusCode.Conflict)
            {
                // Recorded before a crash, and the idea has moved on: the verdict stands.
                await run.Journal.RecordAsync("verdict.recorded", new JsonObject(), cancellationToken);
                verdict = document;
            }
        }

        if (verdict is null)
        {
            return WorkflowOutcome.Failure(Sentences.Join(["The research could not reach a verdict in the agreed form, so none was recorded and nothing will be built", $"What was wrong: {string.Join("; ", faults.Take(3))}"]));
        }

        // Kept for the build to read its placement.
        await run.Journal.OnceAsync("verdict", () => Task.FromResult(verdict.DeepClone().AsObject()), cancellationToken);
        await Workforce.RememberAsync(run, researcher, [new MemoryNote(
            OutputText.Truncate($"Researched: {VerdictBuilder.Title(idea)}", 120),
            Sentences.Plain($"Verdict {Json.Str(verdict, "outcome")}: {Json.Str(verdict, "headline")} Products found: {string.Join(", ", (verdict["existing"]?["products"] as JsonArray ?? []).OfType<JsonObject>().Select(p => Json.Str(p, "name")).Take(8))}.", 1000),
            "fact")], cancellationToken);

        var outcome = Json.Str(verdict, "outcome");
        var headline = Json.Str(verdict, "headline") ?? "";
        var (title, said) = outcome switch
        {
            Verdicts.DoNotBuild => ("Verdict: do not build", Sentences.Join([headline, "Nothing will be built unless you overrule it"])),
            Verdicts.Change => ("Verdict: build it, changed", Sentences.Join([headline, $"The change: {Json.Str(verdict, "suggestedChange")}"])),
            _ => ("Verdict: build", headline),
        };
        await Workforce.SayAsync(run, "researcher", title, said, cancellationToken, "verdict");

        // Auto-mode decides after a build or change verdict; a do-not-build always waits for the owner.
        if (outcome is Verdicts.Build or Verdicts.Change && !run.Journal.Done("decided"))
        {
            var (decision, buildRun, detail) = await run.ControlPlane.BuildOnVerdictAsync(ideaId, cancellationToken);
            await run.Journal.RecordAsync("decided", new JsonObject { ["decision"] = decision.ToString(), ["runId"] = buildRun?.ToString() }, cancellationToken);
            await (decision switch
            {
                AutoDecision.Building => Workforce.SayAsync(run, "runner", "Building has started", "Auto-mode is building it now, on that verdict. You can follow the build, pause it or stop it at any time.", cancellationToken, "decided"),
                AutoDecision.RedLine => Workforce.SayAsync(run, "runner", "It will not be built", detail, cancellationToken, "decided"),
                _ => Workforce.SayAsync(run, "runner", "Waiting for your decision", Sentences.Join(["The verdict waits for you: build it, change it or drop it", detail]), cancellationToken, "decided"),
            });
        }

        return WorkflowOutcome.Success(outcome == Verdicts.DoNotBuild ? "Research finished; the verdict waits for your decision." : "Research finished.") with { Announced = true };
    }

    private static async Task<StrandReport> StrandAsync(RunContext run, (string Id, string Title, string Strand) strand, string idea, string constraints,
        Guid? researcher, int searches, decimal? slice, SourcePool pool, CancellationToken cancellationToken)
    {
        var agentId = $"contractor-{strand.Id}";
        var started = run.History.FirstOrDefault(e => e.Type == HarnessEvents.SubagentStarted && Json.Str(e.Payload, "subagent") == agentId);
        var finished = run.History.Any(e => e.Type == HarnessEvents.SubagentFinished && Json.Str(e.Payload, "subagent") == agentId);
        Guid? contractor = Guid.TryParse(Json.Str(started?.Payload, "contractorId"), out var known) ? known : null;
        var writer = new AgentEventWriter(run.Sink, WorkflowJournal.Agent);
        if (started is null)
        {
            if (researcher is { } briefer)
            {
                try
                {
                    contractor = await run.ControlPlane.StartContractorAsync(run.Run.Scope, briefer, "Research contractor", $"{strand.Title} (contractor)", strand.Strand, run.Run.Id, cancellationToken);
                }
                catch (ServiceProblemException)
                {
                    contractor = null;
                }
            }

            await writer.WriteAsync(HarnessEvents.SubagentStarted, new JsonObject
            {
                ["subagent"] = agentId,
                ["title"] = strand.Title,
                ["role"] = "research contractor",
                ["brief"] = strand.Strand,
                ["contractorId"] = contractor?.ToString(),
                ["briefedBy"] = researcher?.ToString(),
                ["maxSearches"] = searches,
                ["creditBudget"] = slice,
            }, cancellationToken);
        }

        var prompt = RunnerResources.Prompt("research-contractor", new Dictionary<string, string>
        {
            ["idea"] = idea,
            ["constraints"] = constraints,
            ["strand"] = strand.Strand,
            ["searches"] = searches.ToString(CultureInfo.InvariantCulture),
        });
        var agent = run.Agents.Researcher(run, agentId, prompt) with
        {
            EmployeeId = contractor ?? run.Run.EmployeeId,
            Limits = new AgentLimits { MaxSteps = 4, MaxOutputTokens = 8000, MaxSearchesPerCall = searches, CreditBudget = slice },
        };
        var result = await WorkflowSupport.RunAgentAsync(run, agent, NoWorkspace.Instance, "Research your strand now, then reply with the JSON object.", cancellationToken);
        var report = WorkflowSupport.JsonAnswer(result.FinalText);
        var sources = Json.Strings(report, "sources").Concat(result.State.Citations).ToList();
        var added = pool.Add(sources);
        var confidence = VerdictBuilder.Confidence(Json.Str(report, "confidence")) ?? "low";
        var info = new StrandInfo(strand.Id, strand.Title, result.State.Searches, added, confidence, report);
        if (!finished && !StopReasons.IsSuspension(result.StopReason) && result.StopReason is not (StopReasons.Cancelled or StopReasons.RunClosed))
        {
            var summary = VerdictBuilder.StrandSummary(strand.Id, report, result);
            await writer.WriteAsync(HarnessEvents.SubagentFinished, new JsonObject
            {
                ["subagent"] = agentId,
                ["title"] = strand.Title,
                ["summary"] = summary,
                ["stopReason"] = result.StopReason,
                ["searches"] = result.State.Searches,
                ["sources"] = added,
                ["credits"] = result.State.SettledCredits,
                ["report"] = report?.DeepClone() ?? JsonValue.Create(OutputText.Truncate(result.FinalText ?? "", 4000)),
            }, cancellationToken);
            if (contractor is { } id)
            {
                try
                {
                    var learned = Json.Strings(report, "findings").Take(3).Select(f => new MemoryNote(OutputText.Truncate($"{strand.Title}: {VerdictBuilder.Title(idea)}", 120), OutputText.Truncate(f, 1000), "fact")).ToList();
                    await run.ControlPlane.FinishContractorAsync(id, run.Run.Id, learned.Count > 0 ? learned : [new MemoryNote(OutputText.Truncate($"{strand.Title}: {VerdictBuilder.Title(idea)}", 120), summary, "fact")], cancellationToken);
                }
                catch (ServiceProblemException)
                {
                    // The contractor's work is in the log; its record is the control plane's to tidy.
                }
            }
        }

        return new StrandReport(strand.Id, result, report, info);
    }

    private sealed record StrandReport(string Id, AgentResult Result, JsonObject? Report, StrandInfo Strand);
}

/// <summary>One strand's account, for the verdict's <c>method</c>.</summary>
public sealed record StrandInfo(string Id, string Title, int Searches, int Sources, string Confidence, JsonObject? Report);

/// <summary>What the verdict is built from besides the judge's answer.</summary>
public sealed record VerdictContext(string Idea, IReadOnlyList<StrandInfo> Strands, IReadOnlyList<string> Sources, string Scope);

/// <summary>The strands' sources, deduplicated as they arrive (by address, ignoring a trailing slash, the fragment and tracking parameters).</summary>
public sealed class SourcePool
{
    private readonly Lock gate = new();
    private readonly List<string> sources = [];
    private readonly HashSet<string> keys = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<string> All
    {
        get
        {
            lock (gate)
            {
                return sources.ToList();
            }
        }
    }

    /// <summary>Adds what is new; returns how many were new.</summary>
    public int Add(IEnumerable<string> addresses)
    {
        var added = 0;
        lock (gate)
        {
            foreach (var raw in addresses)
            {
                if (Normalise(raw) is not { } address || sources.Count >= 60 || !keys.Add(Key(address)))
                {
                    continue;
                }

                sources.Add(address);
                added++;
            }
        }

        return added;
    }

    public static string? Normalise(string? raw)
    {
        var text = raw?.Trim();
        if (string.IsNullOrEmpty(text) || text.Length > 500 || !Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            return null;
        }

        var query = string.Join('&', uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Where(q => !q.StartsWith("utm_", StringComparison.OrdinalIgnoreCase)));
        return $"{uri.Scheme}://{uri.Host}{uri.AbsolutePath}{(query.Length > 0 ? "?" + query : "")}";
    }

    private static string Key(string address) => address.TrimEnd('/').Replace("://www.", "://", StringComparison.OrdinalIgnoreCase);
}
