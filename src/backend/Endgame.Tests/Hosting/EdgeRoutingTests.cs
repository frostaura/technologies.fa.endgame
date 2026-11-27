using System.Net;
using Endgame.Edge;
using Endgame.Edge.Access;
using Endgame.Edge.Pages;
using Endgame.Edge.Routing;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

public sealed class RouteSnapshotTests
{
    private static readonly string[] Reserved = new EdgeOptions().ReservedSegments.ToArray();

    private static RouteSnapshot Snapshot(params RouteView[] routes) => RouteSnapshot.From(new RoutingTable(DateTimeOffset.UtcNow, routes), Reserved);

    [Fact]
    public void A_valid_route_is_indexed_by_both_of_its_addresses()
    {
        var route = Routes.View();
        var snapshot = Snapshot(route);
        var app = snapshot.ById[route.AppId];
        Assert.Same(app, snapshot.ByPrefix["/acme/apps/notes/web"]);
        Assert.Same(app, snapshot.ByHostPrefix["acme.endgame.test/apps/notes/web"]);
        Assert.Equal(TimeSpan.FromMinutes(15), app.IdleAfter);
        Assert.Equal(AppAvailability.Available, app.Availability);
        Assert.Empty(snapshot.Rejected);
    }

    [Fact]
    public void The_version_ignores_when_the_table_was_generated_and_follows_the_routes()
    {
        var route = Routes.View();
        var a = RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [route]));
        var b = RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow.AddMinutes(1), [route]));
        var c = RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [route with { Sleeping = true }]));
        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
    }

    [Theory]
    [InlineData("api", "apps", "notes", "web")]
    [InlineData("internal", "apps", "notes", "web")]
    [InlineData("Acme", "apps", "notes", "web")]
    [InlineData("acme", "-apps", "notes", "web")]
    [InlineData("acme", "apps", "notes", "")]
    public void Unsafe_or_reserved_slugs_are_left_out(string org, string division, string project, string app)
    {
        var snapshot = Snapshot(Routes.View(org: org, division: division, project: project, app: app));
        Assert.Empty(snapshot.Apps);
        Assert.Single(snapshot.Rejected);
    }

    [Fact]
    public void A_route_whose_prefixes_disagree_with_its_scope_is_left_out() =>
        Assert.Empty(Snapshot(Routes.View() with { PathBase = "/acme/apps/notes/" }).Apps);

    [Theory]
    [InlineData("https://app-x:8080")]
    [InlineData("http://app-x:8080/some/path")]
    [InlineData("not a url")]
    public void Targets_must_be_plain_http_origins(string target) => Assert.Empty(Snapshot(Routes.View(target: target)).Apps);

    [Fact]
    public void Two_routes_claiming_one_address_keep_only_the_first()
    {
        var first = Routes.View();
        var snapshot = Snapshot(first, Routes.View());
        Assert.Equal([first.AppId], snapshot.Apps.Select(a => a.AppId));
    }

    [Fact]
    public void Access_defaults_to_private_and_an_unknown_one_is_never_guessed()
    {
        Assert.Equal(AppAccess.Private, Snapshot(Routes.View(access: null)).Apps.Single().Access);
        Assert.Empty(Snapshot(Routes.View(access: "everyone")).Apps);
    }

    [Fact]
    public void Always_on_never_sleeps_and_an_unknown_mode_is_left_out()
    {
        Assert.Null(Snapshot(Routes.View(sleepMode: SleepSetting.AlwaysOn)).Apps.Single().IdleAfter);
        Assert.Empty(Snapshot(Routes.View(sleepMode: "sometimes")).Apps);
    }

    [Fact]
    public void Availability_follows_the_version_and_the_pause()
    {
        Assert.Equal(AppAvailability.Unpublished, Snapshot(Routes.View(version: null)).Apps.Single().Availability);
        Assert.Equal(AppAvailability.Paused, Snapshot(Routes.View(paused: true)).Apps.Single().Availability);
    }

    [Fact]
    public void The_apps_name_in_the_tree_is_carried_and_a_blank_one_is_none()
    {
        Assert.Equal("Dive Seat Sheet", Snapshot(Routes.View(name: " Dive Seat Sheet ")).Apps.Single().Name);
        Assert.Null(Snapshot(Routes.View(name: "  ")).Apps.Single().Name);
        Assert.Null(Snapshot(Routes.View()).Apps.Single().Name);
        // A rename is a change of the routes: the edge picks it up.
        var named = Routes.View(name: "A");
        Assert.Equal(RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [named])), RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [named with { }])));
        Assert.NotEqual(RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [named])), RouteSnapshot.VersionOf(new RoutingTable(DateTimeOffset.UtcNow, [named with { Name = "B" }])));
    }

    [Fact]
    public void Tests_may_compress_an_idle_minute()
    {
        var app = RouteSnapshot.From(new RoutingTable(DateTimeOffset.UtcNow, [Routes.View(idleMinutes: 2)]), Reserved, secondsPerIdleMinute: 1).Apps.Single();
        Assert.Equal(TimeSpan.FromSeconds(2), app.IdleAfter);
    }
}

