using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Application.Common;

namespace Endgame.Application.Gateway;

public sealed class EstimateOptions
{
    public const string SectionName = "Estimates";

    /// <summary>The most model calls a research run makes; its estimate is that many calls at their worst case.</summary>
    public int ResearchCalls { get; set; } = 8;

    /// <summary>The task type research calls are routed by.</summary>
    public string ResearchTaskType { get; set; } = "research";

    /// <summary>The most model calls a run that suggests ideas from the portfolio makes.</summary>
    public int SuggestCalls { get; set; } = 6;

    /// <summary>The task type those calls are routed by: the research route, which may check the market.</summary>
    public string SuggestTaskType { get; set; } = "research";

    /// <summary>
    /// What a research run costs before an organisation has history of its own: measured, not guessed — the live
    /// factory runs of 2026-11-25 spent 9.0 and 9.5 credits on research, and the first console run 12 (TEST-201).
    /// </summary>
    public decimal ResearchStartingCredits { get; set; } = 12m;

    /// <summary>The same for a suggest run: one or two calls on the research route reading the portfolio, no web search.</summary>
    public decimal SuggestStartingCredits { get; set; } = 2m;

    /// <summary>Finished runs of a kind needed before their median replaces the starting figure.</summary>
    public int MinimumSamples { get; set; } = 3;
}

/// <summary>
/// An estimate shown before work starts: <paramref name="Credits"/> is what the work is expected to cost,
/// <paramref name="Basis"/> says where that figure comes from, and <paramref name="Ceiling"/> is the most it could
/// cost — every call is reserved at its worst case, so the ceiling is a limit, not a guess.
/// </summary>
public sealed record Estimate(decimal Credits, string Basis, decimal? Ceiling = null);

/// <summary>What finished runs of a kind actually cost in one organisation (billable settlements), newest first.</summary>
public interface IEstimateHistory
{
    Task<IReadOnlyList<decimal>> ActualsAsync(Guid organisationId, string kind, CancellationToken cancellationToken);
}

/// <summary>
/// The estimate shown before research starts (CLAUDE.md rule 11). It is the reservation arithmetic
/// the gateway itself uses, applied to the research route for the most calls a research run makes —
/// so the estimate is a ceiling the run cannot exceed, not a guess. Costs nothing to compute.
/// </summary>
public sealed class ResearchEstimator(ModelGatewayOptions options, CreditOptions credits, EstimateOptions estimates, IEstimateHistory? history = null)
{
    /// <summary>
    /// The research estimate the owner is shown (CLAUDE.md rule 11): the median of the organisation's own past research
    /// runs once it has enough of them, otherwise the measured starting figure — never above the ceiling, which is
    /// kept beside it. <paramref name="organisationId"/> is null before an organisation exists.
    /// </summary>
    public async Task<Estimate> ResearchAsync(Guid? organisationId, string? text, IReadOnlyList<string>? constraints, CancellationToken cancellationToken) =>
        await CalibrateAsync(EstimateResearch(text, constraints), organisationId, "research", estimates.ResearchStartingCredits, cancellationToken);

    /// <summary>The suggest run's estimate, calibrated the same way.</summary>
    public async Task<Estimate> SuggestionsAsync(Guid organisationId, int contextCharacters, CancellationToken cancellationToken) =>
        await CalibrateAsync(EstimateSuggestions(contextCharacters), organisationId, "suggest", estimates.SuggestStartingCredits, cancellationToken);

