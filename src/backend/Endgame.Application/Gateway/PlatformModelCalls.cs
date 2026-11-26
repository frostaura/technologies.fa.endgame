using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;

namespace Endgame.Application.Gateway;

/// <summary>One model call FrostAura made for itself, and what it cost.</summary>
public sealed record PlatformCost(string Purpose, string? Model, string? GenerationId, decimal CostUsd, Guid? By, JsonObject Detail);

/// <summary>Port: where platform costs are kept. They are charged to no organisation.</summary>
public interface IPlatformCosts
{
    Task RecordAsync(PlatformCost cost, CancellationToken cancellationToken);
}

/// <summary>A platform call's answer: the assistant's text, the model that gave it, the cost in dollars, and why it stopped.</summary>
/// <param name="FinishReason">OpenRouter's <c>finish_reason</c>: <c>stop</c>, or <c>length</c> when the answer was cut at the token limit.</param>
public sealed record PlatformReply(string Content, string? Model, string? GenerationId, decimal CostUsd, string? FinishReason = null);

/// <summary>
/// The model gateway's path for work FrostAura does for itself, before any organisation exists to pay
/// for it — screening a new organisation against the red lines (OP-03). The call is prepared exactly as
/// the gateway prepares every call (<see cref="ModelGateway.Prepare"/>: the route's models, price
/// ceiling and limits) and goes through the one provider adapter that holds the key, but it reserves
/// nothing in any organisation's ledger: its cost is recorded as a platform cost instead.
/// </summary>
public sealed class PlatformModelCalls(ModelGatewayOptions options, CreditOptions credits, IModelProvider provider, IPlatformCosts costs)
{
    /// <summary>
    /// Calls the model and records its cost. Throws a problem with status 503 (no provider is configured)
    /// or 502 (it could not be reached, or refused) when no answer came back.
    /// </summary>
    public async Task<PlatformReply> CompleteAsync(ChatRequest request, string purpose, Guid? by, JsonObject detail, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(detail);
        if (!options.Routes.TryGetValue(request.TaskType, out var route))
        {
            throw new EndgameProblem(400, "unknown_task_type", "No route for this task type", $"'{request.TaskType}' has no route.");
        }

        if (!provider.IsConfigured)
        {
            throw new EndgameProblem(503, "model_provider_unconfigured", "No model provider is configured", "The control plane has no model provider key, so it cannot call a model.");
        }

        var prepared = ModelGateway.Prepare(options, credits, request, route, stream: false);
        if (prepared.WorstCaseUsd > route.MaxCallUsd)
        {
            throw new EndgameProblem(422, "ceiling_unreachable", "This call could cost more than its task type allows",
                $"At the route's price ceiling it could cost US${prepared.WorstCaseUsd.ToString("0.######", CultureInfo.InvariantCulture)}.");
        }

        ProviderReply reply;
        try
        {
            reply = await provider.CompleteAsync(prepared.Body, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new EndgameProblem(502, "upstream_unavailable", "The model provider could not be reached", ex.Message.Length > 300 ? ex.Message[..300] : ex.Message);
        }

        if (reply.StatusCode is < 200 or > 299)
        {
            throw new EndgameProblem(502, "upstream_error", "The model provider refused the call", $"It answered {reply.StatusCode}.");
        }

        JsonNode? body;
        try
        {
            body = JsonNode.Parse(reply.Body);
        }
        catch (JsonException)
        {
            body = null;
        }

        var choice = body?["choices"]?[0];
        var content = choice?["message"]?["content"]?.ToString() ?? "";
        var finish = choice?["finish_reason"]?.ToString();
        var model = body?["model"]?.ToString();
        var generation = body?["id"]?.ToString();
        var cost = body?["usage"]?["cost"] is JsonValue value && value.TryGetValue<decimal>(out var reported) ? reported
            : generation is not null ? await provider.GetGenerationCostAsync(generation, cancellationToken) ?? 0m : 0m;
        await costs.RecordAsync(new PlatformCost(purpose, model, generation, cost, by, detail), cancellationToken);
        return new PlatformReply(content, model, generation, cost, finish);
    }
}
