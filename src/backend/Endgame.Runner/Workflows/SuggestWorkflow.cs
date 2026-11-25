using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Ideas from the portfolio (ARCH-004, <i>The suggest run</i>; UC-120): the organisation's researcher reads what the
/// organisation holds — its products, the ideas it researched and their verdicts, its context, what was suggested
/// before — and its organisation graph, and proposes one to five ideas it is placed to build. Code keeps only
/// suggestions that are complete and new (never one already suggested or researched, in any case), gives the
/// researcher one corrected attempt when none is left, records them once, and tells the owner in plain words. The
/// model calls are on the research route with the run's id, so they are reserved, attributed and capped as usual.
/// </summary>
public sealed class SuggestWorkflow : IWorkflow
{
    /// <summary>The researcher's attempts, each at most a few steps: within the control plane's <c>Estimates:SuggestCalls</c> (6) model calls.</summary>
    public const int Attempts = 2;

    public string Kind => RunKinds.Suggest;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        if (run.Journal.Get("suggestions.recorded") is { } done)
        {
            return Finished(Json.Strings(done, "titles").ToList());
        }

        JsonObject context;
        try
        {
            context = await run.ControlPlane.SuggestionContextAsync(run.Run.Id, cancellationToken);
        }
        catch (ServiceProblemException e)
        {
            return WorkflowOutcome.Failure($"What the organisation holds could not be read ({e.Code}: {e.Detail}), so no ideas were suggested.")
                with { ForOwner = "What the organisation holds could not be read just now, so no ideas were suggested. Asking again starts afresh." };
        }

        var scope = Json.Str(context, "scope") ?? run.Run.Scope;
        string ontology;
        try
        {
            ontology = Graph(await run.ControlPlane.OntologyAsync(scope, "all", cancellationToken));
        }
        catch (ServiceProblemException)
        {
            // The graph is context; the products and ideas above carry the essentials.
            ontology = "(the organisation graph could not be read)";
        }

        var max = Math.Clamp(Json.Int(context, "maxSuggestions") ?? 5, 1, 5);
        var researcher = await Workforce.HireAsync(run, new Need(
            "stage", $"stage:research:{scope}", scope, "Iris", "Market researcher",
            "Research product ideas before anything is built: who already does it, what gap is left, and whether people would pay. Argue the case against first.",
            run.Options.ResearchTaskType, ["notes", "remember"], run.Options.MonthlyCredits.GetValueOrDefault("researcher", 400m),
            "Ideas are being suggested from this part of the organisation, and that is research."), cancellationToken);
        var memory = await Workforce.MemoryBlockAsync(run, researcher, scope, cancellationToken);
        var prompt = RunnerResources.Prompt("suggester", new Dictionary<string, string>
        {
            ["context"] = Describe(context),
            ["ontology"] = ontology,
            ["max"] = max.ToString(System.Globalization.CultureInfo.InvariantCulture),
        });

        var taken = Taken(context);
        IReadOnlyList<JsonObject> kept = [];
        var why = "";
        for (var attempt = 0; attempt < Attempts && kept.Count == 0; attempt++)
        {
            var task = attempt == 0
                ? "Suggest the ideas now, as the JSON object."
                : $"None of your suggestions could be kept: {why} Reply with the whole JSON object again, with new, complete ideas.";
            var agent = AgentFactory.As(run, run.Agents.Researcher(run, attempt == 0 ? "suggester" : "suggester-corrected", prompt) with
            {
                Limits = new AgentLimits { MaxSteps = 3, MaxOutputTokens = 6000, MaxSearchesPerCall = 0 },
            }, researcher, memory, canRemember: false);
            var result = await WorkflowSupport.RunAgentAsync(run, agent, NoWorkspace.Instance, task, cancellationToken);
            if (WorkflowOutcome.FromAgent(result) is { } stopped)
            {
                return stopped;
            }

            (kept, why) = Keep(WorkflowSupport.JsonAnswer(result.FinalText), taken, max);
        }

        if (kept.Count == 0)
        {
            return WorkflowOutcome.Failure($"No usable suggestion was made: {why}")
                with { ForOwner = "No new idea worth suggesting came out of what the organisation holds this time, so nothing was added. Asking again later, once there is more to build on, may find one." };
        }

        try
        {
            await run.ControlPlane.RecordSuggestionsAsync(run.Run.Id, new JsonArray(kept.Select(k => (JsonNode)k.DeepClone()).ToArray()), cancellationToken);
        }
        catch (ServiceProblemException e) when (e.Status == System.Net.HttpStatusCode.Conflict && e.Detail.Contains("already recorded", StringComparison.Ordinal))
        {
            // A Runner that died after recording and before journaling: the suggestions are there.
        }

