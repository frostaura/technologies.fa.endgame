using Endgame.Application.Common;
using Endgame.Infrastructure.Platform;
using Microsoft.Extensions.Options;

namespace Endgame.ControlPlane.Endpoints;

public sealed record ResolveRequest(string? Session);

/// <summary>
/// <c>/platform/v1/*</c> — the platform API apps call (src/appkit/PLATFORM-API.md §3), authenticated by
/// the app token. Apps reach it only through the egress proxy; Edge never routes it from the public
/// side, and as a second fence a request Edge forwarded (it carries <c>X-Forwarded-Host</c>) is
/// answered as if nothing were here.
/// </summary>
internal static class PlatformEndpoints
{
    public static void MapPlatformApi(this RouteGroupBuilder platform)
    {
        platform.MapPost("/identity/resolve", async (ResolveRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
            await identity.ResolveAsync(AppTokenFilter.Caller(http), request.Session, ct) is { } resolved
                ? Results.Ok(new { resolved.User, resolved.ExpiresAt })
                : Problems.From(new EndgameProblem(401, "session_invalid", "The session is not valid", "The session is unknown, has expired, or is not a session for this app.")))
            .WithName("PlatformResolveIdentity").WithSummary("An app-scoped session token (X-Endgame-Session) to the user: an organisation member with their role on this app, or one of its end users.");

        platform.MapPost("/models/chat", async (AppChatRequest request, HttpContext http, AppModelService models, CancellationToken ct) =>
            Results.Ok(await models.ChatAsync(AppTokenFilter.Caller(http), request, ct)))
            .WithName("PlatformModelChat").WithSummary("A model call through the platform gateway, reserved before it is sent and charged to the app's cascade. 402 budget_exhausted / overdraft_limit are terminal.");

        platform.MapGet("/secrets/{name}", async (string name, HttpContext http, AppSecretService secrets, CancellationToken ct) =>
            Results.Ok(await secrets.GetAsync(AppTokenFilter.Caller(http), name, ct)))
            .WithName("PlatformGetSecret").WithSummary("A vault secret resolved through the cascade from the app upwards, with the level that set it.");

        platform.MapPost("/email", async (AppEmailRequest request, HttpContext http, AppEmailService email, CancellationToken ct) =>
            Results.Json(new { id = await email.QueueAsync(AppTokenFilter.Caller(http), request, ct) }, statusCode: StatusCodes.Status202Accepted))
            .WithName("PlatformSendEmail").WithSummary("Queues a transactional e-mail; it is sent only where SMTP is configured.");

        platform.MapPut("/schedules", async (SchedulesInput request, HttpContext http, AppDeclarationService declarations, CancellationToken ct) =>
            Results.Ok(await declarations.ReplaceSchedulesAsync(AppTokenFilter.Caller(http), request, ct)))
            .WithName("PlatformDeclareSchedules").WithSummary("Replaces the app's recurring jobs; the platform calls back POST <app>/_platform/schedules/<name>, signed.");

        platform.MapPut("/webhooks", async (WebhooksInput request, HttpContext http, AppDeclarationService declarations, CancellationToken ct) =>
            Results.Ok(await declarations.ReplaceWebhooksAsync(AppTokenFilter.Caller(http), request, ct)))
            .WithName("PlatformDeclareWebhooks").WithSummary("Replaces the app's inbound hooks; Edge admits POST <app>/hooks/<name> for them even when the app is private.");

        platform.MapPost("/telemetry/events", async (TelemetryEventsInput request, HttpContext http, TelemetryService telemetry, CancellationToken ct) =>
        {
            await telemetry.IngestEventsAsync(AppTokenFilter.Caller(http), request, ct);
            return Results.Accepted();
        })
        .WithName("PlatformTrackEvents").WithSummary("Custom product events, batched (at most 100).");

        platform.MapPost("/otlp/v1/{signal}", async (string signal, HttpContext http, TelemetryService telemetry, IOptions<TelemetryOptions> options, CancellationToken ct) =>
        {
            var max = options.Value.MaxBodyBytes;
            if (http.Request.ContentLength > max)
            {
                throw new EndgameProblem(413, "too_large", "Too large", $"An export is at most {max} bytes.");
            }

            using var buffer = new MemoryStream();
            await http.Request.Body.CopyToAsync(buffer, ct);
            if (buffer.Length > max)
            {
                throw new EndgameProblem(413, "too_large", "Too large", $"An export is at most {max} bytes.");
            }

            var contentType = http.Request.ContentType;
            await telemetry.IngestOtlpAsync(AppTokenFilter.Caller(http), signal, contentType, http.Request.Headers.ContentEncoding.ToString(), buffer.ToArray(), ct);
            // OTLP/HTTP success: an empty Export*ServiceResponse in the request's own encoding.
            return contentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true
                ? Results.Content("{}", "application/json")
                : Results.Bytes([], "application/x-protobuf");
        })
        .WithName("PlatformOtlp").WithSummary("OTLP/HTTP intake for traces, metrics and logs (protobuf or JSON), attributed to the app by its token.");
    }
}

/// <summary>
/// Guards <c>/platform/v1/*</c>: <c>Authorization: Bearer &lt;app token&gt;</c>, resolved to the app and its
/// whole cascade path, which every handler and every log line of the request is attributed to.
/// </summary>
internal sealed class AppTokenFilter(AppTokenService tokens, ILogger<AppTokenFilter> logger) : IEndpointFilter
{
    public static AppCaller Caller(HttpContext http) =>
        http.Items[AppCaller.ItemKey] as AppCaller ?? throw new InvalidOperationException("The app token filter did not run.");

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var http = context.HttpContext;
        if (http.Request.Headers.ContainsKey("X-Forwarded-Host") || http.Request.Headers.ContainsKey("X-Original-Host"))
        {
            // Came through Edge's public side: the platform API is not there.
            return Problems.From(new EndgameProblem(404, "not_found", "Not found", "There is nothing at this address."));
        }

        var header = http.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header["Bearer ".Length..].Trim() : null;
        var caller = await tokens.AuthenticateAsync(token, http.RequestAborted);
        if (caller is null)
        {
            return Problems.From(new EndgameProblem(401, "app_token_invalid", "App token required",
                "The platform API needs the app's token (ENDGAME_APP_TOKEN) as a bearer token; this one is missing, unknown or superseded."));
        }

        http.Items[AppCaller.ItemKey] = caller;
        using (logger.BeginScope(new Dictionary<string, object> { ["AppId"] = caller.AppId, ["Scope"] = caller.Path }))
        {
            return await next(context);
        }
    }
}
