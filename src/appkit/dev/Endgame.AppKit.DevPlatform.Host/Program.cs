// TEST DOUBLE HOST — see the .csproj for what each port plays. Configuration (environment):
//   DEV_APP_URL      the app container, e.g. http://test-appkit-app:8080      (required)
//   DEV_PATH_PREFIX  the path-form address, e.g. /acme/labs/demo/notes       (default /acme/labs/demo/notes)
//   DEV_HOST_PREFIX  the address on the organisation subdomain, e.g. /labs/demo/notes (default /labs/demo/notes;
//                    empty serves the app at the subdomain's root)
//   DEV_APP_TOKEN    the token the app was started with                      (default dev-app-token)
using System.Net;
using Endgame.AppKit.DevPlatform;
using Microsoft.AspNetCore.Http.Features;
using Yarp.ReverseProxy.Forwarder;

const int PlatformPort = 8080, EgressPort = 8081, PathEdgePort = 8082, HostEdgePort = 8083;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(k =>
{
    foreach (var port in new[] { PlatformPort, EgressPort, PathEdgePort, HostEdgePort })
    {
        k.ListenAnyIP(port);
    }
});
builder.Services.AddHttpForwarder();

var appUrl = new Uri(builder.Configuration["DEV_APP_URL"] ?? throw new InvalidOperationException("DEV_APP_URL is required (the app container's address)."));
var pathPrefix = (builder.Configuration["DEV_PATH_PREFIX"] ?? "/acme/labs/demo/notes").TrimEnd('/');
var hostPrefix = (builder.Configuration["DEV_HOST_PREFIX"] ?? "/labs/demo/notes").TrimEnd('/');
var state = new DevPlatformState { AppToken = builder.Configuration["DEV_APP_TOKEN"] ?? "dev-app-token" };

var app = builder.Build();
var forwarder = app.Services.GetRequiredService<IHttpForwarder>();
var upstream = new HttpMessageInvoker(new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false, UseCookies = false });
var appHttp = new HttpClient { BaseAddress = appUrl };
var log = app.Logger;

app.UseWhen(c => c.Connection.LocalPort == EgressPort, egress => egress.Run(async context =>
{
    // A forward proxy: the app's HttpClient sends absolute-form targets (GET http://host/path).
    var target = context.Features.Get<IHttpRequestFeature>()!.RawTarget;
    if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) || uri.Scheme != "http")
    {
        context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
        await context.Response.WriteAsync("The dev egress proxy forwards plain http absolute-form requests only.");
        return;
    }

    state.EgressLog.Enqueue($"{context.Request.Method} {uri}");
    await forwarder.SendAsync(context, $"{uri.Scheme}://{uri.Authority}", upstream, ForwarderRequestConfig.Empty, new ExactTarget(uri));
}));

app.UseWhen(c => c.Connection.LocalPort is PathEdgePort or HostEdgePort, edge => edge.Run(async context =>
{
    // Both shapes carry a prefix (four segments on the path form, three on the subdomain), unless the
    // subdomain serves the app at its root.
    var prefix = context.Connection.LocalPort == PathEdgePort ? pathPrefix : hostPrefix;
    var appBase = prefix;
    var path = context.Request.Path.Value ?? "/";

    if (prefix.Length > 0)
    {
        if (path == prefix)
        {
            // Edge rule 6: a project path without its trailing slash is redirected to one with it.
            context.Response.Redirect(prefix + "/" + context.Request.QueryString, permanent: true, preserveMethod: true);
            return;
        }

        if (!path.StartsWith(prefix + "/", StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        path = path[prefix.Length..];
    }

    context.Request.Path = path;
    if (path.StartsWith("/_endgame/auth/", StringComparison.Ordinal))
    {
        await DevAuthPages.HandleAsync(context, appBase, state);
        return;
    }

    if (path.StartsWith("/_platform/", StringComparison.Ordinal))
    {
        // Platform callbacks never come from the public side.
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var session = context.Request.Cookies.TryGetValue(DevAuthPages.Cookie, out var token) && state.Sessions.ContainsKey(token) ? token : null;
    var error = await forwarder.SendAsync(context, appUrl.ToString(), upstream, ForwarderRequestConfig.Empty, new EdgeTransformer(appBase, session));
    if (error != ForwarderError.None)
    {
        log.LogWarning("dev edge: forwarding {Path} failed: {Error}", path, error);
    }
}));

app.MapDevPlatform(state, () => appHttp);
app.Run();

/// <summary>Sends the request to exactly the absolute URI the client asked the proxy for.</summary>
internal sealed class ExactTarget(Uri target) : HttpTransformer
{
    public override async ValueTask TransformRequestAsync(HttpContext httpContext, HttpRequestMessage proxyRequest, string destinationPrefix, CancellationToken cancellationToken)
    {
        await base.TransformRequestAsync(httpContext, proxyRequest, destinationPrefix, cancellationToken);
        proxyRequest.RequestUri = target;
        proxyRequest.Headers.Host = null;
    }
}

/// <summary>
/// What Edge does to every request into an app (ARCH-005 rule 6 and PLATFORM-API.md): strip the
/// prefix (already done), say what it was, drop anything the browser tried to pass as platform
/// state, and attach the app-scoped session.
/// </summary>
internal sealed class EdgeTransformer(string appBase, string? session) : HttpTransformer
{
    public override async ValueTask TransformRequestAsync(HttpContext httpContext, HttpRequestMessage proxyRequest, string destinationPrefix, CancellationToken cancellationToken)
    {
        await base.TransformRequestAsync(httpContext, proxyRequest, destinationPrefix, cancellationToken);
        var headers = proxyRequest.Headers;
        foreach (var name in headers.Select(h => h.Key).Where(k => k.StartsWith("X-Endgame-", StringComparison.OrdinalIgnoreCase) || k.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase)).ToList())
        {
            headers.Remove(name);
        }

        headers.Host = null;
        headers.Add("X-Forwarded-Host", httpContext.Request.Host.Value);
        headers.Add("X-Forwarded-Proto", httpContext.Request.Scheme);
        headers.Add("X-Forwarded-For", httpContext.Connection.RemoteIpAddress?.ToString() ?? IPAddress.Loopback.ToString());
        if (appBase.Length > 0)
        {
            headers.Add("X-Forwarded-Prefix", appBase);
        }

        if (session is not null)
        {
            headers.Add("X-Endgame-Session", session);
        }

        // The browser's platform cookie never reaches the app.
        if (headers.TryGetValues("Cookie", out var cookies))
        {
            var kept = string.Join("; ", cookies.SelectMany(c => c.Split(';')).Select(c => c.Trim())
                .Where(c => c.Length > 0 && !c.StartsWith(DevAuthPages.Cookie + "=", StringComparison.Ordinal)));
            headers.Remove("Cookie");
            if (kept.Length > 0)
            {
                headers.Add("Cookie", kept);
            }
        }
    }
}
