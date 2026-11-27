using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Yarp.ReverseProxy.Transforms;
using Yarp.ReverseProxy.Transforms.Builder;

namespace Endgame.Edge.Routing;

/// <summary>
/// What an app receives (ARCH-005, address rule 6): the prefix stripped, and <c>X-Forwarded-Prefix</c>,
/// <c>-Host</c>, <c>-Proto</c> and <c>-For</c> set by the edge alone — whatever the visitor sent
/// is dropped, as is every client-sent <c>X-Endgame-*</c> header. The platform's own cookies —
/// the console session and every <c>endgame.app.*</c> app session — never reach an app. The app is
/// told its name in the tree (<see cref="HostingConventions.AppNameHeader"/>), so its header and tab
/// title show the one name a person sees for it everywhere else.
/// </summary>
public sealed class AppRequestTransforms(IOptions<EdgeOptions> options) : ITransformProvider
{
    public const string SessionItem = "endgame.session";

    /// <summary>The app's name, set by <see cref="AppGate"/> from the routing table.</summary>
    public const string NameItem = "endgame.app-name";

    public void ValidateRoute(TransformRouteValidationContext context)
    {
    }

    public void ValidateCluster(TransformClusterValidationContext context)
    {
    }

    public void Apply(TransformBuilderContext context)
    {
        if (context.Route.Metadata is not { } metadata || !metadata.TryGetValue(AppProxyConfig.AppIdKey, out _))
        {
            // The platform's own routes keep YARP's forwarded headers (passkey sign-in needs
            // X-Forwarded-Host and -Proto, and Origin passes through untouched); behind the tunnel
            // the scheme visitors used replaces the one the edge saw.
            if (options.Value.PublicScheme is { Length: > 0 } publicScheme)
            {
                context.UseDefaultForwarders = false;
                context.AddXForwardedFor();
                context.AddXForwardedHost();
                context.AddXForwardedPrefix();
                context.AddRequestTransform(transform =>
                {
                    transform.ProxyRequest.Headers.Remove("X-Forwarded-Proto");
                    transform.ProxyRequest.Headers.TryAddWithoutValidation("X-Forwarded-Proto", publicScheme);
                    return ValueTask.CompletedTask;
                });
            }

            return;
        }

        var prefix = metadata.GetValueOrDefault(AppProxyConfig.PrefixKey, "");
        var scheme = options.Value.PublicScheme;
        context.UseDefaultForwarders = false;
        context.AddRequestTransform(transform =>
        {
            var request = transform.HttpContext.Request;
            var headers = transform.ProxyRequest.Headers;
            foreach (var name in ForwardedHeaders.Stripped)
            {
                headers.Remove(name);
            }

            foreach (var name in headers.Select(h => h.Key).Where(k => k.StartsWith(HostingConventions.PlatformHeaderPrefix, StringComparison.OrdinalIgnoreCase)).ToList())
            {
                headers.Remove(name);
            }

            // The app roots its own traces (AppForwarderHttpClientFactory): a visitor's trace context,
            // sampled or not, would otherwise decide whether the app records anything.
            foreach (var name in ForwardedHeaders.TraceContext)
            {
                headers.Remove(name);
            }

            if (prefix.Length > 0)
            {
                var path = transform.Path.Value ?? "";
                var rest = path.Length > prefix.Length ? path[prefix.Length..] : "/";
                transform.Path = new PathString(rest.StartsWith('/') ? rest : "/" + rest);
                headers.TryAddWithoutValidation(HostingConventions.ForwardedPrefixHeader, prefix);
            }

            headers.TryAddWithoutValidation("X-Forwarded-Host", request.Host.Value);
            headers.TryAddWithoutValidation("X-Forwarded-Proto", scheme is { Length: > 0 } ? scheme : request.Scheme);
            if (transform.HttpContext.Connection.RemoteIpAddress is { } remote)
            {
                headers.TryAddWithoutValidation("X-Forwarded-For", remote.ToString());
            }

            if (transform.HttpContext.Items.TryGetValue(SessionItem, out var session) && session is string token)
            {
                headers.TryAddWithoutValidation(HostingConventions.SessionHeader, token);
            }

            // Header values are Latin-1: the name goes percent-encoded UTF-8, which the app kit decodes.
            if (transform.HttpContext.Items.TryGetValue(NameItem, out var named) && named is string { Length: > 0 } appName)
            {
                headers.TryAddWithoutValidation(HostingConventions.AppNameHeader, Uri.EscapeDataString(appName));
            }

            if (request.Headers.Cookie.Count > 0)
            {
                headers.Remove(HeaderNames.Cookie);
                var kept = CookieHeaderValue.ParseList(request.Headers.Cookie)
                    .Where(c => !IsPlatformCookie(c.Name.Value))
                    .Select(c => $"{c.Name}={c.Value}")
                    .ToList();
                if (kept.Count > 0)
                {
                    headers.TryAddWithoutValidation(HeaderNames.Cookie, string.Join("; ", kept));
                }
            }

            return ValueTask.CompletedTask;
        });
    }

    /// <summary>True for every cookie the platform owns (<see cref="PlatformCookies.Prefix"/>): sessions, app sessions, ceremonies.</summary>
    public static bool IsPlatformCookie(string? name) =>
        name is null || name.StartsWith(PlatformCookies.Prefix, StringComparison.OrdinalIgnoreCase);
}
