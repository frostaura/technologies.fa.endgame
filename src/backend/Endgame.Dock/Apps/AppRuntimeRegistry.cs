using System.Collections.Concurrent;

namespace Endgame.Dock.Apps;

/// <summary>What Dock knows about an app between Engine calls.</summary>
public sealed class AppRuntime
{
    /// <summary>Start, stop and wake of one app never overlap.</summary>
    public SemaphoreSlim Lifecycle { get; } = new(1, 1);

    /// <summary>When Dock last stopped the app, so the exit that follows is not taken for a crash.</summary>
    public DateTimeOffset? StopRequestedAt { get; set; }

    /// <summary>The most memory the app has been seen using.</summary>
    public long PeakMemoryBytes;

    /// <summary>Memory in use at the last sample, while running.</summary>
    public long LastMemoryBytes;
}

public sealed class AppRuntimeRegistry
{
    private readonly ConcurrentDictionary<Guid, AppRuntime> apps = new();

    public AppRuntime For(Guid appId) => apps.GetOrAdd(appId, _ => new AppRuntime());

    public IEnumerable<KeyValuePair<Guid, AppRuntime>> All => apps;
}
