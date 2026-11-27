using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness.Kernel;

namespace Endgame.Runner.Workflows;

/// <summary>
/// How code weighs the security review's findings (ARCH-006, <i>The security review</i>). A finding blocks publishing unless
/// it is only about a document that says less than the code does: run d09672a3 was not published because its second review
/// found that <c>docs/app.md</c> still said "Signed in? No" for an endpoint its repair had just made require sign-in — code
/// stricter than its document, which is a fix of the document, not a reason to withhold the app.
/// </summary>
public static partial class SecurityFindings
{
    /// <summary>
    /// Whether the finding is only about documentation: its file is a document (a Markdown file, or anything under
    /// <c>docs/</c>), the reviewer did not call it a fault of the code (<c>"kind": "code"</c>), and it is not about a secret — a
    /// key, token or password written in a document is a real finding wherever it is. Everything else blocks publishing.
    /// </summary>
    public static bool IsDocumentation(JsonObject finding)
    {
        ArgumentNullException.ThrowIfNull(finding);
        var file = (Json.Str(finding, "file") ?? "").Trim().Replace('\\', '/').TrimStart('.', '/');
        var document = file.Length > 0 && (file.StartsWith("docs/", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".md", StringComparison.OrdinalIgnoreCase));
        var kind = Json.Str(finding, "kind");
        var text = $"{Json.Str(finding, "item")} {Json.Str(finding, "problem")}";
        return document && !string.Equals(kind, "code", StringComparison.OrdinalIgnoreCase) && !Secret().IsMatch(text);
    }

    /// <summary>The findings that block publishing: every one that is not only about documentation.</summary>
    public static IReadOnlyList<JsonObject> Blocking(JsonObject? review) =>
        All(review).Where(f => !IsDocumentation(f)).ToList();

    /// <summary>The findings that are only about documentation, fixed for free and never a reason to withhold the app.</summary>
    public static IReadOnlyList<JsonObject> Documentation(JsonObject? review) =>
        All(review).Where(IsDocumentation).ToList();

    public static IReadOnlyList<JsonObject> All(JsonObject? review) =>
        (review?["findings"] as JsonArray ?? []).OfType<JsonObject>().ToList();

    /// <summary>
    /// Whether a further repair is earned: the last repair demonstrably cleared what it was given — none of the findings now
    /// is one of those (the same file and checklist item within a few lines, since an edit moves lines) — and what is left is
    /// different and no larger. A finding that comes back, or a review that finds more, ends the repairs.
    /// </summary>
    public static bool Narrower(IReadOnlyList<JsonObject> before, IReadOnlyList<JsonObject> now)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(now);
        return before.Count > 0 && now.Count > 0 && now.Count <= before.Count && !now.Any(n => before.Any(b => Same(b, n)));
    }

    /// <summary>The same finding: the same file and checklist section, at nearly the same line (or with no line to tell).</summary>
    public static bool Same(JsonObject a, JsonObject b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        static string Norm(string? s) => (s ?? "").Trim().Replace('\\', '/').TrimStart('.', '/');
        static string Section(string? item) => (item ?? "").Split(['-', '—', ':'], 2)[0].Trim();
        if (!string.Equals(Norm(Json.Str(a, "file")), Norm(Json.Str(b, "file")), StringComparison.OrdinalIgnoreCase)
            || !string.Equals(Section(Json.Str(a, "item")), Section(Json.Str(b, "item")), StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return Line(a) is not { } x || Line(b) is not { } y || Math.Abs(x - y) <= SameLineWindow;
    }

    /// <summary>How many lines a finding may move and still be the same one: a repair's own edits shift what follows them.</summary>
    public const int SameLineWindow = 10;

    private static int? Line(JsonObject finding) =>
        finding["line"] is JsonValue v && (v.TryGetValue<int>(out var n) || (v.TryGetValue<string>(out var s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out n))) && n > 0 ? n : null;

    /// <summary>The findings as the builder reads them, one JSON object each.</summary>
    public static string Render(IEnumerable<JsonObject> findings) =>
        new JsonArray(findings.Select(f => (JsonNode)f.DeepClone()).ToArray()).ToJsonString(Json.Compact);

    /// <summary>A document finding about a secret is never only a document's: a key in a document is a leak.</summary>
    [GeneratedRegex(@"\b(secrets?|keys?|tokens?|passwords?|credentials?|connection ?strings?|bearer|sk-)(?![a-z])", RegexOptions.IgnoreCase)]
    private static partial Regex Secret();
}
