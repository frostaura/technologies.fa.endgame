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

    /// <summary>The signed-in member or end user the edge admitted, for private and shared apps.</summary>
    public const string UserIdHeader = "X-Endgame-User-Id";

    /// <summary>How long a visitor waited for a sleeping app to wake, in milliseconds.</summary>
    public const string WakeTimeHeader = "X-Endgame-Wake-Ms";

    /// <summary>Every app container listens here (ARCH-004, "Ports and names").</summary>
    public const int AppPort = 8080;

    /// <summary>The path every app answers so the edge knows it is ready.</summary>
    public const string AppHealthPath = "/health";
}

/// <summary>
/// The environment Dock injects into every app container. The app kit reads these names; they
/// are the whole contract between a running app and the platform it was started on.
/// </summary>
public static class AppEnvironment
{
    /// <summary>The app's id in the cascade.</summary>
    public const string AppId = "ENDGAME_APP_ID";

    /// <summary>The organisation the app belongs to.</summary>
    public const string OrganisationId = "ENDGAME_ORGANISATION_ID";

    /// <summary>The commit the running image was built from.</summary>
    public const string Commit = "ENDGAME_APP_COMMIT";

    /// <summary>The token the app presents to the platform API. Minted by the control plane.</summary>
    public const string AppToken = "ENDGAME_APP_TOKEN";

    /// <summary>The platform API's base address, reached through the egress proxy.</summary>
    public const string PlatformUrl = "ENDGAME_PLATFORM_URL";

    /// <summary>The app's own database: a .NET connection string named <c>App</c>.</summary>
    public const string ConnectionString = "ConnectionStrings__App";
}
