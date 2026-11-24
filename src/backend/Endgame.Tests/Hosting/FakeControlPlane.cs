using System.Collections.Concurrent;
using System.Net;
using Endgame.Hosting.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Hosting;

/// <summary>
/// The control plane as Edge and Dock see it (ARCH-004), in the test process: the routing table,
/// the access check, the reports Dock sends, and stand-ins for the console and the public API.
/// The real one is built in parallel by another lane; this follows the contract, not its code.
/// </summary>
public sealed class FakeControlPlane : IAsyncDisposable
{
    public const string MemberSession = "member-session";
    public const string OutsiderSession = "outsider-session";
    public static readonly Guid MemberId = Guid.Parse("0e0e0e0e-1111-2222-3333-444444444444");

    private readonly WebApplication app;
    private readonly string token;
    private RoutingTable table = new("empty", []);
    private int version;

    private FakeControlPlane(WebApplication app, string token)
    {
        this.app = app;
        this.token = token;
    }

    public Uri Address { get; private set; } = null!;

    public int Port => Address.Port;

    public ConcurrentQueue<AppPublished> Published { get; } = new();

    public ConcurrentQueue<AppStateReport> States { get; } = new();

    public ConcurrentQueue<AccessCheckRequest> AccessChecks { get; } = new();

    public int RouteReads;
    public int RouteNotModified;
    public volatile bool AccessDown;

    public static async Task<FakeControlPlane> StartAsync(string token, bool listenOnAllInterfaces = false)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseKestrel(k =>
        {
            if (listenOnAllInterfaces)
            {
                k.Listen(IPAddress.Any, 0);
            }
            else
            {
                k.Listen(IPAddress.Loopback, 0);
            }
        });
        var web = builder.Build();
        var fake = new FakeControlPlane(web, token);
        fake.Map(web);
        await web.StartAsync();
        var address = web.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        fake.Address = new Uri(address.Replace("0.0.0.0", "127.0.0.1", StringComparison.Ordinal));
        return fake;
    }

    public void SetRoutes(params AppRoute[] apps) => table = new RoutingTable($"v{Interlocked.Increment(ref version)}", apps);

    public RoutingTable Table => table;

    public ValueTask DisposeAsync() => app.DisposeAsync();

    private void Map(WebApplication web)
    {
        web.MapGet("/internal/routes", (HttpContext context) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            Interlocked.Increment(ref RouteReads);
            var current = table;
            var etag = $"\"{current.Version}\"";
            if (context.Request.Headers.IfNoneMatch.ToString() == etag)
            {
                Interlocked.Increment(ref RouteNotModified);
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            context.Response.Headers.ETag = etag;
            return Results.Json(current);
        });

        web.MapPost("/internal/apps/{id:guid}/published", (HttpContext context, Guid id, AppPublished report) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            Published.Enqueue(report);
            return Results.NoContent();
        });

        web.MapPost("/internal/apps/{id:guid}/state", (HttpContext context, Guid id, AppStateReport report) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            States.Enqueue(report);
            return Results.NoContent();
        });

        web.MapPost("/internal/access/check", (HttpContext context, AccessCheckRequest request) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            if (AccessDown)
            {
                return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }

            AccessChecks.Enqueue(request);
            var cookie = request.Cookie ?? "";
            if (cookie.Contains($"endgame_session={MemberSession}", StringComparison.Ordinal))
            {
                return Results.Json(new AccessCheckResult(AccessOutcome.Allowed, MemberId, null));
            }

            if (cookie.Contains($"endgame_session={OutsiderSession}", StringComparison.Ordinal))
            {
                return Results.Json(new AccessCheckResult(AccessOutcome.Forbidden, null, null));
            }

            return Results.Json(new AccessCheckResult(AccessOutcome.SignInRequired, null, $"/sign-in?returnTo={Uri.EscapeDataString(request.Path)}"));
        });

        // The platform's public API and the console, reached through the edge's static routes.
        web.MapGet("/api/{**rest}", () => Results.Json(new { from = "control-plane" }));
        web.MapFallback(() => Results.Content("<!doctype html><div id=\"root\">console</div>", "text/html"));
    }

    private bool Authorised(HttpContext context) =>
        context.Request.Headers.Authorization.ToString() == $"{HostingConventions.ServiceTokenScheme} {token}";
}
