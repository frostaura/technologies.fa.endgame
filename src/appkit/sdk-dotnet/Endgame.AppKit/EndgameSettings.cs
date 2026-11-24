using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.AppKit;

/// <summary>
/// The environment the platform injects into every app container when it starts. These names are
/// the contract with Dock; see src/appkit/PLATFORM-API.md.
/// </summary>
public static class EndgameEnvironment
{
    /// <summary>PostgreSQL connection string for the app's own database and role.</summary>
    public const string Database = "ENDGAME_DATABASE";

    /// <summary>Base URL of the platform API, e.g. <c>http://control-plane:8080</c>.</summary>
    public const string PlatformUrl = "ENDGAME_PLATFORM_URL";

    /// <summary>The app's bearer token for the platform API. Also the key platform callbacks are signed with.</summary>
    public const string AppToken = "ENDGAME_APP_TOKEN";

    /// <summary>The egress proxy every outbound HTTP call goes through, e.g. <c>http://egress:8080</c>. Optional.</summary>
    public const string EgressProxy = "ENDGAME_EGRESS_PROXY";

    /// <summary>The app's id, used as the telemetry service name. Optional.</summary>
    public const string AppId = "ENDGAME_APP_ID";

    /// <summary>Set to <c>false</c> to switch OpenTelemetry export off (tests do). Optional.</summary>
    public const string TelemetryExport = "ENDGAME_TELEMETRY_EXPORT";
}

/// <summary>The injected environment, read once and validated when the app starts.</summary>
public sealed class EndgameSettings
{
    /// <summary>See <see cref="EndgameEnvironment.Database"/>.</summary>
    public string? Database { get; set; }

    /// <summary>See <see cref="EndgameEnvironment.PlatformUrl"/>.</summary>
    public Uri? PlatformUrl { get; set; }

    /// <summary>See <see cref="EndgameEnvironment.AppToken"/>.</summary>
    public string? AppToken { get; set; }

    /// <summary>See <see cref="EndgameEnvironment.EgressProxy"/>.</summary>
    public Uri? EgressProxy { get; set; }

    /// <summary>See <see cref="EndgameEnvironment.AppId"/>.</summary>
    public string AppId { get; set; } = "app";

    /// <summary>See <see cref="EndgameEnvironment.TelemetryExport"/>.</summary>
    public bool TelemetryExport { get; set; } = true;

    internal string RequiredAppToken => AppToken ?? throw new InvalidOperationException($"{EndgameEnvironment.AppToken} is not set.");

    internal Uri RequiredPlatformUrl => PlatformUrl ?? throw new InvalidOperationException($"{EndgameEnvironment.PlatformUrl} is not set.");

    /// <summary>Host and database of the connection string, never its password — safe to log.</summary>
    internal string DatabaseForLogs()
    {
        try
        {
            var b = new NpgsqlConnectionStringBuilder(Database);
            return $"Host={b.Host};Port={b.Port};Database={b.Database};Username={b.Username}";
        }
        catch (ArgumentException)
        {
            return "(unparseable connection string)";
        }
    }
}

internal sealed class EndgameSettingsSetup(IConfiguration configuration) : IConfigureOptions<EndgameSettings>
{
    public void Configure(EndgameSettings options)
    {
        options.Database = Value(EndgameEnvironment.Database);
        options.AppToken = Value(EndgameEnvironment.AppToken);
        options.PlatformUrl = AbsoluteUri(EndgameEnvironment.PlatformUrl);
        options.EgressProxy = AbsoluteUri(EndgameEnvironment.EgressProxy);
        options.AppId = Value(EndgameEnvironment.AppId) ?? options.AppId;
        options.TelemetryExport = !string.Equals(Value(EndgameEnvironment.TelemetryExport), "false", StringComparison.OrdinalIgnoreCase);
    }

    private string? Value(string key)
    {
        var value = configuration[key];
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private Uri? AbsoluteUri(string key)
    {
        var value = Value(key);
        if (value is null)
        {
            return null;
        }

        if (!Uri.TryCreate(value.EndsWith('/') ? value : value + "/", UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            throw new OptionsValidationException(key, typeof(EndgameSettings),
                [$"{key} must be an absolute http(s) URL, e.g. http://control-plane:8080. It was set to something else."]);
        }

        return uri;
    }
}

internal sealed class EndgameSettingsValidation : IValidateOptions<EndgameSettings>
{
    public ValidateOptionsResult Validate(string? name, EndgameSettings options)
    {
        // `dotnet ef migrations add` builds the host to find the DbContext; it needs no platform.
        if (Microsoft.EntityFrameworkCore.EF.IsDesignTime)
        {
            return ValidateOptionsResult.Success;
        }

        var missing = new List<string>();
        if (options.Database is null)
        {
            missing.Add(EndgameEnvironment.Database);
        }

        if (options.PlatformUrl is null)
        {
            missing.Add(EndgameEnvironment.PlatformUrl);
        }

        if (options.AppToken is null)
        {
            missing.Add(EndgameEnvironment.AppToken);
        }

        if (missing.Count == 0)
        {
            return ValidateOptionsResult.Success;
        }

        return ValidateOptionsResult.Fail(
            $"Endgame app kit: missing environment variable(s) {string.Join(", ", missing)}. " +
            "The platform injects these when it starts the app. Tests get them from EndgameAppFactory " +
            "(Endgame.AppKit.Testing); never hard-code them in appsettings.json.");
    }
}
