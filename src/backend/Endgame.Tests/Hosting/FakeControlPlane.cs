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

    /// <summary>The one hand-off code this fake redeems, once.</summary>
    public const string HandoffCode = "good-handoff-code";

    /// <summary>The app-session value a redeemed hand-off sets; the access check admits it.</summary>
    public const string HandedOffSession = "handed-off-session";
    public static readonly Guid MemberId = Guid.Parse("0e0e0e0e-1111-2222-3333-444444444444");

    private readonly WebApplication app;
    private readonly string token;
    private RoutingTable table = new(DateTimeOffset.UtcNow, []);
    private int version;

    private FakeControlPlane(WebApplication app, string token)
    {
        this.app = app;
        this.token = token;
    }

    public Uri Address { get; private set; } = null!;

    public int Port => Address.Port;

    public ConcurrentQueue<(Guid AppId, PublishedReport Report)> Published { get; } = new();

    public ConcurrentQueue<(Guid AppId, ControlPlaneAppState Report)> States { get; } = new();

    public ConcurrentQueue<AccessCheckRequest> AccessChecks { get; } = new();

    /// <summary>Every platform-API path an app called.</summary>
    public ConcurrentQueue<string> AppCalls { get; } = new();

    /// <summary>Every hosting-usage sample reported, by its sample id (a repeat is not added twice).</summary>
    public ConcurrentDictionary<string, HostingSample> HostingSamples { get; } = new();

    public int HostingReports;

    /// <summary>The return address a redeemed hand-off sends the visitor to.</summary>
    public string HandoffReturnTo { get; set; } = "";

    private int handoffUsed;

    public static string AppToken(Guid appId) => $"app-token-{appId:N}";

    public static string SessionFor(Guid appId) => $"app-session-{appId:N}";

    public int RouteReads;
    public int RouteNotModified;
    public volatile bool AccessDown;

    /// <summary>Answer the access check with 404 (an older control plane): the edge must stay closed, never decide alone.</summary>
    public volatile bool AccessCheckMissing;

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

    public void SetRoutes(params RouteView[] apps)
    {
        Interlocked.Increment(ref version);
        table = new RoutingTable(DateTimeOffset.UtcNow, apps);
    }

    /// <summary>Sends an ETag (the real control plane does not yet), so the edge's 304 path is exercised.</summary>
    public string ETag => $"\"v{Volatile.Read(ref version)}\"";

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
            var current = table with { GeneratedAt = DateTimeOffset.UtcNow };
            var etag = ETag;
            if (context.Request.Headers.IfNoneMatch.ToString() == etag)
            {
                Interlocked.Increment(ref RouteNotModified);
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            context.Response.Headers.ETag = etag;
            return Results.Json(current);
        });

        web.MapPost("/internal/apps/{id:guid}/published", (HttpContext context, Guid id, PublishedReport report) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            Published.Enqueue((id, report));
            return Results.NoContent();
        });

        web.MapPost("/internal/apps/{id:guid}/state", (HttpContext context, Guid id, ControlPlaneAppState report) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            States.Enqueue((id, report));
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

            if (AccessCheckMissing)
            {
                return Results.NotFound();
            }

            AccessChecks.Enqueue(request);
            var cookie = request.Cookie ?? "";
            if (cookie.Contains($"{PlatformCookies.MemberSession}={MemberSession}", StringComparison.Ordinal)
                || cookie.Contains($"{PlatformCookies.AppSession(request.AppId)}={HandedOffSession}", StringComparison.Ordinal))
            {
                return Results.Json(new AccessCheckResult(AccessDecisions.Allow, SessionFor(request.AppId), null));
            }

            if (cookie.Contains($"{PlatformCookies.MemberSession}={OutsiderSession}", StringComparison.Ordinal))
            {
                return Results.Json(new AccessCheckResult(AccessDecisions.Deny, null, null));
            }

            return Results.Json(new AccessCheckResult(AccessDecisions.SignIn, null, null));
        });

        web.MapPost("/internal/access/handoff", (HttpContext context, HandoffRequest request) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            return request.Code == HandoffCode && Interlocked.Exchange(ref handoffUsed, 1) == 0
                ? Results.Json(new HandoffRedeemed(PlatformCookies.AppSession(request.AppId), HandedOffSession, DateTimeOffset.UtcNow.AddDays(14), HandoffReturnTo))
                : Results.Json(new { code = "handoff_invalid" }, statusCode: StatusCodes.Status410Gone);
        });

        web.MapPost("/internal/usage/hosting", (HttpContext context, HostingUsageReport report) =>
        {
            if (!Authorised(context))
            {
                return Results.Unauthorized();
            }

            Interlocked.Increment(ref HostingReports);
            var recorded = report.Samples.Count(sample => HostingSamples.TryAdd(sample.SampleId, sample));
            return Results.Json(new HostingUsageRecorded(recorded, report.Samples.Count - recorded, 0.01m * recorded));
        });

        web.MapPost("/internal/apps/{id:guid}/token", (HttpContext context, Guid id) =>
            Authorised(context) ? Results.Json(new AppTokenResult(AppToken(id))) : Results.Unauthorized());

        // The platform API apps call (PLATFORM-API §3), through the egress proxy, with their token.
        var platform = web.MapGroup("/platform/v1");
        platform.MapPost("/identity/resolve", (HttpContext context, SessionBody body) =>
        {
            AppCalls.Enqueue(context.Request.Path.Value ?? "");
            return body.Session?.StartsWith("app-session-", StringComparison.Ordinal) == true
                ? Results.Json(new
                {
                    user = new { id = $"usr_{MemberId:N}", email = "member@endgame.test", displayName = "Member", kind = "member", role = "builder" },
                    expiresAt = DateTimeOffset.UtcNow.AddMinutes(10),
                })
                : Results.Json(new { code = "session_invalid" }, statusCode: StatusCodes.Status401Unauthorized);
        });
        platform.MapPut("/schedules", (HttpContext context, System.Text.Json.Nodes.JsonObject body) =>
        {
            AppCalls.Enqueue(context.Request.Path.Value ?? "");
            return Results.Json(body);
        });
        platform.MapPut("/webhooks", (HttpContext context, System.Text.Json.Nodes.JsonObject body) =>
        {
            AppCalls.Enqueue(context.Request.Path.Value ?? "");
            return Results.Json(body);
        });
        platform.MapPost("/telemetry/events", () => Results.Accepted());
        platform.MapPost("/otlp/v1/{signal}", () => Results.Ok());

        // The platform's public API and the console, reached through the edge's static routes.
        web.MapPost("/api/app-auth/{appId:guid}/sign-out", (HttpContext c) =>
        {
            AppCalls.Enqueue(c.Request.Path.Value ?? "");
            c.Response.Headers.Append("Set-Cookie", "endgame.app.cleared=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/");
            return Results.NoContent();
        });
        web.MapPost("/api/auth/logout", (HttpContext c) =>
        {
            AppCalls.Enqueue(c.Request.Path.Value ?? "");
            c.Response.Headers.Append("Set-Cookie", "endgame.session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/");
            return Results.NoContent();
        });
        web.MapGet("/api/{**rest}", (HttpContext c) => Results.Json(new
        {
            from = "control-plane",
            forwardedHost = c.Request.Headers["X-Forwarded-Host"].ToString(),
            forwardedProto = c.Request.Headers["X-Forwarded-Proto"].ToString(),
            origin = c.Request.Headers.Origin.ToString(),
        }));
        web.MapFallback(() => Results.Content("<!doctype html><div id=\"root\">console</div>", "text/html"));
    }

    private bool Authorised(HttpContext context) =>
        context.Request.Headers.Authorization.ToString() == $"{HostingConventions.ServiceTokenScheme} {token}";
}

public sealed record SessionBody(string? Session);
