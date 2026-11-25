using System.Text.RegularExpressions;

namespace Endgame.Harness.Events;

/// <summary>
/// The normal-mode rule (CLAUDE.md rule 12, ARCH-004 <i>Run log</i>): what the owner reads names no file, path,
/// endpoint, code, key or piece of infrastructure. Technical detail travels in separate fields that only
/// technical mode shows. This is the one check of that rule: plans refuse item text that breaks it, tools refuse
/// owner-facing titles that break it, and the factory's tests run every owner-facing field through it.
/// </summary>
public static partial class OwnerText
{
    private static readonly string[] Infrastructure =
    [
        "container", "docker", "kubernetes", "repository", "repo", "endpoint", "migration", "schema", "json", "yaml",
        "dotnet", ".net", "npm", "vite", "react", "tailwind", "ef core", "postgres", "postgresql", "sql", "http",
        "api", "frontend", "front end", "front-end", "backend", "back end", "back-end", "server", "commit", "branch",
        "git", "make test", "make lint", "make build", "workspace", "control plane",
        "unit test", "xunit", "vitest", "stack trace", "exception", "localhost",
    ];

    /// <summary>Every technical thing in <paramref name="text"/> a person reading normal mode should not see; empty when it is plain.</summary>
    public static IReadOnlyList<string> Technical(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var found = new List<string>();
        foreach (Match m in FileName().Matches(text))
        {
            found.Add(m.Value);
        }

        foreach (Match m in PathLike().Matches(text))
        {
            if (m.Value.ToLowerInvariant() is not ("and/or" or "either/or" or "his/her" or "he/she" or "w/o" or "yes/no" or "on/off"))
            {
                found.Add(m.Value);
            }
        }

        foreach (Match m in HttpCall().Matches(text))
        {
            found.Add(m.Value.Trim());
        }

        foreach (Match m in Code().Matches(text))
        {
            found.Add(m.Value);
        }

        foreach (Match m in RawKey().Matches(text))
        {
            found.Add(m.Value);
        }

        var lower = text.ToLowerInvariant();
        foreach (var word in Infrastructure)
        {
            if (Word(lower, word))
            {
                found.Add(word);
            }
        }

        return found.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public static bool IsPlain(string? text) => Technical(text).Count == 0;

    private static bool Word(string lower, string word)
    {
        for (var at = lower.IndexOf(word, StringComparison.Ordinal); at >= 0; at = lower.IndexOf(word, at + 1, StringComparison.Ordinal))
        {
            var before = at == 0 || !char.IsLetterOrDigit(lower[at - 1]);
            var end = at + word.Length;
            // "APIs" and "containers" count; "apiary" and "repository's" do not need special cases beyond a plural s.
            var after = end >= lower.Length || !char.IsLetterOrDigit(lower[end]) || (lower[end] == 's' && (end + 1 >= lower.Length || !char.IsLetterOrDigit(lower[end + 1])));
            if (before && after)
            {
                return true;
            }
        }

        return false;
    }

    [GeneratedRegex(@"\b[\w-]+\.(cs|csproj|slnx?|tsx?|jsx?|mjs|json|md|sql|ya?ml|html|css|sh|dll|env|toml)\b", RegexOptions.IgnoreCase)]
    private static partial Regex FileName();

    [GeneratedRegex(@"(?<![\w/])[a-z_][\w.-]*/[\w.{}-]*[a-z{][\w.{}/-]*", RegexOptions.None)]
    private static partial Regex PathLike();

    [GeneratedRegex(@"\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/?[\w{]", RegexOptions.None)]
    private static partial Regex HttpCall();

    [GeneratedRegex(@"`|=>|::|\{|\}|\[\]|\(\)|&&|\|\||</?[a-z]+>", RegexOptions.None)]
    private static partial Regex Code();

    // "stage:research:frostaura", "item:books-api:round:0": keys, not words.
    [GeneratedRegex(@"\b[a-z0-9-]+:[a-z0-9-]+(?::[a-z0-9/-]+)+\b", RegexOptions.None)]
    private static partial Regex RawKey();
}
