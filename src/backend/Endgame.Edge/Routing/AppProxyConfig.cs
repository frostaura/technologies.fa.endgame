using Endgame.Hosting.Contracts;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;

namespace Endgame.Edge.Routing;

/// <summary>
/// Turns a routing snapshot into proxy routes. Each app gets one cluster and two routes: the path
/// form <c>/org/division/project/app/…</c> on any host, and <c>/division/project/app/…</c> on its
/// organisation's subdomain. Host routes outrank everything; path routes outrank the platform's
/// static <c>/api</c> and console routes.
/// </summary>
public static class AppProxyConfig
{
    public const string AppIdKey = "endgame.app";
    public const string ShapeKey = "endgame.shape";
    public const string PrefixKey = "endgame.prefix";
    public const string PathShape = "path";
    public const string HostShape = "host";

    public const int HostRouteOrder = -1000;
    public const int PathRouteOrder = 0;

    public static (IReadOnlyList<RouteConfig> Routes, IReadOnlyList<ClusterConfig> Clusters) Build(RouteSnapshot snapshot)
    {
        var routes = new List<RouteConfig>();
        var clusters = new List<ClusterConfig>();
        foreach (var app in snapshot.Apps)
        {
            var cluster = ClusterId(app.AppId);
            routes.Add(new RouteConfig
            {
                RouteId = $"app-{app.AppId:D}-path",
                ClusterId = cluster,
                Order = PathRouteOrder,
                Match = new RouteMatch { Path = app.PathPrefix + "/{**rest}" },
                Metadata = new Dictionary<string, string> { [AppIdKey] = app.AppId.ToString("D"), [ShapeKey] = PathShape, [PrefixKey] = app.PathPrefix },
            });
            routes.Add(new RouteConfig
            {
                RouteId = $"app-{app.AppId:D}-host",
                ClusterId = cluster,
                Order = HostRouteOrder,
                Match = new RouteMatch { Hosts = [app.Host], Path = app.HostPrefix + "/{**rest}" },
                Metadata = new Dictionary<string, string> { [AppIdKey] = app.AppId.ToString("D"), [ShapeKey] = HostShape, [PrefixKey] = app.HostPrefix },
            });
            clusters.Add(new ClusterConfig
            {
                ClusterId = cluster,
                Destinations = new Dictionary<string, DestinationConfig> { ["app"] = new() { Address = app.Target } },
                HttpRequest = new ForwarderRequestConfig { ActivityTimeout = TimeSpan.FromSeconds(100) },
            });
        }

        return (routes, clusters);
    }

    public static string ClusterId(Guid appId) => $"app-{appId:D}";

    /// <summary>The app a matched route belongs to, or null for a platform route.</summary>
    public static Guid? AppOf(RouteConfig route) =>
        route.Metadata is { } metadata && metadata.TryGetValue(AppIdKey, out var id) && Guid.TryParse(id, out var appId) ? appId : null;
}

/// <summary>The headers a visitor may not set for an app: the edge is the only source of them.</summary>
public static class ForwardedHeaders
{
    public static readonly string[] Stripped =
    [
        "Forwarded",
        "X-Forwarded-For",
        "X-Forwarded-Proto",
        "X-Forwarded-Host",
        HostingConventions.ForwardedPrefixHeader,
        "X-Real-IP",
    ];
}
