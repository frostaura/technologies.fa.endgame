namespace Endgame.Infrastructure.Health;

/// <summary>Bound from the <c>Status</c> configuration section.</summary>
public sealed class StatusOptions
{
    public const string SectionName = "Status";

    /// <summary>How long one probe may take before its service is reported unhealthy.</summary>
    public int ProbeTimeoutMs { get; set; } = 2000;

    public List<ServiceEndpoint> Services { get; set; } = [];
}

/// <summary>A service probed over HTTP: healthy if its health URL answers 2xx in time.</summary>
public sealed class ServiceEndpoint
{
    public string Key { get; set; } = "";

    public string Name { get; set; } = "";

    public string HealthUrl { get; set; } = "";

    public int Order { get; set; }
}
