namespace Endgame.Edge;

/// <summary>The edge's settings: the <c>Edge</c> configuration section (<c>Edge__*</c> in the environment).</summary>
public sealed class EdgeOptions
{
    public const string Section = "Edge";

    /// <summary>The one published listener: browsers, the tunnel.</summary>
    public int PublicPort { get; set; } = 8080;

    /// <summary>
    /// The control listener: route refreshes and Dock's crash reports. Connections arriving on an
    /// address inside an app subnet are dropped, so no app can reach it (ARCH-005).
    /// </summary>
    public int ControlPort { get; set; } = 8081;

    /// <summary>The address both listeners bind: <c>any</c> in a container, loopback for a developer's machine.</summary>
    public string BindAddress { get; set; } = "any";

    /// <summary>Dock's subnet pools. A connection to the edge on an address in one is an app's, and is refused.</summary>
    public List<string> AppSubnetPools { get; set; } = ["10.213.0.0/16"];

    public string ControlPlaneUrl { get; set; } = "http://control-plane:8080";

    public string DockUrl { get; set; } = "http://dock:8080";

    /// <summary>How often the routing table is re-read when no refresh is pushed.</summary>
    public int RoutesPollSeconds { get; set; } = 5;

    /// <summary>How long a visitor may wait for a sleeping app before seeing the unavailable page.</summary>
    public int WakeTimeoutSeconds { get; set; } = 30;

    /// <summary>After a crash, how long the unavailable page is served before a wake is tried again.</summary>
    public int CrashBackoffSeconds { get; set; } = 15;

    /// <summary>
    /// The length of one minute of an app's idle setting, in seconds: 60, except in tests, which
    /// compress time rather than wait out a real minute.
    /// </summary>
    public int SecondsPerIdleMinute { get; set; } = 60;

    /// <summary>How often idle apps are looked for.</summary>
    public int IdleSweepMilliseconds { get; set; } = 1000;

    /// <summary>How long an access decision is reused for the same session and app.</summary>
    public int AccessCacheSeconds { get; set; } = 15;

    /// <summary>
    /// The scheme visitors used, sent to apps as <c>X-Forwarded-Proto</c>. Behind the tunnel the
    /// edge itself sees plain HTTP, so production sets <c>https</c>; empty means the request's own.
    /// </summary>
    public string PublicScheme { get; set; } = "";

    /// <summary>
    /// The platform's own origin (the path form's host, where the console and its session live),
    /// e.g. <c>https://endgame.frostaura.net</c>. An organisation subdomain's sign-in page sends the
    /// visitor here, where a member's console session can be handed off to the subdomain.
    /// </summary>
    public string PlatformOrigin { get; set; } = "";

    /// <summary>
    /// How often the requests each app served are reported to the control plane as hosting usage
    /// (<c>POST /internal/usage/hosting</c>). Zero turns reporting off.
    /// </summary>
    public int UsageReportSeconds { get; set; } = 300;

    /// <summary>First path segments that are the platform's, never an organisation's.</summary>
    public List<string> ReservedSegments { get; set; } = ["api", "internal", "brand", "assets", "health", "sign-in", "sign-out", "static", "favicon.ico"];
}
