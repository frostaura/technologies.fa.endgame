using System.Collections.Concurrent;
using Endgame.Edge.Routing;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

internal static class Routes
{
    public const string Domain = "endgame.test";

    /// <summary>A route as the control plane serves it.</summary>
    public static RouteView View(
        Guid? id = null,
        string org = "acme",
        string division = "apps",
        string project = "notes",
        string app = "web",
        string target = "http://app-x:8080",
        string? access = AppAccess.Public,
        string sleepMode = SleepSetting.Auto,
        int idleMinutes = 15,
        string? version = "v1",
        bool paused = false)
    {
        var scope = $"{org}/{division}/{project}/{app}";
        return new RouteView(id ?? Guid.NewGuid(), Guid.NewGuid(), scope, $"/{scope}/", $"{org}.{Domain}", $"/{division}/{project}/{app}/",
            target, "running", false, new SleepSetting(sleepMode, idleMinutes, "default", "default"), version, access, paused);
    }

    /// <summary>An app as the edge holds it.</summary>
    public static EdgeApp App(Guid? id = null, string project = "notes", TimeSpan? idleAfter = null, bool alwaysOn = false) =>
        new(id ?? Guid.NewGuid(), Guid.NewGuid(), $"acme/apps/{project}/web", $"/acme/apps/{project}/web", $"acme.{Domain}", $"/apps/{project}/web",
            "http://app-x:8080", AppAccess.Public, alwaysOn ? null : idleAfter ?? TimeSpan.FromMinutes(10), AppAvailability.Available);
}

/// <summary>A Dock and an app that do what a test tells them, and count what they were asked.</summary>
internal sealed class FakeBackend : IAppBackend
{
    public int WakeCalls;
    public int StopCalls;
    public int HealthCalls;
    public volatile bool Running;
    public TimeSpan WakeDelay = TimeSpan.Zero;
    public TimeSpan StopDelay = TimeSpan.Zero;
    public WakeStart WakeAnswer = WakeStart.Started;
    public bool NeverHealthy;
    public string State = AppRuntimeState.Sleeping;
    public ConcurrentQueue<string> Log { get; } = new();

    public async Task<WakeStart> WakeAsync(Guid appId, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref WakeCalls);
        Log.Enqueue("wake");
        await Task.Delay(WakeDelay, cancellationToken);
        if (WakeAnswer == WakeStart.Started)
        {
            Running = true;
            State = AppRuntimeState.Running;
        }

        return WakeAnswer;
    }

    public async Task<bool> StopAsync(Guid appId, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref StopCalls);
        Log.Enqueue("stop:begin");
        await Task.Delay(StopDelay, cancellationToken);
        Running = false;
        State = AppRuntimeState.Sleeping;
        Log.Enqueue("stop:end");
        return true;
    }

    public Task<AppStatus?> StatusAsync(Guid appId, CancellationToken cancellationToken) =>
        Task.FromResult<AppStatus?>(new AppStatus(appId, State, null, null, "http://app-x:8080", null, null, null, null, false, null, null));

    public Task<bool> HealthyAsync(string target, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref HealthCalls);
        return Task.FromResult(Running && !NeverHealthy);
    }
}
