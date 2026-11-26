using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// An in-test HTTP server that answers like OpenRouter (shapes from ARCH-003 and the 2026-11-24
/// spike): chat completions with <c>usage.cost</c>, streams whose last chunk carries the usage, an
/// error inside a 200, a mid-stream error, a refusal when no provider fits <c>max_price</c>, and the
/// generation record. Every request body it receives is kept for assertions.
/// </summary>
public sealed class FakeOpenRouter : IAsyncDisposable
{
    public const string Key = "sk-or-test-key";

    private readonly WebApplication app;

    private FakeOpenRouter(WebApplication app, string baseUrl)
    {
        this.app = app;
        BaseUrl = baseUrl;
    }

    public string BaseUrl { get; }

    public ConcurrentQueue<JsonObject> Requests { get; } = new();

    public ConcurrentQueue<string?> Authorizations { get; } = new();

    /// <summary>What the next chat call gets. Defaults to a plain completion costing US$0.0001.</summary>
    public Func<JsonObject, HttpContext, Task> Chat { get; set; } = Completion(0.0001m);

    public ConcurrentDictionary<string, decimal> Generations { get; } = new();

    /// <summary>When set, every chat call waits for it before answering (to hold calls in flight).</summary>
    public TaskCompletionSource? Gate { get; set; }

    public static async Task<FakeOpenRouter> StartAsync()
    {
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        var app = builder.Build();
        var fake = new FakeOpenRouter(app, $"http://127.0.0.1:{port}");
        app.MapPost("/api/v1/chat/completions", async (HttpContext http) =>
        {
            var body = (await JsonNode.ParseAsync(http.Request.Body))!.AsObject();
            fake.Requests.Enqueue(body);
            fake.Authorizations.Enqueue(http.Request.Headers.Authorization.ToString());
            if (fake.Gate is { } gate)
            {
                await gate.Task;
            }

            await fake.Chat(body, http);
        });
        app.MapGet("/api/v1/generation", (string id) => fake.Generations.TryGetValue(id, out var cost)
            ? Results.Json(new { data = new { id, total_cost = cost } })
            : Results.Json(new { error = new { code = 404, message = "Generation not found" } }, statusCode: 404));
        await app.StartAsync();
        return fake;
    }

    public async ValueTask DisposeAsync() => await app.DisposeAsync();

    public static JsonObject Usage(decimal? cost, int prompt = 12, int completion = 5) => new()
    {
        ["prompt_tokens"] = prompt,
        ["completion_tokens"] = completion,
        ["total_tokens"] = prompt + completion,
        ["completion_tokens_details"] = new JsonObject { ["reasoning_tokens"] = 0 },
        ["cost"] = cost,
    };

    /// <summary>A complete answer. <paramref name="toolCallId"/> adds a tool call with that exact id; <paramref name="finish"/> <c>length</c> is an answer cut at its token limit.</summary>
    public static Func<JsonObject, HttpContext, Task> Completion(decimal? cost, string content = "Hello.", string? toolCallId = null, string id = "gen-fake-1", string? finish = null) => async (request, http) =>
    {
        var message = new JsonObject { ["role"] = "assistant", ["content"] = content };
        if (toolCallId is not null)
        {
            message["tool_calls"] = new JsonArray(new JsonObject
            {
                ["id"] = toolCallId,
                ["type"] = "function",
                ["function"] = new JsonObject { ["name"] = "save_fact", ["arguments"] = "{\"fact\":\"x\"}" },
            });
        }

        var usage = Usage(cost);
        if (cost is null)
        {
            usage.Remove("cost");
        }

        await http.Response.WriteAsJsonAsync(new JsonObject
        {
            ["id"] = id,
            ["provider"] = "FakeProvider",
            ["model"] = request["model"]?.GetValue<string>(),
            ["object"] = "chat.completion",
            ["created"] = 1764000000,
            ["choices"] = new JsonArray(new JsonObject
            {
                ["index"] = 0,
                ["finish_reason"] = finish ?? (toolCallId is null ? "stop" : "tool_calls"),
                ["native_finish_reason"] = finish is "length" ? "MAX_TOKENS" : toolCallId is null ? "STOP" : "TOOL_USE",
                ["message"] = message,
            }),
            ["usage"] = usage,
        });
    };

    /// <summary>A 200 whose body carries an error once output had started (ARCH-003 rule 10).</summary>
    public static Func<JsonObject, HttpContext, Task> ErrorInside200(decimal cost) => async (_, http) =>
        await http.Response.WriteAsJsonAsync(new JsonObject
        {
            ["id"] = "gen-fake-error",
            ["model"] = "qwen/qwen3.7-flash",
            ["choices"] = new JsonArray(new JsonObject { ["index"] = 0, ["finish_reason"] = "error", ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = "" } }),
            ["error"] = new JsonObject { ["code"] = 502, ["message"] = "Provider returned error" },
            ["usage"] = Usage(cost),
        });

    public static Func<JsonObject, HttpContext, Task> Refuse(int status, string message) => async (_, http) =>
    {
        http.Response.StatusCode = status;
        await http.Response.WriteAsJsonAsync(new JsonObject { ["error"] = new JsonObject { ["code"] = status, ["message"] = message } });
    };

    /// <summary>A stream: a processing comment, content deltas, the last chunk with usage, then [DONE].</summary>
    public static Func<JsonObject, HttpContext, Task> Stream(decimal cost, params string[] pieces) => async (request, http) =>
    {
        http.Response.ContentType = "text/event-stream";
        await Line(http, ": OPENROUTER PROCESSING");
        await Line(http, "");
        foreach (var piece in pieces)
        {
            await Data(http, Chunk(request, new JsonObject { ["content"] = piece }, null, null));
        }

        await Data(http, Chunk(request, new JsonObject(), "stop", Usage(cost)));
        await Line(http, "data: [DONE]");
        await Line(http, "");
    };

    /// <summary>A stream that breaks part-way with an error chunk and no usage.</summary>
    public static Func<JsonObject, HttpContext, Task> StreamWithMidStreamError(string generationId = "gen-fake-stream") => async (request, http) =>
    {
        http.Response.ContentType = "text/event-stream";
        await Data(http, Chunk(request, new JsonObject { ["content"] = "Partial" }, null, null, generationId));
        var error = Chunk(request, new JsonObject { ["content"] = "" }, "error", null, generationId);
        error["error"] = new JsonObject { ["code"] = 502, ["message"] = "Upstream stopped mid-answer" };
        await Data(http, error);
    };

    private static JsonObject Chunk(JsonObject request, JsonObject delta, string? finish, JsonObject? usage, string id = "gen-fake-stream")
    {
        var chunk = new JsonObject
        {
            ["id"] = id,
            ["provider"] = "FakeProvider",
            ["model"] = request["model"]?.GetValue<string>(),
            ["object"] = "chat.completion.chunk",
            ["choices"] = new JsonArray(new JsonObject { ["index"] = 0, ["delta"] = delta, ["finish_reason"] = finish }),
        };
        if (usage is not null)
        {
            chunk["usage"] = usage;
        }

        return chunk;
    }

    private static async Task Data(HttpContext http, JsonObject chunk)
    {
        await Line(http, "data: " + chunk.ToJsonString());
        await Line(http, "");
    }

    private static async Task Line(HttpContext http, string line)
    {
        await http.Response.WriteAsync(line + "\n");
        await http.Response.Body.FlushAsync();
    }

    public static string Invariant(decimal value) => value.ToString(CultureInfo.InvariantCulture);
}
