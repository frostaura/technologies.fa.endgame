using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;

namespace Endgame.Runner.Execution;

/// <summary>
/// The names of the places a run can speak of, so what the owner reads says "Community", never "frostaura/community" (D46):
/// the levels its cascade passes through (organisation, division, project, app) and, once <see cref="With"/> has read them,
/// every division, project and app beneath its scope (C-1: an app beneath an organisation-level conversation read "Web").
/// </summary>
public sealed class PlaceNames
{
    /// <summary>The levels on the path down to the scope, from its cascade.</summary>
    private readonly IReadOnlyList<(string Level, string Path, string Name)> levels;

    /// <summary>Those, and every place beneath the scope once <see cref="With"/> has read them.</summary>
    private readonly IReadOnlyList<(string Level, string Path, string Name)> places;

    public PlaceNames(IReadOnlyList<(string Level, string Path, string Name)> levels)
        : this(levels, levels)
    {
    }

    private PlaceNames(IReadOnlyList<(string Level, string Path, string Name)> levels, IReadOnlyList<(string Level, string Path, string Name)> places)
    {
        ArgumentNullException.ThrowIfNull(levels);
        ArgumentNullException.ThrowIfNull(places);
        this.levels = levels;
        this.places = places;
    }

    public static PlaceNames Of(RunContext run)
    {
        ArgumentNullException.ThrowIfNull(run);
        return FromContext(run.Context);
    }

    public static PlaceNames FromContext(JsonObject? context) =>
        new((context?["levels"] as JsonArray ?? []).OfType<JsonObject>()
            .Select(l => (Json.Str(l, "level") ?? "", Json.Str(l, "path") ?? "", Json.Str(l, "name") is { Length: > 0 } n ? n : Json.Str(l, "slug") ?? ""))
            .Where(l => l.Item2.Length > 0)
            .ToList());

    /// <summary>
    /// These names and every place in <paramref name="contents"/> (<c>GET /internal/contents</c>: divisions, their projects,
    /// their apps, each with its name and path). A level the cascade already names keeps its name; null contents add nothing.
    /// </summary>
    public PlaceNames With(JsonObject? contents)
    {
        if (contents is null)
        {
            return this;
        }

        var all = places.ToList();
        void Add(string level, JsonObject? place)
        {
            if (Json.Str(place, "path") is { Length: > 0 } path && Json.Str(place, "name") is { Length: > 0 } name && all.All(p => p.Path != path))
            {
                all.Add((level, path, name));
            }
        }

        foreach (var division in (contents["divisions"] as JsonArray ?? []).OfType<JsonObject>())
        {
            Add("division", division);
            foreach (var project in (division["projects"] as JsonArray ?? []).OfType<JsonObject>())
            {
                Add("project", project);
                foreach (var app in (project["apps"] as JsonArray ?? []).OfType<JsonObject>())
                {
                    Add("app", app);
                }
            }
        }

        return new PlaceNames(levels, all);
    }

    /// <summary>A place's name; a path nothing names reads as its last part, in words.</summary>
    public string Name(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        var known = places.FirstOrDefault(l => l.Path == path.TrimEnd('/'));
        if (known.Name is { Length: > 0 })
        {
            return known.Name;
        }

        var slug = path.TrimEnd('/').Split('/')[^1];
        var words = slug.Split('-', StringSplitOptions.RemoveEmptyEntries);
        return words.Length == 0 ? path : string.Join(' ', words.Select((w, i) => i == 0 ? char.ToUpperInvariant(w[0]) + w[1..] : w));
    }

    /// <summary>The level of a place, when something names it.</summary>
    public string? Level(string path) => places.FirstOrDefault(l => l.Path == path).Level is { Length: > 0 } level ? level : null;

    /// <summary>How the apps at a place are spoken of: "the Club Reading List app" at an app, "apps in Community" above one.</summary>
    public string Apps(string path) => Level(path) == "app" || path.Split('/').Length >= 4 ? $"the {Name(path)} app" : $"apps in {Name(path)}";

    /// <summary>Each level on the path down to the scope as "name (its level)", for the conversation's prompt.</summary>
    public string Listing()
    {
        // Only the path down to the scope: what is beneath it is the prompt's to read with read_organisation, not to list.
        return levels.Count == 0 ? "- (none known)" : string.Join("\n", levels.Select(l => $"- {l.Name}, the {(l.Level.Length > 0 ? l.Level : "place")} at {l.Path}"));
    }
}
