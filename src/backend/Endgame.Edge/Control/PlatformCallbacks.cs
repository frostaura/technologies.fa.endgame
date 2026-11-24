using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Control;

/// <summary>
/// Platform-to-app callbacks (ARCH-004, "Platform → app callbacks"): the control plane posts a
/// schedule run to the edge's control listener, which apps cannot reach; the edge wakes the app if
/// it sleeps and forwards the body and <c>X-Endgame-Signature</c> unchanged to the app's own
/// <c>_platform/schedules/&lt;name&gt;</c> on its network, then answers with the app's status. The
/// edge never signs anything: the app checks the signature against its own token.
/// </summary>
public static partial class PlatformCallbacks
{
    public const string ClientName = "app-callbacks";
    public const int MaxBodyBytes = 64 * 1024;

    public static async Task<IResult> ScheduleAsync(Guid id, string name, HttpContext context, AppRegistry registry, IAppBackend backend,
        IHttpClientFactory http, IOptions<EdgeOptions> options, ILoggerFactory loggers)
    {
        var logger = loggers.CreateLogger(typeof(PlatformCallbacks));
        if (!Slug().IsMatch(name))
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "A schedule's name is a lowercase slug.");
        }

        var signature = context.Request.Headers[Callbacks.SignatureHeader].ToString();
        if (signature.Length is 0 or > 512)
        {
            return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: $"A callback carries {Callbacks.SignatureHeader}.");
        }

        if (registry.Get(id) is not { } app)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "The edge routes no such app.");
        }

        if (app.Route.Availability != AppAvailability.Available)
        {
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: $"The app is {app.Route.Availability}; it is not called back.");
        }

        var body = new MemoryStream();
        await context.Request.Body.CopyToAsync(body, context.RequestAborted);
        if (body.Length > MaxBodyBytes)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "A callback body is at most 64 KB.");
        }

        app.Enter();
        try
        {
            if (!app.Awake)
            {
                var outcome = await app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(options.Value.WakeTimeoutSeconds), context.RequestAborted);
                if (outcome != WakeOutcome.Awake)
                {
                    logger.LogInformation("App {AppId} could not be woken for schedule {Name}: {Outcome}.", id, name, outcome);
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: $"The app could not be woken ({outcome}).");
                }
            }

            using var forward = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(app.Route.Target), $"{HostingConventions.PlatformCallbackPath.TrimStart('/')}/schedules/{name}"))
            {
                Content = new ByteArrayContent(body.ToArray()),
            };
            forward.Content.Headers.ContentType = MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var type) ? type : new MediaTypeHeaderValue("application/json");
            forward.Headers.TryAddWithoutValidation(Callbacks.SignatureHeader, signature);
            try
            {
                using var answer = await http.CreateClient(ClientName).SendAsync(forward, context.RequestAborted);
                return Results.StatusCode((int)answer.StatusCode);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !context.RequestAborted.IsCancellationRequested)
            {
                app.MarkAsleep();
                logger.LogWarning("Schedule {Name} could not reach app {AppId}: {Message}", name, id, e.Message);
                return Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: "The app did not answer the callback.");
            }
        }
        finally
        {
            app.Leave();
        }
    }

    [GeneratedRegex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")]
    private static partial Regex Slug();
}
