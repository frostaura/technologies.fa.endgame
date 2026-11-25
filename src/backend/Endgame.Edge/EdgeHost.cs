using System.Net;
using Endgame.Edge.Access;
using Endgame.Edge.Control;
using Endgame.Edge.Routing;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.XmlEncryption;
using Yarp.ReverseProxy.Configuration;

namespace Endgame.Edge;

/// <summary>
/// The edge, assembled: the single door (ARCH-001). Two listeners — public and control — with any
/// connection arriving on an app-subnet address dropped before it is read, the platform's static
/// routes from configuration, and every app's routes from the control plane.
/// </summary>
public static class EdgeHost
{
    /// <param name="args">Command-line arguments.</param>
    /// <param name="configure">Runs first: configuration sources, content root.</param>
    /// <param name="overrideServices">Runs after the edge's own registrations, so a registration here wins.</param>
    public static WebApplication Create(string[] args, Action<WebApplicationBuilder>? configure = null, Action<IServiceCollection>? overrideServices = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        configure?.Invoke(builder);
        var section = builder.Configuration.GetSection(EdgeOptions.Section);
        if (section["ControlPlaneUrl"] is { Length: > 0 } controlPlane)
        {
            // One setting for both ways the edge reaches the control plane: its internal API and
            // the public /api route.
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ReverseProxy:Clusters:control-plane:Destinations:primary:Address"] = controlPlane.TrimEnd('/') + "/",
            });
        }

        builder.Services.Configure<EdgeOptions>(section);
        var edge = section.Get<EdgeOptions>() ?? new EdgeOptions();
        var appPools = edge.AppSubnetPools.Select(Ipv4Cidr.Parse).ToList();

        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            foreach (var port in new[] { edge.PublicPort, edge.ControlPort })
            {
                Action<Microsoft.AspNetCore.Server.Kestrel.Core.ListenOptions> refuseApps = listen => listen.Use(next => connection =>
                    FromAppNetwork(connection.LocalEndPoint, appPools) ? Task.CompletedTask : next(connection));
                if (edge.BindAddress is "any" or "")
                {
                    kestrel.ListenAnyIP(port, refuseApps);
                }
                else
                {
                    kestrel.Listen(IPAddress.Parse(edge.BindAddress), port, refuseApps);
                }
            }
        });

        // YARP pulls in ASP.NET data protection, but the edge protects nothing that must outlive the
        // process (no session affinity; the only cookie it sets is the control plane's own value). Its key ring is therefore in memory by design,
        // stated here, instead of an unpersisted directory that logs a warning on every start.
        builder.Services.Configure<KeyManagementOptions>(options =>
        {
            options.XmlRepository = new InMemoryXmlRepository();
            options.XmlEncryptor = new NullXmlEncryptor();
        });

        // The platform's own routes are configuration (appsettings.json, ReverseProxy section):
        // /api/* to the control plane, everything else to the console. Apps come from the control
        // plane's routing table, through a second provider.
        var appRoutes = new InMemoryConfigProvider([], []);
        builder.Services.AddSingleton(appRoutes);
        builder.Services.AddReverseProxy()
            .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))
            .AddTransforms<AppRequestTransforms>();
        builder.Services.AddSingleton<IProxyConfigProvider>(appRoutes);
        builder.Services.AddSingleton<Yarp.ReverseProxy.Forwarder.IForwarderHttpClientFactory, AppForwarderHttpClientFactory>();

        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddHttpClient(DockBackend.DockClient, c => c.Timeout = TimeSpan.FromSeconds(30));
        builder.Services.AddHttpClient(DockBackend.HealthClient, c => c.Timeout = TimeSpan.FromSeconds(1))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseProxy = false, ConnectTimeout = TimeSpan.FromSeconds(1), PooledConnectionLifetime = TimeSpan.FromSeconds(5) });
        builder.Services.AddHttpClient(RouteTableSource.ClientName, c => c.Timeout = TimeSpan.FromSeconds(10));
        builder.Services.AddHttpClient(AccessGate.ClientName, c => c.Timeout = TimeSpan.FromSeconds(5));
        builder.Services.AddHttpClient(UsageReporter.ClientName, c => c.Timeout = TimeSpan.FromSeconds(10));
        builder.Services.AddHttpClient(PlatformCallbacks.ClientName, c => c.Timeout = TimeSpan.FromSeconds(100))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseProxy = false, ConnectTimeout = TimeSpan.FromSeconds(5) });
        builder.Services.AddHttpClient(PreviewProbe.ClientName, c => c.Timeout = TimeSpan.FromSeconds(60))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false, ConnectTimeout = TimeSpan.FromSeconds(5) });
        builder.Services.AddSingleton<AppRegistry>();
        builder.Services.AddSingleton<IAppBackend, DockBackend>();
        builder.Services.AddSingleton<AppDiscovery>();
        builder.Services.AddSingleton<AccessGate>();
        builder.Services.AddSingleton<AuthPages>();
        builder.Services.AddSingleton<AppGate>();
        builder.Services.AddSingleton<ServiceTokenFilter>();
        builder.Services.AddSingleton<RouteTableSource>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<RouteTableSource>());
        builder.Services.AddSingleton<IdleSweeper>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<IdleSweeper>());
        builder.Services.AddSingleton<UsageReporter>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<UsageReporter>());
        overrideServices?.Invoke(builder.Services);

        var app = builder.Build();
        if (app.Configuration[HostingConventions.ServiceTokenVariable] is not { Length: >= 16 })
        {
            app.Logger.LogError("{Variable} is not set (16+ characters): the control interface refuses every call and apps cannot be routed.", HostingConventions.ServiceTokenVariable);
        }

        var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
        // Routing has already matched an endpoint here. The control listener serves its own
        // endpoints and /health, and nothing is ever proxied from it; the public listener serves
        // everything but the control endpoints and never routes /internal (ARCH-004).
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            var onControl = context.Connection.LocalPort == edge.ControlPort;
            var isControlEndpoint = context.GetEndpoint()?.Metadata.GetMetadata<ControlEndpoint>() is not null;
            var allowed = onControl
                ? isControlEndpoint || path == "/health"
                : !isControlEndpoint && !path.StartsWithSegments("/internal", StringComparison.OrdinalIgnoreCase);
            if (!allowed)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            await next();
        });
        app.UseMiddleware<TrailingSlashRedirect>();

        // The edge's own liveness. A literal route outranks the proxy's catch-all, so /health is never proxied.
        app.MapGet("/health", (RouteTableSource routes) => Results.Ok(new
        {
            status = "healthy",
            service = "edge",
            revision,
            routes = new { routes.Loaded, routes.Current.Version, apps = routes.Current.Apps.Count, routes.LastError },
        }));
        app.MapEdgeControl();
        app.MapReverseProxy(proxy =>
        {
            var gate = proxy.ApplicationServices.GetRequiredService<AppGate>();
            proxy.Use((context, next) => gate.InvokeAsync(context, next));
        });

        return app;
    }

    /// <summary>True when a connection arrived on one of the edge's addresses inside an app subnet.</summary>
    public static bool FromAppNetwork(EndPoint? local, IReadOnlyList<Ipv4Cidr> pools)
    {
        if (local is not IPEndPoint { Address: var address })
        {
            return false;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        return Ipv4Cidr.TryParse(address + "/32", out var single) && pools.Any(p => p.Overlaps(single));
    }
}

/// <summary>
/// An app's address without its trailing slash: relative URLs would resolve one level too high
/// (ARCH-005, address rule 6), so it is redirected before routing — on the subdomain form
/// <c>/division/project/app</c>, on the path form <c>/org/division/project/app</c>.
/// </summary>
public sealed class TrailingSlashRedirect(RequestDelegate next, RouteTableSource routes)
{
    public Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value;
        var current = routes.Current;
        var host = context.Request.Host.Host;
        if (path is { Length: > 1 } && !path.EndsWith('/')
            && (current.Hosts.Contains(host) ? current.ByHostPrefix.ContainsKey(host + path) : current.ByPrefix.ContainsKey(path)))
        {
            context.Response.StatusCode = StatusCodes.Status308PermanentRedirect;
            context.Response.Headers.Location = path + "/" + context.Request.QueryString;
            return Task.CompletedTask;
        }

        return next(context);
    }
}
