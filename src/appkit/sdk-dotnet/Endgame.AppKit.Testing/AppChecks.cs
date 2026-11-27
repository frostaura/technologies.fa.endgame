using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.AppKit.Testing;

/// <summary>
/// Checks an app's own tests run against the running app, so it cannot drift from the security review's checklist or from
/// its own <c>docs/app.md</c>. The template calls both from <c>api.tests/AppRulesTests.cs</c>:
/// <code>
/// Assert.Empty(AppChecks.OwnRecordFaults(app.Services));
/// Assert.Empty(AppChecks.AppDocumentFaults(app.Services, AppChecks.ReadAppDocument()));
/// </code>
/// </summary>
public static partial class AppChecks
{
    /// <summary>The kit's own "who is signed in": it says who is signed in, or nobody, so it takes an optional user by design.</summary>
    public const string CurrentUserOperation = "getCurrentUser";

    /// <summary>The app's document, relative to the repository root.</summary>
    public const string AppDocumentPath = "docs/app.md";

    /// <summary>
    /// Every endpoint of the app that takes the signed-in person (<see cref="EndgameUser"/>, optional or not) and does not
    /// require sign-in, as one fault each. A handler that takes the person reads or changes something that is theirs, and the
    /// security review's checklist requires sign-in for that ("A person's own record" in AGENTS.md): the person's own state is
    /// read signed in, and what anyone may see — a count, a total — is a field of the public resource instead. The kit's
    /// <see cref="CurrentUserOperation"/> is the one exception.
    /// </summary>
    public static IReadOnlyList<string> OwnRecordFaults(IServiceProvider services)
    {
        ArgumentNullException.ThrowIfNull(services);
        return Endpoints(services)
            .Where(e => e.TakesUser && !e.RequiresUser && e.Name != CurrentUserOperation)
            .Select(e => $"{e.Label} ({e.Name ?? "no operation id"}) takes the signed-in person (EndgameUser{(e.OptionalUser ? "?" : "")}) but does not require sign-in. "
                + "Anything that reads or changes a person's own record requires it: add .RequireUser() and take EndgameUser. "
                + "What anyone may see — a count, a total — belongs on the public resource (for example the note's follower count on getNote), "
                + "never beside someone's own record (AGENTS.md, \"A person's own record\").")
            .ToList();
    }

    /// <summary>
    /// Whether <c>docs/app.md</c> says, for every endpoint, whether calling it needs signing in — exactly as the code does. The
    /// document's feature table has a "Signed in?" column; each row names its endpoints by operation id in backticks
    /// (<c>(`listNotes`)</c>) and says Yes or No. A row whose endpoints differ is split. Every endpoint of the app is in one
    /// row; an operation id the app does not have is a stale row. The kit's <see cref="CurrentUserOperation"/> may be listed,
    /// and is then held to it like any other.
    /// </summary>
    public static IReadOnlyList<string> AppDocumentFaults(IServiceProvider services, string markdown)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(markdown);
        var endpoints = Endpoints(services).Where(e => e.Name is not null).ToList();
        var byName = endpoints.GroupBy(e => e.Name!, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var rows = Rows(markdown);
        if (rows is null)
        {
            return [$"{AppDocumentPath} has no table with a \"Signed in?\" column. List every endpoint there, one feature per row, naming its operation id in backticks and saying Yes or No (see the template's {AppDocumentPath})."];
        }

        var faults = new List<string>();
        var listed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (feature, signedIn, names) in rows)
        {
            var says = signedIn.StartsWith("yes", StringComparison.OrdinalIgnoreCase) ? true : signedIn.StartsWith("no", StringComparison.OrdinalIgnoreCase) ? (bool?)false : null;
            if (says is null)
            {
                faults.Add($"{AppDocumentPath}, row \"{feature}\": \"Signed in?\" says \"{signedIn}\"; write Yes or No. Where the row's endpoints differ, split the row so each says one.");
            }

            var known = names.Where(byName.ContainsKey).ToList();
            foreach (var name in names.Where(n => !byName.ContainsKey(n)))
            {
                faults.Add($"{AppDocumentPath}, row \"{feature}\": names `{name}`, which no endpoint of the app has. Remove it, or name the endpoint by its operation id (WithName).");
            }

            var requires = known.Where(n => byName[n].All(e => e.RequiresUser)).ToList();
            var open = known.Where(n => !requires.Contains(n)).ToList();
            if (says is null && requires.Count > 0 && open.Count > 0)
            {
                faults.Add($"{AppDocumentPath}, row \"{feature}\": {Names(requires)} require sign-in and {Names(open)} do not, so split the row: one that says Yes, one that says No.");
            }

            foreach (var name in known)
            {
                listed.Add(name);
                var required = requires.Contains(name);
                if (says == false && required)
                {
                    faults.Add($"{AppDocumentPath}, row \"{feature}\": says `{name}` needs no sign-in, but the endpoint has .RequireUser(): write Yes{(open.Count > 0 ? ", and split the row from the endpoints that need none" : "")}.");
                }
                else if (says == true && !required)
                {
                    faults.Add($"{AppDocumentPath}, row \"{feature}\": says `{name}` needs signing in, but the endpoint has no .RequireUser(): write No{(requires.Count > 0 ? ", and split the row from the endpoints that do" : "")}, or add .RequireUser() if it must.");
                }
            }
        }

