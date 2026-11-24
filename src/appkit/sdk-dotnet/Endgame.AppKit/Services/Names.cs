using System.Text.RegularExpressions;

namespace Endgame.AppKit;

/// <summary>The naming rules the platform relies on, checked where the name is first written.</summary>
internal static partial class Names
{
    [GeneratedRegex("^[a-z][a-z0-9-]{1,39}$")]
    internal static partial Regex Slug();

    [GeneratedRegex("^[A-Z][A-Z0-9_]{1,127}$")]
    private static partial Regex SecretName();

    [GeneratedRegex("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$")]
    private static partial Regex EventName();

    [GeneratedRegex("^[a-z][a-zA-Z0-9]{2,63}$")]
    internal static partial Regex OperationId();

    internal static void RequireSlug(string kind, string name)
    {
        if (!Slug().IsMatch(name))
        {
            throw new ArgumentException($"{kind} name '{name}' must be a lowercase slug: letters, digits and hyphens, 2 to 40 characters, starting with a letter (e.g. 'nightly-digest').");
        }
    }

    internal static void RequireSecretName(string name)
    {
        if (!SecretName().IsMatch(name))
        {
            throw new ArgumentException($"Secret name '{name}' must be UPPER_SNAKE_CASE (e.g. 'STRIPE_API_KEY').", nameof(name));
        }
    }

    internal static void RequireEventName(string name)
    {
        if (name.Length > 100 || !EventName().IsMatch(name))
        {
            throw new ArgumentException($"Event name '{name}' must be lowercase dot-separated words (e.g. 'note.created').", nameof(name));
        }
    }
}
