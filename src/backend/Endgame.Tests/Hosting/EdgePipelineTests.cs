using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using Endgame.Edge;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Hosting;

/// <summary>
/// The edge's whole request pipeline, in process, on real sockets: a fake control plane, a fake
/// app echoing what it received, and a fake Dock. No Docker needed; the same behaviour is proven
/// against real containers in <see cref="HostingIntegrationTests"/>.
/// </summary>
public sealed class EdgePipelineTests : IAsyncLifetime
{
    private const string Token = "edge-pipeline-test-token-0123456789";
    private readonly FakeBackend backend = new() { Running = true, State = AppRuntimeState.Running };
    private FakeControlPlane controlPlane = null!;
    private WebApplication echo = null!;
    private WebApplication edge = null!;
    private Uri echoAddress = null!;
    private int publicPort;

    private string Target => echoAddress.ToString().TrimEnd('/');
    private int controlPort;
    private HttpClient client = null!;

    private readonly Guid publicApp = Guid.NewGuid();
    private readonly Guid privateApp = Guid.NewGuid();
    private readonly Guid pausedApp = Guid.NewGuid();
    private readonly Guid unpublishedApp = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        controlPlane = await FakeControlPlane.StartAsync(Token);
        (echo, echoAddress) = await StartEchoAsync();
        controlPlane.SetRoutes(
            Routes.View(publicApp, project: "notes", target: Target),
            Routes.View(privateApp, project: "secret", target: Target, access: AppAccess.Private),
            Routes.View(pausedApp, project: "paused", target: Target, paused: true),
            Routes.View(unpublishedApp, project: "soon", target: Target, version: null));

