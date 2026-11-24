using System.Text;
using System.Text.RegularExpressions;

namespace Endgame.Harness.Tools;

/// <summary>The outcome of an exact-replace edit: the new text, or a message that says what to do.</summary>
public sealed record EditResult(bool Ok, string? Content, int Replaced, int FirstLine, string Message);

/// <summary>
/// The <c>edit_file</c> contract (ARCH-006), as pure text logic so every failure path is testable:
/// exact match, exactly once unless <c>replace_all</c>, all or nothing; line endings normalised to the
/// file's own before matching; and a failure message for every common fault that tells the model how
/// to recover — those messages are what made cheap models succeed.
/// </summary>
public static partial class EditEngine
{
    public static EditResult Apply(string content, string? oldString, string? newString, bool replaceAll, string displayPath)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (oldString is null || newString is null)
        {
            return Fail("edit_file needs both old_string and new_string.");
        }

        if (oldString.Length == 0)
        {
            return Fail("old_string is empty. To create a file or replace it whole, use write_file; to insert text, include an existing neighbouring line in old_string and repeat it in new_string.");
        }

        if (oldString == newString)
        {
            return Fail("old_string and new_string are identical, so there is nothing to change. Send the text you want in new_string.");
        }

        // The file's own line ending wins: a model that sends \r\n to an \n file (or the reverse) still matches.
        var crlf = UsesCrlf(content);
        var oldText = ToEnding(oldString, crlf);
        var newText = ToEnding(newString, crlf);

        var count = Count(content, oldText);
        if (count == 0)
        {
            if (LooksLineNumbered(oldString))
            {
                return Fail($"old_string was not found in {displayPath}. It looks like it includes the line-number prefixes read_file shows (for example \"   12\\t\"). Those are not part of the file: remove them and send the text alone.");
            }

            return Fail($"old_string was not found in {displayPath}. Nothing was changed. Re-read the file and copy the text exactly, including indentation.{Nearest(content, oldText)}");
        }

        if (count > 1 && !replaceAll)
        {
            var lines = LinesOf(content, oldText).Take(10).ToList();
            return Fail($"old_string occurs {count} times in {displayPath} (starting on lines {string.Join(", ", lines)}{(count > lines.Count ? ", ..." : "")}). Nothing was changed. Add surrounding lines to make it unique, or set replace_all to true to change every one.");
        }

        var updated = replaceAll ? content.Replace(oldText, newText, StringComparison.Ordinal) : ReplaceFirst(content, oldText, newText);
        var at = newText.Length == 0 ? LinesOf(content, oldText).First() : LinesOf(updated, newText).FirstOrDefault();
        return new EditResult(true, updated, replaceAll ? count : 1, at, $"Edited {displayPath}: replaced {(replaceAll ? count : 1)} occurrence{((replaceAll ? count : 1) == 1 ? "" : "s")}{(at > 0 ? $" at line {at}" : "")}.");
    }

    public static bool UsesCrlf(string content)
    {
        ArgumentNullException.ThrowIfNull(content);
        var crlf = 0;
        var lf = 0;
        for (var i = 0; i < content.Length; i++)
        {
            if (content[i] == '\n')
            {
                if (i > 0 && content[i - 1] == '\r')
                {
                    crlf++;
                }
                else
                {
                    lf++;
                }
            }
        }

        return crlf > lf;
    }

    public static string ToEnding(string text, bool crlf)
    {
        ArgumentNullException.ThrowIfNull(text);
        var lf = text.Replace("\r\n", "\n", StringComparison.Ordinal);
        return crlf ? lf.Replace("\n", "\r\n", StringComparison.Ordinal) : lf;
    }

    public static int Count(string text, string part)
    {
        int n = 0, i = 0;
        while ((i = text.IndexOf(part, i, StringComparison.Ordinal)) >= 0)
        {
            n++;
            i += part.Length;
        }

        return n;
    }

    public static IEnumerable<int> LinesOf(string text, string part)
    {
        var i = 0;
        while ((i = text.IndexOf(part, i, StringComparison.Ordinal)) >= 0)
        {
            yield return text.AsSpan(0, i).Count('\n') + 1;
            i += Math.Max(1, part.Length);
        }
    }

    private static string ReplaceFirst(string text, string oldText, string newText)
    {
        var i = text.IndexOf(oldText, StringComparison.Ordinal);
        return string.Concat(text.AsSpan(0, i), newText, text.AsSpan(i + oldText.Length));
    }

    private static bool LooksLineNumbered(string text)
    {
        var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Where(l => l.Length > 0).ToList();
        return lines.Count > 0 && lines.All(l => LineNumberPrefix().IsMatch(l));
    }

    /// <summary>Points at the closest region and says whether it differs only in whitespace, quoting the file's real text.</summary>
    private static string Nearest(string content, string oldText)
    {
        var squashedOld = Squash(oldText);
        var lines = content.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        var oldLines = oldText.Replace("\r\n", "\n", StringComparison.Ordinal).TrimEnd('\n').Split('\n').Length;
        if (squashedOld.Length > 0)
        {
            for (var span = oldLines; span <= oldLines + 2; span++)
            {
                for (var i = 0; i + span <= lines.Length; i++)
                {
                    var window = string.Join('\n', lines.Skip(i).Take(span));
                    if (Squash(window) == squashedOld)
                    {
                        return $" The text matches lines {i + 1}-{i + span} if whitespace is ignored, so your indentation or line breaks differ. The exact text there is:\n{Quote(window)}";
                    }
                }
            }
        }

        var first = oldText.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 3);
        if (first is null)
        {
            return "";
        }

        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i].Contains(first, StringComparison.Ordinal))
            {
                var excerpt = string.Join('\n', lines.Skip(i).Take(Math.Min(oldLines + 1, 12)));
                return $" Its first line does appear at line {i + 1}, so a later line of old_string differs from the file. The file there reads:\n{Quote(excerpt)}";
            }
        }

        return " Even its first line does not appear in the file: the file may have changed since you read it, or you may be thinking of another file.";
    }

    private static string Quote(string text) => text.Length <= 1500 ? text : text[..1500] + "\n...";

    private static string Squash(string text) => Whitespace().Replace(text, " ").Trim();

    private static EditResult Fail(string message) => new(false, null, 0, 0, message);

    [GeneratedRegex(@"^\s*\d+\t")]
    private static partial Regex LineNumberPrefix();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}

/// <summary>Text codec for workspace files: UTF-8, keeping a byte-order mark if the file had one.</summary>
public static class FileText
{
    private static readonly byte[] Bom = [0xEF, 0xBB, 0xBF];

    public static (string Text, bool Bom) Decode(byte[] bytes)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        var bom = bytes.AsSpan().StartsWith(Bom);
        return (Encoding.UTF8.GetString(bom ? bytes[3..] : bytes), bom);
    }

    public static byte[] Encode(string text, bool bom)
    {
        var body = Encoding.UTF8.GetBytes(text);
        return bom ? [.. Bom, .. body] : body;
    }

    /// <summary>Git's own test: a NUL byte in the first 8000 bytes means binary.</summary>
    public static bool IsBinary(byte[] bytes) => bytes.AsSpan(0, Math.Min(bytes.Length, 8000)).IndexOf((byte)0) >= 0;
}
