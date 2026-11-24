using System.Collections.Concurrent;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;

namespace Endgame.Runner.Execution;

/// <summary>
/// The Runner's work loop: claims queued runs (and runs whose lease lapsed — that is crash recovery:
/// a run left by a dead Runner is claimed again once its lease runs out and resumed from its log) up
/// to a concurrency limit. On a graceful stop, runs are suspended at their next step boundary and
/// their leases released so another Runner can resume them at once.
/// </summary>
public sealed class RunnerService(ControlPlaneClient controlPlane, RunExecutor executor, RunnerOptions options, ILogger<RunnerService> logger, TimeProvider? clock = null) : BackgroundService
{
    private readonly ConcurrentDictionary<Guid, Task> active = new();
    private readonly CancellationTokenSource hard = new();
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private volatile bool stopping;

    /// <summary>This process's lease-holder name: unique per process, so a restarted Runner never mistakes a dead one's lease for its own.</summary>
    public string Holder { get; } = $"runner-{Environment.MachineName.ToLowerInvariant()}-{Guid.NewGuid().ToString("N")[..8]}";

    public IReadOnlyCollection<Guid> Active => active.Keys.ToList();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var kinds = options.Kinds.Count > 0 ? options.Kinds : executor.Kinds.ToList();
        logger.LogInformation("Runner {Holder} taking {Kinds} runs, {Concurrency} at a time.", Holder, string.Join(", ", kinds), options.Concurrency);
        while (!stoppingToken.IsCancellationRequested && !hard.IsCancellationRequested)
        {
            RunInfo? claimed = null;
            if (active.Count < options.Concurrency)
            {
                try
                {
                    claimed = await controlPlane.ClaimAsync(Holder, options.LeaseSeconds, kinds, stoppingToken);
                }
                catch (Exception e) when (e is HttpRequestException or ServiceProblemException or TaskCanceledException && !stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Claiming work failed: {Error}", e.Message);
                }
            }

            if (claimed is { } run)
            {
                active[run.Id] = Task.Run(async () =>
                {
                    try
                    {
                        await executor.ExecuteAsync(run, Holder, () => stopping, hard.Token);
                    }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        logger.LogError(e, "Run {RunId} ended with an unhandled fault.", run.Id);
                    }
                    finally
                    {
                        active.TryRemove(run.Id, out _);
                    }
                }, CancellationToken.None);
                continue;
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(options.PollSeconds), time, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Graceful: stop claiming, let each run reach a step boundary and suspend, then give up on stragglers.</summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        stopping = true;
        await base.StopAsync(cancellationToken);
        var waiting = Task.WhenAll(active.Values.ToList());
        var finished = await Task.WhenAny(waiting, Task.Delay(TimeSpan.FromSeconds(options.ShutdownGraceSeconds), time, cancellationToken));
        if (finished != waiting)
        {
            logger.LogWarning("{Count} runs did not reach a step boundary in time; their leases will lapse and another Runner resumes them.", active.Count);
            await hard.CancelAsync();
        }
    }

    /// <summary>Dies as a crashed process does: no step boundary, no lease released, nothing written. For the kill-and-resume test.</summary>
    public async Task KillAsync()
    {
        await hard.CancelAsync();
        await base.StopAsync(CancellationToken.None);
        try
        {
            await Task.WhenAll(active.Values.ToList());
        }
        catch (OperationCanceledException)
        {
        }
    }

    public override void Dispose()
    {
        hard.Dispose();
        base.Dispose();
    }
}