        publicPort = FreePort();
        controlPort = FreePort();
        edge = EdgeHost.Create([], builder =>
        {
            builder.Environment.ContentRootPath = Path.GetTempPath();
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [HostingConventions.ServiceTokenVariable] = Token,
                ["Edge:BindAddress"] = "127.0.0.1",
                ["Edge:PublicPort"] = publicPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["Edge:ControlPort"] = controlPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["Edge:ControlPlaneUrl"] = controlPlane.Address.ToString(),
                ["Edge:DockUrl"] = "http://127.0.0.1:9",
                ["Edge:RoutesPollSeconds"] = "1",
                ["Edge:CrashBackoffSeconds"] = "30",
                ["Edge:AccessCacheSeconds"] = "0",
                ["Edge:PlatformOrigin"] = "https://endgame.test",
                ["ReverseProxy:Routes:api:ClusterId"] = "control-plane",
                ["ReverseProxy:Routes:api:Order"] = "10",
                ["ReverseProxy:Routes:api:Match:Path"] = "/api/{**rest}",
                ["ReverseProxy:Routes:console:ClusterId"] = "console",
                ["ReverseProxy:Routes:console:Order"] = "100",
                ["ReverseProxy:Routes:console:Match:Path"] = "{**rest}",
                ["ReverseProxy:Clusters:control-plane:Destinations:primary:Address"] = controlPlane.Address.ToString(),
                ["ReverseProxy:Clusters:console:Destinations:primary:Address"] = controlPlane.Address.ToString(),
            });
        }, services => services.Replace(ServiceDescriptor.Singleton<IAppBackend>(backend)));
        await edge.StartAsync();
        client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri($"http://127.0.0.1:{publicPort}") };
        await WaitForAsync(async () => (await ControlAsync(HttpMethod.Get, "/internal/routes")).Contains("\"apps\":4", StringComparison.Ordinal));
    }

    public async Task DisposeAsync()
    {
        client.Dispose();
        await edge.DisposeAsync();
        await echo.DisposeAsync();
        await controlPlane.DisposeAsync();
    }

    [Fact]
    public async Task A_project_path_without_its_trailing_slash_is_redirected()
    {
        using var response = await client.GetAsync("/acme/apps/notes/web?x=1");
        Assert.Equal(HttpStatusCode.PermanentRedirect, response.StatusCode);
        Assert.Equal("/acme/apps/notes/web/?x=1", response.Headers.Location!.OriginalString);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/apps/notes/web");
        request.Headers.Host = "acme.endgame.test";
        using var onHost = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.PermanentRedirect, onHost.StatusCode);
        Assert.Equal("/apps/notes/web/", onHost.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_path_form_strips_the_prefix_and_the_edge_alone_sets_the_forwarded_headers()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/api/whoami?q=1");
        request.Headers.Add("X-Forwarded-Prefix", "/evil");
        request.Headers.Add("X-Forwarded-Host", "evil.example");
        request.Headers.Add(HostingConventions.SessionHeader, "forged");
        request.Headers.Add("X-Endgame-Anything", "forged");
        request.Headers.Add("Cookie", "endgame_session=member-session; app_pref=dark");
        var seen = await EchoAsync(request);
        Assert.Equal("/api/whoami", seen.GetProperty("path").GetString());
        Assert.Equal("?q=1", seen.GetProperty("query").GetString());
        Assert.Equal("/acme/apps/notes/web", seen.GetProperty("prefix").GetString());
        Assert.Equal($"127.0.0.1:{publicPort}", seen.GetProperty("forwardedHost").GetString());
        Assert.Equal("http", seen.GetProperty("forwardedProto").GetString());
        // A public app still learns who a signed-in visitor is — through an app-scoped token.
        Assert.Equal(FakeControlPlane.SessionFor(publicApp), seen.GetProperty("session").GetString());
        Assert.Equal("", seen.GetProperty("other").GetString());
        Assert.Equal("app_pref=dark", seen.GetProperty("cookie").GetString());
    }

    [Fact]
    public async Task The_subdomain_form_strips_the_apps_prefix_on_the_organisation_host()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/apps/notes/web/api/whoami");
        request.Headers.Host = "acme.endgame.test";
        request.Headers.Add("X-Forwarded-Prefix", "/evil");
        var seen = await EchoAsync(request);
        Assert.Equal("/api/whoami", seen.GetProperty("path").GetString());
        Assert.Equal("/apps/notes/web", seen.GetProperty("prefix").GetString());
        Assert.Equal("acme.endgame.test", seen.GetProperty("forwardedHost").GetString());
        Assert.Equal("", seen.GetProperty("session").GetString());
    }

    [Fact]
    public async Task An_app_given_its_whole_subdomain_is_served_at_the_root_with_no_prefix()
    {
        var rooted = Guid.NewGuid();
        controlPlane.SetRoutes([.. controlPlane.Table.Routes, Routes.View(rooted, org: "solo", target: Target) with { HostPathBase = "/" }]);
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/whoami");
        request.Headers.Host = "solo.endgame.test";
        var seen = await EchoAsync(request);
        Assert.Equal("/api/whoami", seen.GetProperty("path").GetString());
        Assert.Equal("", seen.GetProperty("prefix").GetString());
    }

    [Fact]
    public async Task Platform_callbacks_are_never_routed_from_the_public_side()
    {
        foreach (var path in new[] { "/acme/apps/notes/web/_platform/schedules/nightly", "/acme/apps/secret/web/_PLATFORM/x" })
        {
            using var response = await client.PostAsync(path, null);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task Webhooks_reach_a_private_app_without_a_session()
    {
        var seen = await EchoAsync(new HttpRequestMessage(HttpMethod.Post, "/acme/apps/secret/web/hooks/court-sensor"));
        Assert.Equal("/hooks/court-sensor", seen.GetProperty("path").GetString());
        using var get = await client.GetAsync("/acme/apps/secret/web/hooks/court-sensor");
        Assert.Equal(HttpStatusCode.Redirect, get.StatusCode); // only POSTs are hooks
    }

    [Fact]
    public async Task The_edge_answers_the_apps_sign_in_pages_and_keeps_return_addresses_inside_the_app()
    {
        using var signIn = await client.GetAsync("/acme/apps/notes/web/_endgame/auth/sign-in?returnTo=%2Facme%2Fapps%2Fnotes%2Fweb%2Fnotes%2Fnew");
        Assert.Equal(HttpStatusCode.Redirect, signIn.StatusCode);
        var location = signIn.Headers.Location!.OriginalString;
        Assert.StartsWith("https://endgame.test/sign-in?returnTo=", location, StringComparison.Ordinal);
        Assert.Contains(Uri.EscapeDataString($"http://127.0.0.1:{publicPort}/acme/apps/notes/web/notes/new"), location, StringComparison.Ordinal);

        using var escape = await client.GetAsync("/acme/apps/notes/web/_endgame/auth/sign-up?returnTo=https%3A%2F%2Fevil.example%2F");
        Assert.Contains(Uri.EscapeDataString($"http://127.0.0.1:{publicPort}/acme/apps/notes/web/"), escape.Headers.Location!.OriginalString, StringComparison.Ordinal);
        Assert.DoesNotContain("evil", escape.Headers.Location!.OriginalString, StringComparison.Ordinal);

        using var signOut = await client.GetAsync("/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=%2Facme%2Fother%2Fapp%2Fx%2F");
        Assert.Equal("/acme/apps/notes/web/", signOut.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_platforms_own_routes_still_reach_the_control_plane_and_the_console()
    {
        using var api = new HttpRequestMessage(HttpMethod.Get, "/api/system/status");
        api.Headers.Add("Origin", "https://endgame.test");
        using var apiResponse = await client.SendAsync(api);
        var platform = await apiResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("control-plane", platform.GetProperty("from").GetString());
        // Passkey sign-in needs the visitor's host, scheme and origin.
        Assert.Equal($"127.0.0.1:{publicPort}", platform.GetProperty("forwardedHost").GetString());
        Assert.Equal("http", platform.GetProperty("forwardedProto").GetString());
        Assert.Equal("https://endgame.test", platform.GetProperty("origin").GetString());
        Assert.Contains("console", await client.GetStringAsync("/acme/settings"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Internal_paths_are_never_routed_from_the_public_listener()
    {
        foreach (var path in new[] { "/internal/routes", "/INTERNAL/apps", "/internal/routes/refresh" })
        {
            using var response = await client.PostAsync(path, null);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task The_control_listener_requires_the_service_token_and_proxies_nothing()
    {
        using var control = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{controlPort}") };
        using (var anonymous = await control.PostAsync("/internal/routes/refresh", null))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        }

        using (var proxied = await control.GetAsync("/acme/apps/notes/web/"))
        {
            Assert.Equal(HttpStatusCode.NotFound, proxied.StatusCode);
        }

        // An /internal path the control listener does not serve is refused, never proxied.
        using (var unknown = await control.GetAsync("/internal/nothing-here"))
        {
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        }

        // The listener is told by the port a connection arrived on, not the Host header — a
        // published port changes the Host the caller sends.
        using (var rewritten = new HttpRequestMessage(HttpMethod.Post, "/internal/routes/refresh"))
        {
            rewritten.Headers.Host = "127.0.0.1:61234";
            rewritten.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var answer = await control.SendAsync(rewritten);
            Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
            Assert.Contains("\"apps\":", await answer.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        var refreshed = await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        Assert.Contains(Endgame.Edge.Routing.RouteSnapshot.VersionOf(controlPlane.Table), refreshed, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unchanged_routing_table_is_answered_not_modified()
    {
        var before = controlPlane.RouteNotModified;
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        Assert.True(controlPlane.RouteNotModified > before);
    }

    [Fact]
    public async Task A_paused_app_gets_its_holding_page_and_is_never_woken()
    {
        var calls = backend.WakeCalls;
        using var response = await client.GetAsync("/acme/apps/paused/web/");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("This app is paused", html, StringComparison.Ordinal);
        Assert.Contains("/brand/endgame-mark.svg", html, StringComparison.Ordinal);
        Assert.Equal(calls, backend.WakeCalls);
    }

    [Fact]
    public async Task An_unpublished_app_says_it_is_not_ready()
    {
        using var response = await client.GetAsync("/acme/apps/soon/web/");
        Assert.Contains("isn&#39;t ready yet", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_private_app_sends_a_visitor_with_no_session_to_sign_in()
    {
        using var response = await client.GetAsync("/acme/apps/secret/web/page?a=b");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/acme/apps/secret/web/_endgame/auth/sign-in?returnTo=%2Facme%2Fapps%2Fsecret%2Fweb%2Fpage%3Fa%3Db", response.Headers.Location!.OriginalString);
        Assert.Equal("/page?a=b", controlPlane.AccessChecks.Last(c => c.AppId == privateApp).Path);
    }

    [Fact]
    public async Task A_private_app_admits_a_member_with_an_app_scoped_session_never_the_cookie()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/api/whoami");
        request.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.MemberSession}");
        var seen = await EchoAsync(request);
        Assert.Equal(FakeControlPlane.SessionFor(privateApp), seen.GetProperty("session").GetString());
        Assert.Equal("", seen.GetProperty("cookie").GetString());
    }

    [Fact]
    public async Task Until_the_per_app_check_exists_the_visitors_own_roles_decide()
    {
        controlPlane.AccessCheckMissing = true;
        try
        {
            using var member = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/api/x");
            member.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.MemberSession}");
            using (var admitted = await client.SendAsync(member))
            {
                Assert.Equal(HttpStatusCode.OK, admitted.StatusCode);
            }

            using var outsider = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/api/x");
            outsider.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.OutsiderSession}");
            using (var refused = await client.SendAsync(outsider))
            {
                Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            }

            using var anonymous = await client.GetAsync("/acme/apps/secret/web/api/x");
            Assert.Equal(HttpStatusCode.Redirect, anonymous.StatusCode);
        }
        finally
        {
            controlPlane.AccessCheckMissing = false;
        }
    }

    [Fact]
    public async Task A_private_app_refuses_a_signed_in_outsider()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/");
        request.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.OutsiderSession}");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("don&#39;t have access", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task When_access_cannot_be_checked_a_private_app_is_closed()
    {
        controlPlane.AccessDown = true;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/");
            request.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.MemberSession}");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        }
        finally
        {
            controlPlane.AccessDown = false;
        }
    }

    [Fact]
    public async Task A_crash_report_from_dock_turns_the_next_request_into_the_unavailable_page()
    {
        var crashed = Guid.NewGuid();
        controlPlane.SetRoutes([.. controlPlane.Table.Routes, Routes.View(crashed, project: "fragile", target: Target)]);
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        using (var first = await client.GetAsync("/acme/apps/fragile/web/api/x"))
        {
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        }

        await ControlAsync(HttpMethod.Post, $"/internal/apps/{crashed:D}/state", new AppStateReport(crashed, AppRuntimeState.Crashed, 3, false, DateTimeOffset.UtcNow));
        using var after = await client.GetAsync("/acme/apps/fragile/web/api/x");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, after.StatusCode);
        Assert.Contains("stopped for a moment", await after.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_sleeping_app_is_woken_and_the_wait_is_reported()
    {
        var sleepy = Guid.NewGuid();
        controlPlane.SetRoutes([.. controlPlane.Table.Routes, Routes.View(sleepy, project: "sleepy", target: Target)]);
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{sleepy:D}/state", new AppStateReport(sleepy, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        var before = backend.WakeCalls;
        using var response = await client.GetAsync("/acme/apps/sleepy/web/api/x");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.Contains(HostingConventions.WakeTimeHeader));
        Assert.Equal(before + 1, backend.WakeCalls);
    }

    private async Task<JsonElement> EchoAsync(HttpRequestMessage request)
    {
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<string> ControlAsync(HttpMethod method, string path, object? body = null)
    {
        using var control = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{controlPort}") };
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using var response = await control.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }

    private static async Task<(WebApplication, Uri)> StartEchoAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseKestrel(k => k.Listen(IPAddress.Loopback, 0));
        var app = builder.Build();
        app.MapFallback((HttpContext c) => Results.Json(new
        {
            path = c.Request.Path.Value,
            query = c.Request.QueryString.Value ?? "",
            prefix = c.Request.Headers[HostingConventions.ForwardedPrefixHeader].ToString(),
            forwardedHost = c.Request.Headers["X-Forwarded-Host"].ToString(),
            forwardedProto = c.Request.Headers["X-Forwarded-Proto"].ToString(),
            session = c.Request.Headers[HostingConventions.SessionHeader].ToString(),
            other = c.Request.Headers["X-Endgame-Anything"].ToString(),
            cookie = c.Request.Headers.Cookie.ToString(),
        }));
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        return (app, new Uri(address));
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static async Task WaitForAsync(Func<Task<bool>> condition)
    {
        for (var i = 0; i < 100; i++)
        {
            try
            {
                if (await condition())
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("The edge never loaded the routing table.");
    }
}
