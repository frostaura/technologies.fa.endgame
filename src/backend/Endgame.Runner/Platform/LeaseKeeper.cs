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
        catch (ServiceProblemException e) when (e.Status is HttpStatusCode.Conflict or HttpStatusCode.NotFound)
        {
            // A run that has finished (or was cancelled) refuses its lease: that is the normal end of the work, not a fault.
            // Its status is read from the refusal itself, and from the wording when an older control plane gives none.
            var finished = e.RunStatus is { } said && RunStatuses.IsTerminal(said) ? said
                : e.Detail.Contains("has ", StringComparison.Ordinal) && !e.Detail.Contains("held by", StringComparison.Ordinal)
                    ? e.Detail.Contains(RunStatuses.Cancelled, StringComparison.Ordinal) ? RunStatuses.Cancelled
                    : e.Detail.Contains(RunStatuses.Failed, StringComparison.Ordinal) ? RunStatuses.Failed : RunStatuses.Succeeded
                    : null;
            if (finished is not null)
            {
                status = finished;
                logger.LogInformation("Run {RunId} has {Status}; its lease is no longer renewed.", runId, finished);
            }
            else
            {
                lost = true;
            }

            return false;
        }
        catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // Anything else — the network, a refusal of another kind, an answer that could not be read — is retried until
            // the lease would lapse; it never takes the run down with it.
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
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Finished, cancelled or already lapsed: nothing is held, and releasing it is never a fault.
            logger.LogDebug(e, "Run {RunId}'s lease was not released: it is no longer held.", runId);
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
            try
            {
                await Task.Delay(interval, clock, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            if (!await RenewAsync(cancellationToken) && (lost || RunStatuses.IsTerminal(status)))
            {
                return;
            }
        }
    }
}
