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
    private readonly ConcurrentDictionary<Guid, ActiveRun> active = new();
    private readonly CancellationTokenSource hard = new();
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private volatile bool stopping;

    /// <summary>This process's lease-holder name: unique per process, so a restarted Runner never mistakes a dead one's lease for its own.</summary>
    public string Holder { get; } = $"runner-{Environment.MachineName.ToLowerInvariant()}-{Guid.NewGuid().ToString("N")[..8]}";

    public IReadOnlyCollection<Guid> Active => active.Keys.ToList();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var kinds = options.Kinds.Count > 0 ? options.Kinds : executor.Kinds.ToList();
        logger.LogInformation("Runner {Holder} taking {Kinds} runs, {Concurrency} at a time and {Conversations} conversations beside them.", Holder, string.Join(", ", kinds), options.Concurrency, options.ConversationConcurrency);
        while (!stoppingToken.IsCancellationRequested && !hard.IsCancellationRequested)
        {
            var claimedAny = false;
            foreach (var lane in RunLanes.Plan(kinds, options, active.Values.Count(v => v.Lane == RunLanes.Work), active.Values.Count(v => v.Lane == RunLanes.Conversation)))
            {
                RunInfo? claimed = null;
                try
                {
                    claimed = await controlPlane.ClaimAsync(Holder, options.LeaseSeconds, lane.Kinds, stoppingToken);
                }
                catch (Exception e) when (e is HttpRequestException or ServiceProblemException or TaskCanceledException && !stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Claiming work failed: {Error}", e.Message);
                }

                if (claimed is { } run)
                {
                    claimedAny = true;
                    Start(run, lane.Name);
                }
            }

            if (claimedAny)
            {
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

    private void Start(RunInfo run, string lane)
    {
        var started = new TaskCompletionSource();
        active[run.Id] = new ActiveRun(lane, Task.Run(async () =>
        {
            await started.Task;
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
        }, CancellationToken.None));
        started.SetResult();
    }

    private sealed record ActiveRun(string Lane, Task Work);

    /// <summary>Graceful: stop claiming, let each run reach a step boundary and suspend, then give up on stragglers.</summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        stopping = true;
        await base.StopAsync(cancellationToken);
        var waiting = Task.WhenAll(active.Values.Select(a => a.Work).ToList());
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
            await Task.WhenAll(active.Values.Select(a => a.Work).ToList());
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

/// <summary>
/// The Runner's two lanes (D47). Conversations are answered in a lane of their own, so a chat never waits behind long
/// builds and research; the work lane takes every other kind, so chats can never starve a build either. Each lane has its
/// own limit, and a lane with room asks the control plane only for its own kinds.
/// </summary>
public static class RunLanes
{
    public const string Work = "work";

    public const string Conversation = "conversation";

    /// <summary>The kinds answered in the conversation lane.</summary>
    public static readonly IReadOnlyList<string> ConversationKinds = [Endgame.Domain.Runs.RunKinds.Conversation];

    /// <summary>One claim to try: the lane it fills and the kinds it asks for.</summary>
    public sealed record Claim(string Name, IReadOnlyList<string> Kinds);

    /// <summary>The claims to try now, conversation lane first (a chat is waited on by a person), each only while its lane has room.</summary>
    public static IReadOnlyList<Claim> Plan(IReadOnlyList<string> kinds, RunnerOptions options, int activeWork, int activeConversations)
    {
        ArgumentNullException.ThrowIfNull(kinds);
        ArgumentNullException.ThrowIfNull(options);
        var chat = kinds.Where(k => ConversationKinds.Contains(k, StringComparer.Ordinal)).ToList();
        var work = kinds.Where(k => !ConversationKinds.Contains(k, StringComparer.Ordinal)).ToList();
        var claims = new List<Claim>();
        if (chat.Count > 0 && activeConversations < Math.Max(0, options.ConversationConcurrency))
        {
            claims.Add(new Claim(Conversation, chat));
        }

        if (work.Count > 0 && activeWork < Math.Max(0, options.Concurrency))
        {
            claims.Add(new Claim(Work, work));
        }

        return claims;
    }
}
