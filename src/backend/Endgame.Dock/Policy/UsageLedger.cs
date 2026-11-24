using System.Globalization;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Policy;

/// <summary>
/// What each app used since the last report, from the memory sampler's ticks: seconds awake and
/// memory over that time (ARCH-005: measured use, not limits). <see cref="Close"/> turns a period
/// into hosting samples (ARCH-004, <c>POST /internal/usage/hosting</c>) whose ids name this Dock,
/// the app and the period's start, so a report sent twice is charged once. Pure: no Docker, no
/// clock of its own beyond the one it is given.
/// </summary>
public sealed class UsageLedger(TimeProvider time, TimeSpan maxGap)
{
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, (double AwakeSeconds, double MemoryByteSeconds)> apps = [];
    private DateTimeOffset since = time.GetUtcNow();
    private DateTimeOffset? lastTick;

    /// <summary>
    /// One sampler tick: every app running now, with the memory it uses. The time since the last
    /// tick (at most <c>maxGap</c>, so a stalled sampler never bills a gap it did not see) counts
    /// as awake for each of them.
    /// </summary>
    public void Tick(IReadOnlyDictionary<Guid, long> running)
    {
        ArgumentNullException.ThrowIfNull(running);
        var now = time.GetUtcNow();
        lock (gate)
        {
            var elapsed = lastTick is { } last ? Math.Clamp((now - last).TotalSeconds, 0, maxGap.TotalSeconds) : 0;
            lastTick = now;
            foreach (var (appId, memory) in running)
            {
                var current = apps.GetValueOrDefault(appId);
                apps[appId] = (current.AwakeSeconds + elapsed, current.MemoryByteSeconds + (Math.Max(0, memory) * elapsed));
            }
        }
    }

    /// <summary>
    /// Ends the period now and returns one sample per app that was awake in it or stores
    /// something (<paramref name="storage"/>, bytes by app). The next period starts here.
    /// </summary>
    public IReadOnlyList<HostingSample> Close(string instance, IReadOnlyDictionary<Guid, long> storage)
    {
        ArgumentNullException.ThrowIfNull(storage);
        var to = time.GetUtcNow();
        lock (gate)
        {
            var from = since;
            if (to <= from)
            {
                return [];
            }

            var period = (to - from).TotalSeconds;
            var samples = new List<HostingSample>();
            foreach (var appId in apps.Keys.Union(storage.Keys).Order())
            {
                var (awake, memorySeconds) = apps.GetValueOrDefault(appId);
                var awakeSeconds = (long)Math.Min(Math.Round(awake), Math.Floor(period));
                var stored = Math.Max(0, storage.GetValueOrDefault(appId));
                if (awakeSeconds <= 0 && stored <= 0)
                {
                    continue;
                }

                var memory = awake > 0 ? (long)(memorySeconds / awake) : 0;
                var id = string.Create(CultureInfo.InvariantCulture, $"dock:{instance}:{appId:N}:{from.ToUnixTimeMilliseconds()}");
                samples.Add(new HostingSample(id, appId, from, to, Math.Max(0, awakeSeconds), memory, stored, 0));
            }

            apps.Clear();
            since = to;
            return samples;
        }
    }
}
