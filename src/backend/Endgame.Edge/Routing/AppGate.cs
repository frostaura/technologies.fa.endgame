using System.Diagnostics;
using System.Globalization;
using Endgame.Edge.Access;
using Endgame.Edge.Pages;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Model;

namespace Endgame.Edge.Routing;

/// <summary>
/// The step in the proxy pipeline between matching an app's route and forwarding to it: is the
/// app available, may this visitor open it, is it awake — waking it if not — and, if the app
/// fails underneath the request, the unavailable page instead of a bare error.
/// </summary>
public sealed class AppGate(AppRegistry registry, IAppBackend backend, AccessGate access, IOptions<EdgeOptions> options, ILogger<AppGate> logger)
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

        switch (app.Route.Availability)
        {
            case AppAvailability.Paused:
                await UnavailablePage.WriteAsync(context, Unavailable.Paused, mark);
                return;
            case AppAvailability.Unpublished:
                await UnavailablePage.WriteAsync(context, Unavailable.NotReady, mark);
                return;
        }

        var decision = await access.CheckAsync(app.Route, context, context.RequestAborted);
        if (!decision.Allowed)
        {
            await RefuseAsync(context, decision, mark);
            return;
        }

        if (decision.UserId is { } userId)
        {
            context.Items[AppRequestTransforms.UserItem] = userId;
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

    private async Task RefuseAsync(HttpContext context, AccessDecision decision, string? mark)
    {
        switch (decision.Outcome)
        {
            case AccessOutcome.SignInRequired:
                var request = context.Request;
                var original = request.PathBase + request.Path + request.QueryString;
                var target = decision.SignInUrl is { Length: > 0 } url
                    ? url
                    : $"{options.Value.SignInPath}?returnTo={Uri.EscapeDataString(original)}";
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
            case AccessOutcome.Forbidden:
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