    /// <summary>Expected cost from history when there is enough, from the measured starting figure when there is not; the worst case as the ceiling.</summary>
    public static Estimate Calibrate(Estimate ceiling, IReadOnlyList<decimal> actuals, string kind, decimal startingFigure, int minimumSamples)
    {
        ArgumentNullException.ThrowIfNull(ceiling);
        ArgumentNullException.ThrowIfNull(actuals);
        var most = ceiling.Credits;
        var ceilingText = $"It can never cost more than {most.ToString("0.##", CultureInfo.InvariantCulture)} credits, the most its steps could cost; it is charged at what it actually costs.";
        if (actuals.Count >= minimumSamples)
        {
            var median = Median(actuals);
            return new Estimate(Math.Min(most, Math.Ceiling(median * 100m) / 100m),
                $"About the median of the last {actuals.Count.ToString(CultureInfo.InvariantCulture)} {kind} runs here, which is what they actually cost. {ceilingText}", most);
        }

        return new Estimate(Math.Min(most, startingFigure),
            $"The measured starting figure for {kind} runs, used until {minimumSamples.ToString(CultureInfo.InvariantCulture)} have finished here to learn from. {ceilingText}", most);
    }

    private async Task<Estimate> CalibrateAsync(Estimate ceiling, Guid? organisationId, string kind, decimal startingFigure, CancellationToken cancellationToken)
    {
        // Tenant data is never used across organisations (CLAUDE.md rule 2): only this organisation's own runs count.
        IReadOnlyList<decimal> actuals = organisationId is { } org && history is not null ? await history.ActualsAsync(org, kind, cancellationToken) : [];
        return Calibrate(ceiling, actuals, kind, startingFigure, Math.Max(1, estimates.MinimumSamples));
    }

    private static decimal Median(IReadOnlyList<decimal> values)
    {
        var sorted = values.Order().ToList();
        return sorted.Count % 2 == 1 ? sorted[sorted.Count / 2] : (sorted[(sorted.Count / 2) - 1] + sorted[sorted.Count / 2]) / 2m;
    }

    public Estimate EstimateResearch(string? text, IReadOnlyList<string>? constraints)
    {
        var idea = text?.Trim() ?? "";
        if (idea.Length == 0)
        {
            throw EndgameProblem.Invalid("Describe the idea first; the estimate depends on it.");
        }

        if (!options.Routes.TryGetValue(estimates.ResearchTaskType, out var route))
        {
            throw new EndgameProblem(503, "estimate_unavailable", "The research estimate cannot be worked out",
                $"There is no '{estimates.ResearchTaskType}' route to price research against.");
        }

        var brief = idea + "\n" + string.Join("\n", constraints ?? []);
        var request = new ChatRequest
        {
            TaskType = estimates.ResearchTaskType,
            Messages = [new JsonObject { ["role"] = "user", ["content"] = brief }],
        };
        var perCall = ModelGateway.Prepare(options, credits, request, route, stream: false).ReservedCredits;
        var total = Math.Ceiling(perCall * estimates.ResearchCalls * 100m) / 100m;
        return new Estimate(total,
            $"Up to {estimates.ResearchCalls.ToString(CultureInfo.InvariantCulture)} research steps, each priced at the most it could cost. Research is charged at what it actually costs, which is usually far less, and never more than this.");
    }

    /// <summary>
    /// What a suggestion run costs at most: the same reservation arithmetic on its route, for the most
    /// calls it makes, with the portfolio it reads (<paramref name="contextCharacters"/>) in every prompt.
    /// </summary>
    public Estimate EstimateSuggestions(int contextCharacters)
    {
        if (!options.Routes.TryGetValue(estimates.SuggestTaskType, out var route))
        {
            throw new EndgameProblem(503, "estimate_unavailable", "The estimate cannot be worked out",
                $"There is no '{estimates.SuggestTaskType}' route to price suggestions against.");
        }

        var request = new ChatRequest
        {
            TaskType = estimates.SuggestTaskType,
            Messages = [new JsonObject { ["role"] = "user", ["content"] = new string('x', Math.Clamp(contextCharacters, 1, 200_000)) }],
        };
        var perCall = ModelGateway.Prepare(options, credits, request, route, stream: false).ReservedCredits;
        var total = Math.Ceiling(perCall * estimates.SuggestCalls * 100m) / 100m;
        return new Estimate(total,
            $"Up to {estimates.SuggestCalls.ToString(CultureInfo.InvariantCulture)} steps reading what the organisation holds, each priced at the most it could cost. It is charged at what it actually costs.");
    }
}
