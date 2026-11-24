using System.Text.RegularExpressions;

namespace Endgame.Domain.Platform;

/// <summary>
/// Who may open an app (spec, <i>Apps are private by default</i>): organisation members with rights
/// over it; those plus the people it was shared with; or anyone. Making an app public is a human act
/// (CLAUDE.md rule 10) — no agent and no service may set it.
/// </summary>
public static class AppAccess
{
    public const string Private = "private";
    public const string Shared = "shared";
    public const string Public = "public";

    public static readonly IReadOnlyList<string> All = [Private, Shared, Public];

    public static string Require(string? value) =>
        value is not null && All.Contains(value)
            ? value
            : throw new DomainException($"'{value}' is not an access setting: use {string.Join(", ", All)}.");
}

/// <summary>Who is changing a value. Only people may make an app public.</summary>
public enum Actor
{
    /// <summary>A signed-in organisation member, through the console.</summary>
    Member,

    /// <summary>A FrostAura operator acting in God mode — a person too.</summary>
    Operator,

    /// <summary>An agent of the workforce, through the Runner.</summary>
    Agent,

    /// <summary>A platform service presenting the service token.</summary>
    Service,
}

public static class Actors
{
    public static bool IsHuman(this Actor actor) => actor is Actor.Member or Actor.Operator;
}

/// <summary>The naming rules of what an app declares to the platform (PLATFORM-API §3.5–3.7).</summary>
public static partial class PlatformNames
{
    public const int MaxEventName = 100;

    [GeneratedRegex("^[a-z][a-z0-9-]{1,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex Slug();

    [GeneratedRegex("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$", RegexOptions.CultureInvariant)]
    private static partial Regex EventName();

    /// <summary>A schedule's or webhook's name: a lowercase slug, 2 to 40 characters, starting with a letter.</summary>
    public static string RequireSlug(string kind, string? name) =>
        name is not null && Slug().IsMatch(name)
            ? name
            : throw new DomainException($"{kind} name '{name}' must be a lowercase slug: letters, digits and hyphens, 2 to 40 characters, starting with a letter.");

    /// <summary>A custom event's name: lowercase dot-separated words, at most 100 characters.</summary>
    public static string RequireEventName(string? name) =>
        name is { Length: > 0 and <= MaxEventName } && EventName().IsMatch(name)
            ? name
            : throw new DomainException($"Event name '{name}' must be lowercase dot-separated words of at most {MaxEventName} characters (for example note.created).");
}
