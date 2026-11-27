namespace Endgame.Domain;

/// <summary>
/// Short text for people: one line, cut at a word boundary with "…", never mid-word or mid-number. What a title, an
/// approval's question or a work card reads, so nobody sees <c>"… claim a seat in a ..."</c>.
/// </summary>
public static class Words
{
    /// <summary>The first line of <paramref name="text"/>, whitespace collapsed, at most <paramref name="max"/> characters, "…" where it was cut.</summary>
    public static string Clamp(string? text, int max)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(max, 2);
        var line = OneLine(text);
        if (line.Length <= max)
        {
            return line;
        }

        // Room for the ellipsis; back up to the last space so no word is cut, unless that would leave almost nothing.
        var cut = line[..(max - 1)];
        var space = cut.LastIndexOf(' ');
        if (space >= max / 2)
        {
            cut = cut[..space];
        }

        return cut.TrimEnd(' ', ',', ';', ':', '-', '–', '—', '.') + "…";
    }

    /// <summary>The same, in typographic quotes: <c>“Add a waiting list when a session is full”</c>. Quotes already around it are not doubled.</summary>
    public static string Quoted(string? text, int max)
    {
        var inner = OneLine(text).Trim('"', '“', '”', '\'', '‘', '’', ' ');
        return $"“{Clamp(inner, max)}”";
    }

    /// <summary>Every line joined into one, runs of whitespace collapsed to a single space.</summary>
    public static string OneLine(string? text) =>
        string.Join(' ', (text ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
}
