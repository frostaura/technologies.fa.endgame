using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;

namespace Endgame.Harness.Model;

/// <summary>
/// <see cref="IModelClient"/> over the control plane's <c>POST /internal/model/chat</c> (ARCH-003,
/// ARCH-004): the only path from the Runner to a model. The Runner never holds the OpenRouter key.
/// Replies are streamed and assembled into one assistant message, reasoning details included.
/// </summary>
public sealed class GatewayModelClient(HttpClient http, bool stream = true) : IModelClient
{
    public const string Path = "/internal/model/chat";

    public async Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        using var request = new HttpRequestMessage(HttpMethod.Post, Path)
        {
            Content = new StringContent(Body(call, stream).ToJsonString(Json.Compact), Encoding.UTF8, "application/json"),
        };
        if (stream)
        {
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        }

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new ModelCallException(ModelFailure.Timeout, "The model gateway did not answer in time.");
        }
        catch (HttpRequestException e)
        {
            throw new ModelCallException(ModelFailure.ServerError, $"The model gateway could not be reached: {e.Message}");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw await RefusalAsync(response, cancellationToken);
            }

            var media = response.Content.Headers.ContentType?.MediaType;
            if (media == "text/event-stream")
            {
                using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var reader = new StreamReader(body, Encoding.UTF8);
                var assembler = new StreamAssembler();
                string? line;
                string? eventName = null;
                try
                {
                    while ((line = await reader.ReadLineAsync(cancellationToken)) is not null)
                    {
                        if (line.Length == 0)
                        {
                            eventName = null;
                            continue;
                        }

                        if (line.StartsWith("event:", StringComparison.Ordinal))
                        {
                            eventName = line[6..].Trim();
                            continue;
                        }

                        if (!line.StartsWith("data:", StringComparison.Ordinal))
                        {
                            continue; // comments such as ": OPENROUTER PROCESSING"
                        }

                        var data = line[5..].Trim();
                        if (data == "[DONE]")
                        {
                            break;
                        }

                        var node = TryParse(data);
                        if (eventName == "endgame.settlement")
                        {
                            assembler.Settle(node as JsonObject);
                        }
                        else
                        {
                            assembler.Absorb(node as JsonObject);
                        }
                    }
                }
                catch (IOException e)
                {
                    throw new ModelCallException(ModelFailure.ServerError, $"The reply stream broke: {e.Message}", assembler.SettledCredits);
                }
                catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    throw new ModelCallException(ModelFailure.Timeout, "The reply stream stalled.", assembler.SettledCredits);
                }

                return assembler.Finish();
            }

            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            var reply = TryParse(text) as JsonObject ?? throw new ModelCallException(ModelFailure.EmptyReply, "The gateway answered with no JSON body.");
            var settled = Header(response, "Endgame-Settled-Credits");
            var reserved = Header(response, "Endgame-Reserved-Credits");
            return FromCompletion(reply, reserved, settled);
        }
    }

    /// <summary>The request body, in the shape of the control plane's <c>ChatRequest</c>.</summary>
    public static JsonObject Body(ChatCall call, bool stream)
    {
        ArgumentNullException.ThrowIfNull(call);
        var body = new JsonObject
        {
            ["taskType"] = call.TaskType,
            ["scope"] = call.Scope,
            ["runId"] = call.RunId?.ToString(),
            ["employeeId"] = call.EmployeeId?.ToString(),
            ["messages"] = call.Messages.DeepClone(),
            ["limits"] = new JsonObject { ["maxTokens"] = call.MaxTokens },
            ["stream"] = stream,
            ["repair"] = call.Repair,
            ["idempotencyKey"] = call.IdempotencyKey,
        };
        if (call.Tools is { Count: > 0 } tools)
        {
            body["tools"] = tools.DeepClone();
        }

        if (call.ToolChoice is not null)
        {
            body["toolChoice"] = call.ToolChoice;
        }

        if (call.ProviderOrder is { Count: > 0 } order)
        {
            // Needs the control plane to pass it on as provider.order (see the lane report).
            body["providerOrder"] = Json.Array(order);
        }

        return body;
    }

    /// <summary>A non-streamed chat completion, read into a reply.</summary>
    public static ModelReply FromCompletion(JsonObject reply, decimal reserved, decimal settled)
    {
        ArgumentNullException.ThrowIfNull(reply);
        if (reply["error"] is JsonObject error)
        {
            throw new ModelCallException(ModelFailure.ServerError, $"The model failed: {error["message"]}", settled);
        }

        var choice = (reply["choices"] as JsonArray)?.FirstOrDefault() as JsonObject;
        if (choice?["message"] is not JsonObject message)
        {
            throw new ModelCallException(ModelFailure.EmptyReply, "The reply carried no message.", settled);
        }

        var usage = reply["usage"] as JsonObject;
        var result = new ModelReply(
            message.DeepClone().AsObject(),
            choice["finish_reason"]?.GetValue<string>(),
            reply["model"]?.GetValue<string>(),
            reply["provider"]?.GetValue<string>(),
            Long(usage?["prompt_tokens"]),
            Long(usage?["completion_tokens"]),
            Long(usage?["prompt_tokens_details"]?["cached_tokens"]),
            reserved,
            settled,
            true);
        return StreamAssembler.IsEmpty(result.Message)
            ? throw new ModelCallException(ModelFailure.EmptyReply, "The model replied with nothing: no text and no tool call.", settled)
            : result;
    }

    internal static async Task<ModelCallException> RefusalAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var problem = TryParse(text) as JsonObject;
        var code = problem?["code"]?.GetValue<string>() ?? "";
        var detail = problem?["detail"]?.GetValue<string>() ?? problem?["title"]?.GetValue<string>() ?? text;
        var status = (int)response.StatusCode;
        var upstream = problem?["upstreamStatus"] is JsonValue v && v.TryGetValue<int>(out var u) ? u : 0;
        var failure = (status, code) switch
        {
            (402, _) or (_, "budget_exhausted") => ModelFailure.BudgetExhausted,
            (422, _) or (_, "ceiling_unreachable") => ModelFailure.CeilingUnreachable,
            (409, _) => ModelFailure.RunClosed,
            (429, _) => ModelFailure.RateLimited,
            (504, _) => ModelFailure.Timeout,
            (502, _) when upstream == 429 => ModelFailure.RateLimited,
            (502, _) when upstream is >= 400 and < 500 and not 408 => ModelFailure.BadRequest,
            ( >= 500, _) => ModelFailure.ServerError,
            (408, _) => ModelFailure.Timeout,
            _ => ModelFailure.BadRequest,
        };
        return new ModelCallException(failure, $"{(int)response.StatusCode} {code}: {detail}");
    }

    private static decimal Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) && decimal.TryParse(values.FirstOrDefault(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0m;

    public static JsonNode? TryParse(string text)
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

    internal static long Long(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var l) ? l : 0;
}

/// <summary>
/// Assembles streamed chat-completion chunks into the one assistant message they describe: content,
/// reasoning and reasoning details concatenated, tool calls merged by index with their ids kept
/// exactly as issued (ARCH-003 rule 8). Every chunk is checked for an error (rule 10).
/// </summary>
public sealed class StreamAssembler
{
    private readonly StringBuilder content = new();
    private readonly StringBuilder reasoning = new();
    private readonly SortedDictionary<int, JsonObject> details = [];
    private readonly SortedDictionary<int, (string? Id, string? Type, StringBuilder Name, StringBuilder Arguments)> calls = [];
    private bool sawContent;
    private string? finish;
    private string? model;
    private string? provider;
    private long prompt;
    private long completion;
    private long cached;
    private string? error;
    private bool settledSeen;
    private bool billable = true;

    public decimal ReservedCredits { get; private set; }

    public decimal SettledCredits { get; private set; }

    public void Absorb(JsonObject? chunk)
    {
        if (chunk is null)
        {
            return;
        }

        model ??= chunk["model"]?.GetValue<string>();
        provider ??= chunk["provider"]?.GetValue<string>();
        if (chunk["error"] is JsonNode e && e.GetValueKind() != JsonValueKind.Null)
        {
            error ??= e["message"]?.ToString() ?? e.ToJsonString();
        }

        if (chunk["usage"] is JsonObject usage)
        {
            prompt = GatewayModelClient.Long(usage["prompt_tokens"]);
            completion = GatewayModelClient.Long(usage["completion_tokens"]);
            cached = GatewayModelClient.Long(usage["prompt_tokens_details"]?["cached_tokens"]);
        }

        if ((chunk["choices"] as JsonArray)?.FirstOrDefault() is not JsonObject choice)
        {
            return;
        }

        if (choice["finish_reason"] is JsonValue f && f.TryGetValue<string>(out var reason))
        {
            finish = reason;
        }

        if (choice["delta"] is not JsonObject delta)
        {
            return;
        }

        if (delta["content"] is JsonValue c && c.TryGetValue<string>(out var text))
        {
            sawContent = true;
            content.Append(text);
        }

        if (delta["reasoning"] is JsonValue r && r.TryGetValue<string>(out var thought))
        {
            reasoning.Append(thought);
        }

        if (delta["reasoning_details"] is JsonArray parts)
        {
            foreach (var part in parts.OfType<JsonObject>())
            {
                var index = part["index"] is JsonValue iv && iv.TryGetValue<int>(out var i) ? i : details.Count;
                if (!details.TryGetValue(index, out var existing))
                {
                    details[index] = part.DeepClone().AsObject();
                    continue;
                }

                foreach (var (key, value) in part)
                {
                    if (key is "text" or "summary" or "data" or "signature" && value is JsonValue sv && sv.TryGetValue<string>(out var piece)
                        && existing[key] is JsonValue ev && ev.TryGetValue<string>(out var sofar))
                    {
                        existing[key] = sofar + piece;
                    }
                    else if (existing[key] is null)
                    {
                        existing[key] = value?.DeepClone();
                    }
                }
            }
        }

        if (delta["tool_calls"] is JsonArray toolCalls)
        {
            foreach (var call in toolCalls.OfType<JsonObject>())
            {
                var index = call["index"] is JsonValue iv && iv.TryGetValue<int>(out var i) ? i : calls.Count;
                if (!calls.TryGetValue(index, out var entry))
                {
                    entry = (null, null, new StringBuilder(), new StringBuilder());
                }

                entry.Id ??= call["id"]?.GetValue<string>();
                entry.Type ??= call["type"]?.GetValue<string>();
                if (call["function"] is JsonObject fn)
                {
                    if (fn["name"] is JsonValue n && n.TryGetValue<string>(out var name))
                    {
                        entry.Name.Append(name);
                    }

                    switch (fn["arguments"])
                    {
                        case JsonValue a when a.TryGetValue<string>(out var args):
                            entry.Arguments.Append(args);
                            break;
                        case JsonObject o:
                            entry.Arguments.Append(o.ToJsonString());
                            break;
                    }
                }

                calls[index] = entry;
            }
        }
    }

    /// <summary>The gateway's own <c>endgame.settlement</c> event, written before <c>[DONE]</c>.</summary>
    public void Settle(JsonObject? settlement)
    {
        if (settlement is null)
        {
            return;
        }

        settledSeen = true;
        ReservedCredits = Dec(settlement["reservedCredits"]);
        SettledCredits = Dec(settlement["settledCredits"]);
        billable = settlement["billable"] is not JsonValue b || !b.TryGetValue<bool>(out var x) || x;
        model ??= settlement["model"]?.GetValue<string>();
        if (settlement["error"] is JsonNode e && e.GetValueKind() != JsonValueKind.Null)
        {
            error ??= e["message"]?.ToString() ?? e.ToJsonString();
        }
    }

    public ModelReply Finish()
    {
        if (error is not null)
        {
            throw new ModelCallException(ModelFailure.ServerError, $"The model failed part-way through its answer: {error}", SettledCredits);
        }

        var message = new JsonObject { ["role"] = "assistant", ["content"] = sawContent || calls.Count == 0 ? content.ToString() : null };
        if (reasoning.Length > 0)
        {
            message["reasoning"] = reasoning.ToString();
        }

        if (details.Count > 0)
        {
            message["reasoning_details"] = new JsonArray(details.Values.Select(d => (JsonNode)d).ToArray());
        }

        if (calls.Count > 0)
        {
            message["tool_calls"] = new JsonArray(calls.Values.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id,
                ["type"] = c.Type ?? "function",
                ["function"] = new JsonObject { ["name"] = c.Name.ToString(), ["arguments"] = c.Arguments.ToString() },
            }).ToArray());
        }

        if (IsEmpty(message))
        {
            throw new ModelCallException(ModelFailure.EmptyReply, "The model replied with nothing: no text and no tool call.", SettledCredits);
        }

        _ = settledSeen;
        return new ModelReply(message, finish, model, provider, prompt, completion, cached, ReservedCredits, SettledCredits, billable);
    }

    internal static bool IsEmpty(JsonObject message) =>
        message["tool_calls"] is not JsonArray { Count: > 0 }
        && string.IsNullOrWhiteSpace(message["content"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null);

    private static decimal Dec(JsonNode? node) => node is JsonValue v && v.TryGetValue<decimal>(out var d) ? d : 0m;
}

/// <summary>Reads a problem-details refusal from any internal API (control plane or Dock).</summary>
public sealed class ServiceProblemException(HttpStatusCode status, string code, string detail) : Exception($"{(int)status} {code}: {detail}")
{
    public HttpStatusCode Status { get; } = status;

    public string Code { get; } = code;

    public string Detail { get; } = detail;

    public static async Task<ServiceProblemException> FromAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(response);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        var problem = GatewayModelClient.TryParse(text) as JsonObject;
        var code = problem?["code"]?.GetValue<string>() ?? response.StatusCode.ToString();
        var detail = problem?["detail"]?.GetValue<string>() ?? problem?["title"]?.GetValue<string>() ?? OutputText.Truncate(text, 500);
        return new ServiceProblemException(response.StatusCode, code, detail);
    }
}