        var titles = kept.Select(k => Json.Str(k, "title")!).ToList();
        await run.Journal.RecordAsync("suggestions.recorded", new JsonObject { ["titles"] = Json.Array(titles) }, cancellationToken);
        var count = titles.Count;
        await Workforce.SayAsync(run, "researcher", count == 1 ? "A new idea for you" : "New ideas for you",
            $"{count} idea{(count == 1 ? "" : "s")} from what the organisation already holds: {string.Join("; ", titles)}. Each says the gap it fills and what it builds on; take one to research it, or set it aside.",
            cancellationToken, "suggested");
        return Finished(titles) with { Announced = true };
    }

    private static WorkflowOutcome Finished(IReadOnlyList<string> titles) =>
        WorkflowOutcome.Success($"Suggested {titles.Count} idea{(titles.Count == 1 ? "" : "s")}: {string.Join("; ", titles)}.");

    /// <summary>The suggestions worth keeping: every field present and within the control plane's limits, and new.</summary>
    public static (IReadOnlyList<JsonObject> Kept, string Why) Keep(JsonObject? answer, IReadOnlySet<string> taken, int max)
    {
        ArgumentNullException.ThrowIfNull(taken);
        if (answer?["suggestions"] is not JsonArray raw)
        {
            return ([], "the reply was not a JSON object with a suggestions list.");
        }

        var kept = new List<JsonObject>();
        var reasons = new List<string>();
        var seen = new HashSet<string>(taken, StringComparer.Ordinal);
        foreach (var s in raw.OfType<JsonObject>())
        {
            var title = Json.Str(s, "title")?.Trim() ?? "";
            var fields = new[] { ("title", title, 200), ("idea", Json.Str(s, "idea")?.Trim() ?? "", 4000), ("gap", Json.Str(s, "gap")?.Trim() ?? "", 2000), ("whyUs", Json.Str(s, "whyUs")?.Trim() ?? "", 2000) };
            if (fields.FirstOrDefault(f => f.Item2.Length == 0 || f.Item2.Length > f.Item3) is { Item1: { } bad })
            {
                reasons.Add($"'{(title.Length > 0 ? title : "a suggestion")}' has no {bad} of 1 to {fields.First(f => f.Item1 == bad).Item3} characters");
                continue;
            }

            if (!seen.Add(Normal(title)))
            {
                reasons.Add($"'{title}' repeats an idea already suggested or researched");
                continue;
            }

            kept.Add(new JsonObject
            {
                ["title"] = title,
                ["idea"] = fields[1].Item2,
                ["gap"] = fields[2].Item2,
                ["whyUs"] = fields[3].Item2,
                ["reuses"] = Json.Array(Json.Strings(s, "reuses").Select(r => r.Trim()).Where(r => r.Length > 0).Take(20)),
            });
            if (kept.Count == max)
            {
                break;
            }
        }

        return (kept, reasons.Count == 0 ? "there were no suggestions." : string.Join("; ", reasons) + ".");
    }

    /// <summary>Titles already suggested and ideas already researched, compared without case, spacing or punctuation.</summary>
    private static HashSet<string> Taken(JsonObject context) =>
        Json.Strings(context, "alreadySuggested")
            .Concat((context["ideas"] as JsonArray ?? []).OfType<JsonObject>().Select(i => Json.Str(i, "title") ?? ""))
            .Where(t => t.Length > 0)
            .Select(Normal)
            .ToHashSet(StringComparer.Ordinal);

    private static string Normal(string title) => new(title.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static string Describe(JsonObject context)
    {
        var lines = new List<string> { $"Organisation: {Json.Str(context, "organisation")} (suggesting for {Json.Str(context, "scope")})", "", "What it has:" };
        lines.AddRange((context["products"] as JsonArray ?? []).OfType<JsonObject>().Select(p => $"- {Json.Str(p, "kind")} {Json.Str(p, "name")} ({Json.Str(p, "scope")}, {Json.Str(p, "status")})"));
        lines.Add("");
        lines.Add("Ideas it researched:");
        lines.AddRange((context["ideas"] as JsonArray ?? []).OfType<JsonObject>().Select(i => $"- {Json.Str(i, "title")} — {Json.Str(i, "status")}{(Json.Str(i, "verdict") is { Length: > 0 } v ? $", verdict {v}" : "")}"));
        lines.Add("");
        lines.Add("Its notes:");
        lines.AddRange(Json.Strings(context, "context").Select(c => $"- {c}"));
        lines.Add("");
        lines.Add("Already suggested (never repeat these):");
        lines.AddRange(Json.Strings(context, "alreadySuggested").Select(t => $"- {t}"));
        return OutputText.Truncate(string.Join('\n', lines), 12_000);
    }

    private static string Graph(JsonObject graph)
    {
        var nodes = (graph["nodes"] as JsonArray ?? []).OfType<JsonObject>().ToDictionary(n => Json.Str(n, "id") ?? "", n => $"{Json.Str(n, "name")} ({Json.Str(n, "type")})", StringComparer.Ordinal);
        var edges = (graph["edges"] as JsonArray ?? []).OfType<JsonObject>()
            .Select(e => $"- {nodes.GetValueOrDefault(Json.Str(e, "from") ?? "", Json.Str(e, "from") ?? "")} {Json.Str(e, "label") ?? Json.Str(e, "type")} {nodes.GetValueOrDefault(Json.Str(e, "to") ?? "", Json.Str(e, "to") ?? "")}");
        var text = string.Join('\n', nodes.Values.Select(n => $"- {n}").Concat(edges));
        return text.Length == 0 ? "(empty)" : OutputText.Truncate(text, 8_000);
    }
}
