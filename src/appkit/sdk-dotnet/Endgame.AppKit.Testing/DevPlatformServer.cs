using Endgame.AppKit.DevPlatform;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.AppKit.Testing;

/// <summary>The dev platform fake, hosted in memory. Point the app's platform HttpClients at <see cref="CreateHandler"/>.</summary>
public sealed class DevPlatformServer : IAsyncDisposable
{
    private readonly WebApplication _app;

    private DevPlatformServer(WebApplication app, DevPlatformState state)
    {
        _app = app;
        State = state;
    }

    /// <summary>What the app told the fake, and the switches a test flips.</summary>
    public DevPlatformState State { get; }

    /// <summary>Starts the fake. <paramref name="appClient"/> addresses the app, for schedule callbacks.</summary>
    public static DevPlatformServer Start(DevPlatformState state, Func<HttpClient> appClient)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddRouting();
        var app = builder.Build();
        app.MapDevPlatform(state, appClient);
        app.StartAsync().GetAwaiter().GetResult();
        return new DevPlatformServer(app, state);
    }

    /// <summary>A handler that sends requests to the fake.</summary>
    public HttpMessageHandler CreateHandler() => new SyncCapable(_app.GetTestServer().CreateHandler());

    /// <inheritdoc />
    public ValueTask DisposeAsync() => _app.DisposeAsync();

    /// <summary>
    /// The OpenTelemetry exporter sends synchronously; the in-memory test server only does async.
    /// A real SocketsHttpHandler does both, so this bridge exists only here.
    /// </summary>
    private sealed class SyncCapable(HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        protected override HttpResponseMessage Send(HttpRequestMessage request, CancellationToken cancellationToken) =>
            SendAsync(request, cancellationToken).GetAwaiter().GetResult();
    }
}
