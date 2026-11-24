using Endgame.Edge.Routing;
using Endgame.Hosting.Contracts;

namespace Endgame.Edge.Runtime;

/// <summary>Why a request could not be served by its app.</summary>
public enum WakeOutcome
{
    Awake,
    Crashed,
    NoCapacity,
    NotPublished,
    TimedOut,
    Unreachable,
}

/// <summary>
/// One app's runtime state at the edge (ARCH-005, "Waking"): awake or not, requests in flight,
/// last activity, and the single wake every concurrent request to a sleeping app shares. Start and
/// stop share one lock, so a wake arriving mid-sleep waits for the stop to finish and then wakes.
/// </summary>
public sealed class AppRuntime(EdgeApp route, TimeProvider time)
{
    private readonly Lock gate = new();
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private Task<WakeOutcome>? waking;
    private CancellationTokenSource? wakeAbort;
    private DateTimeOffset crashedUntil = DateTimeOffset.MinValue;
    private volatile bool awake;
    private int inFlight;
    private long lastSeenTicks = time.GetTimestamp();
    private int wakes;
    private int sleeps;
    private long lastWakeMs;

    public EdgeApp Route { get; set; } = route;

    public bool Awake => awake;

    public int InFlight => Volatile.Read(ref inFlight);

    public int Wakes => Volatile.Read(ref wakes);

    public int Sleeps => Volatile.Read(ref sleeps);

    public long LastWakeMs => Interlocked.Read(ref lastWakeMs);

    public bool Crashed => time.GetUtcNow() < crashedUntil;

    public TimeSpan Idle => time.GetElapsedTime(Interlocked.Read(ref lastSeenTicks));

    public void Touch() => Interlocked.Exchange(ref lastSeenTicks, time.GetTimestamp());

    /// <summary>Counts a request in. Always before reading <see cref="Awake"/>, so the sweeper cannot miss it.</summary>
    public void Enter()
    {
        Interlocked.Increment(ref inFlight);
        Touch();
    }

    public void Leave()
    {
        Touch();
        Interlocked.Decrement(ref inFlight);
    }

    /// <summary>The app was found running (after an edge restart, or Dock said so).</summary>
    public void MarkAwake()
    {
        awake = true;
        Touch();
    }

    /// <summary>The app went away behind the edge's back; the next request wakes it.</summary>
    public void MarkAsleep() => awake = false;

    /// <summary>
    /// The app crashed: serve the unavailable page at once — including to anyone waiting on a
    /// wake — and do not try again until the back-off has passed.
    /// </summary>
    public void MarkCrashed(TimeSpan backoff)
    {
        lock (gate)
        {
            awake = false;
            crashedUntil = time.GetUtcNow() + backoff;
            wakeAbort?.Cancel();
        }
    }

    /// <summary>
    /// Makes sure the app is awake. Concurrent callers share one wake; a caller that gives up
    /// (its request was aborted) does not cancel the wake for the others.
    /// </summary>
    public async Task<WakeOutcome> EnsureAwakeAsync(IAppBackend backend, TimeSpan timeout, CancellationToken cancellationToken)
    {
        Task<WakeOutcome> wake;
        lock (gate)
        {
            if (awake)
            {
                return WakeOutcome.Awake;
            }

            if (time.GetUtcNow() < crashedUntil)
            {
                return WakeOutcome.Crashed;
            }

            wake = waking ??= RunWakeAsync(backend, timeout);
        }

        return await wake.WaitAsync(cancellationToken);
    }

    /// <summary>
    /// Puts the app to sleep if it is still idle once the lock is held and no request slipped in.
    /// Returns true when it was stopped.
    /// </summary>
    public async Task<bool> TrySleepAsync(IAppBackend backend, CancellationToken cancellationToken)
    {
        if (!await lifecycle.WaitAsync(0, cancellationToken))
        {
            return false;
        }

        try
        {
            if (!awake)
            {
                return false;
            }

            // Mark first, then re-read the count. A request increments, then reads `awake`: either
            // it sees asleep (and waits on the lock for a fresh wake) or this sees it and backs off.
            awake = false;
            Interlocked.MemoryBarrier();
            if (Volatile.Read(ref inFlight) != 0)
            {
                awake = true;
                return false;
            }

            if (!await backend.StopAsync(Route.AppId, cancellationToken))
            {
                awake = true; // still running as far as anyone knows; try again on the next sweep
                return false;
            }

            Interlocked.Increment(ref sleeps);
            return true;
        }
        finally
        {
            lifecycle.Release();
        }
    }

    private async Task<WakeOutcome> RunWakeAsync(IAppBackend backend, TimeSpan timeout)
    {
        // Leave the caller's lock before doing anything: the wake must never complete inline, or
        // its clean-up would run before `waking` is assigned and leave a finished task behind.
        await Task.Yield();
        var started = time.GetTimestamp();
        using var abort = new CancellationTokenSource();
        lock (gate)
        {
            wakeAbort = abort;
        }

        await lifecycle.WaitAsync(CancellationToken.None);
        try
        {
            if (awake)
            {
                return WakeOutcome.Awake;
            }

            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(abort.Token);
            deadline.CancelAfter(timeout);
            var outcome = await WakeAndWaitAsync(backend, abort, deadline.Token);
            if (outcome == WakeOutcome.Awake)
            {
                Interlocked.Exchange(ref lastWakeMs, (long)time.GetElapsedTime(started).TotalMilliseconds);
                Interlocked.Increment(ref wakes);
                awake = true;
                Touch();
            }

            return outcome;
        }
        finally
        {
            lifecycle.Release();
            lock (gate)
            {
                waking = null;
                wakeAbort = null;
            }
        }
    }

    private async Task<WakeOutcome> WakeAndWaitAsync(IAppBackend backend, CancellationTokenSource abort, CancellationToken cancellationToken)
    {
        var target = Route.Target;
        try
        {
            switch (await backend.WakeAsync(Route.AppId, cancellationToken))
            {
                case WakeStart.NotPublished:
                    return WakeOutcome.NotPublished;
                case WakeStart.NoCapacity:
                    return WakeOutcome.NoCapacity;
                case WakeStart.Unreachable:
                    return WakeOutcome.Unreachable;
            }

            var polls = 0;
            while (true)
            {
                if (await backend.HealthyAsync(target, cancellationToken))
                {
                    return WakeOutcome.Awake;
                }

                // A crash report from Dock cancels `abort`; this check catches one that was lost.
                if (++polls % 25 == 0 && await backend.StatusAsync(Route.AppId, cancellationToken) is { State: AppRuntimeState.Crashed })
                {
                    return WakeOutcome.Crashed;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(20), time, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            return abort.IsCancellationRequested ? WakeOutcome.Crashed : WakeOutcome.TimedOut;
        }
    }
}
