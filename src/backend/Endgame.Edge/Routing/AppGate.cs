using System.Diagnostics;
using System.Globalization;
using Endgame.Edge.Access;
using Endgame.Edge.Pages;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;
using Yarp.ReverseProxy.Forwarder;

namespace Endgame.Edge.Routing;

/// <summary>
/// The step in the proxy pipeline between matching an app's route and forwarding to it: is the
/// app available, may this visitor open it, is it awake — waking it if not — and, if the app
/// fails underneath the request, the unavailable page instead of a bare error.
/// <para>
/// It also keeps the console off an organisation's app host: a host in the routing table (an
/// organisation subdomain that serves apps) is never served the console. There, anything that is
/// not an app's address and not the control plane's <c>/api</c> or <c>/mcp</c> (which the identity
/// pages call on that host) is the edge's "There is no app at this address" (404). On the
/// platform's own host an unknown address is the console's, which shows its own not-found page.
/// </para>
/// </summary>
public sealed class AppGate(AppRegistry registry, IAppBackend backend, AccessGate access, AuthPages auth, RouteTableSource routes, IOptions<EdgeOptions> options, ILogger<AppGate> logger)
{
    /// <summary>The platform's console cluster (appsettings.json): what an organisation's app host is never served.</summary>
    public const string ConsoleCluster = "console";

    public async Task InvokeAsync(HttpContext context, Func<Task> next)
    {
        var route = context.GetReverseProxyFeature().Route.Config;
        if (AppProxyConfig.AppOf(route) is not { } appId)
        {
            var onAppHost = routes.Current.Hosts.Contains(context.Request.Host.Host);
            if (route.ClusterId == ConsoleCluster && onAppHost && context.Request.Path.StartsWithSegments(PageChrome.AssetsPath, out var file)
                && await PageChrome.TryServeAsync(context, file.Value?.TrimStart('/') ?? ""))
            {
                return;
            }

            if (route.ClusterId == ConsoleCluster && onAppHost)
            {
                await UnavailablePage.WriteAsync(context, Unavailable.NoApp, NoAppLinks(context));
                return;
            }

            await next();
            return;
        }

        var shape = route.Metadata?.GetValueOrDefault(AppProxyConfig.ShapeKey);
        var prefix = route.Metadata?.GetValueOrDefault(AppProxyConfig.PrefixKey) ?? "";
        var path = context.Request.Path.Value ?? "/";
        var inApp = path.Length > prefix.Length ? path[prefix.Length..] : "/";
        var appAddress = context.Request.PathBase + prefix;

        // The edge's own pages' typefaces and mark, under every app's address (the app kit reserves /_endgame).
        if (inApp.StartsWith(PageChrome.AssetsPath + "/", StringComparison.Ordinal))
        {
            if (!await PageChrome.TryServeAsync(context, inApp[(PageChrome.AssetsPath.Length + 1)..]))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
            }

            return;
        }

        var links = Links(context, appId, shape, appAddress);
        var app = registry.Get(appId);
        if (app is null)
        {
            await UnavailablePage.WriteAsync(context, Unavailable.Temporary, links);
            return;
        }

        context.Items[AppRequestTransforms.NameItem] = app.Route.Name;
        if (app.Route.Availability == AppAvailability.Paused)
        {
            await UnavailablePage.WriteAsync(context, app.Route.PausedReason == PausedReasons.BudgetExhausted ? Unavailable.BudgetSpent : Unavailable.Paused, links);
            return;
        }

        if (StartsWithSegment(inApp, HostingConventions.PlatformCallbackPath))
        {
            // Platform-to-app callbacks arrive on the edge's control listener, signed, never on the public side.
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (StartsWithSegment(inApp, HostingConventions.AuthPath))
        {
            await auth.HandleAsync(context, app.Route, shape ?? AppProxyConfig.PathShape, appAddress, inApp[HostingConventions.AuthPath.Length..]);
            return;
        }

        // Declared webhooks — and only those — reach even a private app: the app kit verifies their signature.
        var isHook = HttpMethods.IsPost(context.Request.Method) && HookName(inApp) is { } hook && app.Route.DeclaresHook(hook);
        if (!isHook)
        {
            var decision = await access.CheckAsync(app.Route, context, inApp + context.Request.QueryString, context.RequestAborted);
            if (!decision.Allowed)
            {
                await RefuseAsync(context, decision, appAddress, inApp, links);
                return;
            }

            if (decision.SessionToken is { Length: > 0 } session)
            {
                context.Items[AppRequestTransforms.SessionItem] = session;
            }
        }

        // An app with an address and no published version yet says so — to whoever may open it; a visitor who may not is
        // sent to sign in or refused first, exactly as for a published app (D68, ACC-16).
        if (app.Route.Availability == AppAvailability.Unpublished)
        {
            await UnavailablePage.WriteAsync(context, Unavailable.NotReady, links);
            return;
        }

        app.Enter();
        try
        {
            if (!app.Awake)
            {
                var clock = Stopwatch.StartNew();
                var outcome = await app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(options.Value.WakeTimeoutSeconds), context.RequestAborted);
                if (outcome != WakeOutcome.Awake)
                {
                    logger.LogInformation("App {AppId} could not be woken: {Outcome}.", appId, outcome);
                    await UnavailablePage.WriteAsync(context, ReasonFor(outcome), links);
                    return;
                }

                context.Response.Headers[HostingConventions.WakeTimeHeader] = clock.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture);
            }

