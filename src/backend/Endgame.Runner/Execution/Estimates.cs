using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;

namespace Endgame.Runner.Execution;

/// <summary>An estimate shown before work starts (CLAUDE.md rule 11).</summary>
public sealed record Estimate(decimal Credits, string Basis, int Samples);

/// <summary>What a run actually cost, from the gateway's own <c>model.replied</c> settlements.</summary>
public sealed record Actuals(decimal Billable, decimal NonBillable, int Calls);

/// <summary>
/// Estimates from past cost by task type (the control plane's history of finished runs), falling
/// back to a configured prior until three runs of a kind have finished; refined by the plan's size
/// once there is a plan. Scored at the end against what the gateway settled.
/// </summary>
public sealed class Estimator(RunnerOptions options)
{
    public const int MinimumSamples = 3;

    public async Task<Estimate> EstimateAsync(RunContext run, int? planItems, CancellationToken cancellationToken)
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

        var prior = options.EstimatePriors.GetValueOrDefault(run.Run.Kind, 2m);
        var perRun = history.Count >= MinimumSamples ? Median(history) : prior;
        var basis = history.Count >= MinimumSamples
            ? string.Create(CultureInfo.InvariantCulture, $"median of the last {history.Count} {run.Run.Kind} runs")
            : $"the starting figure for {run.Run.Kind} runs (fewer than {MinimumSamples} finished runs to learn from)";
        if (planItems is > 0 && run.Run.Kind == RunKinds.Build)
        {
            // A build's history is per run of a typical size: scale by the plan, a typical plan being four items.
            perRun = decimal.Round(perRun * Math.Max(1, planItems.Value) / 4m, 4);
            basis += string.Create(CultureInfo.InvariantCulture, $", scaled to a plan of {planItems} items");
        }

        return new Estimate(decimal.Round(perRun, 4), basis, history.Count);
    }

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

    public static JsonObject Made(Estimate estimate, string stage) => new()
    {
        ["credits"] = estimate.Credits,
        ["basis"] = estimate.Basis,
        ["samples"] = estimate.Samples,
        ["stage"] = stage,
        ["source"] = "runner",
    };

    public static JsonObject Scored(decimal expected, Actuals actual) => new()
    {
        ["expectedCredits"] = expected,
        ["actualCredits"] = actual.Billable,
        ["nonBillableCredits"] = actual.NonBillable,
        ["modelCalls"] = actual.Calls,
        ["ratio"] = expected > 0 ? decimal.Round(actual.Billable / expected, 4) : null,
    };

    /// <summary>The most recent estimate in the log, which is what the run is scored against.</summary>
    public static decimal? Latest(IReadOnlyList<RunEvent> log) =>
        log.LastOrDefault(e => e.Type == HarnessEvents.EstimateMade) is { } e ? Json.Dec(e.Payload, "credits") : null;

    private static decimal Median(IReadOnlyList<decimal> values)
    {
        var sorted = values.Order().ToList();
        return sorted.Count % 2 == 1 ? sorted[sorted.Count / 2] : (sorted[(sorted.Count / 2) - 1] + sorted[sorted.Count / 2]) / 2m;
    }
}
