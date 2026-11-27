using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Planning;

namespace Endgame.Runner.Execution;

/// <summary>An estimate shown before work starts (CLAUDE.md rule 11).</summary>
public sealed record Estimate(decimal Credits, string Basis, int Samples);

/// <summary>What a run actually cost, from the gateway's own <c>model.replied</c> settlements.</summary>
public sealed record Actuals(decimal Billable, decimal NonBillable, int Calls);

/// <summary>
/// Estimates from past cost by task type (the control plane's history of finished runs), falling
/// back to a configured prior until three runs of a kind have finished. Once there is a plan, a build is
/// refined by it: with history, the median scaled by the plan's size; without, the plan's items weighted by
/// what each involves (<see cref="BuildEstimateWeights"/>). Scored at the end against what the gateway settled.
/// </summary>
public sealed partial class Estimator(RunnerOptions options)
{
    public const int MinimumSamples = 3;

    /// <summary>The plan size a build's history is taken to describe, when it is scaled to a plan.</summary>
    public const int TypicalPlanItems = 4;

    public async Task<Estimate> EstimateAsync(RunContext run, PlanContract? plan, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        IReadOnlyList<decimal> history;
        try
        {
            history = await run.ControlPlane.CostHistoryAsync(run.Run.Kind, run.Run.Scope, cancellationToken);
        }
        catch (ServiceProblemException)
        {
            history = [];
        }

        // A change to a built app is a task run that goes through the build's stages, so it is priced as a small build.
        var change = run.Run.Kind == RunKinds.Task && Json.Str(run.OwnerMessage(), "kind") == "change";
        var kind = change ? "change" : run.Run.Kind;
        var learned = history.Count >= MinimumSamples;
        var perRun = learned ? Median(history) : options.EstimatePriors.GetValueOrDefault(kind, 2m);
        var basis = learned
            ? string.Create(CultureInfo.InvariantCulture, $"median of the last {history.Count} {run.Run.Kind} runs")
            : $"the measured starting figure for {kind} runs (fewer than {MinimumSamples} finished runs here to learn from)";
        if (plan is { Items.Count: > 0 } && (run.Run.Kind == RunKinds.Build || change))
        {
            if (learned)
            {
                // A build's history is per run of a typical size: scale by the plan.
                perRun = decimal.Round(perRun * plan.Items.Count / TypicalPlanItems, 4);
                basis += string.Create(CultureInfo.InvariantCulture, $", scaled to a plan of {plan.Items.Count} items");
            }
            else
            {
                var weighed = Weigh(plan, options.BuildEstimate);
                perRun = weighed.Credits;
                basis = $"the measured starting figure for build runs, weighted by this plan's {weighed.Description} (fewer than {MinimumSamples} finished build runs here to learn from)";
            }
        }

        return new Estimate(decimal.Round(perRun, 4), basis, history.Count);
    }

    /// <summary>What an item involves, read from its plain text and its technical detail.</summary>
    public sealed record ItemKinds(bool KeepsData, bool Screen, IReadOnlyList<string> Integrations);

    public static ItemKinds Classify(PlanItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var text = $"{item.Text} {item.Detail}".ToLowerInvariant();
        var integrations = new List<string>();
        if (WebhookWords().IsMatch(text))
        {
            integrations.Add("webhooks");
        }

        if (EmailWords().IsMatch(text))
        {
            integrations.Add("e-mail");
        }

        if (ScheduleWords().IsMatch(text))
        {
            integrations.Add("schedules");
        }

        if (ModelWords().IsMatch(text))
        {
            integrations.Add("models");
        }

        return new ItemKinds(DataWords().IsMatch(text), ScreenWords().IsMatch(text), integrations);
    }

    /// <summary>A plan's starting estimate: every item, plus what each involves and the requirements it covers.</summary>
    public static (decimal Credits, string Description) Weigh(PlanContract plan, BuildEstimateWeights weights)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(weights);
        var kinds = plan.Items.Select(Classify).ToList();
        var data = kinds.Count(k => k.KeepsData);
        var screens = kinds.Count(k => k.Screen);
        var reaching = kinds.Count(k => k.Integrations.Count > 0);
        var services = kinds.SelectMany(k => k.Integrations).ToList();
        var covered = plan.Items.Sum(i => Math.Max(1, i.Covers.Count));
        var credits = (plan.Items.Count * weights.PerItem) + (data * weights.DataItem) + (screens * weights.Screen) + (services.Count * weights.Integration) + (covered * weights.Requirement);
        var parts = new List<string> { Count(plan.Items.Count, "item", "items") };
        if (data > 0)
        {
            parts.Add($"{data} that keep{(data == 1 ? "s" : "")} data");
        }

        if (screens > 0)
        {
            parts.Add(Count(screens, "screen", "screens"));
        }

        if (reaching > 0)
        {
            parts.Add($"{reaching} reaching {And(services.Distinct().ToList())}");
        }

