using System.Net;
using System.Net.Http.Headers;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;
using Yarp.ReverseProxy.Configuration;

namespace Endgame.Edge.Routing;

/// <summary>
/// Keeps the edge's routes in step with the control plane's <c>GET /internal/routes</c>: polled
/// with <c>If-None-Match</c>, applied only when the version changed, and refreshed at once when
/// the control plane pushes to the control listener. A failed read keeps the last good table.
/// </summary>
public sealed class RouteTableSource(
    IHttpClientFactory http,
    InMemoryConfigProvider proxy,
    AppRegistry registry,
    AppDiscovery discovery,
    IOptions<EdgeOptions> options,
    IConfiguration configuration,
    ILogger<RouteTableSource> logger) : BackgroundService
{
    public const string ClientName = "control-plane";

    private readonly SemaphoreSlim fetch = new(1, 1);
    private readonly SemaphoreSlim poke = new(0, 1);
    private string? etag;

    public RouteSnapshot Current { get; private set; } = RouteSnapshot.Empty;

    /// <summary>True once a table has been read; until then only the platform's own routes exist.</summary>
    public bool Loaded { get; private set; }

    public DateTimeOffset? LastSuccess { get; private set; }

    public string? LastError { get; private set; }

    /// <summary>Reads the table now. Returns the version in force afterwards.</summary>
    public async Task<RouteSnapshot> RefreshAsync(CancellationToken cancellationToken)
    {
        await fetch.WaitAsync(cancellationToken);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/routes"));
            request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
            if (etag is not null && Loaded)
            {
                request.Headers.TryAddWithoutValidation("If-None-Match", etag);
            }

            using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotModified)
            {
                LastSuccess = DateTimeOffset.UtcNow;
                LastError = null;
                return Current;
            }

            response.EnsureSuccessStatusCode();
            var table = await response.Content.ReadFromJsonAsync<RoutingTable>(cancellationToken)
                ?? throw new InvalidDataException("The routing table was empty.");
            etag = response.Headers.ETag?.ToString();
            LastSuccess = DateTimeOffset.UtcNow;
            LastError = null;
            if (Loaded && RouteSnapshot.VersionOf(table) == Current.Version)
            {
                return Current;
            }

            Apply(RouteSnapshot.From(table, options.Value.ReservedSegments, options.Value.SecondsPerIdleMinute));
            return Current;
        }
        finally
        {
            fetch.Release();
        }
    }

    /// <summary>Asks the background loop for an immediate read without waiting for it.</summary>
    public void Poke()
    {
        if (poke.CurrentCount == 0)
        {
            poke.Release();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(1, options.Value.RoutesPollSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RefreshAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
            {
                LastError = e.Message;
                logger.LogWarning("Could not read the routing table ({Message}); keeping version '{Version}'.", e.Message, Current.Version);
            }

            try
            {
                await poke.WaitAsync(Loaded ? interval : TimeSpan.FromSeconds(1), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private void Apply(RouteSnapshot snapshot)
    {
        foreach (var rejected in snapshot.Rejected)
        {
            logger.LogWarning("Route left out: {Reason}", rejected);
        }

        var (routes, clusters) = AppProxyConfig.Build(snapshot);
        var added = registry.Apply(snapshot);
        proxy.Update(routes, clusters);
        Current = snapshot;
        Loaded = true;
        logger.LogInformation("Routing table '{Version}' applied: {Apps} apps.", snapshot.Version, snapshot.Apps.Count);
        if (added.Count > 0)
        {
            _ = discovery.DiscoverAsync(added, CancellationToken.None);
        }
    }
}
