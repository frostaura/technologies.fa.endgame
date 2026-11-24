using System.Net;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;

namespace Endgame.Runner.Platform;

/// <summary>
/// Holds a run's lease while it is worked (ARCH-002: recovery reads the lease, never guesses). It
/// renews every third of the lease, learns from each answer whether the run was paused or cancelled,
/// and is what the loop asks between steps. A lease it cannot renew before expiry is treated as lost.
/// </summary>
public sealed class LeaseKeeper : IRunControl, IAsyncDisposable
{
    private readonly ControlPlaneClient controlPlane;
    private readonly Guid runId;
    private readonly string holder;
    private readonly TimeSpan lease;
    private readonly TimeProvider clock;
    private readonly ILogger logger;
    private readonly CancellationTokenSource stop = new();
    private readonly List<Func<DateTimeOffset, CancellationToken, Task>> onRenewed = [];
    private Task? loop;
    private volatile string status = RunStatuses.Running;
    private volatile bool lost;
    private DateTimeOffset expiresAt;

    public LeaseKeeper(ControlPlaneClient controlPlane, Guid runId, string holder, TimeSpan lease, DateTimeOffset expiresAt, TimeProvider clock, ILogger logger)
    {
        this.controlPlane = controlPlane;
        this.runId = runId;
        this.holder = holder;
        this.lease = lease;
        this.clock = clock;
        this.logger = logger;
        this.expiresAt = expiresAt;
    }

    public string Status => status;

    public DateTimeOffset ExpiresAt => expiresAt;

    /// <summary>Also renew something bound to the lease, such as the run's workspace in Dock.</summary>
    public void OnRenewed(Func<DateTimeOffset, CancellationToken, Task> renewed) => onRenewed.Add(renewed);

    public void Start() => loop ??= Task.Run(() => RenewLoopAsync(stop.Token));

    public ValueTask<RunSignal> CheckAsync(CancellationToken cancellationToken)
    {
        if (lost || clock.GetUtcNow() >= expiresAt)
        {
            return ValueTask.FromResult(RunSignal.LeaseLost);
        }

        return ValueTask.FromResult(status switch
        {
            RunStatuses.Paused => RunSignal.Pause,
            RunStatuses.Cancelled or RunStatuses.Failed or RunStatuses.Succeeded => RunSignal.Cancel,
            _ => RunSignal.Continue,
        });
    }

    /// <summary>Renews once now; true while the lease is held.</summary>
    public async Task<bool> RenewAsync(CancellationToken cancellationToken)
    {
        try
        {
            var run = await controlPlane.LeaseAsync(runId, holder, (int)lease.TotalSeconds, cancellationToken);
            status = run.Status;
            expiresAt = run.LeaseExpiresAt ?? clock.GetUtcNow().Add(lease);
            foreach (var renewed in onRenewed)
            {
                try
                {
                    await renewed(expiresAt, cancellationToken);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogWarning(e, "Renewing what run {RunId}'s lease covers failed.", runId);
                }
            }

            return true;
        }
        catch (ServiceProblemException e) when (e.Status == HttpStatusCode.Conflict)
        {
            // Terminal ("has cancelled") or held by another Runner.
            if (e.Detail.Contains("has ", StringComparison.Ordinal) && !e.Detail.Contains("held by", StringComparison.Ordinal))
            {
                status = e.Detail.Contains(RunStatuses.Cancelled, StringComparison.Ordinal) ? RunStatuses.Cancelled
                    : e.Detail.Contains(RunStatuses.Failed, StringComparison.Ordinal) ? RunStatuses.Failed : RunStatuses.Succeeded;
            }
            else
            {
                lost = true;
            }

            return false;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(e, "Run {RunId}'s lease could not be renewed; retrying until it lapses at {Expiry}.", runId, expiresAt);
            return clock.GetUtcNow() < expiresAt;
        }
    }

    /// <summary>Lets the lease lapse at once, so the run can be claimed again without waiting (graceful shutdown, pause).</summary>
    public async Task ReleaseAsync()
    {
        await StopAsync();
        try
        {
            await controlPlane.LeaseAsync(runId, holder, 1, CancellationToken.None);
        }
        catch (Exception e) when (e is ServiceProblemException or HttpRequestException)
        {
            // Finished, cancelled or already lapsed: nothing is held.
        }
    }

    public async Task StopAsync()
    {
        await stop.CancelAsync();
        if (loop is not null)
        {
            try
            {
                await loop;
            }
            catch (OperationCanceledException)
            {
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        stop.Dispose();
    }

    private async Task RenewLoopAsync(CancellationToken cancellationToken)
    {
        var interval = TimeSpan.FromTicks(Math.Max(TimeSpan.FromMilliseconds(200).Ticks, lease.Ticks / 3));
        while (!cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(interval, clock, cancellationToken);
            if (!await RenewAsync(cancellationToken) && (lost || RunStatuses.IsTerminal(status)))
            {
                return;
            }
        }
    }
}
