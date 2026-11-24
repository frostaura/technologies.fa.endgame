namespace Endgame.Dock.Policy;

/// <summary>
/// Staggers app starts (ARCH-005: twenty simultaneous wakes took 1.3 s median, forty 2.8 s, and
/// after a host restart every app wakes at once). At most <c>concurrency</c> starts run together,
/// and consecutive starts are spaced by at least <c>spacing</c>.
/// </summary>
public sealed class WakeGate(int concurrency, TimeSpan spacing, TimeProvider time)
{
    private readonly SemaphoreSlim slots = new(Math.Max(1, concurrency), Math.Max(1, concurrency));
    private readonly Lock gate = new();
    private long nextStartTicks;

    public int Waiting => Math.Max(0, Volatile.Read(ref waiting));

    private int waiting;

    public async Task<T> RunAsync<T>(Func<Task<T>> start, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref waiting);
        try
        {
            await slots.WaitAsync(cancellationToken);
        }
        finally
        {
            Interlocked.Decrement(ref waiting);
        }

        try
        {
            TimeSpan delay;
            lock (gate)
            {
                var now = time.GetTimestamp();
                var slot = Math.Max(now, nextStartTicks);
                nextStartTicks = slot + (long)(spacing.TotalSeconds * time.TimestampFrequency);
                delay = TimeSpan.FromSeconds((double)(slot - now) / time.TimestampFrequency);
            }

            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, time, cancellationToken);
            }

            return await start();
        }
        finally
        {
            slots.Release();
        }
    }
}
