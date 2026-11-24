using Endgame.Hosting.Contracts;

namespace Endgame.Edge.Runtime;

/// <summary>What waking an app through Dock came to.</summary>
public enum WakeStart
{
    Started,
    NotPublished,
    NoCapacity,
    Unreachable,
}

/// <summary>Everything the wake and sleep logic needs from outside: Dock, and the app itself.</summary>
public interface IAppBackend
{
    Task<WakeStart> WakeAsync(Guid appId, CancellationToken cancellationToken);

    Task<bool> StopAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>Dock's view of the app; null when Dock did not answer.</summary>
    Task<AppStatus?> StatusAsync(Guid appId, CancellationToken cancellationToken);

    /// <summary>True when the app answers its health check. The edge is on the app's network; Dock is not.</summary>
    Task<bool> HealthyAsync(string target, CancellationToken cancellationToken);
}
