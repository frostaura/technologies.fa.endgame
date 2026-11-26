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
    private readonly Guid privateDraftApp = Guid.NewGuid();
    private readonly Guid budgetApp = Guid.NewGuid();
    private static readonly System.Collections.Concurrent.ConcurrentQueue<(string Name, string Signature, string Body)> Callbacks = new();

    public async Task InitializeAsync()
    {
        controlPlane = await FakeControlPlane.StartAsync(Token);
        (echo, echoAddress) = await StartEchoAsync();
        controlPlane.SetRoutes(
            Routes.View(publicApp, project: "notes", target: Target),
            Routes.View(privateApp, project: "secret", target: Target, access: AppAccess.Private, hooks: "court-sensor"),
            Routes.View(pausedApp, project: "paused", target: Target, paused: true),
            Routes.View(unpublishedApp, project: "soon", target: Target, version: null),
            Routes.View(privateDraftApp, project: "draft", target: Target, access: AppAccess.Private, version: null),
            Routes.View(budgetApp, project: "budget", target: Target, paused: true, pausedReason: PausedReasons.BudgetExhausted));

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
                ["Edge:UsageReportSeconds"] = "0",
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
        await WaitForAsync(async () => (await ControlAsync(HttpMethod.Get, "/internal/routes")).Contains("\"apps\":6", StringComparison.Ordinal));
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
        request.Headers.Add("Cookie", $"endgame.session=member-session; app_pref=dark; endgame.app.{publicApp:N}=app-session-cookie; endgame.app_auth=ceremony");
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
    public async Task No_trace_context_reaches_an_app_so_the_app_roots_and_samples_its_own_traces()
    {
        // Something listening makes the edge create (unsampled) activities, as logging does in a container.
        using var listener = new System.Diagnostics.ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = (ref System.Diagnostics.ActivityCreationOptions<System.Diagnostics.ActivityContext> _) => System.Diagnostics.ActivitySamplingResult.PropagationData,
        };
        System.Diagnostics.ActivitySource.AddActivityListener(listener);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/api/whoami");
        request.Headers.Add("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00");
        request.Headers.Add("tracestate", "vendor=forged");
        var seen = await EchoAsync(request);
        Assert.Equal("", seen.GetProperty("traceparent").GetString());
        Assert.Equal("", seen.GetProperty("tracestate").GetString());

        var plain = await EchoAsync(new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/api/whoami"));
        Assert.Equal("", plain.GetProperty("traceparent").GetString());
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
    public async Task Declared_webhooks_and_only_those_reach_a_private_app_without_a_session()
    {
        var seen = await EchoAsync(new HttpRequestMessage(HttpMethod.Post, "/acme/apps/secret/web/hooks/court-sensor"));
        Assert.Equal("/hooks/court-sensor", seen.GetProperty("path").GetString());
        using (var get = await client.GetAsync("/acme/apps/secret/web/hooks/court-sensor"))
        {
            Assert.Equal(HttpStatusCode.Redirect, get.StatusCode); // only POSTs are hooks
        }

        foreach (var undeclared in new[] { "/acme/apps/secret/web/hooks/other", "/acme/apps/secret/web/hooks/court-sensor/deeper", "/acme/apps/secret/web/hooks/" })
        {
            using var refused = await client.PostAsync(undeclared, null);
            Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
            Assert.Contains("/_endgame/auth/sign-in?returnTo=", refused.Headers.Location!.OriginalString, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_sign_in_page_is_the_edges_own_and_drives_the_control_planes_app_identity_endpoints()
    {
        using var signIn = await client.GetAsync("/acme/apps/secret/web/_endgame/auth/sign-in?returnTo=%2Facme%2Fapps%2Fsecret%2Fweb%2Fnotes%2Fnew");
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        var html = await signIn.Content.ReadAsStringAsync();
        var config = Config(html);
        Assert.Equal(privateApp.ToString("D"), config.GetProperty("appId").GetString());
        Assert.Equal($"http://127.0.0.1:{publicPort}/acme/apps/secret/web/notes/new", config.GetProperty("returnTo").GetString());
        Assert.False(config.GetProperty("handoff").GetBoolean());
        Assert.Contains("/api/app-auth/${config.appId}", html, StringComparison.Ordinal);
        Assert.Contains("/api/auth/passkey/login/options", html, StringComparison.Ordinal);
        Assert.Contains("/sign-up/options", html, StringComparison.Ordinal);
        Assert.Contains("/development", html, StringComparison.Ordinal);
        var policy = signIn.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'nonce-", policy, StringComparison.Ordinal);
        Assert.Contains("connect-src 'self'", policy, StringComparison.Ordinal);
        Assert.DoesNotContain("unsafe-inline", policy, StringComparison.Ordinal);

        // A return address outside the app is replaced by the app's home, never followed.
        foreach (var escape in new[] { "https%3A%2F%2Fevil.example%2F", "%2F%2Fevil.example%2F", "%2Facme%2Fapps%2Fnotes%2Fweb%2F" })
        {
            using var page = await client.GetAsync($"/acme/apps/secret/web/_endgame/auth/sign-up?returnTo={escape}");
            Assert.Equal($"http://127.0.0.1:{publicPort}/acme/apps/secret/web/", Config(await page.Content.ReadAsStringAsync()).GetProperty("returnTo").GetString());
        }
    }

    [Fact]
    public async Task On_the_organisation_subdomain_sign_in_moves_to_the_platforms_host_and_returns_by_hand_off()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/apps/secret/web/_endgame/auth/sign-in?returnTo=%2Fapps%2Fsecret%2Fweb%2Fpage%3Fa%3Db");
        request.Headers.Host = $"acme.endgame.test:{publicPort}";
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var location = response.Headers.Location!.OriginalString;
        Assert.StartsWith("https://endgame.test/acme/apps/secret/web/_endgame/auth/sign-in?returnTo=", location, StringComparison.Ordinal);
        Assert.EndsWith(Uri.EscapeDataString($"http://acme.endgame.test:{publicPort}/apps/secret/web/page?a=b"), location, StringComparison.Ordinal);

        // On the platform's host the same absolute address is accepted, and marked for a hand-off.
        var page = await client.GetStringAsync($"/acme/apps/secret/web/_endgame/auth/sign-in?returnTo={Uri.EscapeDataString($"http://acme.endgame.test:{publicPort}/apps/secret/web/page?a=b")}");
        var config = Config(page);
        Assert.True(config.GetProperty("handoff").GetBoolean());
        Assert.Equal($"http://acme.endgame.test:{publicPort}/apps/secret/web/page?a=b", config.GetProperty("returnTo").GetString());
        Assert.False(config.GetProperty("signedIn").GetBoolean()); // nothing to hand off: the page never asks

        using var member = new HttpRequestMessage(HttpMethod.Get, $"/acme/apps/secret/web/_endgame/auth/sign-in?returnTo={Uri.EscapeDataString($"http://acme.endgame.test:{publicPort}/apps/secret/web/")}");
        member.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
        using var withSession = await client.SendAsync(member);
        Assert.True(Config(await withSession.Content.ReadAsStringAsync()).GetProperty("signedIn").GetBoolean()); // handed off at once
    }

    [Fact]
    public async Task A_hand_off_sets_the_subdomains_own_session_cookie_once_and_the_app_then_admits_it()
    {
        controlPlane.HandoffReturnTo = $"http://acme.endgame.test:{publicPort}/apps/secret/web/page";
        using var redeem = new HttpRequestMessage(HttpMethod.Get, $"/apps/secret/web/_endgame/auth/handoff?code={FakeControlPlane.HandoffCode}&returnTo=https%3A%2F%2Fevil.example%2F");
        redeem.Headers.Host = $"acme.endgame.test:{publicPort}";
        using var redeemed = await client.SendAsync(redeem);
        Assert.Equal(HttpStatusCode.Redirect, redeemed.StatusCode);
        Assert.Equal(controlPlane.HandoffReturnTo, redeemed.Headers.Location!.OriginalString);
        var cookie = redeemed.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(PlatformCookies.AppSession(privateApp), StringComparison.Ordinal));
        Assert.Contains($"={FakeControlPlane.HandedOffSession}", cookie, StringComparison.Ordinal);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", cookie, StringComparison.OrdinalIgnoreCase); // host-only

        using var visit = new HttpRequestMessage(HttpMethod.Get, "/apps/secret/web/api/whoami");
        visit.Headers.Host = $"acme.endgame.test:{publicPort}";
        visit.Headers.Add("Cookie", $"{PlatformCookies.AppSession(privateApp)}={FakeControlPlane.HandedOffSession}; theme=dark");
        var seen = await EchoAsync(visit);
        Assert.Equal(FakeControlPlane.SessionFor(privateApp), seen.GetProperty("session").GetString());
        Assert.Equal("theme=dark", seen.GetProperty("cookie").GetString());

        // A code works once.
        using var again = new HttpRequestMessage(HttpMethod.Get, $"/apps/secret/web/_endgame/auth/handoff?code={FakeControlPlane.HandoffCode}");
        again.Headers.Host = $"acme.endgame.test:{publicPort}";
        using var gone = await client.SendAsync(again);
        Assert.Equal(HttpStatusCode.Gone, gone.StatusCode);
        Assert.Contains("This sign-in link has expired", await gone.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.False(gone.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task Signing_out_ends_the_session_through_the_control_plane_and_comes_back_inside_the_app()
    {
        using var member = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=%2Facme%2Fother%2Fapp%2Fx%2F");
        member.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
        using var signedOut = await client.SendAsync(member);
        Assert.Equal("http://127.0.0.1:" + publicPort + "/acme/apps/notes/web/", signedOut.Headers.Location!.OriginalString);
        Assert.Contains(signedOut.Headers.GetValues("Set-Cookie"), c => c.StartsWith("endgame.session=;", StringComparison.Ordinal));
        Assert.Contains("/api/auth/logout", controlPlane.AppCalls);

        using var visitor = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/_endgame/auth/sign-out");
        visitor.Headers.Add("Cookie", $"{PlatformCookies.AppSession(publicApp)}=x");
        using var visitorOut = await client.SendAsync(visitor);
        Assert.Contains($"/api/app-auth/{publicApp:D}/sign-out", controlPlane.AppCalls);
        Assert.Contains(visitorOut.Headers.GetValues("Set-Cookie"), c => c.StartsWith(PlatformCookies.AppSession(publicApp) + "=;", StringComparison.Ordinal));
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
    public async Task An_app_paused_by_a_spent_budget_says_so()
    {
        using var response = await client.GetAsync("/acme/apps/budget/web/");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("This app is paused", html, StringComparison.Ordinal);
        Assert.Contains("this month&#39;s budget", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_schedule_callback_on_the_control_listener_wakes_the_app_and_forwards_body_and_signature_unchanged()
    {
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{privateApp:D}/state", new AppStateReport(privateApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        var wakes = backend.WakeCalls;
        const string body = "{\"scheduledFor\":\"2026-11-25T03:00:00Z\"}";
        const string signature = "t=1764039600,v1=00ff";
        using var control = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{controlPort}") };
        using var callback = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{privateApp:D}/platform/schedules/nightly-digest") { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        callback.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        callback.Headers.TryAddWithoutValidation(HostingConventions.PlatformHeaderPrefix + "Signature", signature);
        using var answer = await control.SendAsync(callback);
        Assert.Equal(HttpStatusCode.NoContent, answer.StatusCode); // the app's own status
        Assert.Equal(wakes + 1, backend.WakeCalls);
        Assert.Contains(Callbacks, c => c.Name == "nightly-digest" && c.Signature == signature && c.Body == body);

        using (var unsigned = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{privateApp:D}/platform/schedules/nightly-digest") { Content = new StringContent(body) })
        {
            unsigned.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var refused = await control.SendAsync(unsigned);
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        }

        using (var anonymous = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{privateApp:D}/platform/schedules/nightly-digest") { Content = new StringContent(body) })
        {
            anonymous.Headers.TryAddWithoutValidation(HostingConventions.PlatformHeaderPrefix + "Signature", signature);
            using var refused = await control.SendAsync(anonymous);
            Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        }

        // Never from the public side.
        using var publicSide = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{privateApp:D}/platform/schedules/nightly-digest") { Content = new StringContent(body) };
        publicSide.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        using var notRouted = await client.SendAsync(publicSide);
        Assert.Equal(HttpStatusCode.NotFound, notRouted.StatusCode);
    }

    [Fact]
    public async Task The_evaluator_probes_a_private_preview_through_the_control_listener_only_as_a_signed_out_visitor()
    {
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{privateApp:D}/state", new AppStateReport(privateApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        var wakes = backend.WakeCalls;
        var answer = JsonDocument.Parse(await ControlAsync(HttpMethod.Post, $"/internal/apps/{privateApp:D}/probe", new { method = "GET", path = "api/books?shelf=1", body = (string?)null })).RootElement;
        Assert.Equal(200, answer.GetProperty("status").GetInt32());
        Assert.StartsWith("application/json", answer.GetProperty("contentType").GetString(), StringComparison.Ordinal);
        var echoed = JsonDocument.Parse(answer.GetProperty("body").GetString()!).RootElement;
        Assert.Equal("/api/books", echoed.GetProperty("path").GetString());
        Assert.Equal("?shelf=1", echoed.GetProperty("query").GetString());
        Assert.Equal("/acme/apps/secret/web", echoed.GetProperty("prefix").GetString());
        Assert.Equal("endgame.test", echoed.GetProperty("forwardedHost").GetString());
        Assert.Equal("", echoed.GetProperty("session").GetString()); // nobody is signed in
        Assert.Equal(wakes + 1, backend.WakeCalls);

        using var control = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{controlPort}") };
        async Task<HttpStatusCode> Probe(object body, bool token = true, HttpClient? via = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{privateApp:D}/probe") { Content = JsonContent.Create(body) };
            if (token)
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            }

            using var response = await (via ?? control).SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.Unauthorized, await Probe(new { method = "GET", path = "" }, token: false));
        Assert.Equal(HttpStatusCode.NotFound, await Probe(new { method = "GET", path = "" }, via: client));
        foreach (var path in new[] { "_platform/schedules/x", "_endgame/auth/sign-in", "../other", "http://evil/" })
        {
            Assert.Equal(HttpStatusCode.BadRequest, await Probe(new { method = "GET", path }));
        }

        Assert.Equal(HttpStatusCode.BadRequest, await Probe(new { method = "TRACE", path = "" }));
        using var paused = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{pausedApp:D}/probe") { Content = JsonContent.Create(new { method = "GET", path = "" }) };
        paused.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        Assert.Equal(HttpStatusCode.Conflict, (await control.SendAsync(paused)).StatusCode);
    }

    [Fact]
    public async Task The_control_planes_app_gateway_calls_an_app_through_the_control_listener_with_the_members_session()
    {
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{privateApp:D}/state", new AppStateReport(privateApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        var wakes = backend.WakeCalls;

        // The real caller: the control plane's AppGateway, as the per-app MCP tools use it.
        var services = new ServiceCollection();
        services.AddHttpClient(Endgame.Infrastructure.Platform.AppGateway.ClientName);
        services.Configure<Endgame.Infrastructure.Platform.ServiceAddresses>(a => a.EdgeControl = $"http://127.0.0.1:{controlPort}");
        services.Configure<Endgame.Infrastructure.Platform.AppCallOptions>(_ => { });
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [HostingConventions.ServiceTokenVariable] = Token }).Build());
        services.AddSingleton<Endgame.Infrastructure.Platform.AppGateway>();
        await using var provider = services.BuildServiceProvider();
        var gateway = provider.GetRequiredService<Endgame.Infrastructure.Platform.AppGateway>();
        var operation = new Endgame.Infrastructure.Platform.AppOperation("createBooking", "Book a court", "post", "/api/courts/{court}/bookings",
            new System.Text.Json.Nodes.JsonObject(), ["court"], ["dryRun"], HasBody: true);
        var arguments = new System.Text.Json.Nodes.JsonObject { ["court"] = "2", ["dryRun"] = "true", ["body"] = new System.Text.Json.Nodes.JsonObject { ["slot"] = "18:00" } };
        var answer = await gateway.CallAsync(privateApp, operation, arguments, "egs_member-session", CancellationToken.None);

        Assert.Equal(200, answer.Status);
        var seen = answer.Json!.AsObject();
        Assert.Equal("POST", seen["method"]!.GetValue<string>());
        Assert.Equal("/api/courts/2/bookings", seen["path"]!.GetValue<string>());
        Assert.Equal("?dryRun=true", seen["query"]!.GetValue<string>());
        Assert.StartsWith("application/json", seen["contentType"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal("{\"slot\":\"18:00\"}", seen["body"]!.GetValue<string>());
        Assert.Equal("egs_member-session", seen["session"]!.GetValue<string>()); // the member, as at the app's door
        Assert.Equal("/acme/apps/secret/web", seen["prefix"]!.GetValue<string>());
        Assert.Equal("endgame.test", seen["forwardedHost"]!.GetValue<string>());
        Assert.Equal(wakes + 1, backend.WakeCalls); // a sleeping app is woken first

        // A declared webhook, called as its device would: the device's own header passes, the service token never reaches the app.
        var hook = await gateway.CallHookAsync(privateApp, "court-status", "X-Court-Signature", "sha256=00ff", "{\"courtId\":\"2\"}", CancellationToken.None);
        var atApp = hook.Json!.AsObject();
        Assert.Equal(("/hooks/court-status", "sha256=00ff", ""), (atApp["path"]!.GetValue<string>(), atApp["signature"]!.GetValue<string>(), atApp["authorization"]!.GetValue<string>()));

        // The app's own OpenAPI document, as the gateway reads it to derive the tools.
        using var control = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{controlPort}") };
        async Task<HttpStatusCode> Call(HttpMethod method, string path, bool token = true, HttpClient? via = null)
        {
            using var request = new HttpRequestMessage(method, path);
            if (token)
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            }

            using var response = await (via ?? control).SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.OK, await Call(HttpMethod.Get, $"/internal/apps/{privateApp:D}/call/openapi/v1.json"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Call(HttpMethod.Get, $"/internal/apps/{privateApp:D}/call/api/x", token: false));
        Assert.Equal(HttpStatusCode.NotFound, await Call(HttpMethod.Get, $"/internal/apps/{privateApp:D}/call/api/x", via: client)); // never the public side
        foreach (var path in new[] { "_platform/schedules/x", "_endgame/auth/sign-in", "%5Fplatform/x" })
        {
            Assert.Equal(HttpStatusCode.BadRequest, await Call(HttpMethod.Get, $"/internal/apps/{privateApp:D}/call/{path}"));
        }

        Assert.Equal(HttpStatusCode.NotFound, await Call(HttpMethod.Get, $"/internal/apps/{Guid.NewGuid():D}/call/api/x"));
        Assert.Equal(HttpStatusCode.Conflict, await Call(HttpMethod.Get, $"/internal/apps/{pausedApp:D}/call/api/x"));
        Assert.Equal(HttpStatusCode.Conflict, await Call(HttpMethod.Get, $"/internal/apps/{unpublishedApp:D}/call/api/x"));

        // Edge's own refusals are marked, so a caller never mistakes them for the app's answer; the app's own are not.
        using (var paused = new HttpRequestMessage(HttpMethod.Get, $"/internal/apps/{pausedApp:D}/call/api/x"))
        {
            paused.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var refused = await control.SendAsync(paused);
            Assert.Equal("app_paused", refused.Headers.GetValues(HostingConventions.RefusalHeader).Single());
        }

        using (var own = new HttpRequestMessage(HttpMethod.Get, $"/internal/apps/{privateApp:D}/call/api/x"))
        {
            own.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var answered = await control.SendAsync(own);
            Assert.False(answered.Headers.Contains(HostingConventions.RefusalHeader));
        }

        // An app that cannot be woken is 503, and the gateway carries the app's status to its caller unchanged.
        await ControlAsync(HttpMethod.Post, $"/internal/apps/{privateApp:D}/state", new AppStateReport(privateApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        backend.WakeAnswer = WakeStart.NoCapacity;
        try
        {
            var asleep = await gateway.CallAsync(privateApp, operation, arguments, "egs_member-session", CancellationToken.None);
            Assert.Equal(503, asleep.Status);
        }
        finally
        {
            backend.WakeAnswer = WakeStart.Started;
        }
    }

    [Fact]
    public async Task Requests_an_app_served_are_reported_as_hosting_usage_once_per_period()
    {
        for (var i = 0; i < 3; i++)
        {
            using var response = await client.GetAsync("/acme/apps/notes/web/api/count");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        await ControlAsync(HttpMethod.Post, "/internal/usage/flush");
        var sample = Assert.Single(controlPlane.HostingSamples.Values, s => s.AppId == publicApp);
        Assert.True(sample.Requests >= 3, $"{sample.Requests} requests");
        Assert.Equal(0, sample.AwakeSeconds);
        Assert.Equal(0, sample.MemoryBytes);
        Assert.True(sample.To > sample.From);
        Assert.StartsWith("edge:", sample.SampleId, StringComparison.Ordinal);

        // Nothing new served, nothing new charged.
        var reports = controlPlane.HostingReports;
        await ControlAsync(HttpMethod.Post, "/internal/usage/flush");
        Assert.Equal(reports, controlPlane.HostingReports);
        Assert.Single(controlPlane.HostingSamples.Values, s => s.AppId == publicApp);
    }

    [Fact]
    public async Task An_unpublished_app_says_it_is_not_ready()
    {
        using var response = await client.GetAsync("/acme/apps/soon/web/");
        Assert.Contains("isn&#39;t ready yet", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_private_unpublished_app_asks_a_stranger_to_sign_in_and_tells_a_member_it_is_not_ready()
    {
        // The address exists before the first version (D68): who may not open it is sent to sign in, as for any private app.
        using var stranger = await client.GetAsync("/acme/apps/draft/web/");
        Assert.Equal(HttpStatusCode.Redirect, stranger.StatusCode);
        Assert.StartsWith("/acme/apps/draft/web/_endgame/auth/sign-in", stranger.Headers.Location!.OriginalString, StringComparison.Ordinal);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/draft/web/");
        request.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
        using var member = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, member.StatusCode);
        Assert.Contains("isn&#39;t ready yet", await member.Content.ReadAsStringAsync(), StringComparison.Ordinal);
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
        request.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
        var seen = await EchoAsync(request);
        Assert.Equal(FakeControlPlane.SessionFor(privateApp), seen.GetProperty("session").GetString());
        Assert.Equal("", seen.GetProperty("cookie").GetString());
    }

    [Fact]
    public async Task Without_the_control_planes_access_check_a_private_app_stays_closed_even_to_a_member()
    {
        controlPlane.AccessCheckMissing = true;
        try
        {
            using var member = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/secret/web/api/x");
            member.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
            using var closed = await client.SendAsync(member);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, closed.StatusCode);
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
        request.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.OutsiderSession}");
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
            request.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
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

    private static JsonElement Config(string html)
    {
        const string open = "<script type=\"application/json\" id=\"config\">";
        var start = html.IndexOf(open, StringComparison.Ordinal) + open.Length;
        return JsonDocument.Parse(html[start..html.IndexOf("</script>", start, StringComparison.Ordinal)]).RootElement;
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
        app.MapPost("/_platform/schedules/{name}", async (string name, HttpContext c) =>
        {
            Callbacks.Enqueue((name, c.Request.Headers["X-Endgame-Signature"].ToString(), await new StreamReader(c.Request.Body).ReadToEndAsync()));
            return Results.NoContent();
        });
        app.MapFallback("{**path}", async Task<IResult> (HttpContext c) => Results.Json(new
        {
            method = c.Request.Method,
            contentType = c.Request.ContentType ?? "",
            body = await new StreamReader(c.Request.Body).ReadToEndAsync(),
            path = c.Request.Path.Value,
            query = c.Request.QueryString.Value ?? "",
            prefix = c.Request.Headers[HostingConventions.ForwardedPrefixHeader].ToString(),
            forwardedHost = c.Request.Headers["X-Forwarded-Host"].ToString(),
            forwardedProto = c.Request.Headers["X-Forwarded-Proto"].ToString(),
            session = c.Request.Headers[HostingConventions.SessionHeader].ToString(),
            other = c.Request.Headers["X-Endgame-Anything"].ToString(),
            signature = c.Request.Headers["X-Court-Signature"].ToString(),
            authorization = c.Request.Headers.Authorization.ToString(),
            cookie = c.Request.Headers.Cookie.ToString(),
            traceparent = c.Request.Headers["traceparent"].ToString(),
            tracestate = c.Request.Headers["tracestate"].ToString(),
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
