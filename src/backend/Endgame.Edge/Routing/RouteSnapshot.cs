using System.Collections.Frozen;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Endgame.Hosting.Contracts;

namespace Endgame.Edge.Routing;

/// <summary>
/// One app as the edge routes it, normalised from the control plane's <see cref="RouteView"/>.
/// </summary>
/// <param name="PathPrefix">The path form's prefix, <c>/org/division/project/app</c>, no trailing slash.</param>
/// <param name="Host">The organisation subdomain.</param>
/// <param name="HostPrefix">The prefix on that subdomain, <c>/division/project/app</c>.</param>
/// <param name="IdleAfter">How long with no request before the app sleeps; null when always on.</param>
/// <param name="PausedReason">Why the app is paused (<see cref="PausedReasons"/>), when <paramref name="Availability"/> is paused.</param>
/// <param name="Hooks">The declared webhook names: only <c>POST hooks/&lt;name&gt;</c> for these skips the access check.</param>
public sealed record EdgeApp(
    Guid AppId,
    Guid OrganisationId,
    string Scope,
    string PathPrefix,
    string Host,
    string HostPrefix,
    string Target,
    string Access,
    TimeSpan? IdleAfter,
    string Availability,
    string? PausedReason = null,
    IReadOnlySet<string>? Hooks = null)
{
    /// <summary>True when <paramref name="name"/> is one of the app's declared webhooks.</summary>
    public bool DeclaresHook(string name) => Hooks is { } hooks && hooks.Contains(name);
}

/// <summary>
/// One immutable reading of the routing table, validated: every app the edge will route, indexed
/// by its path prefix and by host and prefix. An entry that fails validation is left out, never
/// guessed at.
/// </summary>
public sealed partial class RouteSnapshot
{
    public static readonly RouteSnapshot Empty = new("", [], []);

    private RouteSnapshot(string version, IReadOnlyList<EdgeApp> apps, IReadOnlyList<string> rejected)
    {
        Version = version;
        Apps = apps;
        Rejected = rejected;
        ById = apps.ToFrozenDictionary(a => a.AppId);
        ByPrefix = apps.ToFrozenDictionary(a => a.PathPrefix, StringComparer.OrdinalIgnoreCase);
        ByHostPrefix = apps.ToFrozenDictionary(a => a.Host + a.HostPrefix, StringComparer.OrdinalIgnoreCase);
        Hosts = apps.Select(a => a.Host).ToFrozenSet(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>A hash of the routes themselves: unchanged routes, unchanged version.</summary>
    public string Version { get; }

    public IReadOnlyList<EdgeApp> Apps { get; }

    /// <summary>Entries left out, with the reason — logged when a table is applied.</summary>
    public IReadOnlyList<string> Rejected { get; }

    public FrozenDictionary<Guid, EdgeApp> ById { get; }

    public FrozenDictionary<string, EdgeApp> ByPrefix { get; }

    /// <summary>Keyed by <c>host/division/project/app</c>.</summary>
    public FrozenDictionary<string, EdgeApp> ByHostPrefix { get; }

    /// <summary>Every organisation subdomain that serves at least one app.</summary>
    public FrozenSet<string> Hosts { get; }

    public static string VersionOf(RoutingTable table)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(table.Routes ?? []);
        return Convert.ToHexString(SHA256.HashData(bytes))[..16].ToLowerInvariant();
    }

    /// <param name="table">The control plane's table.</param>
    /// <param name="reservedSegments">First path segments that belong to the platform.</param>
    /// <param name="secondsPerIdleMinute">60 in production; tests compress time with less.</param>
    public static RouteSnapshot From(RoutingTable table, IReadOnlyCollection<string> reservedSegments, int secondsPerIdleMinute = 60)
    {
        var accepted = new List<EdgeApp>();
        var rejected = new List<string>();
        var ids = new HashSet<Guid>();
        var prefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hostPrefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var route in table.Routes ?? [])
        {
            if (Normalise(route, reservedSegments, secondsPerIdleMinute, out var app) is { } reason)
            {
                rejected.Add($"{route.AppId}: {reason}");
                continue;
            }

            if (!ids.Add(app.AppId) || !prefixes.Add(app.PathPrefix) || !hostPrefixes.Add(app.Host + app.HostPrefix))
            {
                rejected.Add($"{route.AppId}: another route already has this app or one of its addresses");
                continue;
            }

            accepted.Add(app);
        }

        return new RouteSnapshot(VersionOf(table), accepted, rejected);
    }

    private static string? Normalise(RouteView route, IReadOnlyCollection<string> reserved, int secondsPerIdleMinute, out EdgeApp app)
    {
        app = null!;
        if (route.AppId == Guid.Empty)
        {
            return "no app id";
        }

        var segments = (route.Scope ?? "").Split('/');
        if (segments.Length != 4 || segments.Any(s => !Slug().IsMatch(s)))
        {
            return $"the scope '{route.Scope}' is not org/division/project/app";
        }

        if (reserved.Contains(segments[0], StringComparer.OrdinalIgnoreCase))
        {
            return $"'{segments[0]}' is reserved for the platform";
        }

        // The subdomain form is /division/project/app/ on the organisation's host, or — when the
        // control plane gives an app the whole subdomain — its root.
        var pathPrefix = "/" + route.Scope;
        var hostPrefix = route.HostPathBase == "/" ? "" : "/" + string.Join('/', segments[1..]);
        if (route.PathBase != pathPrefix + "/" || route.HostPathBase != hostPrefix + "/")
        {
            return "its prefixes do not match its scope";
        }

        if (route.Host is null || !HostName().IsMatch(route.Host))
        {
            return $"the host '{route.Host}' is not a host name";
        }

        if (!Uri.TryCreate(route.Target, UriKind.Absolute, out var target) || target.Scheme != Uri.UriSchemeHttp || target.AbsolutePath != "/")
        {
            return $"the target '{route.Target}' is not an http origin";
        }

        // Absent means private: the edge never opens an app it was not told it may.
        var access = route.Access ?? AppAccess.Private;
        if (access is not (AppAccess.Private or AppAccess.Shared or AppAccess.Public))
        {
            return $"the access '{access}' is not known";
        }

        TimeSpan? idle = route.Sleep?.Mode switch
        {
            SleepSetting.AlwaysOn => null,
            SleepSetting.Auto when route.Sleep.IdleMinutes > 0 => TimeSpan.FromSeconds((double)route.Sleep.IdleMinutes * secondsPerIdleMinute),
            _ => TimeSpan.MinValue,
        };
        if (idle == TimeSpan.MinValue)
        {
            return "its sleep setting is not known";
        }

        // A webhook name that is not a slug opens nothing; the app itself is still routed.
        var hooks = (route.Hooks ?? []).Where(h => h is not null && Slug().IsMatch(h)).ToFrozenSet(StringComparer.Ordinal);

        var availability = route.Paused ? AppAvailability.Paused
            : route.Version is null ? AppAvailability.Unpublished
            : AppAvailability.Available;
        var pausedReason = route.Paused ? route.PausedReason ?? PausedReasons.OverdraftLimit : null;
        app = new EdgeApp(route.AppId, route.OrganisationId, route.Scope!, pathPrefix, route.Host.ToLowerInvariant(), hostPrefix, route.Target, access, idle, availability,
            pausedReason, hooks);
        return null;
    }

    [GeneratedRegex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")]
    private static partial Regex Slug();

    [GeneratedRegex("^(?i)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")]
    private static partial Regex HostName();
}
