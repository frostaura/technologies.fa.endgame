using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

public sealed class AppRuntimeTests
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task Concurrent_requests_to_a_sleeping_app_share_one_wake()
    {
        var backend = new FakeBackend { WakeDelay = TimeSpan.FromMilliseconds(150) };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 50).Select(_ => Task.Run(() => app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None))));
        Assert.All(outcomes, o => Assert.Equal(WakeOutcome.Awake, o));
        Assert.Equal(1, backend.WakeCalls);
        Assert.Equal(1, app.Wakes);
        Assert.True(app.Awake);
    }

    [Fact]
    public async Task A_request_that_gives_up_does_not_cancel_the_wake_for_the_others()
    {
        var backend = new FakeBackend { WakeDelay = TimeSpan.FromMilliseconds(200) };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        using var impatient = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        var abandoned = app.EnsureAwakeAsync(backend, Timeout, impatient.Token);
        var patient = app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => abandoned);
        Assert.Equal(WakeOutcome.Awake, await patient);
        Assert.Equal(1, backend.WakeCalls);
    }

    [Fact]
    public async Task A_crash_during_a_wake_fails_every_waiter_at_once()
    {
        var backend = new FakeBackend { NeverHealthy = true };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        var waiters = Enumerable.Range(0, 5).Select(_ => app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(30), CancellationToken.None)).ToList();
        await Task.Delay(100);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        app.MarkCrashed(TimeSpan.FromSeconds(10));
        var outcomes = await Task.WhenAll(waiters);
        Assert.All(outcomes, o => Assert.Equal(WakeOutcome.Crashed, o));
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(1), $"waiters took {clock.Elapsed}");
    }

    [Fact]
    public async Task After_a_crash_no_wake_is_tried_until_the_backoff_passes()
    {
        var backend = new FakeBackend();
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        app.MarkCrashed(TimeSpan.FromMilliseconds(300));
        Assert.Equal(WakeOutcome.Crashed, await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None));
        Assert.Equal(0, backend.WakeCalls);
        await Task.Delay(400);
        Assert.Equal(WakeOutcome.Awake, await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None));
    }

    [Fact]
    public async Task A_lost_crash_report_is_caught_by_asking_dock()
    {
        var backend = new FakeBackend { NeverHealthy = true };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        var task = app.EnsureAwakeAsync(backend, TimeSpan.FromSeconds(20), CancellationToken.None);
        await Task.Delay(100);
        backend.State = AppRuntimeState.Crashed; // the wake set it running; it died, and the report never came
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var outcome = await task;
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(3), $"noticed after {clock.Elapsed}");
        Assert.Equal(WakeOutcome.Crashed, outcome);
    }

    [Theory]
    [InlineData(WakeStart.NotPublished, WakeOutcome.NotPublished)]
    [InlineData(WakeStart.NoCapacity, WakeOutcome.NoCapacity)]
    [InlineData(WakeStart.Unreachable, WakeOutcome.Unreachable)]
    public async Task Refusals_from_dock_are_reported_not_waited_out(WakeStart answer, WakeOutcome expected)
    {
        var backend = new FakeBackend { WakeAnswer = answer };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        Assert.Equal(expected, await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None));
        Assert.Equal(0, backend.HealthCalls);
    }

    [Fact]
    public async Task An_app_that_never_answers_times_out()
    {
        var backend = new FakeBackend { NeverHealthy = true, State = AppRuntimeState.Running };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        Assert.Equal(WakeOutcome.TimedOut, await app.EnsureAwakeAsync(backend, TimeSpan.FromMilliseconds(300), CancellationToken.None));
        Assert.False(app.Awake);
    }

    [Fact]
    public async Task The_sweeper_never_stops_an_app_with_a_request_in_flight()
    {
        var backend = new FakeBackend();
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None);
        app.Enter();
        Assert.False(await app.TrySleepAsync(backend, CancellationToken.None));
        Assert.True(app.Awake);
        Assert.Equal(0, backend.StopCalls);
        app.Leave();
        Assert.True(await app.TrySleepAsync(backend, CancellationToken.None));
        Assert.False(app.Awake);
        Assert.Equal(1, backend.StopCalls);
    }

    [Fact]
    public async Task A_wake_arriving_during_a_sleep_waits_for_the_stop_then_wakes()
    {
        var backend = new FakeBackend { StopDelay = TimeSpan.FromMilliseconds(200) };
        var app = new AppRuntime(Routes.App(), TimeProvider.System);
        await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None);
        var sleeping = app.TrySleepAsync(backend, CancellationToken.None);
        await Task.Delay(50);
        var outcome = await app.EnsureAwakeAsync(backend, Timeout, CancellationToken.None);
        Assert.True(await sleeping);
        Assert.Equal(WakeOutcome.Awake, outcome);
        Assert.Equal(["wake", "stop:begin", "stop:end", "wake"], backend.Log.ToArray());
        Assert.True(backend.Running);
    }

    [Fact]
    public async Task The_idle_sweeper_honours_each_apps_own_setting()
    {
        var backend = new FakeBackend();
        var registry = new AppRegistry(TimeProvider.System);
        var quick = Routes.App(project: "quick", sleep: new SleepPolicy(false, 1));
        var pinned = Routes.App(project: "pinned", sleep: new SleepPolicy(true, 1));
        var patient = Routes.App(project: "patient", sleep: new SleepPolicy(false, 3600));
        registry.Apply(Endgame.Edge.Routing.RouteSnapshot.From(new RoutingTable("v1", [quick, pinned, patient]), []));
        foreach (var app in registry.All)
        {
            app.MarkAwake();
        }

        await Task.Delay(1200);
        var sweeper = new IdleSweeper(registry, backend, Microsoft.Extensions.Options.Options.Create(new Endgame.Edge.EdgeOptions()), Microsoft.Extensions.Logging.Abstractions.NullLogger<IdleSweeper>.Instance);
        Assert.Equal(1, await sweeper.SweepAsync(CancellationToken.None));
        Assert.False(registry.Get(quick.AppId)!.Awake);
        Assert.True(registry.Get(pinned.AppId)!.Awake);
        Assert.True(registry.Get(patient.AppId)!.Awake);
    }
}
