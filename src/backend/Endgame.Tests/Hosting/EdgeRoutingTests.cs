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

public sealed class AccessCoverageTests
{
    [Theory]
    [InlineData("acme", true)]
    [InlineData("acme/apps", true)]
    [InlineData("acme/apps/notes/web", true)]
    [InlineData("acme/apps/notes/other", false)]
    [InlineData("acme/app", false)]
    [InlineData("acmesubsidiary", false)]
    [InlineData("", false)]
    public void A_role_applies_at_its_scope_and_beneath(string grant, bool covers) =>
        Assert.Equal(covers, AccessGate.Covers(grant, "acme/apps/notes/web"));
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

    [Theory]
    [MemberData(nameof(Reasons))]
    public void Every_page_is_plain_language_and_branded(Unavailable reason)
    {
        var html = UnavailablePage.Render(reason, UnavailablePage.MarkPath);
        var (title, message) = UnavailablePage.Copy(reason);
        foreach (var word in Forbidden)
        {
            Assert.DoesNotContain(word, title + " " + message, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Contains("src=\"/brand/endgame-mark.svg\"", html, StringComparison.Ordinal);
        Assert.Contains(WebUtility.HtmlEncode(title), html, StringComparison.Ordinal);
    }

    [Fact]
    public void Without_a_mark_address_the_page_shows_the_wordmark() =>
        Assert.Contains("class=\"wordmark\"", UnavailablePage.Render(Unavailable.Crashed, null), StringComparison.Ordinal);

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