public sealed class AppProxyConfigTests
{
    [Fact]
    public void Each_app_gets_a_path_route_a_host_route_and_one_cluster()
    {
        var route = Routes.View(target: "http://app-1:8080");
        var (routes, clusters) = AppProxyConfig.Build(RouteSnapshot.From(new RoutingTable(DateTimeOffset.UtcNow, [route]), []));
        var path = Assert.Single(routes, r => r.Metadata![AppProxyConfig.ShapeKey] == AppProxyConfig.PathShape);
        Assert.Equal("/acme/apps/notes/web/{**rest}", path.Match.Path);
        Assert.Null(path.Match.Hosts);
        Assert.Equal("/acme/apps/notes/web", path.Metadata![AppProxyConfig.PrefixKey]);
        var host = Assert.Single(routes, r => r.Metadata![AppProxyConfig.ShapeKey] == AppProxyConfig.HostShape);
        Assert.Equal(["acme.endgame.test"], host.Match.Hosts!);
        Assert.Equal("/apps/notes/web/{**rest}", host.Match.Path);
        Assert.Equal("/apps/notes/web", host.Metadata![AppProxyConfig.PrefixKey]);
        Assert.Equal(AppProxyConfig.HostRouteOrder, host.Order);
        Assert.Equal("http://app-1:8080", Assert.Single(clusters).Destinations!["app"].Address);
        Assert.Equal(route.AppId, AppProxyConfig.AppOf(path));
    }

    [Fact]
    public void Host_routes_outrank_path_routes_which_outrank_the_platforms_own()
    {
        // appsettings.json: /api/* is Order 10, the console catch-all Order 100.
        Assert.True(AppProxyConfig.HostRouteOrder < AppProxyConfig.PathRouteOrder);
        Assert.True(AppProxyConfig.PathRouteOrder < 10);
    }
}

public sealed class AppAddressRulesTests
{
    private static readonly EdgeApp App = Routes.App(project: "notes") with { Hooks = new HashSet<string>(StringComparer.Ordinal) { "court-sensor" } };

    [Theory]
    [InlineData("/hooks/court-sensor", "court-sensor")]
    [InlineData("/hooks/court-sensor/", "court-sensor")]
    [InlineData("/hooks/court-sensor/deeper", null)]
    [InlineData("/hooks/", null)]
    [InlineData("/hooks", null)]
    [InlineData("/HOOKS/court-sensor", null)]
    [InlineData("/api/hooks/court-sensor", null)]
    public void A_hook_is_exactly_hooks_slash_its_name(string path, string? name) => Assert.Equal(name, AppGate.HookName(path));

    [Fact]
    public void Only_declared_hooks_skip_the_access_check()
    {
        Assert.True(App.DeclaresHook("court-sensor"));
        Assert.False(App.DeclaresHook("other"));
        Assert.False((App with { Hooks = null }).DeclaresHook("court-sensor"));
    }

    [Theory]
    [InlineData("endgame.session", true)]
    [InlineData("endgame.app.0123456789abcdef0123456789abcdef", true)]
    [InlineData("endgame.app_auth", true)]
    [InlineData("Endgame.Registration", true)]
    [InlineData("endgame_session", false)]
    [InlineData("theme", false)]
    public void Every_platform_cookie_is_recognised(string name, bool platform) => Assert.Equal(platform, AppRequestTransforms.IsPlatformCookie(name));

