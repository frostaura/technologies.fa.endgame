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
            Routes.App(publicApp, project: "notes", hosts: ["acme.endgame.test"], target: echoAddress.ToString().TrimEnd('/')),
            Routes.App(privateApp, project: "secret", target: echoAddress.ToString().TrimEnd('/'), access: AppAccess.Private),
            Routes.App(pausedApp, project: "paused", target: echoAddress.ToString().TrimEnd('/'), availability: AppAvailability.Paused),
            Routes.App(unpublishedApp, project: "soon", target: echoAddress.ToString().TrimEnd('/'), availability: AppAvailability.Unpublished));

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
        using var response = await client.GetAsync("/acme/apps/notes?x=1");
        Assert.Equal(HttpStatusCode.PermanentRedirect, response.StatusCode);
        Assert.Equal("/acme/apps/notes/?x=1", response.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_path_form_strips_the_prefix_and_the_edge_alone_sets_the_forwarded_headers()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/api/whoami?q=1");
        request.Headers.Add("X-Forwarded-Prefix", "/evil");
        request.Headers.Add("X-Forwarded-Host", "evil.example");
        request.Headers.Add(HostingConventions.UserIdHeader, Guid.NewGuid().ToString());
        request.Headers.Add("Cookie", "endgame_session=member-session; app_pref=dark");
        var seen = await EchoAsync(request);
        Assert.Equal("/api/whoami", seen.GetProperty("path").GetString());
        Assert.Equal("?q=1", seen.GetProperty("query").GetString());
        Assert.Equal("/acme/apps/notes", seen.GetProperty("prefix").GetString());
        Assert.Equal($"127.0.0.1:{publicPort}", seen.GetProperty("forwardedHost").GetString());
        Assert.Equal("http", seen.GetProperty("forwardedProto").GetString());
        Assert.Equal("", seen.GetProperty("user").GetString());
        Assert.Equal("app_pref=dark", seen.GetProperty("cookie").GetString());
    }

    [Fact]
    public async Task The_subdomain_form_serves_the_app_at_its_root_with_no_prefix()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/whoami");
        request.Headers.Host = "acme.endgame.test";
        request.Headers.Add("X-Forwarded-Prefix", "/evil");
        var seen = await EchoAsync(request);
        Assert.Equal("/api/whoami", seen.GetProperty("path").GetString());
        Assert.Equal("", seen.GetProperty("prefix").GetString());
        Assert.Equal("acme.endgame.test", seen.GetProperty("forwardedHost").GetString());
    }

    [Fact]
    public async Task The_platforms_own_routes_still_reach_the_control_plane_and_the_console()
    {
        Assert.Contains("control-plane", await client.GetStringAsync("/api/system/status"), StringComparison.Ordinal);
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

        using (var proxied = await control.GetAsync("/acme/apps/notes/"))
        {
            Assert.Equal(HttpStatusCode.NotFound, proxied.StatusCode);
        }

        var refreshed = await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        Assert.Contains(controlPlane.Table.Version, refreshed, StringComparison.Ordinal);
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
        using var response = await client.GetAsync("/acme/apps/paused/");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("This app is paused", html, StringComparison.Ordinal);
        Assert.Contains("/brand/endgame-mark.svg", html, StringComparison.Ordinal);
        Assert.Equal(calls, backend.WakeCalls);
    }

    [Fact]
    public async Task An_unpublished_app_says_it_is_not_ready()
    {
        using var response = await client.GetAsync("/acme/apps/soon/");
        Assert.Contains("isn&#39;t ready yet", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_private_app_sends_a_visitor_with_no_session_to_sign_in()
    {
        using var response = await client.GetAsync("/acme/apps/secret/page?a=b");
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/sign-in?returnTo=%2Facme%2Fapps%2Fsecret%2Fpage%3Fa%3Db", response.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task A_private_app_admits_a_member_and_tells_the_app_who_it_is()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/api/whoami");
        request.Headers.Add("Cookie", $"endgame_session={FakeControlPlane.MemberSession}");
        var seen = await EchoAsync(request);
        Assert.Equal(FakeControlPlane.MemberId.ToString("D"), seen.GetProperty("user").GetString());
        Assert.Equal("", seen.GetProperty("cookie").GetString());
    }

    [Fact]
    public async Task A_private_app_refuses_a_signed_in_outsider()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/");
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
            using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/");
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
        var routes = controlPlane.Table.Apps.Append(Routes.App(crashed, project: "fragile", target: echoAddress.ToString().TrimEnd('/'))).ToArray();
        controlPlane.SetRoutes(routes);
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        using (var first = await client.GetAsync("/acme/apps/fragile/api/x"))
        {
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        }

        await ControlAsync(HttpMethod.Post, $"/internal/apps/{crashed:D}/state", new AppStateReport(crashed, AppRuntimeState.Crashed, 3, false, DateTimeOffset.UtcNow));
        using var after = await client.GetAsync("/acme/apps/fragile/api/x");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, after.StatusCode);
        Assert.Contains("stopped for a moment", await after.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_sleeping_app_is_woken_and_the_wait_is_reported()
    {
        var sleepy = Guid.NewGuid();
        controlPlane.SetRoutes(controlPlane.Table.Apps.Append(Routes.App(sleepy, project: "sleepy", target: echoAddress.ToString().TrimEnd('/'))).ToArray());
        await ControlAsync(HttpMethod.Post, "/internal/routes/refresh");
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{sleepy:D}/state", new AppStateReport(sleepy, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        var before = backend.WakeCalls;
        using var response = await client.GetAsync("/acme/apps/sleepy/api/x");
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
            user = c.Request.Headers[HostingConventions.UserIdHeader].ToString(),
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
