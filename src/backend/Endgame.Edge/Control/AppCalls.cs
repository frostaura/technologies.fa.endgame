using System.Net.Http.Headers;
using Endgame.Edge.Routing;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Control;

/// <summary>
/// <c>ANY /internal/apps/{id}/call/{**path}</c> (ARCH-004, <i>MCP</i>): the control plane calling an app's own
/// API for its per-app MCP surface. On the listener apps cannot reach and only with the service token, the edge
/// wakes the app if it sleeps and forwards the method, query, body, <c>Content-Type</c> and the
/// <c>X-Endgame-Session</c> the control plane minted for the member, to the app on its network at its path
/// address (forwarded prefix and host set as for any visitor), and returns the app's status, content type and
/// body. The platform's own paths are never called this way.
/// </summary>
public static class AppCalls
{
    public const string ClientName = "app-calls";
    public const int MaxRequestBody = 1024 * 1024;

    public static async Task<IResult> CallAsync(Guid id, string? path, HttpContext context, AppRegistry registry, RouteTableSource routes,
        IAppBackend backend, IHttpClientFactory http, IOptions<EdgeOptions> options, ILoggerFactory loggers)
    {
        var cancellationToken = context.RequestAborted;
        var relative = (path ?? "").TrimStart('/');
        if (relative.Length > 2000 || relative.Contains("://", StringComparison.Ordinal) || relative.Contains('\\', StringComparison.Ordinal)
            || relative.Split('/').Any(s => s is ".." or "." || Uri.UnescapeDataString(s) is ".." or ".")
            || relative.StartsWith(HostingConventions.PlatformCallbackPath.TrimStart('/'), StringComparison.OrdinalIgnoreCase)
            || relative.StartsWith(HostingConventions.AuthPath.TrimStart('/'), StringComparison.OrdinalIgnoreCase))
        {
            return Refuse(context, StatusCodes.Status400BadRequest, "An app call names a path inside the app, outside its _platform and _endgame paths.", "invalid_path");
        }

        if (context.Request.ContentLength is > MaxRequestBody)
        {
            return Refuse(context, StatusCodes.Status413PayloadTooLarge, "An app call's body is at most 1 MB.", "body_too_large");
        }

        // An app published a moment ago may not be in this edge's table yet.
        if (registry.Get(id) is null)
        {
            await routes.RefreshAsync(cancellationToken);
        }

        if (registry.Get(id) is not { } app)
        {
            return Refuse(context, StatusCodes.Status404NotFound, "The edge routes no such app.", "not_found");
        }

        if (app.Route.Availability != AppAvailability.Available)
        {
            return Refuse(context, StatusCodes.Status409Conflict, $"The app is {app.Route.Availability}; it is not called.", app.Route.Availability == AppAvailability.Paused ? "app_paused" : "app_unpublished");
        }

        var body = new MemoryStream();
        await context.Request.Body.CopyToAsync(body, cancellationToken);
        if (body.Length > MaxRequestBody)
        {
            return Refuse(context, StatusCodes.Status413PayloadTooLarge, "An app call's body is at most 1 MB.", "body_too_large");
        }

        var logger = loggers.CreateLogger(typeof(AppCalls));
        app.Enter();
        try
        {
            if (!app.Awake)
            {
                var outcome = await app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(options.Value.WakeTimeoutSeconds), cancellationToken);
                if (outcome != WakeOutcome.Awake)
                {
                    return Refuse(context, StatusCodes.Status503ServiceUnavailable, $"The app could not be woken ({outcome}).", "app_unavailable");
                }
            }

            var target = new Uri(new Uri(app.Route.Target.TrimEnd('/') + "/"), relative + context.Request.QueryString.Value);
            using var forward = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
            forward.Headers.TryAddWithoutValidation(HostingConventions.ForwardedPrefixHeader, app.Route.PathPrefix);
            var origin = Uri.TryCreate(options.Value.PlatformOrigin, UriKind.Absolute, out var o) ? o : null;
            forward.Headers.TryAddWithoutValidation("X-Forwarded-Host", origin?.Authority ?? "localhost");
            forward.Headers.TryAddWithoutValidation("X-Forwarded-Proto", options.Value.PublicScheme is { Length: > 0 } scheme ? scheme : origin?.Scheme ?? "http");
            var session = context.Request.Headers[HostingConventions.SessionHeader].ToString();
            if (session.Length is > 0 and <= 512)
            {
                forward.Headers.TryAddWithoutValidation(HostingConventions.SessionHeader, session);
            }

            var accept = context.Request.Headers.Accept.ToString();
            forward.Headers.TryAddWithoutValidation("Accept", accept.Length > 0 ? accept : "application/json");
            if (body.Length > 0 || !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) && !HttpMethods.IsDelete(context.Request.Method))
            {
                forward.Content = new ByteArrayContent(body.ToArray());
                if (MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var type))
                {
                    forward.Content.Headers.ContentType = type;
                }
            }

            HttpResponseMessage answer;
            try
            {
                answer = await http.CreateClient(ClientName).SendAsync(forward, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                app.MarkAsleep();
                logger.LogWarning("A call could not reach app {AppId}: {Message}", id, e.Message);
                return Refuse(context, StatusCodes.Status502BadGateway, "The app did not answer.", "app_unreachable");
            }

            using (answer)
            {
                context.Response.StatusCode = (int)answer.StatusCode;
                if (answer.Content.Headers.ContentType is { } contentType)
                {
                    context.Response.ContentType = contentType.ToString();
                }

                await answer.Content.CopyToAsync(context.Response.Body, cancellationToken);
                return Results.Empty;
            }
        }
        finally
        {
            app.Leave();
        }
    }

    /// <summary>Edge's own refusal: a problem with a stable code, marked so a caller never mistakes it for the app's answer.</summary>
    private static IResult Refuse(HttpContext context, int status, string title, string code)
    {
        context.Response.Headers[HostingConventions.RefusalHeader] = code;
        return Results.Problem(statusCode: status, title: title, extensions: new Dictionary<string, object?> { ["code"] = code });
    }
}