        parts.Add(Count(covered, "requirement covered", "requirements covered"));
        var each = string.Create(CultureInfo.InvariantCulture,
            $"{weights.PerItem} credits an item, {weights.DataItem} more for keeping data, {weights.Screen} for a screen, {weights.Integration} for each of webhooks, e-mail, schedules or models, and {weights.Requirement} a requirement");
        return (decimal.Round(credits, 4), $"{string.Join(", ", parts)}: {each}");
    }

    private static string Count(int n, string one, string many) => string.Create(CultureInfo.InvariantCulture, $"{n} {(n == 1 ? one : many)}");

    private static string And(IReadOnlyList<string> words) => words.Count switch
    {
        0 => "",
        1 => words[0],
        _ => $"{string.Join(", ", words.Take(words.Count - 1))} and {words[^1]}",
    };

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(entity|entities|api|apis|endpoints?|migrations?|database|tables?|ledger|stored|kept|saved|records?)\b")]
    private static partial System.Text.RegularExpressions.Regex DataWords();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(screens?|pages?|views?|forms?|buttons?|dashboards?|layout|navigation|cards?|ui)\b")]
    private static partial System.Text.RegularExpressions.Regex ScreenWords();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(webhooks?|hooks?)\b")]
    private static partial System.Text.RegularExpressions.Regex WebhookWords();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(e-?mails?|mail)\b")]
    private static partial System.Text.RegularExpressions.Regex EmailWords();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(schedules?|scheduled|nightly|daily|weekly|hourly|recurring|reminders?|cron)\b")]
    private static partial System.Text.RegularExpressions.Regex ScheduleWords();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(ai|language models?|model calls?|summari[sz]e[sd]?|classif(y|ies|ied)|generated? by a model)\b")]
    private static partial System.Text.RegularExpressions.Regex ModelWords();

    public static Actuals Score(IReadOnlyList<RunEvent> log)
    {
        ArgumentNullException.ThrowIfNull(log);
        decimal billable = 0, free = 0;
        var calls = 0;
        foreach (var e in log.Where(e => e.Type == RunEventTypes.ModelReplied))
        {
            var settled = Json.Dec(e.Payload, "settledCredits") ?? 0m;
            calls++;
            if (Json.Bool(e.Payload, "billable") == false)
            {
                free += settled;
            }
            else
            {
                billable += settled;
            }
        }

        return new Actuals(billable, free, calls);
    }

    /// <param name="reason">Why the estimate was made again, in one plain line the card can show beside the new figure.</param>
    /// <param name="previous">The figure this one replaces, when there was one.</param>
    public static JsonObject Made(Estimate estimate, string stage, string? reason = null, decimal? previous = null)
    {
        ArgumentNullException.ThrowIfNull(estimate);
        var made = new JsonObject
        {
            ["credits"] = estimate.Credits,
            ["basis"] = estimate.Basis,
            ["samples"] = estimate.Samples,
            ["stage"] = stage,
            ["source"] = "runner",
        };
        if (reason is not null)
        {
            made["reason"] = reason;
        }

        if (previous is not null)
        {
            made["previousCredits"] = previous;
        }

        return made;
    }

    /// <summary>Why a build or change is estimated again once its plan is agreed: "Re-estimated after planning: 3 parts."</summary>
    public static string AfterPlanning(int parts) =>
        string.Create(CultureInfo.InvariantCulture, $"Re-estimated after planning: {parts} part{(parts == 1 ? "" : "s")}.");

    public static JsonObject Scored(decimal expected, Actuals actual) => new()
    {
        ["expectedCredits"] = expected,
        ["actualCredits"] = actual.Billable,
        ["nonBillableCredits"] = actual.NonBillable,
        ["modelCalls"] = actual.Calls,
        ["ratio"] = expected > 0 ? decimal.Round(actual.Billable / expected, 4) : null,
    };

    /// <summary>The most the run could cost, when the latest estimate states it (the control plane's research and suggest estimates do).</summary>
    public static decimal? LatestCeiling(IReadOnlyList<RunEvent> log) =>
        log.LastOrDefault(e => e.Type == HarnessEvents.EstimateMade) is { } e ? Json.Dec(e.Payload, "ceiling") : null;

    /// <summary>The most recent estimate in the log, which is what the run is scored against.</summary>
    public static decimal? Latest(IReadOnlyList<RunEvent> log) =>
        log.LastOrDefault(e => e.Type == HarnessEvents.EstimateMade) is { } e ? Json.Dec(e.Payload, "credits") : null;

    private static decimal Median(IReadOnlyList<decimal> values)
    {
        var sorted = values.Order().ToList();
        return sorted.Count % 2 == 1 ? sorted[sorted.Count / 2] : (sorted[(sorted.Count / 2) - 1] + sorted[sorted.Count / 2]) / 2m;
    }
}
