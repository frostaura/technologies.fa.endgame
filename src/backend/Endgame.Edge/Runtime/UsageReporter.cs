using System.Globalization;
using System.Net.Http.Headers;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Runtime;

/// <summary>
/// Hosting usage, the edge's half (ARCH-004, <c>POST /internal/usage/hosting</c>): how many requests
/// each app was sent. Dock reports awake time, memory and storage; the edge alone sees requests, so
/// it reports them itself as samples with no awake time. Each sample's id names this edge process,
/// the app and the period, so a report sent twice is charged once; one the control plane could not
/// take is kept and sent again. Counts are in memory: an edge restart loses at most one period.
/// </summary>
public sealed class UsageReporter(AppRegistry registry, IHttpClientFactory http, IOptions<EdgeOptions> options, IConfiguration configuration, TimeProvider time, ILogger<UsageReporter> logger) : BackgroundService
{
    public const string ClientName = "usage";

    private readonly string boot = Guid.NewGuid().ToString("N")[..12];
    private readonly List<HostingSample> pending = [];
    private readonly SemaphoreSlim flushing = new(1, 1);
    private DateTimeOffset since = time.GetUtcNow();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = options.Value.UsageReportSeconds;
        if (seconds <= 0)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds), time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await FlushAsync(stoppingToken);
        }
    }

    /// <summary>Closes the current period and sends every sample not yet taken. Returns how many the control plane took.</summary>
    public async Task<int> FlushAsync(CancellationToken cancellationToken)
    {
        await flushing.WaitAsync(cancellationToken);
        try
        {
            var to = time.GetUtcNow();
            var from = since;
            if (to > from)
            {
                foreach (var app in registry.All)
                {
                    var count = app.TakeRequests();
                    if (count > 0)
                    {
                        var id = string.Create(CultureInfo.InvariantCulture, $"edge:{boot}:{app.Route.AppId:N}:{from.ToUnixTimeMilliseconds()}");
                        pending.Add(new HostingSample(id, app.Route.AppId, from, to, 0, 0, 0, count));
                    }
                }

                since = to;
            }

            var taken = 0;
            foreach (var sample in pending.ToList())
            {
                switch (await SendAsync(sample, cancellationToken))
                {
                    case true:
                        taken++;
                        pending.Remove(sample);
                        break;
                    case null:
                        pending.Remove(sample); // refused for good (an app that no longer exists): never retried
                        break;
                }
            }

            return taken;
        }
        finally
        {
            flushing.Release();
        }
    }

    /// <summary>True when recorded (or already recorded), null when refused for good, false to try again later.</summary>
    private async Task<bool?> SendAsync(HostingSample sample, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/usage/hosting"))
            {
                Content = JsonContent.Create(new HostingUsageReport([sample])),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
            using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return true;
            }

            logger.LogWarning("Hosting usage for app {AppId} was refused: {Status}.", sample.AppId, (int)response.StatusCode);
            return (int)response.StatusCode is >= 400 and < 500 and not 401 and not 408 and not 429 ? null : false;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Could not report hosting usage for app {AppId}: {Message}", sample.AppId, e.Message);
            return false;
        }
    }
}
