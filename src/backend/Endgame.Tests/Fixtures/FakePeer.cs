using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// An in-test HTTP server standing in for one of the control plane's peers (Dock, Ops, Edge's
/// control listener): each test maps the routes it needs, and every request is kept for assertions.
/// </summary>
public sealed class FakePeer : IAsyncDisposable
{
    private readonly WebApplication app;

    private FakePeer(WebApplication app, string baseUrl)
    {
        this.app = app;
        BaseUrl = baseUrl;
    }

    public string BaseUrl { get; }

    public ConcurrentQueue<(string Method, string Path, string? Authorization, string? Session)> Requests { get; } = new();

    public static async Task<FakePeer> StartAsync(Action<IEndpointRouteBuilder> routes)
    {
        ArgumentNullException.ThrowIfNull(routes);
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        var app = builder.Build();
        var peer = new FakePeer(app, $"http://127.0.0.1:{port}");
        app.Use(async (http, next) =>
        {
            peer.Requests.Enqueue((http.Request.Method, http.Request.Path + http.Request.QueryString, http.Request.Headers.Authorization.ToString(), http.Request.Headers["X-Endgame-Session"].ToString()));
            await next(http);
        });
        routes(app);
        await app.StartAsync();
        return peer;
    }

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }
}