        foreach (var endpoint in endpoints.Where(e => e.Name != CurrentUserOperation && !listed.Contains(e.Name!)).DistinctBy(e => e.Name))
        {
            faults.Add($"`{endpoint.Name}` ({endpoint.Label}) is not in {AppDocumentPath}'s table: add it to its feature's row, with \"Signed in?\" {(endpoint.RequiresUser ? "Yes" : "No")}.");
        }

        return faults;
    }

    /// <summary>The app's <c>docs/app.md</c>, found by walking up from the test's own directory to the repository root.</summary>
    public static string ReadAppDocument()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, AppDocumentPath);
            if (File.Exists(path))
            {
                return File.ReadAllText(path);
            }
        }

        throw new FileNotFoundException($"{AppDocumentPath} was not found above {AppContext.BaseDirectory}. Every app keeps one: what it is, who uses it, and each feature with its endpoints.");
    }

    private static string Names(IEnumerable<string> names) => string.Join(", ", names.Select(n => $"`{n}`"));

    private sealed record AppEndpoint(string Label, string? Name, bool TakesUser, bool OptionalUser, bool RequiresUser);

    /// <summary>The app's own endpoints: those mapped on the group <c>UseEndgameApp()</c> returns, as the platform describes them.</summary>
    private static List<AppEndpoint> Endpoints(IServiceProvider services)
    {
        var all = services.GetRequiredService<EndgameEndpoints>().All;
        var found = new List<AppEndpoint>();
        foreach (var endpoint in all.OfType<RouteEndpoint>())
        {
            var metadata = endpoint.Metadata;
            if (metadata.GetMetadata<MethodInfo>() is not { } handler || metadata.GetMetadata<EndgameApiMetadata>() is null
                || metadata.GetMetadata<IExcludeFromDescriptionMetadata>() is { ExcludeFromDescription: true })
            {
                continue;
            }

            var methods = metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];
            var label = $"{(methods.Count == 0 ? "ANY" : string.Join(",", methods))} {endpoint.RoutePattern.RawText?.TrimStart('/') ?? ""}";
            var users = handler.GetParameters().Where(p => p.ParameterType == typeof(EndgameUser)).ToList();
            found.Add(new AppEndpoint(label, metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName, users.Count > 0, users.Any(EndgameUser.IsNullable),
                metadata.GetMetadata<RequireUserMetadata>() is not null));
        }

        return found;
    }

    /// <summary>The rows of the first table with a "Signed in?" column: each row's first cell, that column, and the operation ids it names.</summary>
    private static List<(string Feature, string SignedIn, List<string> Names)>? Rows(string markdown)
    {
        var lines = markdown.ReplaceLineEndings("\n").Split('\n').Select(l => l.Trim()).ToList();
        for (var i = 0; i + 1 < lines.Count; i++)
        {
            if (!lines[i].StartsWith('|'))
            {
                continue;
            }

            var header = Cells(lines[i]);
            var column = header.FindIndex(c => c.Equals("Signed in?", StringComparison.OrdinalIgnoreCase));
            if (column < 0 || !Separator().IsMatch(lines[i + 1]))
            {
                continue;
            }

            var rows = new List<(string, string, List<string>)>();
            for (var j = i + 2; j < lines.Count && lines[j].StartsWith('|'); j++)
            {
                var cells = Cells(lines[j]);
                var names = OperationId().Matches(lines[j]).Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();
                rows.Add((cells.FirstOrDefault() ?? "", column < cells.Count ? cells[column] : "", names));
            }

            return rows;
        }

        return null;
    }

    private static List<string> Cells(string line) =>
        line.Trim().Trim('|').Split('|').Select(c => c.Trim()).ToList();

    [GeneratedRegex(@"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$")]
    private static partial Regex Separator();

    /// <summary>An operation id in backticks: lowerCamelCase with at least one capital (<c>`listNotes`</c>), never a route.</summary>
    [GeneratedRegex(@"`([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)`")]
    private static partial Regex OperationId();
}
