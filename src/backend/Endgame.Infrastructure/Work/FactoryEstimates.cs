using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Credits;

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

    /// <summary>
    /// How many of a turn's calls an attached file is expected to be read in: the first answer, and the one after the read it
    /// usually makes. Every call carries the files (the ceiling counts all <see cref="ConversationCalls"/> of them).
    /// </summary>
    public int AttachmentReadsExpected { get; set; } = 2;

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

    /// <summary>
    /// One conversation turn: what it is expected to cost, and the most it can cost — every call is reserved at its worst case.
    /// The files a message carries are read in every call: each image at <see cref="ReservationFormula.ImageTokens"/>, text at
    /// its length, exactly as the gateway will reserve them. A message whose files would make one call dearer than the route
    /// allows is refused here, before it is sent, rather than failing once it is running.
    /// </summary>
    public async Task<Estimate> ConversationAsync(Guid organisationId, string? taskType, CancellationToken cancellationToken, AttachmentLoad? attachments = null)
    {
        var type = string.IsNullOrWhiteSpace(taskType) ? factory.ConversationTaskType : taskType;
        if (!gateway.Routes.TryGetValue(type, out var route) && !gateway.Routes.TryGetValue(factory.ConversationTaskType, out route))
        {
            throw new EndgameProblem(503, "estimate_unavailable", "The estimate cannot be worked out", $"There is no '{type}' route to price the conversation against.");
        }

        var files = attachments ?? AttachmentLoad.None;
        if (files.Images > 0 && !gateway.AcceptsImages(route))
        {
            throw new EndgameProblem(422, "images_not_accepted", "Whoever answers here cannot look at images",
                "Whoever answers here reads text only, so a message with an image cannot be sent here. Remove the image, or describe what it shows in words.");
        }

        var prompt = new string('x', (int)Math.Min(int.MaxValue / 2, factory.ConversationPromptCharacters + files.Characters));
        JsonNode content = files.Images == 0
            ? JsonValue.Create(prompt)
            : new JsonArray([new JsonObject { ["type"] = "text", ["text"] = prompt }, .. Enumerable.Range(0, files.Images).Select(_ => (JsonNode)new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = "data:image/png;base64," } })]);
        var request = new ChatRequest
        {
            TaskType = type,
            Messages = [new JsonObject { ["role"] = "user", ["content"] = content }],
            Limits = new ChatLimits { MaxTokens = factory.ConversationOutputTokens },
        };
        var prepared = ModelGateway.Prepare(gateway, credits, request, route, stream: false);
        if (files.Files > 0 && prepared.WorstCaseUsd > route.MaxCallUsd)
        {
            throw new EndgameProblem(413, "attachments_too_much", "These files are more than can be read in one message",
                "Together the files hold more than whoever answers here can read in one message. Attach fewer, or shorter ones, or only the part that matters.");
        }

        var perCall = prepared.ReservedCredits;
        var most = Math.Ceiling(perCall * factory.ConversationCalls * 100m) / 100m;
        var expected = await ExpectedAsync(organisationId, "conversation", factory.ConversationStartingCredits, cancellationToken);
        var credited = expected.Credits;
        var reading = "";
        if (files.Files > 0)
        {
            // Text at a token for every four characters, each image at its fixed figure, read in the calls a turn usually makes.
            var tokens = (files.Characters / 4) + ((long)files.Images * ReservationFormula.ImageTokens);
            var usd = tokens * route.MaxPromptPerMillionUsd / 1_000_000m * Math.Max(1, factory.AttachmentReadsExpected);
            credited += credits.ToCreditsCeiling(usd);
            credited = Math.Ceiling(credited * 100m) / 100m;
            reading = $" It adds reading the {files.Files.ToString(CultureInfo.InvariantCulture)} attached file{(files.Files == 1 ? "" : "s")} (about {tokens.ToString("N0", CultureInfo.InvariantCulture)} tokens: text at one for every four characters{(files.Images > 0 ? $", each image at {ReservationFormula.ImageTokens.ToString("N0", CultureInfo.InvariantCulture)}" : "")}) in each of the {Math.Max(1, factory.AttachmentReadsExpected).ToString(CultureInfo.InvariantCulture)} steps a turn usually takes.";
        }

        return new Estimate(Math.Min(most, credited),
            $"{expected.Basis}{reading} It can never cost more than {most.ToString("0.##", CultureInfo.InvariantCulture)} credits: up to {factory.ConversationCalls.ToString(CultureInfo.InvariantCulture)} steps, each priced at the most it could cost{(files.Files > 0 ? " with the files read in every one" : "")}, and it is charged at what it actually costs.",
            most);
    }

    private async Task<Estimate> LearnedAsync(Guid organisationId, string historyKind, string name, decimal startingFigure, int remaining, int items, CancellationToken cancellationToken)
    {
        var whole = await ExpectedAsync(organisationId, historyKind, startingFigure, cancellationToken, name);
        if (items <= 0 || remaining >= items)
        {
            return whole;
        }

        // Nothing left to build (every part passed, the app was not published): what is left is the review and the release,
        // priced as one part's share — never "Only 0 of its parts are left to build" (R7-3).
        var share = Math.Max(1, remaining) / (decimal)items;
        var left = Math.Ceiling(whole.Credits * share * 100m) / 100m;
        if (remaining <= 0)
        {
            var release = name == "change" ? "the new version" : "publishing";
            return new Estimate(left, $"{whole.Basis} Every part is built and checked. What is left is the security review and {release}, so it is priced as one part's share; the parts are not built or charged again.");
        }

        return new Estimate(left, $"{whole.Basis} Only {remaining.ToString(CultureInfo.InvariantCulture)} of its {items.ToString(CultureInfo.InvariantCulture)} parts {(remaining == 1 ? "is" : "are")} left to build, so it is priced for those; the parts already built and checked are not built or charged again.");
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