            await next();

            if (context.Features.Get<IForwarderErrorFeature>() is { } failure && failure.Error is not ForwarderError.RequestCanceled)
            {
                // The app went away underneath the request (a crash, or stopped behind the edge's
                // back): the next request wakes it, and this one gets a page instead of a bare 502.
                app.MarkAsleep();
                if (!context.Response.HasStarted)
                {
                    await UnavailablePage.WriteAsync(context, app.Crashed ? Unavailable.Crashed : Unavailable.Temporary, links);
                }
            }
        }
        finally
        {
            app.Leave();
        }
    }

    /// <summary>The <c>&lt;name&gt;</c> of <c>/hooks/&lt;name&gt;</c>, or null for any other path.</summary>
    public static string? HookName(string inApp)
    {
        var prefix = HostingConventions.HooksPath + "/";
        if (!inApp.StartsWith(prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var name = inApp[prefix.Length..].TrimEnd('/');
        return name.Length > 0 && !name.Contains('/', StringComparison.Ordinal) ? name : null;
    }

    private static bool StartsWithSegment(string path, string segment) =>
        path.StartsWith(segment, StringComparison.OrdinalIgnoreCase)
        && (path.Length == segment.Length || path[segment.Length] == '/');

    private static async Task RefuseAsync(HttpContext context, AccessDecision decision, string appAddress, string inApp, PageLinks links)
    {
        switch (decision.Decision)
        {
            case AccessDecisions.SignIn:
                var request = context.Request;
                var original = appAddress + inApp + request.QueryString;
                var target = decision.SignInUrl is { Length: > 0 } url
                    ? url
                    : $"{appAddress}{HostingConventions.AuthPath}/sign-in?returnTo={Uri.EscapeDataString(original)}";
                if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method))
                {
                    context.Response.Redirect(target, permanent: false);
                }
                else
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    context.Response.Headers.Location = target;
                }

                return;
            case AccessDecisions.Deny:
                await UnavailablePage.WriteAsync(context, Unavailable.Forbidden, links);
                return;
            default:
                await UnavailablePage.WriteAsync(context, Unavailable.Temporary, links);
                return;
        }
    }

    /// <summary>
    /// Where an app's page may send the visitor: the same address again; the console — on the
    /// path form it shares this host, on a subdomain it is the platform's origin (none when that
    /// is not configured); and the app's sign-out, returning to its sign-in.
    /// </summary>
    private PageLinks Links(HttpContext context, Guid appId, string? shape, string appAddress)
    {
        var request = context.Request;
        var signIn = $"{appAddress}{HostingConventions.AuthPath}/{AuthPages.SignIn}?returnTo={Uri.EscapeDataString(appAddress + "/")}";
        return new PageLinks(
            PageChrome.AssetsAt(appAddress),
            request.PathBase + request.Path + request.QueryString,
            ConsoleFrom(shape == AppProxyConfig.PathShape),
            request.Cookies.ContainsKey(PlatformCookies.MemberSession),
            $"{appAddress}{HostingConventions.AuthPath}/{AuthPages.SignOut}?returnTo={Uri.EscapeDataString(signIn)}",
            appId);
    }

    private PageLinks NoAppLinks(HttpContext context)
    {
        var request = context.Request;
        return new PageLinks(PageChrome.AssetsPath, request.PathBase + request.Path + request.QueryString, ConsoleFrom(onPlatformHost: false),
            Address: $"{request.Host.Value}{request.PathBase}{request.Path}");
    }

    private string? ConsoleFrom(bool onPlatformHost) =>
        onPlatformHost ? "" : options.Value.PlatformOrigin is { Length: > 0 } origin ? origin.TrimEnd('/') : null;

    public static Unavailable ReasonFor(WakeOutcome outcome) => outcome switch
    {
        WakeOutcome.Crashed => Unavailable.Crashed,
        WakeOutcome.NoCapacity => Unavailable.Busy,
        WakeOutcome.NotPublished => Unavailable.NotReady,
        WakeOutcome.TimedOut => Unavailable.Slow,
        _ => Unavailable.Temporary,
    };
}
