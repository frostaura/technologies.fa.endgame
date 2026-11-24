using Endgame.Hosting.Contracts;

namespace Endgame.Dock;

/// <summary>Dock's settings: the <c>Dock</c> configuration section (<c>Dock__*</c> in the environment).</summary>
public sealed class DockOptions
{
    public const string Section = "Dock";

    /// <summary>Put before every resource name. Empty in production; <c>test-endgame-</c> in tests.</summary>
    public string ResourcePrefix { get; set; } = "";

    /// <summary>The <c>endgame.dock</c> label on everything this Dock owns. Nothing else is ever touched.</summary>
    public string Instance { get; set; } = "endgame";

    /// <summary>The private range every app, workspace and build /28 is cut from.</summary>
    public string SubnetPool { get; set; } = "10.213.0.0/16";

    /// <summary>Repositories and Dock's small state files.</summary>
    public string DataDirectory { get; set; } = "/data";

    /// <summary>The app-kit template every new repository starts from.</summary>
    public string TemplateDirectory { get; set; } = "/opt/endgame/app-template";

    /// <summary>
    /// A prebuilt workspace image to use as is. When empty, Dock builds its own from the template,
    /// tagged by a hash of what went into it, so a changed template gets a fresh image.
    /// </summary>
    public string WorkspaceImage { get; set; } = "";

    /// <summary>The repository name of the workspace image Dock builds.</summary>
    public string WorkspaceImageRepository { get; set; } = "endgame-workspace";

    /// <summary>The containers Dock joins to every app network. Dock itself never joins one.</summary>
    public PeerOptions Peers { get; set; } = new();

    /// <summary>A role able to create databases and roles on the shared server.</summary>
    public string PostgresAdmin { get; set; } = "";

    /// <summary>Most connections one app may hold.</summary>
    public int AppConnectionLimit { get; set; } = 10;

    /// <summary>Derives every app's database name and password. Required; never logged.</summary>
    public string SecretKey { get; set; } = "";

    public string ControlPlaneUrl { get; set; } = "http://control-plane:8080";

    /// <summary>Edge's control listener: where crash reports and route refreshes go.</summary>
    public string EdgeControlUrl { get; set; } = "http://edge:8081";

    /// <summary>The platform API as an app sees it (through the egress proxy).</summary>
    public string PlatformUrlForApps { get; set; } = "http://control-plane:8080";

    /// <summary>The host and port the proxy lets every app reach for the platform API.</summary>
    public string PlatformHost { get; set; } = "control-plane";

    public int PlatformPort { get; set; } = 8080;

    /// <summary>Passed to apps as <c>ENDGAME_TELEMETRY_EXPORT</c> when set; <c>false</c> turns OTLP export off.</summary>
    public string TelemetryExport { get; set; } = "";

    public ResourceLimits AppDefaults { get; set; } = new(1, 256, 128);

    public ResourceLimits AppMaxima { get; set; } = new(2, 1024, 512);

    public ResourceLimits WorkspaceDefaults { get; set; } = new(2, 2048, 1024);

    public ResourceLimits WorkspaceMaxima { get; set; } = new(4, 4096, 4096);

    public ResourceLimits BuildLimits { get; set; } = new(2, 3072, 2048);

    /// <summary>Memory every awake app together may use, measured, not by limit.</summary>
    public int AppMemoryBudgetMb { get; set; } = 4096;

    /// <summary>What an app that has never been measured is assumed to need.</summary>
    public int DefaultAppEstimateMb { get; set; } = 64;

    public int MaxConcurrentWakes { get; set; } = 4;

    public int WakeSpacingMs { get; set; } = 40;

    public int LeaseSweepSeconds { get; set; } = 15;

    public int MemorySampleSeconds { get; set; } = 10;

    /// <summary>How often hosting usage (awake time, memory, storage) is reported to the control plane. Zero turns it off.</summary>
    public int UsageReportSeconds { get; set; } = 300;

    public int BuildTimeoutSeconds { get; set; } = 900;

    /// <summary>Hosts every workspace and build may reach: the package registries.</summary>
    public List<string> PackageRegistries { get; set; } =
    [
        "api.nuget.org",
        "*.nuget.org",
        "registry.npmjs.org",
        "mcr.microsoft.com",
        "*.data.mcr.microsoft.com",
        // Certificate revocation checks NuGet makes while verifying package signatures.
        "*.digicert.com",
    ];

    /// <summary>Largest workspace bundle Dock will fetch back on commit.</summary>
    public long MaxBundleBytes { get; set; } = 256L * 1024 * 1024;

    /// <summary>Largest file the files API returns or accepts.</summary>
    public int MaxFileBytes { get; set; } = 4 * 1024 * 1024;
}

public sealed class PeerOptions
{
    public string Edge { get; set; } = "endgame-edge-1";

    public string Postgres { get; set; } = "endgame-postgres-1";

    public string Egress { get; set; } = "endgame-egress-1";

    /// <summary>The name an app uses for the database server on its own network.</summary>
    public string PostgresAlias { get; set; } = "postgres";

    /// <summary>The name an app uses for the egress proxy on its own network.</summary>
    public string EgressAlias { get; set; } = "egress";

    public int EgressPort { get; set; } = 3128;

    /// <summary>Where the egress proxy reads Dock's policy fragment from, inside its container.</summary>
    public string EgressPolicyPath { get; set; } = "/etc/squid/policy/endgame.conf";
}
