using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Runtime;

/// <summary>
/// Puts idle apps to sleep, each by its own sleep setting from the cascade. Never an app with a
/// request in flight, never one pinned always-on, never one that is not available (a paused app
/// is already behind its holding page and sleeps like any other).
/// </summary>
public sealed class IdleSweeper(AppRegistry registry, IAppBackend backend, IOptions<EdgeOptions> options, ILogger<IdleSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Max(100, options.Value.IdleSweepMilliseconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await SweepAsync(stoppingToken);
        }
    }

    public async Task<int> SweepAsync(CancellationToken cancellationToken)
    {
        var slept = 0;
        foreach (var app in registry.All)
        {
            var policy = app.Route.Sleep;
            if (!app.Awake || policy.AlwaysOn || app.InFlight > 0 || app.Idle < TimeSpan.FromSeconds(policy.IdleSeconds))
            {
                continue;
            }

            try
            {
                if (await app.TrySleepAsync(backend, cancellationToken))
                {
                    slept++;
                    logger.LogInformation("App {AppId} slept after {Seconds}s idle.", app.Route.AppId, (int)app.Idle.TotalSeconds);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Putting app {AppId} to sleep failed.", app.Route.AppId);
            }
        }

        return slept;
    }
}

/// <summary>Learns which apps are already running when they first appear, so they can sleep too.</summary>
public sealed class AppDiscovery(IAppBackend backend, ILogger<AppDiscovery> logger)
{
    public async Task DiscoverAsync(IEnumerable<AppRuntime> added, CancellationToken cancellationToken)
    {
        await Parallel.ForEachAsync(added, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = cancellationToken }, async (app, ct) =>
        {
            if (await backend.StatusAsync(app.Route.AppId, ct) is { State: AppRuntimeState.Running } && await backend.HealthyAsync(app.Route.Target, ct))
            {
                app.MarkAwake();
                logger.LogDebug("App {AppId} is already running.", app.Route.AppId);
            }
        });
    }
}
