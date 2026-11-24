namespace Endgame.Hosting.Contracts;

/// <summary>Names every hosting service and every app agree on. Change one here, never inline.</summary>
public static class HostingConventions
{
    /// <summary>The environment variable holding the token every internal API call carries.</summary>
    public const string ServiceTokenVariable = "ENDGAME_SERVICE_TOKEN";

    /// <summary>The scheme of the <c>Authorization</c> header on internal calls.</summary>
    public const string ServiceTokenScheme = "Bearer";

    /// <summary>The prefix the edge strips from a path-form request, sent to the app.</summary>
    public const string ForwardedPrefixHeader = "X-Forwarded-Prefix";

    /// <summary>Every header with this prefix is the platform's: a visitor's are dropped before an app sees them.</summary>
    public const string PlatformHeaderPrefix = "X-Endgame-";

    /// <summary>The app-scoped session token of the admitted visitor; the app resolves it through the platform API.</summary>
    public const string SessionHeader = "X-Endgame-Session";

    /// <summary>How long a visitor waited for a sleeping app to wake, in milliseconds.</summary>
    public const string WakeTimeHeader = "X-Endgame-Wake-Ms";

    /// <summary>Every app container listens here (ARCH-004, "Ports and names").</summary>
    public const int AppPort = 8080;

    /// <summary>The path every app answers so the edge knows it is ready.</summary>
    public const string AppHealthPath = "/health";

    /// <summary>Under an app's address: the organisation's identity pages, served by the edge (PLATFORM-API §5.4).</summary>
    public const string AuthPath = "/_endgame/auth";

    /// <summary>Under an app's address: platform-to-app callbacks. Never routed from the public side.</summary>
    public const string PlatformCallbackPath = "/_platform";

    /// <summary>Under an app's address: declared webhooks, let through even on a private app.</summary>
    public const string HooksPath = "/hooks";
}

/// <summary>
/// The environment Dock injects into every app container — the app kit's contract
/// (<c>src/appkit/PLATFORM-API.md</c>, §1). The kit reads exactly these names.
/// </summary>
public static class AppEnvironment
{
    /// <summary>Npgsql connection string for the app's own database and role.</summary>
    public const string Database = "ENDGAME_DATABASE";

    /// <summary>The platform API's base address as the app reaches it.</summary>
    public const string PlatformUrl = "ENDGAME_PLATFORM_URL";

    /// <summary>The app's bearer token for the platform API, minted by the control plane.</summary>
    public const string AppToken = "ENDGAME_APP_TOKEN";

    /// <summary>The forward proxy every outbound call goes through.</summary>
    public const string EgressProxy = "ENDGAME_EGRESS_PROXY";

    /// <summary>The app's id.</summary>
    public const string AppId = "ENDGAME_APP_ID";

    /// <summary><c>false</c> turns OTLP export off.</summary>
    public const string TelemetryExport = "ENDGAME_TELEMETRY_EXPORT";

    /// <summary>In a workspace: a server where an app's tests may create and drop databases.</summary>
    public const string TestDatabase = "ENDGAME_TEST_DATABASE";
}
