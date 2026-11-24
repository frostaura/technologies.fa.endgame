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
}

public sealed record Estimate(decimal Credits, string Basis);

/// <summary>
/// The estimate shown before research starts (CLAUDE.md rule 11). It is the reservation arithmetic
/// the gateway itself uses, applied to the research route for the most calls a research run makes —
/// so the estimate is a ceiling the run cannot exceed, not a guess. Costs nothing to compute.
/// </summary>
public sealed class ResearchEstimator(ModelGatewayOptions options, CreditOptions credits, EstimateOptions estimates)
{
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
}
