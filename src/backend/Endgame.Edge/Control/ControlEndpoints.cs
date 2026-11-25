using System.Security.Cryptography;
using System.Text;
using Endgame.Edge.Routing;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Control;

/// <summary>
/// The edge's control interface, on its own listener (ARCH-005): the control plane pushes route
/// changes, Dock reports crashes. Every call carries the service token.
/// </summary>
public static class ControlEndpoints
{
    public static void MapEdgeControl(this IEndpointRouteBuilder app)
    {
        // Which listener a request arrived on is checked by the edge's first middleware (the local
        // port, never the Host header, which a published port rewrites); these carry the marker it looks for.
        var control = app.MapGroup("/internal").WithMetadata(new ControlEndpoint()).AddEndpointFilter<ServiceTokenFilter>();

        control.MapPost("/routes/refresh", async (RouteTableSource routes, CancellationToken ct) =>
        {
            var snapshot = await routes.RefreshAsync(ct);
            return Results.Ok(new RoutesRefreshed(snapshot.Version, snapshot.Apps.Count));
        });

        control.MapPost("/apps/{id:guid}/state", (Guid id, AppStateReport report, AppRegistry registry, IOptions<EdgeOptions> options) =>
        {
            var app = registry.Get(id);
            if (app is null)
            {
                return Results.NotFound();
            }

            switch (report.State)
            {
                case AppRuntimeState.Crashed:
                    app.MarkCrashed(TimeSpan.FromSeconds(options.Value.CrashBackoffSeconds));
                    break;
                case AppRuntimeState.Sleeping:
                case AppRuntimeState.NotProvisioned:
                    app.MarkAsleep();
                    break;
            }

            return Results.NoContent();
        });

        control.MapPost("/apps/{id:guid}/platform/schedules/{name}", PlatformCallbacks.ScheduleAsync);

        // The evaluator's look at a private preview: one request, as a signed-out visitor, never from the public side.
        control.MapPost("/apps/{id:guid}/probe", PreviewProbe.ProbeAsync);

        // The per-app MCP surface: the control plane calls an app's own API with a member's app-scoped session.
        control.MapMethods("/apps/{id:guid}/call/{**path}", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], AppCalls.CallAsync);

        control.MapGet("/apps", (AppRegistry registry) => registry.All.Select(a => new
        {
            a.Route.AppId,
            prefix = a.Route.PathPrefix,
            a.Route.Host,
            a.Route.HostPrefix,
            a.Awake,
            a.Crashed,
            a.InFlight,
            idleMs = (long)a.Idle.TotalMilliseconds,
            a.Wakes,
            a.Sleeps,
            a.LastWakeMs,
        }));

        control.MapPost("/usage/flush", async (UsageReporter usage, CancellationToken ct) => Results.Ok(new { taken = await usage.FlushAsync(ct) }));

        control.MapGet("/routes", (RouteTableSource routes) => new
        {
            routes.Current.Version,
            routes.Loaded,
            routes.LastSuccess,
            routes.LastError,
            apps = routes.Current.Apps.Count,
            rejected = routes.Current.Rejected,
        });
    }
}

/// <summary>Marks an endpoint of the control interface.</summary>
public sealed class ControlEndpoint;

/// <summary><c>Authorization: Bearer $ENDGAME_SERVICE_TOKEN</c>, compared in constant time.</summary>
public sealed class ServiceTokenFilter(IConfiguration configuration) : IEndpointFilter
{
    private readonly byte[]? expected = configuration[HostingConventions.ServiceTokenVariable] is { Length: >= 16 } token
        ? SHA256.HashData(Encoding.UTF8.GetBytes(token))
        : null;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var header = context.HttpContext.Request.Headers.Authorization.ToString();
        var prefix = HostingConventions.ServiceTokenScheme + " ";
        var presented = header.StartsWith(prefix, StringComparison.Ordinal) ? header[prefix.Length..] : "";
        if (expected is null || !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "A valid service token is required.");
        }

        return await next(context);
    }
}
