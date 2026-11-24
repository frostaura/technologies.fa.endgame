using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Engine;
using Endgame.Dock.Platform;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Apps;

/// <summary>
/// Watches the Engine's event stream for app containers exiting (ARCH-005, "fail fast on a crash")
/// and reports a crash the moment it happens. An exit Dock asked for is not a crash.
/// </summary>
public sealed class CrashWatcher(
    DockerClient docker,
    AppRuntimeRegistry registry,
    PlatformReports reports,
    ResourceNames names,
    TimeProvider time,
    ILogger<CrashWatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var since = time.GetUtcNow();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var parameters = new ContainerEventsParameters
                {
                    Since = since.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Filters = new Dictionary<string, IDictionary<string, bool>>
                    {
                        ["type"] = new Dictionary<string, bool> { ["container"] = true },
                        ["event"] = new Dictionary<string, bool> { ["die"] = true },
                        ["label"] = new Dictionary<string, bool>
                        {
                            [$"{ResourceNames.ManagedByLabel}={names.Instance}"] = true,
                            [$"{ResourceNames.KindLabel}={ResourceNames.AppKind}"] = true,
                        },
                    },
                };
                await docker.System.MonitorEventsAsync(parameters, new Progress<Message>(m => _ = OnDieAsync(m, stoppingToken)), stoppingToken);
            }
            catch (Exception e) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("The Engine's event stream dropped ({Message}); reconnecting.", e.Message);
            }

            since = time.GetUtcNow().AddSeconds(-2);
            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }

    private async Task OnDieAsync(Message message, CancellationToken cancellationToken)
    {
        try
        {
            if (message.Actor?.Attributes is not { } attributes
                || !attributes.TryGetValue(ResourceNames.AppLabel, out var app)
                || !Guid.TryParse(app, out var appId))
            {
                return;
            }

            var runtime = registry.For(appId);
            Volatile.Write(ref runtime.LastMemoryBytes, 0);
            ContainerInspectResponse container;
            try
            {
                container = await docker.Containers.InspectContainerAsync(message.Actor.ID, cancellationToken);
            }
            catch (DockerContainerNotFoundException)
            {
                return; // removed, not crashed
            }

            if (!AppService.IsCrash(container.State, runtime, time.GetUtcNow()))
            {
                return;
            }

            logger.LogWarning("App {AppId} crashed (exit {Code}, out of memory: {Oom}).", appId, container.State?.ExitCode, container.State?.OOMKilled);
            await reports.StateChangedAsync(new AppStateReport(appId, AppRuntimeState.Crashed, (int)(container.State?.ExitCode ?? -1), container.State?.OOMKilled == true, time.GetUtcNow()), cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Handling an exit event failed.");
        }
    }
}

/// <summary>
/// Samples the memory every running app really uses (ARCH-005: budget by real use, not limits).
/// Page cache the kernel can reclaim is not counted.
/// </summary>
public sealed class MemorySampler(DockerClient docker, AppRuntimeRegistry registry, ResourceNames names, IOptions<DockOptions> options, ILogger<MemorySampler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.MemorySampleSeconds)));
        do
        {
            try
            {
                await SampleAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogDebug(e, "Memory sampling failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task SampleAsync(CancellationToken cancellationToken)
    {
        var running = await docker.Containers.ListContainersAsync(new ContainersListParameters
        {
            Filters = new Dictionary<string, IDictionary<string, bool>>
            {
                ["label"] = new Dictionary<string, bool>
                {
                    [$"{ResourceNames.ManagedByLabel}={names.Instance}"] = true,
                    [$"{ResourceNames.KindLabel}={ResourceNames.AppKind}"] = true,
                },
            },
        }, cancellationToken);
        var seen = new HashSet<Guid>();
        foreach (var container in running)
        {
            if (!container.LabelMap().TryGetValue(ResourceNames.AppLabel, out var app) || !Guid.TryParse(app, out var appId))
            {
                continue;
            }

            ContainerStatsResponse? stats = null;
            await docker.Containers.GetContainerStatsAsync(container.ID, new ContainerStatsParameters { Stream = false, OneShot = true },
                new Progress<ContainerStatsResponse>(s => stats = s), cancellationToken);
            if (stats?.MemoryStats is not { } memory)
            {
                continue;
            }

            var usage = (long)(memory.Usage ?? 0);
            if (memory.Stats is { } detail && detail.TryGetValue("inactive_file", out var inactive))
            {
                usage -= (long)Math.Min((ulong)usage, inactive);
            }

            var runtime = registry.For(appId);
            Volatile.Write(ref runtime.LastMemoryBytes, usage);
            if (usage > Volatile.Read(ref runtime.PeakMemoryBytes))
            {
                Volatile.Write(ref runtime.PeakMemoryBytes, usage);
            }

            seen.Add(appId);
        }

        foreach (var (appId, runtime) in registry.All)
        {
            if (!seen.Contains(appId))
            {
                Volatile.Write(ref runtime.LastMemoryBytes, 0);
            }
        }
    }
}
