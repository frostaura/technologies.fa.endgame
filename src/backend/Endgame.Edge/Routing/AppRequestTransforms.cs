using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Yarp.ReverseProxy.Transforms;
using Yarp.ReverseProxy.Transforms.Builder;

namespace Endgame.Edge.Routing;

/// <summary>
/// What an app receives (ARCH-005, address rule 6): the prefix stripped, and <c>X-Forwarded-Prefix</c>,
/// <c>-Host</c>, <c>-Proto</c> and <c>-For</c> set by the edge alone — whatever the visitor sent
/// is dropped. The platform's own cookies never reach an app.
/// </summary>
public sealed class AppRequestTransforms(IOptions<EdgeOptions> options) : ITransformProvider
{
    public const string UserItem = "endgame.user";

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
            return;
        }

        var prefix = metadata.GetValueOrDefault(AppProxyConfig.PrefixKey, "");
        var platformCookies = options.Value.PlatformCookies.ToHashSet(StringComparer.Ordinal);
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

            if (transform.HttpContext.Items.TryGetValue(UserItem, out var user) && user is Guid userId)
            {
                headers.TryAddWithoutValidation(HostingConventions.UserIdHeader, userId.ToString("D"));
            }

            if (request.Headers.Cookie.Count > 0)
            {
                headers.Remove(HeaderNames.Cookie);
                var kept = CookieHeaderValue.ParseList(request.Headers.Cookie)
                    .Where(c => !platformCookies.Contains(c.Name.Value ?? ""))
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
}
