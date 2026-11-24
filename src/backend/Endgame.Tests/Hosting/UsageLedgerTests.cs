using Endgame.Dock.Policy;

namespace Endgame.Tests.Hosting;

/// <summary>Dock's half of hosting usage: awake time and memory from the sampler's ticks, closed into samples.</summary>
public sealed class UsageLedgerTests
{
    private sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly Guid Awake = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Asleep = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly IReadOnlyDictionary<Guid, long> NoStorage = new Dictionary<Guid, long>();

    [Fact]
    public void Awake_time_and_mean_memory_come_from_the_ticks_and_storage_from_the_database()
    {
        var clock = new Clock(DateTimeOffset.Parse("2026-11-25T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
        var ledger = new UsageLedger(clock, TimeSpan.FromSeconds(30));
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 100 });
        clock.Now = clock.Now.AddSeconds(10);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 100 });
        clock.Now = clock.Now.AddSeconds(10);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 300 });
        clock.Now = clock.Now.AddSeconds(40);

        var samples = ledger.Close("endgame", new Dictionary<Guid, long> { [Asleep] = 8192 });
        Assert.Equal(2, samples.Count);
        var awake = samples.Single(s => s.AppId == Awake);
        Assert.Equal(20, awake.AwakeSeconds);
        Assert.Equal(200, awake.MemoryBytes); // (100·10 + 300·10) / 20
        Assert.Equal(0, awake.Requests); // the edge reports requests
        Assert.Equal(TimeSpan.FromSeconds(60), awake.To - awake.From);
        var asleep = samples.Single(s => s.AppId == Asleep);
        Assert.Equal(0, asleep.AwakeSeconds);
        Assert.Equal(8192, asleep.StorageBytes);
        Assert.Equal(0, asleep.MemoryBytes);
    }

    [Fact]
    public void Sample_ids_name_the_dock_the_app_and_the_period_and_a_new_period_starts_empty()
    {
        var clock = new Clock(DateTimeOffset.UnixEpoch.AddDays(20_000));
        var ledger = new UsageLedger(clock, TimeSpan.FromSeconds(30));
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        clock.Now = clock.Now.AddSeconds(5);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        var first = Assert.Single(ledger.Close("endgame-int", NoStorage));
        Assert.Equal($"dock:endgame-int:{Awake:N}:{DateTimeOffset.UnixEpoch.AddDays(20_000).ToUnixTimeMilliseconds()}", first.SampleId);

        clock.Now = clock.Now.AddSeconds(5);
        Assert.Empty(ledger.Close("endgame-int", NoStorage)); // nothing awake, nothing stored
        clock.Now = clock.Now.AddSeconds(5);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        clock.Now = clock.Now.AddSeconds(5);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        var third = Assert.Single(ledger.Close("endgame-int", NoStorage));
        Assert.NotEqual(first.SampleId, third.SampleId);
        Assert.Equal(first.To.AddSeconds(5), third.From);
    }

    [Fact]
    public void A_stalled_sampler_never_bills_more_than_its_gap_or_the_period()
    {
        var clock = new Clock(DateTimeOffset.UnixEpoch.AddDays(20_000));
        var ledger = new UsageLedger(clock, TimeSpan.FromSeconds(30));
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        clock.Now = clock.Now.AddHours(1);
        ledger.Tick(new Dictionary<Guid, long> { [Awake] = 1 });
        var sample = Assert.Single(ledger.Close("endgame", NoStorage));
        Assert.Equal(30, sample.AwakeSeconds);
        Assert.True(sample.AwakeSeconds <= (sample.To - sample.From).TotalSeconds);
    }
}
