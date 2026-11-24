namespace Endgame.Application.Status;

public enum HealthState
{
    Healthy,
    Unhealthy,
}

/// <summary>One service's answer to "are you up?", as measured by asking it.</summary>
/// <param name="Key">Stable identifier, e.g. <c>control-plane</c>.</param>
/// <param name="Name">Display name.</param>
/// <param name="State">Healthy only when the service itself said so.</param>
/// <param name="LatencyMs">How long the answer took, or how long until it was given up on.</param>
/// <param name="Detail">What went wrong, or what the service reported about itself.</param>
public sealed record ServiceHealth(string Key, string Name, HealthState State, long LatencyMs, string? Detail);

/// <summary>Every service's health at one moment.</summary>
public sealed record SystemStatus(HealthState Overall, DateTimeOffset CheckedAt, IReadOnlyList<ServiceHealth> Services);