    [Theory]
    [InlineData("/acme/apps/notes/web/notes/new?x=1", "https://endgame.test/acme/apps/notes/web/notes/new?x=1")]
    [InlineData("https://endgame.test/acme/apps/notes/web/", "https://endgame.test/acme/apps/notes/web/")]
    [InlineData("https://acme.endgame.test/apps/notes/web/notes", "https://acme.endgame.test/apps/notes/web/notes")]
    [InlineData("https://ACME.endgame.test/apps/notes/web", "https://acme.endgame.test/apps/notes/web")]
    [InlineData("/acme/apps/other/web/", null)]
    [InlineData("//evil.example/acme/apps/notes/web/", null)]
    [InlineData("https://evil.example/acme/apps/notes/web/", null)]
    [InlineData("https://user@endgame.test/acme/apps/notes/web/", null)]
    [InlineData("http://endgame.test/acme/apps/notes/web/", null)]
    [InlineData("https://endgame.test:8443/acme/apps/notes/web/", null)]
    [InlineData("https://acme.endgame.test/apps/notes/webby/", null)]
    [InlineData("/acme/apps/notes/web/../../other/web/", null)]
    [InlineData("javascript:alert(1)", null)]
    public void A_return_address_must_be_inside_one_of_the_apps_two_addresses(string returnTo, string? inside)
    {
        var addresses = new AppAddresses(App, AppProxyConfig.PathShape, "https", new Microsoft.AspNetCore.Http.HostString("endgame.test"), new Uri("https://endgame.test"));
        Assert.Equal(inside, addresses.Inside(returnTo, AppProxyConfig.PathShape));
    }

    [Fact]
    public void The_two_homes_carry_the_visitors_scheme_and_port()
    {
        var local = new AppAddresses(App, AppProxyConfig.PathShape, "http", new Microsoft.AspNetCore.Http.HostString("localhost:18095"), new Uri("http://localhost:18095"));
        Assert.Equal("http://localhost:18095/acme/apps/notes/web/", local.PathHome);
        Assert.Equal("http://acme.endgame.test:18095/apps/notes/web/", local.SubdomainHome);
        Assert.True(local.IsOnSubdomain(local.SubdomainHome));
        Assert.False(local.IsOnSubdomain(local.PathHome));

        // From the subdomain, the path form is named on the platform's own origin.
        var fromSubdomain = new AppAddresses(App, AppProxyConfig.HostShape, "https", new Microsoft.AspNetCore.Http.HostString("acme.endgame.test"), new Uri("https://endgame.test"));
        Assert.Equal("https://endgame.test/acme/apps/notes/web/", fromSubdomain.PathHome);
        Assert.Equal("https://acme.endgame.test/apps/notes/web/", fromSubdomain.Home(AppProxyConfig.HostShape));
    }
}

public sealed class AppNetworkListenerTests
{
    private static readonly IReadOnlyList<Ipv4Cidr> Pools = [Ipv4Cidr.Parse("10.213.0.0/16")];

    [Theory]
    [InlineData("10.213.4.2", true)]
    [InlineData("10.213.255.254", true)]
    [InlineData("172.18.0.5", false)]
    [InlineData("127.0.0.1", false)]
    [InlineData("::1", false)]
    public void Connections_to_an_app_subnet_address_are_recognised(string address, bool fromApp) =>
        Assert.Equal(fromApp, EdgeHost.FromAppNetwork(new IPEndPoint(IPAddress.Parse(address), 8081), Pools));

    [Fact]
    public void An_ipv4_mapped_address_is_recognised_too() =>
        Assert.True(EdgeHost.FromAppNetwork(new IPEndPoint(IPAddress.Parse("10.213.0.3").MapToIPv6(), 8080), Pools));
}

public sealed class UnavailablePageTests
{
    // CLAUDE.md rule 12: normal mode never names infrastructure.
    private static readonly string[] Forbidden = ["container", "docker", "server", "network", "proxy", "502", "503", "repository", "stack", "image"];

    private static readonly Guid AppId = Guid.Parse("6f0b1c2d-0000-4000-8000-000000000001");

