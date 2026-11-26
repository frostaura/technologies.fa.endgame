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
/// </summary>
public sealed class AppGate(AppRegistry registry, IAppBackend backend, AccessGate access, AuthPages auth, IOptions<EdgeOptions> options, ILogger<AppGate> logger)
{
    public async Task InvokeAsync(HttpContext context, Func<Task> next)
    {
        var route = context.GetReverseProxyFeature().Route.Config;
        if (AppProxyConfig.AppOf(route) is not { } appId)
        {
            await next();
            return;
        }

        var shape = route.Metadata?.GetValueOrDefault(AppProxyConfig.ShapeKey);
        var mark = MarkUrl(shape);
        var app = registry.Get(appId);
        if (app is null)
        {
            await UnavailablePage.WriteAsync(context, Unavailable.Temporary, mark);
            return;
        }

        if (app.Route.Availability == AppAvailability.Paused)
        {
            await UnavailablePage.WriteAsync(context, app.Route.PausedReason == PausedReasons.BudgetExhausted ? Unavailable.BudgetSpent : Unavailable.Paused, mark);
            return;
        }

        var prefix = route.Metadata?.GetValueOrDefault(AppProxyConfig.PrefixKey) ?? "";
        var path = context.Request.Path.Value ?? "/";
        var inApp = path.Length > prefix.Length ? path[prefix.Length..] : "/";
        var appAddress = context.Request.PathBase + prefix;
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
                await RefuseAsync(context, decision, appAddress, inApp, mark);
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
            await UnavailablePage.WriteAsync(context, Unavailable.NotReady, mark);
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
                    await UnavailablePage.WriteAsync(context, ReasonFor(outcome), mark);
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
                    await UnavailablePage.WriteAsync(context, app.Crashed ? Unavailable.Crashed : Unavailable.Temporary, mark);
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

    private static async Task RefuseAsync(HttpContext context, AccessDecision decision, string appAddress, string inApp, string? mark)
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
                await UnavailablePage.WriteAsync(context, Unavailable.Forbidden, mark);
                return;
            default:
                await UnavailablePage.WriteAsync(context, Unavailable.Temporary, mark);
                return;
        }
    }

    // On the path form the console shares the origin and serves the mark itself; on an
    // organisation subdomain that path belongs to the app, so the console's origin is named.
    private string? MarkUrl(string? shape) =>
        shape == AppProxyConfig.PathShape ? UnavailablePage.MarkPath
        : options.Value.PlatformOrigin is { Length: > 0 } origin ? origin.TrimEnd('/') + UnavailablePage.MarkPath
        : null;

    public static Unavailable ReasonFor(WakeOutcome outcome) => outcome switch
    {
        WakeOutcome.Crashed => Unavailable.Crashed,
        WakeOutcome.NoCapacity => Unavailable.Busy,
        WakeOutcome.NotPublished => Unavailable.NotReady,
        WakeOutcome.TimedOut => Unavailable.Slow,
        _ => Unavailable.Temporary,
    };
}
