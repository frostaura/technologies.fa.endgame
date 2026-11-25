using System.Net.Http.Headers;
using System.Text;
using Endgame.Edge.Routing;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Control;

/// <summary><c>POST /internal/apps/{id}/probe</c>: one request into an app's running preview.</summary>
public sealed record ProbeRequest(string? Method, string? Path, string? Body);

/// <summary>What the app answered; a body that is not text is described, never returned.</summary>
public sealed record ProbeAnswer(int Status, string ContentType, string Body, bool Truncated);

/// <summary>
/// The evaluator's way into a private preview (ARCH-004, <i>Edge — control listener</i>): on the listener
/// apps cannot reach and only with the service token, the edge sends ONE request to the app on its own
/// network — waking it if it sleeps — as a signed-out visitor at its path address (the prefix and
/// forwarded headers set as for any visitor, no session, no platform cookie), and returns the status,
/// the content type and the body. Nothing here is reachable from the public side, and an app sees
/// nothing it would not see from an anonymous browser.
/// </summary>
public static class PreviewProbe
{
    public const string ClientName = "app-probe";
    public const int MaxRequestBody = 64 * 1024;
    public const int MaxAnswerBody = 48 * 1024;

    private static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    public static async Task<IResult> ProbeAsync(Guid id, ProbeRequest request, AppRegistry registry, RouteTableSource routes, IAppBackend backend,
        IHttpClientFactory http, IOptions<EdgeOptions> options, ILoggerFactory loggers, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var method = (request.Method ?? "GET").Trim().ToUpperInvariant();
        if (!Methods.Contains(method))
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: $"method is one of {string.Join(", ", Methods)}.");
        }

        var path = (request.Path ?? "").Trim().TrimStart('/');
        if (path.Length > 2000 || path.Contains("://", StringComparison.Ordinal) || path.Contains('\\', StringComparison.Ordinal)
            || path.Split('?')[0].Split('/').Any(s => s is ".." or ".")
            || path.StartsWith(HostingConventions.PlatformCallbackPath.TrimStart('/'), StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(HostingConventions.AuthPath.TrimStart('/'), StringComparison.OrdinalIgnoreCase))
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "path is a path inside the app, relative to its address, outside its _platform and _endgame paths.");
        }

        if (request.Body is { Length: > MaxRequestBody })
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "A probe's body is at most 64 KB.");
        }

        // An app published a moment ago may not be in this edge's table yet.
        if (registry.Get(id) is null)
        {
            await routes.RefreshAsync(cancellationToken);
        }

        if (registry.Get(id) is not { } app)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "The edge routes no such app.");
        }

        if (app.Route.Availability == AppAvailability.Paused)
        {
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: "The app is paused; it is not probed.");
        }

        var logger = loggers.CreateLogger(typeof(PreviewProbe));
        app.Enter();
        try
        {
            if (!app.Awake)
            {
                var outcome = await app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(options.Value.WakeTimeoutSeconds), cancellationToken);
                if (outcome != WakeOutcome.Awake)
                {
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: $"The app could not be woken ({outcome}).");
                }
            }

            using var forward = new HttpRequestMessage(new HttpMethod(method), new Uri(new Uri(app.Route.Target.TrimEnd('/') + "/"), path));
            forward.Headers.TryAddWithoutValidation(HostingConventions.ForwardedPrefixHeader, app.Route.PathPrefix);
            var origin = Uri.TryCreate(options.Value.PlatformOrigin, UriKind.Absolute, out var o) ? o : null;
            forward.Headers.TryAddWithoutValidation("X-Forwarded-Host", origin?.Authority ?? "localhost");
            forward.Headers.TryAddWithoutValidation("X-Forwarded-Proto", options.Value.PublicScheme is { Length: > 0 } scheme ? scheme : origin?.Scheme ?? "http");
            forward.Headers.Accept.ParseAdd(method == "GET" && !path.Contains("api", StringComparison.OrdinalIgnoreCase) ? "text/html,application/json;q=0.9,*/*;q=0.8" : "application/json,*/*;q=0.8");
            if (request.Body is { Length: > 0 } body && method != "GET" && method != "DELETE")
            {
                forward.Content = new StringContent(body, Encoding.UTF8, "application/json");
            }

            try
            {
                using var answer = await http.CreateClient(ClientName).SendAsync(forward, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                var type = answer.Content.Headers.ContentType?.ToString() ?? "";
                var bytes = await ReadAsync(answer.Content, MaxAnswerBody + 1, cancellationToken);
                var truncated = bytes.Length > MaxAnswerBody;
                var text = IsText(answer.Content.Headers.ContentType)
                    ? Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, MaxAnswerBody))
                    : $"[{type} body, {bytes.Length}{(truncated ? "+" : "")} bytes, not shown]";
                return Results.Ok(new ProbeAnswer((int)answer.StatusCode, type, text, truncated));
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                app.MarkAsleep();
                logger.LogWarning("A probe could not reach app {AppId}: {Message}", id, e.Message);
                return Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: "The app did not answer.");
            }
        }
        finally
        {
            app.Leave();
        }
    }

    private static bool IsText(MediaTypeHeaderValue? type) =>
        type?.MediaType is null || type.MediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase)
        || type.MediaType.Contains("json", StringComparison.OrdinalIgnoreCase) || type.MediaType.Contains("xml", StringComparison.OrdinalIgnoreCase)
        || type.MediaType.Contains("javascript", StringComparison.OrdinalIgnoreCase);

    private static async Task<byte[]> ReadAsync(HttpContent content, int limit, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while (buffer.Length < limit && (read = await stream.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, limit - buffer.Length)), cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
