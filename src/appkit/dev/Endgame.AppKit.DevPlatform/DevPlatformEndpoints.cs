using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Endgame.AppKit.DevPlatform;

/// <summary>
/// TEST DOUBLE. The platform API of src/appkit/PLATFORM-API.md, faked: same paths, same shapes,
/// same errors, with in-memory state and canned model replies. Plus <c>dev/*</c> control endpoints
/// a test uses to set things up and read back what happened.
/// </summary>
public static class DevPlatformEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Maps the fake platform API and its dev controls.</summary>
    /// <param name="endpoints">Where to map.</param>
    /// <param name="state">The fake's state.</param>
    /// <param name="appClient">An HttpClient addressed at the app's base, for schedule callbacks.</param>
    public static IEndpointRouteBuilder MapDevPlatform(this IEndpointRouteBuilder endpoints, DevPlatformState state, Func<HttpClient> appClient)
    {
        var platform = endpoints.MapGroup("platform/v1").AddEndpointFilter(async (ctx, next) =>
        {
            var auth = ctx.HttpContext.Request.Headers.Authorization.ToString();
            if (auth != $"Bearer {state.AppToken}")
            {
                return Problem(401, "app_token_invalid", "The app token is missing or wrong.");
            }

            return await next(ctx);
        });

        platform.MapPost("identity/resolve", (SessionBody body) =>
            state.Sessions.TryGetValue(body.Session ?? "", out var user)
                ? Results.Json(new { user, expiresAt = DateTimeOffset.UtcNow.AddHours(8) }, Json)
                : Problem(401, "session_invalid", "The session is unknown or has expired."));

        platform.MapPost("models/chat", (JsonObject body) =>
        {
            state.ModelCalls.Enqueue(body);
            if (state.BudgetExhausted)
            {
                return Problem(402, "budget_exhausted", "The app's credit budget is spent (dev platform).");
            }

            var messages = body["messages"]?.AsArray() ?? [];
            if (messages.Count == 0)
            {
                return Problem(400, "invalid_request", "messages is required and must not be empty.");
            }

            var last = messages[^1]?["content"]?.GetValue<string>() ?? "";
            var content = $"[dev platform] reply to: {last}";
            return Results.Json(new
            {
                content,
                model = "dev/echo",
                usage = new { inputTokens = Tokens(messages.ToJsonString()), outputTokens = Tokens(content) },
                credits = 0.001m,
            }, Json);
        });

        platform.MapGet("secrets/{name}", (string name) =>
            state.Secrets.TryGetValue(name, out var value)
                ? Results.Json(new { name, value, scope = "acme/labs/demo" }, Json)
                : Problem(404, "secret_not_found",
                    $"No secret named {name} is set on the app, its project, its division or the organisation."));

        platform.MapPost("email", (JsonObject body) =>
        {
            if (body["to"] is not JsonArray { Count: > 0 } || body["subject"] is null || body["text"] is null)
            {
                return Problem(400, "invalid_request", "to, subject and text are required.");
            }

            var id = "eml_" + Guid.NewGuid().ToString("N")[..12];
            body["id"] = id;
            state.Emails.Enqueue(body);
            return Results.Json(new { id }, Json, statusCode: 202);
        });

        platform.MapPut("schedules", (JsonObject body) =>
        {
            state.Schedules = body["schedules"]?.DeepClone();
            return Results.Json(new { schedules = state.Schedules }, Json);
        });

        platform.MapPut("webhooks", (JsonObject body) =>
        {
            state.Webhooks = body["webhooks"]?.DeepClone();
            return Results.Json(new { webhooks = state.Webhooks }, Json);
        });

        platform.MapPost("telemetry/events", (JsonObject body) =>
        {
            foreach (var e in body["events"]?.AsArray() ?? [])
            {
                if (e is JsonObject o)
                {
                    state.Events.Enqueue((JsonObject)o.DeepClone());
                }
            }

            return Results.Accepted();
        });

        platform.MapPost("otlp/v1/{signal}", async (string signal, HttpRequest request) =>
        {
            await request.Body.CopyToAsync(Stream.Null);
            state.OtlpRequests.AddOrUpdate(signal, 1, (_, n) => n + 1);
            return Results.Ok();
        });

        // ---- dev controls: test set-up and read-back. Never part of the real platform. ----
        var dev = endpoints.MapGroup("dev");
        dev.MapGet("state", () => Results.Json(state.Snapshot(), Json));
        dev.MapPost("sessions", (NewSession body) =>
            Results.Json(new { token = state.CreateSession(body.Email, body.Kind ?? EndgameUserKind.Member, body.DisplayName) }, Json));
        dev.MapPut("secrets/{name}", (string name, SecretBody body) =>
        {
            state.Secrets[name] = body.Value;
            return Results.NoContent();
        });
        dev.MapPost("budget", (BudgetBody body) =>
        {
            state.BudgetExhausted = body.Exhausted;
            return Results.NoContent();
        });
        dev.MapPost("schedules/{name}/run", async (string name) =>
        {
            var status = await RunScheduleAsync(state, appClient(), name);
            return Results.Json(new { status }, Json);
        });
        return endpoints;
    }

    /// <summary>Calls a schedule on the app exactly as the platform does: signed POST to <c>_platform/schedules/&lt;name&gt;</c>.</summary>
    public static async Task<int> RunScheduleAsync(DevPlatformState state, HttpClient app, string name, string? signWith = null)
    {
        var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { scheduledFor = DateTimeOffset.UtcNow }, Json));
        using var request = new HttpRequestMessage(HttpMethod.Post, $"_platform/schedules/{name}") { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        request.Headers.Add(CallbackSignature.Header, CallbackSignature.Create(signWith ?? state.AppToken, body, DateTimeOffset.UtcNow));
        using var response = await app.SendAsync(request);
        state.ScheduleRuns.Enqueue($"{name} {(int)response.StatusCode}");
        return (int)response.StatusCode;
    }

    private static int Tokens(string text) => Math.Max(1, text.Length / 4);

    private static IResult Problem(int status, string code, string detail) =>
        Results.Problem(statusCode: status, title: code.Replace('_', ' '), detail: detail, extensions: new Dictionary<string, object?> { ["code"] = code });

    private sealed record SessionBody(string? Session);

    private sealed record NewSession(string Email, EndgameUserKind? Kind, string? DisplayName);

    private sealed record SecretBody(string Value);

    private sealed record BudgetBody(bool Exhausted);
}
