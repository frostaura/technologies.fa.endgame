using System.Collections.Frozen;
using System.Text.RegularExpressions;
using Endgame.Hosting.Contracts;

namespace Endgame.Edge.Routing;

/// <summary>
/// One immutable reading of the routing table, validated: every app the edge will route, indexed
/// by its path prefix and its hosts. An entry that fails validation is left out, never guessed at.
/// </summary>
public sealed partial class RouteSnapshot
{
    public static readonly RouteSnapshot Empty = new("", [], []);

    private RouteSnapshot(string version, IReadOnlyList<AppRoute> apps, IReadOnlyList<string> rejected)
    {
        Version = version;
        Apps = apps;
        Rejected = rejected;
        ById = apps.ToFrozenDictionary(a => a.AppId);
        ByPrefix = apps.ToFrozenDictionary(PrefixOf, StringComparer.OrdinalIgnoreCase);
        ByHost = apps.SelectMany(a => a.Hosts.Select(h => (Host: h.ToLowerInvariant(), App: a))).ToFrozenDictionary(x => x.Host, x => x.App, StringComparer.OrdinalIgnoreCase);
    }

    public string Version { get; }

    public IReadOnlyList<AppRoute> Apps { get; }

    /// <summary>Entries left out, with the reason — logged when a table is applied.</summary>
    public IReadOnlyList<string> Rejected { get; }

    public FrozenDictionary<Guid, AppRoute> ById { get; }

    public FrozenDictionary<string, AppRoute> ByPrefix { get; }

    public FrozenDictionary<string, AppRoute> ByHost { get; }

    /// <summary>The path-form prefix: <c>/org/division/project</c>, no trailing slash.</summary>
    public static string PrefixOf(AppRoute app) => $"/{app.Organisation}/{app.Division}/{app.Project}";

    public static RouteSnapshot From(RoutingTable table, IReadOnlyCollection<string> reservedSegments)
    {
        var accepted = new List<AppRoute>();
        var rejected = new List<string>();
        var prefixes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ids = new HashSet<Guid>();
        foreach (var app in table.Apps ?? [])
        {
            var reason = Validate(app, reservedSegments);
            if (reason is null && !ids.Add(app.AppId))
            {
                reason = "the app appears twice";
            }

            if (reason is null && !prefixes.Add(PrefixOf(app)))
            {
                reason = $"another app already has {PrefixOf(app)}";
            }

            var duplicateHost = app.Hosts?.FirstOrDefault(h => hosts.Contains(h));
            if (reason is null && duplicateHost is not null)
            {
                reason = $"another app already has {duplicateHost}";
            }

            if (reason is not null)
            {
                rejected.Add($"{app.AppId}: {reason}");
                continue;
            }

            foreach (var host in app.Hosts!)
            {
                hosts.Add(host);
            }

            accepted.Add(app with { Hosts = app.Hosts!.Select(h => h.ToLowerInvariant()).ToList() });
        }

        return new RouteSnapshot(table.Version ?? "", accepted, rejected);
    }

    private static string? Validate(AppRoute app, IReadOnlyCollection<string> reserved)
    {
        if (app.AppId == Guid.Empty)
        {
            return "no app id";
        }

        foreach (var (name, slug) in new[] { ("organisation", app.Organisation), ("division", app.Division), ("project", app.Project) })
        {
            if (slug is null || !Slug().IsMatch(slug))
            {
                return $"the {name} slug '{slug}' is not valid";
            }
        }

        if (reserved.Contains(app.Organisation, StringComparer.OrdinalIgnoreCase))
        {
            return $"'{app.Organisation}' is reserved for the platform";
        }

        if (!Uri.TryCreate(app.Target, UriKind.Absolute, out var target) || target.Scheme != Uri.UriSchemeHttp || target.AbsolutePath != "/")
        {
            return $"the target '{app.Target}' is not an http origin";
        }

        if (app.Hosts is null || app.Hosts.Any(h => h is null || !HostName().IsMatch(h)))
        {
            return "a host is not a valid host name";
        }

        if (app.Access is not (AppAccess.Private or AppAccess.Shared or AppAccess.Public))
        {
            return $"the access '{app.Access}' is not known";
        }

        if (app.Availability is not (AppAvailability.Available or AppAvailability.Paused or AppAvailability.Unpublished))
        {
            return $"the availability '{app.Availability}' is not known";
        }

        if (app.Sleep is null || (!app.Sleep.AlwaysOn && app.Sleep.IdleSeconds <= 0))
        {
            return "no sleep setting";
        }

        return null;
    }

    [GeneratedRegex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")]
    private static partial Regex Slug();

    [GeneratedRegex("^(?i)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$")]
    private static partial Regex HostName();
}