    private static readonly PageLinks Everything = new(
        "/acme/apps/notes/web/_endgame/assets", "/acme/apps/notes/web/books?page=2", "", Member: true,
        SwitchAccount: "/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=x", AppId: AppId, Address: "acme.endgame.test/nothing/here");

    [Theory]
    [MemberData(nameof(Reasons))]
    public void Every_page_is_plain_language_in_the_consoles_faces_and_offers_a_way_onward(Unavailable reason)
    {
        var html = UnavailablePage.Render(reason, Everything);
        var (title, message) = UnavailablePage.Copy(reason);
        foreach (var word in Forbidden)
        {
            Assert.DoesNotContain(word, title + " " + message, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Contains("<img class=\"mark\" src=\"/acme/apps/notes/web/_endgame/assets/endgame-mark.svg\"", html, StringComparison.Ordinal);
        Assert.Contains("url(\"/acme/apps/notes/web/_endgame/assets/space-grotesk-latin-wght-normal.woff2\")", html, StringComparison.Ordinal);
        Assert.Contains("url(\"/acme/apps/notes/web/_endgame/assets/inter-latin-wght-normal.woff2\")", html, StringComparison.Ordinal);
        Assert.Contains($"<h1>{WebUtility.HtmlEncode(title)}</h1>", html, StringComparison.Ordinal);
        Assert.Contains("<nav class=\"actions\" aria-label=\"What to do next\"><a class=\"button\" href=", html, StringComparison.Ordinal);
        // Typographic apostrophes: "isn’t", never "isn't".
        Assert.DoesNotContain("'", title + message, StringComparison.Ordinal);
        Assert.DoesNotContain("&#39;", html, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(Unavailable.Crashed)]
    [InlineData(Unavailable.Busy)]
    [InlineData(Unavailable.Slow)]
    [InlineData(Unavailable.Temporary)]
    [InlineData(Unavailable.Paused)]
    [InlineData(Unavailable.BudgetSpent)]
    [InlineData(Unavailable.NotReady)]
    public void Where_trying_again_can_help_try_again_is_a_plain_link_to_the_same_address(Unavailable reason) =>
        Assert.Contains("<nav class=\"actions\" aria-label=\"What to do next\"><a class=\"button\" href=\"/acme/apps/notes/web/books?page=2\">Try again</a></nav>",
            UnavailablePage.Render(reason, Everything), StringComparison.Ordinal);

    [Fact]
    public void A_slow_wake_tries_again_by_itself_after_its_retry_after_and_says_so()
    {
        var html = UnavailablePage.Render(Unavailable.Slow, Everything);
        Assert.Equal(3, UnavailablePage.RetryAfter(Unavailable.Slow));
        Assert.Contains("<meta http-equiv=\"refresh\" content=\"3\">", html, StringComparison.Ordinal);
        Assert.Contains("<p class=\"note\">This page tries again by itself in a few seconds.</p>", html, StringComparison.Ordinal);
        Assert.DoesNotContain("http-equiv", UnavailablePage.Render(Unavailable.Busy, Everything), StringComparison.Ordinal);
    }

    [Fact]
    public void Forbidden_offers_signing_in_as_someone_else_and_a_member_the_way_back_to_endgame()
    {
        Assert.Contains("<a class=\"button\" href=\"/\">Go to Endgame</a><a class=\"button secondary\" href=\"/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=x\">Sign in as someone else</a>",
            UnavailablePage.Render(Unavailable.Forbidden, Everything), StringComparison.Ordinal);
        var visitor = UnavailablePage.Render(Unavailable.Forbidden, Everything with { Member = false });
        Assert.Contains("<a class=\"button\" href=\"/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=x\">Sign in as someone else</a>", visitor, StringComparison.Ordinal);
        Assert.DoesNotContain("Go to Endgame", visitor, StringComparison.Ordinal);
    }

    [Fact]
    public void The_owner_is_pointed_at_the_place_in_endgame_that_fixes_it_and_only_when_this_host_can_name_it()
    {
        Assert.Contains("<p class=\"note\">Is this your app? <a href=\"https://endgame.test/credits\">Top up the credits in Endgame</a></p>",
            UnavailablePage.Render(Unavailable.Paused, Everything with { Console = "https://endgame.test" }), StringComparison.Ordinal);
        Assert.Contains($"<a href=\"/apps/{AppId:D}\">Raise its budget in Endgame</a>", UnavailablePage.Render(Unavailable.BudgetSpent, Everything), StringComparison.Ordinal);
        Assert.Contains($"<a href=\"/apps/{AppId:D}\">Open it in Endgame</a>", UnavailablePage.Render(Unavailable.NotReady, Everything), StringComparison.Ordinal);
        foreach (var reason in new[] { Unavailable.Paused, Unavailable.BudgetSpent, Unavailable.NotReady })
        {
            Assert.DoesNotContain("class=\"note\"", UnavailablePage.Render(reason, Everything with { Console = null }), StringComparison.Ordinal);
        }
    }

    [Fact]
    public void There_is_no_app_at_this_address_is_a_404_naming_the_address()
    {
        Assert.Equal(404, UnavailablePage.StatusFor(Unavailable.NoApp));
        var html = UnavailablePage.Render(Unavailable.NoApp, new PageLinks(PageChrome.AssetsPath, "/x", "https://endgame.test", Address: "acme.endgame.test/community/<no-such-app>/web/"));
        Assert.Contains("<h1>There is no app at this address</h1>", html, StringComparison.Ordinal);
        Assert.Contains("<p class=\"address\">acme.endgame.test/community/&lt;no-such-app&gt;/web/</p>", html, StringComparison.Ordinal);
        Assert.Contains("<a class=\"button\" href=\"https://endgame.test/\">Go to Endgame</a>", html, StringComparison.Ordinal);
        Assert.Contains("src=\"/_endgame/assets/endgame-mark.svg\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_crash_page_says_what_is_true_the_owner_is_told_and_the_next_visit_starts_it_again()
    {
        // Edge keeps a crashed app down for a short pause and the next visit wakes it; nothing restarts it sooner (D69, HOST-05).
        var (_, message) = UnavailablePage.Copy(Unavailable.Crashed);
        Assert.Equal("Something went wrong inside it, and its owner has been told. Please try again in a minute: the next visit starts it again.", message);
        Assert.DoesNotContain("shortly", message, StringComparison.Ordinal);
    }

    [Fact]
    public void The_pages_assets_are_the_edges_own()
    {
        foreach (var file in new[] { PageChrome.MarkFile, PageChrome.SansFile, PageChrome.DisplayFile })
        {
            using var stream = typeof(PageChrome).Assembly.GetManifestResourceStream($"Endgame.Edge.Pages.Assets.{file}");
            Assert.NotNull(stream);
            Assert.True(stream.Length > 300);
        }
    }

    public static TheoryData<Unavailable> Reasons()
    {
        var data = new TheoryData<Unavailable>();
        foreach (var reason in Enum.GetValues<Unavailable>())
        {
            data.Add(reason);
        }

        return data;
    }
}

/// <summary>The edge's shipped configuration, read from its own appsettings.json.</summary>
public sealed class EdgeShippedRoutesTests
{
    [Fact]
    public void Mcp_goes_to_the_control_plane_before_the_console_catches_everything()
    {
        // A live MCP client got the console's nginx 405: the shipped edge routed /api only.
        var root = AppContext.BaseDirectory;
        while (!File.Exists(Path.Combine(root, "src", "backend", "Endgame.slnx")))
        {
            root = Path.GetDirectoryName(root)!;
        }

        var routes = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(root, "src", "backend", "Endgame.Edge", "appsettings.json")))!["ReverseProxy"]!["Routes"]!.AsObject();
        var console = routes["console"]!["Order"]!.GetValue<int>();
        // An organisation's app host is never served the console: the gate knows it by this cluster.
        Assert.Equal(AppGate.ConsoleCluster, routes["console"]!["ClusterId"]!.GetValue<string>());
        foreach (var path in new[] { "/mcp", "/mcp/{**rest}" })
        {
            var route = routes.Select(r => r.Value!).Single(r => r["Match"]!["Path"]!.GetValue<string>() == path);
            Assert.Equal("control-plane", route["ClusterId"]!.GetValue<string>());
            Assert.True(route["Order"]!.GetValue<int>() < console);
        }
    }
}
