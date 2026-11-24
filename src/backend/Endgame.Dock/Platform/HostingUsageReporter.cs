using System.Net.Http.Headers;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Apps;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Platform;

/// <summary>
/// Hosting usage, Dock's half (ARCH-004, <c>POST /internal/usage/hosting</c>): every
/// <c>Dock:UsageReportSeconds</c>, one sample per app with its awake seconds and mean memory (from
/// the memory sampler, <see cref="UsageLedger"/>) and its database's size. Requests are counted
/// and reported by Edge, which alone sees them. A sample the control plane could not take is kept
/// and sent again under the same id; one it refuses for good (an app it no longer knows) is dropped.
/// </summary>
public sealed class HostingUsageReporter(
    UsageLedger ledger,
    DockerClient docker,
    DatabaseProvisioner databases,
    ResourceNames names,
    IHttpClientFactory http,
    IOptions<DockOptions> options,
    IConfiguration configuration,
    ILogger<HostingUsageReporter> logger) : BackgroundService
{
    private readonly List<HostingSample> pending = [];
    private readonly SemaphoreSlim flushing = new(1, 1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = options.Value.UsageReportSeconds;
        if (seconds <= 0)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await FlushAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning("Reporting hosting usage failed: {Message}", e.Message);
            }
        }
    }

    /// <summary>Closes the period now and sends every sample not yet taken. Returns how many the control plane took.</summary>
    public async Task<int> FlushAsync(CancellationToken cancellationToken)
    {
        await flushing.WaitAsync(cancellationToken);
        try
        {
            var apps = await AppsAsync(cancellationToken);
            pending.AddRange(ledger.Close(names.Instance, await databases.SizesAsync(apps, cancellationToken)));
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
                        pending.Remove(sample);
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

    /// <summary>Every app this Dock has a container for, awake or asleep.</summary>
    private async Task<IReadOnlyList<Guid>> AppsAsync(CancellationToken cancellationToken)
    {
        var containers = await docker.Containers.ListContainersAsync(new ContainersListParameters
        {
            All = true,
            Filters = new Dictionary<string, IDictionary<string, bool>>
            {
                ["label"] = new Dictionary<string, bool>
                {
                    [$"{ResourceNames.ManagedByLabel}={names.Instance}"] = true,
                    [$"{ResourceNames.KindLabel}={ResourceNames.AppKind}"] = true,
                },
            },
        }, cancellationToken);
        return containers
            .Select(c => c.Labels is { } labels && labels.TryGetValue(ResourceNames.AppLabel, out var app) && Guid.TryParse(app, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();
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
            using var response = await http.CreateClient(PlatformReports.ClientName).SendAsync(request, cancellationToken);
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
