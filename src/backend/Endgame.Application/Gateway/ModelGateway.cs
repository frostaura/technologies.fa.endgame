using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Credits;
using Endgame.Domain.Runs;

namespace Endgame.Application.Gateway;

/// <summary>
/// The model gateway (ARCH-003): the only path from Endgame to a model. It routes by task type,
/// reserves the worst case in the same transaction that admits the call, sends that same ceiling as
/// <c>max_price</c> so the call cannot cost more, always clamps output and sets reasoning, passes the
/// reply through untouched, and settles from the reply's own cost figure.
/// </summary>
public sealed class ModelGateway(
    ModelGatewayOptions options,
    CreditOptions credits,
    ICreditLedger ledger,
    IGatewayContext context,
    IModelProvider provider,
    TimeProvider clock)
{
    public const string SettlementEvent = "endgame.settlement";

    private const int MaxErrorText = 500;

    /// <summary>A non-streamed call.</summary>
    public async Task<ChatResult> CompleteAsync(ChatRequest request, CancellationToken cancellationToken)
    {
        var call = await AdmitAsync(request, stream: false, cancellationToken);
        ProviderReply reply;
        try
        {
            reply = await provider.CompleteAsync(call.Body, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            // Nothing came back, so there is no generation to pay for.
            await ReleaseAsync(call, "the upstream could not be reached");
            throw cancellationToken.IsCancellationRequested
                ? new OperationCanceledException(cancellationToken)
                : new EndgameProblem(502, "upstream_unavailable", "The model provider could not be reached", Truncate(ex.Message));
        }

        var parsed = TryParse(reply.Body);
        if (reply.StatusCode is < 200 or > 299)
        {
            await ReleaseAsync(call, $"the upstream refused the call ({reply.StatusCode})");
            throw UpstreamRefusal(reply.StatusCode, parsed, reply.Body);
        }

        var facts = ReplyFacts.From(parsed);
        var settlement = await SettleAsync(call, facts);
        if (facts.Error is not null)
        {
            // ARCH-003 rule 10: a 200 can still carry an error once output has started.
            throw UpstreamError(facts.Error, settlement);
        }

        return new ChatResult(reply.Body, settlement);
    }

    /// <summary>
    /// A streamed call. Upstream lines are written through as they arrive; the upstream's closing
    /// <c>[DONE]</c> is held back until the call has settled, and an <c>endgame.settlement</c> event is
    /// written just before it. <paramref name="onStart"/> runs once, before the first byte, only when
    /// the upstream accepted the call — a refusal is thrown as a problem instead.
    /// </summary>
    public async Task StreamAsync(ChatRequest request, Func<Task> onStart, Func<string, Task> writeLine, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(onStart);
        ArgumentNullException.ThrowIfNull(writeLine);
        var call = await AdmitAsync(request, stream: true, cancellationToken);
        ProviderStream stream;
        try
        {
            stream = await provider.StreamAsync(call.Body, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            await ReleaseAsync(call, "the upstream could not be reached");
            throw cancellationToken.IsCancellationRequested
                ? new OperationCanceledException(cancellationToken)
                : new EndgameProblem(502, "upstream_unavailable", "The model provider could not be reached", Truncate(ex.Message));
        }

        if (stream.StatusCode is < 200 or > 299)
        {
            await ReleaseAsync(call, $"the upstream refused the call ({stream.StatusCode})");
            throw UpstreamRefusal(stream.StatusCode, TryParse(stream.ErrorBody ?? ""), stream.ErrorBody ?? "");
        }

        var facts = new ReplyFacts();
        var sawDone = false;
        var clientGone = false;
        ChatSettlement? settlement = null;
        await onStart();
        try
        {
            await foreach (var line in stream.Lines.WithCancellation(cancellationToken))
            {
                if (line.StartsWith("data:", StringComparison.Ordinal))
                {
                    var data = line[5..].Trim();
                    if (data == "[DONE]")
                    {
                        sawDone = true;
                        continue;
                    }

                    // Every chunk is checked for an error, not only the status code (rule 10).
                    facts.Absorb(TryParse(data));
                }

                await writeLine(line);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            clientGone = true;
        }
        finally
        {
            settlement = await SettleAsync(call, facts);
        }

        if (clientGone)
        {
            return;
        }

        var report = new JsonObject
        {
            ["reservedCredits"] = settlement.ReservedCredits,
            ["settledCredits"] = settlement.SettledCredits,
            ["billable"] = settlement.Billable,
            ["model"] = settlement.Model,
            ["error"] = facts.Error?.DeepClone(),
        };
        await writeLine($"event: {SettlementEvent}");
        await writeLine($"data: {report.ToJsonString()}");
        await writeLine("");
        if (sawDone)
        {
            await writeLine("data: [DONE]");
            await writeLine("");
        }
    }

    /// <summary>The upstream body and the reservation for a call. Pure, so estimates and tests use the very same arithmetic.</summary>
    public static PreparedCall Prepare(ModelGatewayOptions options, CreditOptions credits, ChatRequest request, ModelRoute route, bool stream)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(credits);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(route);
        if (request.Messages is not { Count: > 0 } messages)
        {
            throw EndgameProblem.Invalid("A model call needs at least one message.");
        }

        var modelMax = route.Models.Min(m => options.Models[m].MaxOutputTokens);
        int maxTokens;
        try
        {
            maxTokens = ReservationFormula.ClampMaxTokens(request.Limits?.MaxTokens, route.MaxTokens, modelMax);
        }
        catch (DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }

        var tools = request.Tools?.DeepClone().AsArray() ?? [];
        long searchFees = 0;
        decimal searchFeesUsd = 0m;
        if (route.WebSearch is { } search)
        {
            tools.Add(new JsonObject
            {
                ["type"] = "openrouter:web_search",
                ["parameters"] = new JsonObject
                {
                    ["engine"] = search.Engine,
                    ["max_results"] = search.MaxResults,
                    ["max_uses"] = search.MaxUses,
                },
            });
            var results = (long)search.MaxResults * search.MaxUses;
            searchFees = results * search.PromptTokensPerResult;
            searchFeesUsd = results * search.FeePerResultUsd;
        }

        var promptBytes = Encoding.UTF8.GetByteCount(messages.ToJsonString()) + (request.Tools is null ? 0 : Encoding.UTF8.GetByteCount(request.Tools.ToJsonString()));
        var promptTokens = ReservationFormula.EstimatePromptTokens(promptBytes, messages.Count);
        var ceiling = new PriceCeiling(route.MaxPromptPerMillionUsd, route.MaxCompletionPerMillionUsd, route.MaxRequestUsd);
        var worstUsd = ReservationFormula.WorstCaseUsd(promptTokens, maxTokens, ceiling, searchFeesUsd, searchFees);

        var maxPrice = new JsonObject
        {
            ["prompt"] = route.MaxPromptPerMillionUsd,
            ["completion"] = route.MaxCompletionPerMillionUsd,
        };
        if (route.MaxRequestUsd > 0)
        {
            maxPrice["request"] = route.MaxRequestUsd;
        }

        var body = new JsonObject
        {
            ["model"] = route.Models[0],
            ["messages"] = messages.DeepClone(),
            ["max_tokens"] = maxTokens,
            ["reasoning"] = route.Reasoning == "off"
                ? new JsonObject { ["enabled"] = false }
                : new JsonObject { ["effort"] = route.Reasoning },
            ["provider"] = new JsonObject
            {
                ["max_price"] = maxPrice,
                ["sort"] = route.Sort,
                ["require_parameters"] = true,
                ["allow_fallbacks"] = true,
            },
            ["usage"] = new JsonObject { ["include"] = true },
            ["stream"] = stream,
        };
        if (route.Models.Count > 1)
        {
            body["models"] = new JsonArray(route.Models.Select(m => (JsonNode)JsonValue.Create(m)!).ToArray());
        }

        if (tools.Count > 0)
        {
            body["tools"] = tools;
            // Rule 9: never assume parallel tool calls; the route says whether they are allowed.
            body["parallel_tool_calls"] = route.ParallelToolCalls;
        }

        if (request.ToolChoice is not null)
        {
            body["tool_choice"] = request.ToolChoice.DeepClone();
        }

        if (request.ResponseFormat is not null)
        {
            body["response_format"] = request.ResponseFormat.DeepClone();
        }

        if (request.Temperature is { } temperature)
        {
            if (double.IsNaN(temperature) || temperature < 0 || temperature > 2)
            {
                throw EndgameProblem.Invalid("temperature is a number from 0 to 2.");
            }

            body["temperature"] = temperature;
        }

        return new PreparedCall(body, maxTokens, promptTokens, worstUsd, credits.ToCreditsCeiling(worstUsd));
    }

    private async Task<AdmittedCall> AdmitAsync(ChatRequest request, bool stream, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.TaskType) || !options.Routes.TryGetValue(request.TaskType, out var route))
        {
            throw new EndgameProblem(400, "unknown_task_type", "No route for this task type",
                $"'{request.TaskType}' has no route. Known task types: {string.Join(", ", options.Routes.Keys.Order(StringComparer.Ordinal))}.");
        }

        if (!provider.IsConfigured)
        {
            throw new EndgameProblem(503, "model_provider_unconfigured", "No model provider is configured",
                "The control plane has no OpenRouter key (OPENROUTER_API_KEY), so it cannot call a model.");
        }

        var prepared = Prepare(options, credits, request, route, stream);
        if (prepared.WorstCaseUsd > route.MaxCallUsd)
        {
            var problem = new EndgameProblem(422, "ceiling_unreachable", "This call could cost more than its task type allows",
                $"At the route's price ceiling this call could cost US${prepared.WorstCaseUsd.ToString("0.######", CultureInfo.InvariantCulture)}, above the US${route.MaxCallUsd.ToString("0.######", CultureInfo.InvariantCulture)} allowed for one '{request.TaskType}' call. Send a shorter prompt or a lower max_tokens.");
            problem.Extensions["terminal"] = false;
            throw problem;
        }

        var attribution = await context.ResolveAsync(request.Scope, request.RunId, request.EmployeeId, cancellationToken);
        var billable = !request.Repair;
        var expiresAt = clock.GetUtcNow().AddMinutes(credits.ReservationMinutes);
        var admission = await ledger.AdmitAsync(
            new ReservationRequest(attribution, request.TaskType, string.Join(",", route.Models), prepared.ReservedCredits, prepared.WorstCaseUsd, billable, expiresAt, request.IdempotencyKey, request.AppMonthlyCap),
            cancellationToken);

        if (admission is Refused refused)
        {
            // A budget refusal ends the run's spending for good. The overdraft limit does not: a
            // top-up restores everything at once (spec, Overdraft), so the run may resume after one.
            if (attribution.RunId is { } runId && refused.Code == Refusals.BudgetExhausted)
            {
                await context.MarkBudgetExhaustedAsync(attribution.OrganisationId, runId, CancellationToken.None);
            }

            throw BudgetExhausted(refused);
        }

        var admitted = (Admitted)admission;
        if (attribution.RunId is { } run)
        {
            await context.AppendEventAsync(attribution.OrganisationId, run, RunEventTypes.ModelRequested, new JsonObject
            {
                ["taskType"] = request.TaskType,
                ["model"] = route.Models[0],
                ["models"] = new JsonArray(route.Models.Select(m => (JsonNode)JsonValue.Create(m)!).ToArray()),
                ["maxTokens"] = prepared.MaxTokens,
                ["estimatedPromptTokens"] = prepared.PromptTokens,
                ["reservedCredits"] = admitted.Credits,
                ["callId"] = admitted.ReservationId.ToString(),
                ["billable"] = billable,
                ["employeeId"] = attribution.EmployeeId?.ToString(),
            }, CancellationToken.None);
        }

        return new AdmittedCall(prepared.Body, attribution, admitted.ReservationId, admitted.Credits, billable, request.TaskType);
    }

    public static EndgameProblem BudgetExhausted(Refused refused)
    {
        ArgumentNullException.ThrowIfNull(refused);
        var problem = refused.Code == Refusals.OverdraftLimit
            ? new EndgameProblem(402, Refusals.OverdraftLimit, "The overdraft limit is reached",
                $"{refused.Reason} Work stops until the organisation is topped up; do not retry it.")
            : new EndgameProblem(402, Refusals.BudgetExhausted, "The budget is exhausted",
                $"{refused.Reason} This is terminal for the run: do not retry it.");
        problem.Extensions["terminal"] = true;
        problem.Extensions["bindingScope"] = refused.BindingScope;
        problem.Extensions["headroomCredits"] = refused.Headroom;
        problem.Extensions["neededCredits"] = refused.Needed;
        return problem;
    }

    private async Task<ChatSettlement> SettleAsync(AdmittedCall call, ReplyFacts facts)
    {
        var cost = facts.CostUsd;
        var fromProvider = cost is not null;
        if (cost is null && facts.GenerationId is { } generationId)
        {
            cost = await LookUpGenerationCostAsync(generationId);
        }

        decimal settled;
        if (cost is null && facts.GenerationId is null)
        {
            // Nothing identifies a generation, so nothing was produced or charged.
            await ledger.ReleaseAsync(call.Attribution.OrganisationId, call.ReservationId, "no generation was reported", CancellationToken.None);
            settled = 0m;
        }
        else
        {
            var note = cost is null
                ? "cost not reported by the reply or the generation record; settled at the reservation"
                : fromProvider ? null : "cost taken from the generation record";
            settled = cost is null ? call.ReservedCredits : credits.ToCredits(cost.Value);
            await ledger.SettleAsync(new Settlement(call.Attribution.OrganisationId, call.ReservationId, settled, cost ?? 0m, facts.Model, facts.GenerationId, note), CancellationToken.None);
        }

        var result = new ChatSettlement(call.ReservationId, call.ReservedCredits, settled, call.Billable, facts.Model, facts.GenerationId, fromProvider);
        if (call.Attribution.RunId is { } runId)
        {
            await context.AppendEventAsync(call.Attribution.OrganisationId, runId, RunEventTypes.ModelReplied, new JsonObject
            {
                ["callId"] = call.ReservationId.ToString(),
                ["taskType"] = call.TaskType,
                ["tokens"] = new JsonObject { ["input"] = facts.PromptTokens, ["output"] = facts.CompletionTokens },
                ["model"] = facts.Model,
                ["promptTokens"] = facts.PromptTokens,
                ["completionTokens"] = facts.CompletionTokens,
                ["reasoningTokens"] = facts.ReasoningTokens,
                ["reservedCredits"] = call.ReservedCredits,
                ["settledCredits"] = settled,
                ["billable"] = call.Billable,
                ["costFromProvider"] = fromProvider,
                ["finishReason"] = facts.FinishReason,
                ["error"] = facts.Error?.DeepClone(),
            }, CancellationToken.None);
        }

        return result;
    }

    private async Task ReleaseAsync(AdmittedCall call, string reason) =>
        await ledger.ReleaseAsync(call.Attribution.OrganisationId, call.ReservationId, reason, CancellationToken.None);

    private async Task<decimal?> LookUpGenerationCostAsync(string generationId)
    {
        // The record appears 6 to 11 seconds after the call (ARCH-003); poll for a bounded time.
        var deadline = clock.GetUtcNow().AddSeconds(options.GenerationLookupSeconds);
        while (true)
        {
            try
            {
                if (await provider.GetGenerationCostAsync(generationId, CancellationToken.None) is { } cost)
                {
                    return cost;
                }
            }
            catch (HttpRequestException)
            {
                // Try again until the deadline.
            }

            if (clock.GetUtcNow() >= deadline)
            {
                return null;
            }

            await Task.Delay(TimeSpan.FromSeconds(2), clock);
        }
    }

    private static EndgameProblem UpstreamRefusal(int status, JsonNode? body, string raw)
    {
        var message = body?["error"]?["message"]?.GetValue<string>() ?? raw;
        var lowered = message.ToLowerInvariant();
        if (status is 404 or 400 && (lowered.Contains("max_price", StringComparison.Ordinal) || lowered.Contains("no endpoints", StringComparison.Ordinal) || lowered.Contains("price", StringComparison.Ordinal)))
        {
            var unreachable = new EndgameProblem(422, "ceiling_unreachable", "No provider can serve this call under its price ceiling", Truncate(message));
            unreachable.Extensions["terminal"] = false;
            return unreachable;
        }

        var problem = new EndgameProblem(502, "upstream_error", "The model provider refused the call", Truncate(message));
        problem.Extensions["upstreamStatus"] = status;
        return problem;
    }

    private static EndgameProblem UpstreamError(JsonNode error, ChatSettlement settlement)
    {
        var message = error["message"]?.ToString() ?? error.ToJsonString();
        var problem = new EndgameProblem(502, "upstream_error", "The model failed part-way through its answer", Truncate(message));
        problem.Extensions["settledCredits"] = settlement.SettledCredits;
        problem.Extensions["upstreamCode"] = error["code"]?.ToString();
        return problem;
    }

    private static JsonNode? TryParse(string text)
    {
        try
        {
            return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Truncate(string text) => text.Length <= MaxErrorText ? text : text[..MaxErrorText] + "…";

    private sealed record AdmittedCall(JsonObject Body, Attribution Attribution, Guid ReservationId, decimal ReservedCredits, bool Billable, string TaskType);

    /// <summary>What the gateway reads from a reply or from stream chunks: never the content.</summary>
    private sealed class ReplyFacts
    {
        public string? GenerationId { get; private set; }

        public string? Model { get; private set; }

        public decimal? CostUsd { get; private set; }

        public long? PromptTokens { get; private set; }

        public long? CompletionTokens { get; private set; }

        public long? ReasoningTokens { get; private set; }

        public string? FinishReason { get; private set; }

        public JsonNode? Error { get; private set; }

        public static ReplyFacts From(JsonNode? body)
        {
            var facts = new ReplyFacts();
            facts.Absorb(body);
            return facts;
        }

        public void Absorb(JsonNode? chunk)
        {
            if (chunk is not JsonObject o)
            {
                return;
            }

            GenerationId ??= Text(o["id"]);
            Model ??= Text(o["model"]);
            if (o["error"] is JsonNode error && error.GetValueKind() != JsonValueKind.Null)
            {
                Error ??= error.DeepClone();
            }

            if (o["choices"] is JsonArray { Count: > 0 } choices && Text(choices[0]?["finish_reason"]) is { } finish)
            {
                // Rule 8: the normalised finish reason, never the native one.
                FinishReason = finish;
            }

            if (o["usage"] is JsonObject usage)
            {
                CostUsd = Number(usage["cost"]) ?? CostUsd;
                PromptTokens = (long?)Number(usage["prompt_tokens"]) ?? PromptTokens;
                CompletionTokens = (long?)Number(usage["completion_tokens"]) ?? CompletionTokens;
                ReasoningTokens = (long?)Number(usage["completion_tokens_details"]?["reasoning_tokens"]) ?? ReasoningTokens;
            }
        }

        private static string? Text(JsonNode? node) =>
            node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

        private static decimal? Number(JsonNode? node) =>
            node is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<decimal>(out var d) ? d : null;
    }
}

/// <summary>A call ready to send: the upstream body and what was reserved for it.</summary>
public sealed record PreparedCall(JsonObject Body, int MaxTokens, long PromptTokens, decimal WorstCaseUsd, decimal ReservedCredits);
