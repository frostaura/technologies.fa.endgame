using System.Net;
using Endgame.Edge;
using Endgame.Edge.Pages;
using Endgame.Edge.Routing;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

public sealed class RouteSnapshotTests
{
    private static readonly string[] Reserved = new EdgeOptions().ReservedSegments.ToArray();

    [Fact]
    public void Valid_apps_are_indexed_by_prefix_and_host()
    {
        var app = Routes.App(hosts: ["Acme.Endgame.Test"]);
        var snapshot = RouteSnapshot.From(new RoutingTable("v1", [app]), Reserved);
        Assert.Same(snapshot.ById[app.AppId], snapshot.ByPrefix["/acme/apps/notes"]);
        Assert.Equal(app.AppId, snapshot.ByHost["acme.endgame.test"].AppId);
        Assert.Empty(snapshot.Rejected);
    }

    [Theory]
    [InlineData("api", "apps", "notes")]
    [InlineData("internal", "apps", "notes")]
    [InlineData("Acme", "apps", "notes")]
    [InlineData("acme", "apps/x", "notes")]
    [InlineData("acme", "apps", "")]
    [InlineData("acme", "-apps", "notes")]
    public void Unsafe_or_reserved_slugs_are_left_out(string org, string division, string project)
    {
        var snapshot = RouteSnapshot.From(new RoutingTable("v1", [Routes.App(org: org, division: division, project: project)]), Reserved);
        Assert.Empty(snapshot.Apps);
        Assert.Single(snapshot.Rejected);
    }

    [Theory]
    [InlineData("https://app-x:8080")]
    [InlineData("http://app-x:8080/some/path")]
    [InlineData("not a url")]
    public void Targets_must_be_plain_http_origins(string target) =>
        Assert.Empty(RouteSnapshot.From(new RoutingTable("v1", [Routes.App(target: target)]), Reserved).Apps);

    [Fact]
    public void Two_apps_claiming_one_prefix_or_host_keep_only_the_first()
    {
        var first = Routes.App(hosts: ["acme.endgame.test"]);
        var samePrefix = Routes.App();
        var sameHost = Routes.App(project: "other", hosts: ["acme.endgame.test"]);
        var snapshot = RouteSnapshot.From(new RoutingTable("v1", [first, samePrefix, sameHost]), Reserved);
        Assert.Equal([first.AppId], snapshot.Apps.Select(a => a.AppId));
        Assert.Equal(2, snapshot.Rejected.Count);
    }

    [Fact]
    public void Unknown_access_or_availability_is_never_guessed()
    {
        var snapshot = RouteSnapshot.From(new RoutingTable("v1", [Routes.App(access: "everyone"), Routes.App(project: "b", availability: "maybe")]), Reserved);
        Assert.Empty(snapshot.Apps);
    }
}

public sealed class AppProxyConfigTests
{
    [Fact]
    public void Each_app_gets_a_path_route_a_route_per_host_and_one_cluster()
    {
        var app = Routes.App(hosts: ["acme.endgame.test", "notes.acme.test"], target: "http://app-1:8080");
        var (routes, clusters) = AppProxyConfig.Build(RouteSnapshot.From(new RoutingTable("v1", [app]), []));
        var path = Assert.Single(routes, r => r.Metadata![AppProxyConfig.ShapeKey] == AppProxyConfig.PathShape);
        Assert.Equal("/acme/apps/notes/{**rest}", path.Match.Path);
        Assert.Equal("/acme/apps/notes", path.Metadata![AppProxyConfig.PrefixKey]);
        var hosts = routes.Where(r => r.Metadata![AppProxyConfig.ShapeKey] == AppProxyConfig.HostShape).ToList();
        Assert.Equal(2, hosts.Count);
        Assert.All(hosts, r => Assert.Equal(AppProxyConfig.HostRouteOrder, r.Order));
        Assert.Equal("http://app-1:8080", Assert.Single(clusters).Destinations!["app"].Address);
        Assert.Equal(app.AppId, AppProxyConfig.AppOf(path));
    }

    [Fact]
    public void Host_routes_outrank_path_routes_which_outrank_the_platforms_own()
    {
        // appsettings.json: /api/* is Order 10, the console catch-all Order 100.
        Assert.True(AppProxyConfig.HostRouteOrder < AppProxyConfig.PathRouteOrder);
        Assert.True(AppProxyConfig.PathRouteOrder < 10);
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
        Assert.Contains(System.Net.WebUtility.HtmlEncode(title), html, StringComparison.Ordinal);
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
