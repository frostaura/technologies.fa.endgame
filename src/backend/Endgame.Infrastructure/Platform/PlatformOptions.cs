namespace Endgame.Infrastructure.Platform;

/// <summary>
/// Where the control plane finds its peers, bound from <c>Services</c> (environment
/// <c>Services__Edge</c> and so on). The defaults are the compose network's names and do not change
/// with the environment name, so a control plane running in Development inside compose still finds
/// them. Outside compose, set each one explicitly. An empty value switches that peer off.
/// </summary>
public sealed class ServiceAddresses
{
    public const string SectionName = "Services";

    /// <summary>This control plane, as it probes itself.</summary>
    public string ControlPlane { get; set; } = "http://127.0.0.1:8080";

    /// <summary>Edge's public listener (its health).</summary>
    public string Edge { get; set; } = "http://edge:8080";

    /// <summary>Edge's control listener, which apps cannot reach: route refreshes and platform-to-app callbacks.</summary>
    public string EdgeControl { get; set; } = "http://edge:8081";

    public string Runner { get; set; } = "http://runner:8080";

    public string Dock { get; set; } = "http://dock:8080";

    public string Console { get; set; } = "http://console:8080";

    /// <summary>The ops service (Cloudflare and backups, ARCH-007): reserved organisation names. Empty: none runs, the built-in list applies.</summary>
    public string Ops { get; set; } = "http://ops:8080";

    /// <summary>A telemetry collector, probed only when set (none runs in the stack today).</summary>
    public string Collector { get; set; } = "";
}

/// <summary>An app's own model calls (PLATFORM-API §3.2), bound from <c>AppModels</c>.</summary>
public sealed class AppModelOptions
{
    public const string SectionName = "AppModels";

    /// <summary>The task types an app may ask for, each fixed to an app-safe route of the gateway.</summary>
    public Dictionary<string, string> Routes { get; set; } = new(StringComparer.Ordinal)
    {
        ["chat"] = "app.chat",
        ["classify"] = "app.classify",
        ["summarise"] = "app.summarise",
        ["extract"] = "app.extract",
    };

    /// <summary>Per-app cap on model credits per calendar month, unless the cascade sets <c>app_models.monthly_credits</c>.</summary>
    public decimal DefaultMonthlyCredits { get; set; } = 500m;

    public int MaxMessages { get; set; } = 100;
}

/// <summary>App sessions and the access check (PLATFORM-API §5), bound from <c>AppSessions</c>.</summary>
public sealed class AppSessionOptions
{
    public const string SectionName = "AppSessions";

    /// <summary>How long an app-scoped session token handed to Edge lives.</summary>
    public int TokenMinutes { get; set; } = 15;

    /// <summary>How long an end user stays signed in at an app.</summary>
    public int SessionDays { get; set; } = 14;

    /// <summary>How long a share's invitation code stays open.</summary>
    public int InvitationDays { get; set; } = 14;

    /// <summary>Optional cookie domain for app sessions; host-only when empty.</summary>
    public string CookieDomain { get; set; } = "";

    /// <summary>How long a superseded app token keeps working, so a restart overlapping the old container does not fail.</summary>
    public int TokenGraceSeconds { get; set; } = 120;
}

/// <summary>The scheduler, bound from <c>Scheduler</c>.</summary>
public sealed class SchedulerOptions
{
    public const string SectionName = "Scheduler";

    public bool Enabled { get; set; } = true;

    public int PollSeconds { get; set; } = 15;

    /// <summary>How long one run's lease lasts; a lapsed lease is taken over by the next poll.</summary>
    public int LeaseSeconds { get; set; } = 120;

    public int TimeoutSeconds { get; set; } = 60;

    /// <summary>
    /// <c>edge</c>: through Edge's control listener (<c>POST {EdgeControl}/internal/apps/{id}/platform/{rest}</c>),
    /// which wakes the app and forwards. <c>direct</c>: straight to the app's container target.
    /// </summary>
    public string Transport { get; set; } = "edge";

    public int MaxPerApp { get; set; } = 50;
}

/// <summary>Telemetry intake, bound from <c>Telemetry</c>.</summary>
public sealed class TelemetryOptions
{
    public const string SectionName = "Telemetry";

    /// <summary>Rows older than this are pruned by the sweep.</summary>
    public int RetentionDays { get; set; } = 14;

    public int MaxBodyBytes { get; set; } = 4 * 1024 * 1024;

    public int MaxEventsPerRequest { get; set; } = 100;

    public int MaxPropertiesBytes { get; set; } = 8 * 1024;

    public int MaxLogBodyChars { get; set; } = 4000;
}

/// <summary>
/// What hosting costs, in US dollars, before the credit margin; bound from <c>Hosting</c>. Dock
/// reports usage samples; each becomes one <c>hosting</c> ledger entry through the same conversion
/// as model calls. These rates are the founder's to set; the defaults put a small always-on app at
/// roughly two dollars a month.
/// </summary>
public sealed class HostingOptions
{
    public const string SectionName = "Hosting";

    public decimal UsdPerAwakeHour { get; set; } = 0.002m;

    public decimal UsdPerGbHourMemory { get; set; } = 0.004m;

    public decimal UsdPerGbMonthStorage { get; set; } = 0.10m;

    public decimal UsdPerMillionRequests { get; set; } = 0.20m;

    /// <summary>A sample may cover at most this long.</summary>
    public int MaxSampleHours { get; set; } = 24;
}

/// <summary>
/// The mail server, bound from <c>Smtp</c> (environment <c>Smtp__Host</c>, <c>Smtp__Port</c>,
/// <c>Smtp__Username</c>, <c>Smtp__Password</c>, <c>Smtp__From</c>, <c>Smtp__StartTls</c>). With no host
/// or no sender, nothing is sent anywhere: messages wait in the outbox.
/// </summary>
public sealed class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string Host { get; set; } = "";

    public int Port { get; set; } = 587;

    public string Username { get; set; } = "";

    public string Password { get; set; } = "";

    /// <summary>The sender address, e.g. <c>no-reply@frostaura.net</c>.</summary>
    public string From { get; set; } = "";

    public bool StartTls { get; set; } = true;

    public int TimeoutSeconds { get; set; } = 30;

    public bool IsConfigured => Host.Length > 0 && From.Length > 0;
}

/// <summary>The outbox dispatcher, bound from <c>Email</c>.</summary>
public sealed class EmailOptions
{
    public const string SectionName = "Email";

    public bool DispatchEnabled { get; set; } = true;

    public int DispatchSeconds { get; set; } = 5;

    public int MaxAttempts { get; set; } = 6;

    public int MaxRecipients { get; set; } = 50;
}
