using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;

namespace Endgame.Runner.Execution;

/// <summary>
/// The names of the places a run's scope passes through (organisation, division, project, app), from its cascade, so what
/// the owner reads says "Community", never "frostaura/community" (D46).
/// </summary>
public sealed class PlaceNames(IReadOnlyList<(string Level, string Path, string Name)> levels)
{
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

    /// <summary>A place's name; a path beneath the run's scope that the cascade does not name reads as its last part, in words.</summary>
    public string Name(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        var known = levels.FirstOrDefault(l => l.Path == path);
        if (known.Name is { Length: > 0 })
        {
            return known.Name;
        }

        var slug = path.TrimEnd('/').Split('/')[^1];
        var words = slug.Split('-', StringSplitOptions.RemoveEmptyEntries);
        return words.Length == 0 ? path : string.Join(' ', words.Select((w, i) => i == 0 ? char.ToUpperInvariant(w[0]) + w[1..] : w));
    }

    /// <summary>The level of a place, when the cascade names it.</summary>
    public string? Level(string path) => levels.FirstOrDefault(l => l.Path == path).Level is { Length: > 0 } level ? level : null;

    /// <summary>How the apps at a place are spoken of: "the Club Reading List app" at an app, "apps in Community" above one.</summary>
    public string Apps(string path) => Level(path) == "app" || path.Split('/').Length >= 4 ? $"the {Name(path)} app" : $"apps in {Name(path)}";

    /// <summary>Each level as "name (its level)", for the conversation's prompt.</summary>
    public string Listing() =>
        levels.Count == 0 ? "- (none known)" : string.Join("\n", levels.Select(l => $"- {l.Name}, the {(l.Level.Length > 0 ? l.Level : "place")} at {l.Path}"));
}
