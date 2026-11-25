namespace Endgame.Infrastructure.Health;

/// <summary>Bound from the <c>Status</c> configuration section.</summary>
public sealed class StatusOptions
{
    public const string SectionName = "Status";

    /// <summary>How long one probe may take before its service is reported unhealthy.</summary>
    public int ProbeTimeoutMs { get; set; } = 2000;

    /// <summary>Extra services to probe beyond the platform's own peers. Empty by default.</summary>
    public List<ServiceEndpoint> Services { get; set; } = [];

    /// <summary>
    /// What the status view probes: every peer from the explicit service addresses (never derived
    /// from the environment name), in a stable order, then any extra endpoints. A peer whose address
    /// is empty is not probed.
    /// </summary>
    public static IReadOnlyList<ServiceEndpoint> Probes(Platform.ServiceAddresses peers, IEnumerable<ServiceEndpoint> extra)
    {
        ArgumentNullException.ThrowIfNull(peers);
        var list = new List<ServiceEndpoint>();
        void Add(string key, string name, string address, int order)
        {
            if (!string.IsNullOrWhiteSpace(address))
            {
                list.Add(new ServiceEndpoint { Key = key, Name = name, HealthUrl = address.TrimEnd('/') + "/health", Order = order });
            }
        }

        Add("control-plane", "Control plane", peers.ControlPlane, 10);
        Add("edge", "Edge", peers.Edge, 20);
        Add("runner", "Runner", peers.Runner, 30);
        Add("dock", "Dock", peers.Dock, 40);
        Add("console", "Console", peers.Console, 60);
        Add("ops", "Cloudflare and backups", peers.Ops, 65);
        Add("collector", "Telemetry collector", peers.Collector, 70);
        list.AddRange(extra.Where(e => list.All(p => p.Key != e.Key)));
        return list;
    }
}

/// <summary>A service probed over HTTP: healthy if its health URL answers 2xx in time.</summary>
public sealed class ServiceEndpoint
{
    public string Key { get; set; } = "";

    public string Name { get; set; } = "";

    public string HealthUrl { get; set; } = "";

    public int Order { get; set; }
}
