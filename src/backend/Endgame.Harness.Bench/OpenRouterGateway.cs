using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Credits;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;

namespace Endgame.Harness.Bench;

/// <summary>What OpenRouter says about one model: its parameters, its dearest provider's prices, its output limit.</summary>
public sealed record ModelFacts(string Id, IReadOnlySet<string> Parameters, decimal PromptPerToken, decimal CompletionPerToken, int MaxOutput);

/// <summary>
/// The benchmark's stand-in for the control plane's <c>POST /internal/model/chat</c>, in process:
/// it does what the gateway does (ARCH-003) — sends only the parameters the model lists as supported,
/// sets reasoning explicitly where it can, clamps output, reserves the worst case against the dearest
/// provider and sends that same ceiling as <c>max_price</c>, pins the provider the harness asks for,
/// settles from the reply's own cost — and appends <c>model.requested</c> / <c>model.replied</c> to the
/// run log as the gateway does. The harness on top of it is the production harness, unchanged.
/// </summary>
public sealed class OpenRouterGateway : IModelClient, IDisposable
{
    private readonly HttpClient http;
    private readonly SpendLedger ledger;
    private readonly Dictionary<string, ModelFacts> facts = new(StringComparer.Ordinal);

    public OpenRouterGateway(string apiKey, SpendLedger ledger)
    {
        this.ledger = ledger;
        http = new HttpClient { BaseAddress = new Uri("https://openrouter.ai"), Timeout = TimeSpan.FromMinutes(6) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        http.DefaultRequestHeaders.Add("X-Title", "FrostAura Endgame harness benchmark");
    }

    /// <summary>The model every call of a run is routed to: the benchmark measures one tier at a time.</summary>
    public required Func<ChatCall, string> Route { get; init; }

    /// <summary>Where the gateway's own events go, per run.</summary>
    public required Func<ChatCall, IEventSink?> Log { get; init; }

    public async Task LoadAsync(IEnumerable<string> models, CancellationToken cancellationToken)
    {
        var list = JsonNode.Parse(await http.GetStringAsync("/api/v1/models", cancellationToken))!["data"]!.AsArray();
        foreach (var id in models)
        {
            var model = list.OfType<JsonObject>().FirstOrDefault(m => Json.Str(m, "id") == id)
                ?? throw new InvalidOperationException($"OpenRouter does not list '{id}': never route to an unvalidated id (ARCH-003 rule 7).");
            var endpoints = JsonNode.Parse(await http.GetStringAsync($"/api/v1/models/{id}/endpoints", cancellationToken))!["data"]!["endpoints"] as JsonArray ?? [];
            decimal Price(JsonNode? n) => decimal.TryParse(n?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0m;
            var prompt = endpoints.OfType<JsonObject>().Select(e => Price(e["pricing"]?["prompt"])).DefaultIfEmpty(Price(model["pricing"]?["prompt"])).Max();
            var completion = endpoints.OfType<JsonObject>().Select(e => Price(e["pricing"]?["completion"])).DefaultIfEmpty(Price(model["pricing"]?["completion"])).Max();
            var maxOutput = Json.Int(model["top_provider"] as JsonObject, "max_completion_tokens") ?? 16_000;
            var parameters = Json.Strings(model, "supported_parameters").ToHashSet(StringComparer.Ordinal);
            facts[id] = new ModelFacts(id, parameters, prompt, completion, maxOutput);
        }
    }

    public ModelFacts Facts(string model) => facts[model];

    public async Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var model = Facts(Route(call));
        var maxTokens = Math.Min(call.MaxTokens, model.MaxOutput);
        var body = new JsonObject
        {
            ["model"] = model.Id,
            ["messages"] = call.Messages.DeepClone(),
            ["max_tokens"] = maxTokens,
            ["usage"] = new JsonObject { ["include"] = true },
            ["provider"] = new JsonObject
            {
                ["require_parameters"] = true,
                ["max_price"] = new JsonObject { ["prompt"] = model.PromptPerToken * 1_000_000m, ["completion"] = model.CompletionPerToken * 1_000_000m },
            },
        };
        if (call.ProviderOrder is { Count: > 0 } order)
        {
            body["provider"]!["order"] = Json.Array(order);
        }

        if (call.Tools is { Count: > 0 } tools)
        {
            body["tools"] = tools.DeepClone();
            if (model.Parameters.Contains("tool_choice"))
            {
                body["tool_choice"] = "auto";
            }

            if (model.Parameters.Contains("parallel_tool_calls"))
            {
                body["parallel_tool_calls"] = false;
            }
        }

        if (model.Parameters.Contains("reasoning"))
        {
            body["reasoning"] = new JsonObject { ["effort"] = "low" };
        }

        if (model.Parameters.Contains("temperature"))
        {
            body["temperature"] = 0.2;
        }

        // Reserve the worst case before the call: the prompt by ARCH-003's formula, every output token, at the dearest provider.
        var promptTokens = ReservationFormula.EstimatePromptTokens(Encoding.UTF8.GetByteCount(body.ToJsonString()), call.Messages.Count);
        var worst = (promptTokens * model.PromptPerToken) + (maxTokens * model.CompletionPerToken);
        if (!ledger.TryReserve(worst, out var refusal))
        {
            throw new ModelCallException(ModelFailure.BudgetExhausted, $"budget_exhausted: {refusal}");
        }

        var sink = Log(call);
        if (sink is not null)
        {
            await sink.AppendAsync([new RunEvent(Endgame.Domain.Runs.RunEventTypes.ModelRequested, new JsonObject { ["taskType"] = call.TaskType, ["model"] = model.Id, ["maxTokens"] = maxTokens, ["reservedUsd"] = worst })], cancellationToken);
        }

        decimal cost = 0;
        var clock = Stopwatch.StartNew();
        try
        {
            using var response = await http.PostAsync("/api/v1/chat/completions", new StringContent(body.ToJsonString(Json.Compact), Encoding.UTF8, "application/json"), cancellationToken);
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            var reply = GatewayModelClient.TryParse(text) as JsonObject;
            cost = Json.Dec(reply?["usage"] as JsonObject, "cost") ?? 0m;
            if (!response.IsSuccessStatusCode)
            {
                throw Refusal(response.StatusCode, reply, text);
            }

            var result = GatewayModelClient.FromCompletion(reply!, worst * 100m, cost * 100m);
            if (sink is not null)
            {
                await sink.AppendAsync([new RunEvent(Endgame.Domain.Runs.RunEventTypes.ModelReplied, new JsonObject
                {
                    ["model"] = result.Model,
                    ["provider"] = result.Provider,
                    ["promptTokens"] = result.PromptTokens,
                    ["completionTokens"] = result.CompletionTokens,
                    ["cachedTokens"] = result.CachedTokens,
                    ["costUsd"] = cost,
                    ["settledCredits"] = cost * 100m,
                    ["billable"] = !call.Repair,
                    ["ms"] = clock.ElapsedMilliseconds,
                    ["finishReason"] = result.FinishReason,
                })], cancellationToken);
            }

            return result;
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new ModelCallException(ModelFailure.Timeout, "OpenRouter did not answer in time.");
        }
        catch (HttpRequestException e)
        {
            throw new ModelCallException(ModelFailure.ServerError, $"OpenRouter could not be reached: {e.Message}");
        }
        finally
        {
            ledger.Settle(worst, cost);
        }
    }

    public void Dispose() => http.Dispose();

    private static ModelCallException Refusal(HttpStatusCode status, JsonObject? reply, string text)
    {
        var message = reply?["error"]?["message"]?.ToString() ?? OutputText.Truncate(text, 400);
        var failure = (int)status switch
        {
            402 => ModelFailure.BudgetExhausted,
            429 => ModelFailure.RateLimited,
            408 or 504 => ModelFailure.Timeout,
            404 when message.Contains("endpoint", StringComparison.OrdinalIgnoreCase) || message.Contains("price", StringComparison.OrdinalIgnoreCase) => ModelFailure.CeilingUnreachable,
            >= 500 => ModelFailure.ServerError,
            _ => ModelFailure.BadRequest,
        };
        return new ModelCallException(failure, $"{(int)status}: {message}");
    }

    /// <summary>The key from the environment or the worktree's .env, by name only; the value is never printed.</summary>
    public static string? ReadKey(string startDirectory)
    {
        if (Environment.GetEnvironmentVariable("OPENROUTER_API_KEY") is { Length: > 0 } fromEnvironment)
        {
            return fromEnvironment;
        }

        for (var dir = new DirectoryInfo(startDirectory); dir is not null; dir = dir.Parent)
        {
            var file = Path.Combine(dir.FullName, ".env");
            if (File.Exists(file))
            {
                var line = File.ReadLines(file).FirstOrDefault(l => l.StartsWith("OPENROUTER_API_KEY=", StringComparison.Ordinal));
                if (line is not null)
                {
                    return line["OPENROUTER_API_KEY=".Length..].Trim().Trim('"');
                }
            }
        }

        return null;
    }
}
