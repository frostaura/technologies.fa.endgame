using System.Diagnostics;
using Yarp.ReverseProxy.Forwarder;

namespace Endgame.Edge.Routing;

/// <summary>
/// The edge's own trace context never reaches an app. The edge records no traces, so the context it
/// would propagate is unsampled — and an app's OpenTelemetry samples by its parent, so every request
/// that came through the edge went untraced and the app's telemetry stayed empty (found by the
/// merged stack's acceptance test). Each app starts its own traces; a visitor's trace headers are
/// stripped by <see cref="AppRequestTransforms"/>. The platform's own routes keep YARP's behaviour.
/// </summary>
public sealed class AppForwarderHttpClientFactory : ForwarderHttpClientFactory
{
    protected override void ConfigureHandler(ForwarderHttpClientContext context, SocketsHttpHandler handler)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(handler);
        base.ConfigureHandler(context, handler);
        if (context.ClusterId.StartsWith(AppProxyConfig.ClusterPrefix, StringComparison.Ordinal))
        {
            handler.ActivityHeadersPropagator = DistributedContextPropagator.CreateNoOutputPropagator();
        }
    }
}
