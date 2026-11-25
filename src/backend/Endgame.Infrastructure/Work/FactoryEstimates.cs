using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;

namespace Endgame.Infrastructure.Work;

/// <summary>Starting figures for the factory's own estimates (section <c>Estimates:Factory</c>), measured where a measurement exists.</summary>
public sealed class FactoryEstimateOptions
{
    public const string SectionName = "Estimates:Factory";

    /// <summary>A build before the organisation has finished three: the Runner's own prior for a typical four-item plan.</summary>
    public decimal BuildStartingCredits { get; set; } = 20m;

    /// <summary>A change to a built app: usually one to three parts plus the check of what worked before, so about half a build.</summary>
    public decimal ChangeStartingCredits { get; set; } = 10m;

    /// <summary>A conversation turn before history: one or two calls on the chat route.</summary>
    public decimal ConversationStartingCredits { get; set; } = 0.5m;

    /// <summary>The most model calls one conversation turn makes (the conversation agent's step limit).</summary>
    public int ConversationCalls { get; set; } = 12;

    /// <summary>The prompt a conversation call is priced at, at most: instructions, tools, earlier turns and reads.</summary>
    public int ConversationPromptCharacters { get; set; } = 40_000;

    /// <summary>The conversation agent's own output limit per call.</summary>
    public int ConversationOutputTokens { get; set; } = 4000;

    public string ConversationTaskType { get; set; } = "chat";

    public int MinimumSamples { get; set; } = 3;
}

/// <summary>
/// Estimates shown before factory work that is not research (CLAUDE.md rule 11): trying a build or a change again, changing an
/// app, and one conversation turn. Each is the median of what this organisation's own finished runs of the kind cost once it
/// has enough of them, otherwise the measured starting figure; work that resumes is priced for what is left to do.
/// </summary>
public sealed class FactoryEstimates(FactoryEstimateOptions factory, ModelGatewayOptions gateway, CreditOptions credits, IEstimateHistory? history = null)
{
    /// <summary>A build, or the part of one still to do (<paramref name="remaining"/> of <paramref name="items"/> parts).</summary>
    public Task<Estimate> BuildAsync(Guid organisationId, int remaining, int items, CancellationToken cancellationToken) =>
        LearnedAsync(organisationId, "build", "build", factory.BuildStartingCredits, remaining, items, cancellationToken);

    /// <summary>A change to a built app, or the part of one still to do.</summary>
    public Task<Estimate> ChangeAsync(Guid organisationId, int remaining, int items, CancellationToken cancellationToken) =>
        LearnedAsync(organisationId, "task", "change", factory.ChangeStartingCredits, remaining, items, cancellationToken);

    /// <summary>One conversation turn: what it is expected to cost, and the most it can cost — every call is reserved at its worst case.</summary>
    public async Task<Estimate> ConversationAsync(Guid organisationId, string? taskType, CancellationToken cancellationToken)
    {
        var type = string.IsNullOrWhiteSpace(taskType) ? factory.ConversationTaskType : taskType;
        if (!gateway.Routes.TryGetValue(type, out var route) && !gateway.Routes.TryGetValue(factory.ConversationTaskType, out route))
        {
            throw new EndgameProblem(503, "estimate_unavailable", "The estimate cannot be worked out", $"There is no '{type}' route to price the conversation against.");
        }

        var request = new ChatRequest
        {
            TaskType = type,
            Messages = [new JsonObject { ["role"] = "user", ["content"] = new string('x', factory.ConversationPromptCharacters) }],
            Limits = new ChatLimits { MaxTokens = factory.ConversationOutputTokens },
        };
        var perCall = ModelGateway.Prepare(gateway, credits, request, route, stream: false).ReservedCredits;
        var most = Math.Ceiling(perCall * factory.ConversationCalls * 100m) / 100m;
        var expected = await ExpectedAsync(organisationId, "conversation", factory.ConversationStartingCredits, cancellationToken);
        return new Estimate(Math.Min(most, expected.Credits),
            $"{expected.Basis} It can never cost more than {most.ToString("0.##", CultureInfo.InvariantCulture)} credits: up to {factory.ConversationCalls.ToString(CultureInfo.InvariantCulture)} steps, each priced at the most it could cost, and it is charged at what it actually costs.",
            most);
    }

    private async Task<Estimate> LearnedAsync(Guid organisationId, string historyKind, string name, decimal startingFigure, int remaining, int items, CancellationToken cancellationToken)
    {
        var whole = await ExpectedAsync(organisationId, historyKind, startingFigure, cancellationToken, name);
        if (items <= 0 || remaining >= items)
        {
            return whole;
        }

        var share = Math.Max(1, remaining) / (decimal)items;
        var left = Math.Ceiling(whole.Credits * share * 100m) / 100m;
        return new Estimate(left, $"{whole.Basis} Only {remaining.ToString(CultureInfo.InvariantCulture)} of its {items.ToString(CultureInfo.InvariantCulture)} parts are left to build, so it is priced for those; the parts already built and checked are not built or charged again.");
    }

    private async Task<Estimate> ExpectedAsync(Guid organisationId, string kind, decimal startingFigure, CancellationToken cancellationToken, string? name = null)
    {
        // Tenant data is never used across organisations (CLAUDE.md rule 2): only this organisation's own runs count.
        var actuals = history is null ? [] : await history.ActualsAsync(organisationId, kind, cancellationToken);
        var label = name ?? kind;
        if (actuals.Count >= Math.Max(1, factory.MinimumSamples))
        {
            var sorted = actuals.Order().ToList();
            var median = sorted.Count % 2 == 1 ? sorted[sorted.Count / 2] : (sorted[(sorted.Count / 2) - 1] + sorted[sorted.Count / 2]) / 2m;
            return new Estimate(Math.Ceiling(median * 100m) / 100m, $"About the median of the last {actuals.Count.ToString(CultureInfo.InvariantCulture)} {label} runs here, which is what they actually cost.");
        }

        return new Estimate(startingFigure, $"The measured starting figure for {label} runs, used until {factory.MinimumSamples.ToString(CultureInfo.InvariantCulture)} have finished here to learn from.");
    }
}
