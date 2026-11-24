using Docker.DotNet.Models;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Engine;

/// <summary>
/// The host configuration of everything Dock runs (ARCH-005, "Running an app"): limits, no new
/// privileges, every capability dropped, no socket and no host path, one internal network.
/// Disk quotas, AppArmor and gVisor are absent on this machine, so disk use is watched instead.
/// </summary>
public static class Hardening
{
    /// <summary>An app: also a read-only root with a small no-exec temporary directory.</summary>
    public static HostConfig App(ResourceLimits limits, string network) => Base(limits, network, readOnlyRoot: true);

    /// <summary>A workspace or build: SDKs write caches, so the root stays writable.</summary>
    public static HostConfig Workspace(ResourceLimits limits, string network)
    {
        var config = Base(limits, network, readOnlyRoot: false);
        config.Init = true; // reaps whatever an agent's commands leave behind
        return config;
    }

    private static HostConfig Base(ResourceLimits limits, string network, bool readOnlyRoot)
    {
        var memory = limits.MemoryMb * 1024L * 1024L;
        return new HostConfig
        {
            Memory = memory,
            MemorySwap = memory, // no swap beyond the limit
            NanoCPUs = (long)(limits.Cpus * 1_000_000_000),
            PidsLimit = limits.Pids,
            ReadonlyRootfs = readOnlyRoot,
            Tmpfs = readOnlyRoot ? new Dictionary<string, string> { ["/tmp"] = "rw,noexec,nosuid,nodev,size=64m" } : null,
            SecurityOpt = ["no-new-privileges:true"],
            CapDrop = ["ALL"],
            Privileged = false,
            NetworkMode = network,
            RestartPolicy = new RestartPolicy { Name = RestartPolicyKind.No },
            LogConfig = new LogConfig { Type = "json-file", Config = new Dictionary<string, string> { ["max-size"] = "2m", ["max-file"] = "2" } },
            Binds = [],
            Mounts = [],
        };
    }
}
