using System.Text.RegularExpressions;

namespace Endgame.Harness.Workspaces;

/// <summary>A command to run in the workspace container: an argument vector, or one line for <c>bash -lc</c>.</summary>
public sealed record WorkspaceCommand(
    IReadOnlyList<string>? Argv,
    string? Shell,
    int TimeoutSeconds = 120,
    int MaxOutputBytes = 64 * 1024,
    string? WorkingDirectory = null,
    IReadOnlyDictionary<string, string>? Environment = null)
{
    public static WorkspaceCommand Args(params string[] argv) => new(argv, null);

    public static WorkspaceCommand Line(string shell, int timeoutSeconds = 120) => new(null, shell, timeoutSeconds);
}

/// <summary>The outcome of a command. Output past the cap keeps its head and tail.</summary>
public sealed record WorkspaceExec(int ExitCode, string Stdout, string Stderr, bool TimedOut, bool Truncated, long DurationMs)
{
    public string Combined => Stderr.Length == 0 ? Stdout : Stdout.Length == 0 ? Stderr : Stdout.TrimEnd('\n') + "\n" + Stderr;
}

/// <summary>The commit a workspace's changes became.</summary>
public sealed record WorkspaceCommit(string CommitId, bool Changed);

/// <summary>
/// Where an agent's tools execute (CLAUDE.md rule 6): a container the harness reaches only through
/// this interface. Production: Dock's workspace API. File contents cross as raw bytes (base64 on the
/// wire), never line by line, so exact matching survives (ARCH-006).
/// </summary>
public interface IWorkspace
{
    /// <summary>The directory every relative path is taken from.</summary>
    string Root { get; }

    /// <summary>The file's bytes, or null when it does not exist or is not a regular file.</summary>
    Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken);

    Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken);

    Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken);

    /// <summary>Commits everything in the workspace with the given author; the employee is the author.</summary>
    Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken);
}

/// <summary>Raised by a workspace when the container refuses or cannot do what was asked.</summary>
public sealed class WorkspaceException(string message, string code = "workspace_error") : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>A path the model gave, resolved against the workspace root, or why it cannot be used.</summary>
public sealed record WorkspacePath(string Absolute, string Relative)
{
    public static (WorkspacePath? Path, string? Error) Resolve(string? raw, string root, bool allowRoot = false)
    {
        ArgumentNullException.ThrowIfNull(root);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return allowRoot ? (new WorkspacePath(root, "."), null) : (null, "A path is required.");
        }

        var trimmed = raw.Trim();
        if (trimmed.Contains('\0', StringComparison.Ordinal))
        {
            return (null, "The path contains a NUL character.");
        }

        var combined = trimmed.StartsWith('/') ? trimmed : $"{root}/{trimmed}";
        var parts = new List<string>();
        foreach (var segment in combined.Replace('\\', '/').Split('/'))
        {
            if (segment is "" or ".")
            {
                continue;
            }

            if (segment == "..")
            {
                if (parts.Count > 0)
                {
                    parts.RemoveAt(parts.Count - 1);
                }

                continue;
            }

            parts.Add(segment);
        }

        var absolute = "/" + string.Join('/', parts);
        if (absolute != root && !absolute.StartsWith(root + "/", StringComparison.Ordinal))
        {
            // ARCH-006: weak models often write root-relative paths; the error names the fix.
            var hint = trimmed.StartsWith('/') ? $" If you meant a path inside the repository, drop the leading slash (\"{trimmed.TrimStart('/')}\") or write it under {root}/." : "";
            return (null, $"'{trimmed}' is outside the workspace ({absolute}). Only paths under {root} can be used.{hint}");
        }

        if (absolute == root && !allowRoot)
        {
            return (null, "A file path is required, not the workspace root.");
        }

        var relative = absolute == root ? "." : absolute[(root.Length + 1)..];
        return (new WorkspacePath(absolute, relative), null);
    }

    public bool IsInsideGit => Relative.Split('/').Any(s => string.Equals(s, ".git", StringComparison.OrdinalIgnoreCase));
}

/// <summary>Glob matching for permission rules and the protected-path floor: <c>**</c>, <c>*</c> and <c>?</c>.</summary>
public static class Glob
{
    private static readonly Dictionary<string, Regex> Cache = new(StringComparer.Ordinal);
    private static readonly Lock CacheGate = new();

    public static bool IsMatch(string pattern, string text)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        ArgumentNullException.ThrowIfNull(text);
        Regex regex;
        lock (CacheGate)
        {
            if (!Cache.TryGetValue(pattern, out regex!))
            {
                regex = new Regex("^" + ToRegex(pattern) + "$", RegexOptions.CultureInvariant | RegexOptions.Singleline, TimeSpan.FromMilliseconds(200));
                Cache[pattern] = regex;
            }
        }

        return regex.IsMatch(text);
    }

    private static string ToRegex(string pattern)
    {
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < pattern.Length; i++)
        {
            var c = pattern[i];
            if (c == '*' && i + 1 < pattern.Length && pattern[i + 1] == '*')
            {
                // "**/" matches zero or more directories; a bare "**" anything at all.
                if (i + 2 < pattern.Length && pattern[i + 2] == '/')
                {
                    sb.Append("(?:.*/)?");
                    i += 2;
                }
                else
                {
                    sb.Append(".*");
                    i++;
                }
            }
            else if (c == '*')
            {
                sb.Append("[^/]*");
            }
            else if (c == '?')
            {
                sb.Append("[^/]");
            }
            else
            {
                sb.Append(Regex.Escape(c.ToString()));
            }
        }

        return sb.ToString();
    }
}
