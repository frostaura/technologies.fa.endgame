namespace Endgame.Dock.Policy;

/// <summary>
/// The protected-path floor for every file and working-directory argument (CLAUDE.md rule 7):
/// nothing outside the workspace root, nothing inside <c>.git</c>. Lexical here; Dock repeats the
/// check on the path the container resolves, so a symbolic link cannot step over the floor.
/// </summary>
public static class WorkspacePaths
{
    public const string Root = "/workspace";

    /// <summary>
    /// The absolute container path for <paramref name="requested"/>, or the reason it is refused.
    /// Relative paths are taken from the root; an absolute path must already be under it.
    /// </summary>
    public static PathDecision Resolve(string? requested, string root = Root)
    {
        if (requested is null)
        {
            return PathDecision.Refuse("A path is required.");
        }

        if (requested.Contains('\0', StringComparison.Ordinal) || requested.Contains('\\', StringComparison.Ordinal))
        {
            return PathDecision.Refuse("The path contains a character that is not allowed.");
        }

        var trimmed = requested.Trim();
        var relative = trimmed.StartsWith('/')
            ? StripRoot(trimmed, root)
            : trimmed;
        if (relative is null)
        {
            return PathDecision.Refuse($"Only paths inside {root} may be used.");
        }

        var segments = new List<string>();
        foreach (var segment in relative.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment == ".")
            {
                continue;
            }

            if (segment == "..")
            {
                if (segments.Count == 0)
                {
                    return PathDecision.Refuse($"Only paths inside {root} may be used.");
                }

                segments.RemoveAt(segments.Count - 1);
                continue;
            }

            segments.Add(segment);
        }

        if (segments.Any(IsGitSegment))
        {
            return PathDecision.Refuse("Paths inside .git are protected.");
        }

        var absolute = segments.Count == 0 ? root : $"{root}/{string.Join('/', segments)}";
        return PathDecision.Allow(absolute, string.Join('/', segments));
    }

    /// <summary>Re-checks a path the container resolved (symbolic links followed).</summary>
    public static PathDecision CheckResolved(string resolved, string root = Root)
    {
        if (resolved != root && !resolved.StartsWith(root + "/", StringComparison.Ordinal))
        {
            return PathDecision.Refuse($"The path leads outside {root}.");
        }

        return Resolve(resolved, root);
    }

    private static string? StripRoot(string absolute, string root)
    {
        if (absolute == root || absolute == root + "/")
        {
            return "";
        }

        return absolute.StartsWith(root + "/", StringComparison.Ordinal) ? absolute[(root.Length + 1)..] : null;
    }

    // `.git` in any case: a case-insensitive file system on a developer's machine would treat
    // `.GIT` as the same directory once the code is checked out there.
    private static bool IsGitSegment(string segment) => string.Equals(segment, ".git", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Whether a path may be used, and where it points.</summary>
public sealed record PathDecision(bool Allowed, string AbsolutePath, string RelativePath, string? Reason)
{
    public static PathDecision Allow(string absolute, string relative) => new(true, absolute, relative, null);

    public static PathDecision Refuse(string reason) => new(false, "", "", reason);
}
