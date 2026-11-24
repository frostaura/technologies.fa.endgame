using System.Text;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Repositories;

/// <summary>Pages a file by line and a directory by entry, the same way for repositories and workspaces.</summary>
public static class FilePaging
{
    public const int DefaultLimit = 400;
    public const int MaxLimit = 5000;

    public static FilePage File(string path, byte[] content, int offset, int limit)
    {
        limit = Math.Clamp(limit <= 0 ? DefaultLimit : limit, 1, MaxLimit);
        offset = Math.Max(0, offset);
        if (IsBinary(content))
        {
            return new FilePage(path, "file", Convert.ToBase64String(content), true, null, 0, 1, false);
        }

        var text = Encoding.UTF8.GetString(content);
        var lines = text.Split('\n');
        if (lines.Length > 1 && lines[^1].Length == 0)
        {
            lines = lines[..^1]; // a trailing newline ends the last line; it does not start another
        }

        var page = lines.Skip(offset).Take(limit).ToList();
        return new FilePage(path, "file", string.Join('\n', page), false, null, offset, lines.Length, offset + page.Count < lines.Length);
    }

    public static FilePage Directory(string path, IReadOnlyList<DirectoryEntry> entries, int offset, int limit)
    {
        limit = Math.Clamp(limit <= 0 ? DefaultLimit : limit, 1, MaxLimit);
        offset = Math.Max(0, offset);
        var sorted = entries.OrderBy(e => e.Kind == "directory" ? 0 : 1).ThenBy(e => e.Name, StringComparer.Ordinal).ToList();
        var page = sorted.Skip(offset).Take(limit).ToList();
        return new FilePage(path, "directory", null, false, page, offset, sorted.Count, offset + page.Count < sorted.Count);
    }

    // Git's own heuristic: a NUL byte in the first 8000 bytes means binary.
    private static bool IsBinary(byte[] content) => content.AsSpan(0, Math.Min(content.Length, 8000)).IndexOf((byte)0) >= 0;
}
