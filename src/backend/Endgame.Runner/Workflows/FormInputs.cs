using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Planning;
using Endgame.Harness.Workspaces;

namespace Endgame.Runner.Workflows;

/// <summary>One field of a form a part's screens carry: its test id (<c>dive-when</c>), what it takes, and the file it is in.</summary>
public sealed record FormField(string TestId, string Kind, string File)
{
    /// <summary>The kind in words, for a fault the builder reads.</summary>
    public string Described => Kind switch
    {
        FormInputs.Date => "date",
        FormInputs.Number => "number",
        FormInputs.Select => "choice",
        _ => "text",
    };
}

/// <summary>
/// A form holds up against bad input (ARCH-006, R7-1). A built app's "Add a dive" page — a form with a date field and a live
/// preview beside it — went blank on a six-digit year a browser lets through, and nothing the evaluator could do with the app
/// touched its page: it calls the API and reads the code. So for every form field a part's plan names (<c>&lt;entity&gt;-&lt;field&gt;</c>
/// on an input, select or textarea in <c>web/src</c>), code itself runs the app's front-end tests and needs the field's own
/// bad-input test — titled <see cref="TitlePrefix"/> + its test id, written with the kit's <c>holdsUpAgainstBadInput</c>, which
/// feeds it the values a person can give it and fails unless the page stays whole and refuses each beside the field — to have
/// passed. Decided from the tests code ran, never from what the evaluator wrote.
/// </summary>
public static partial class FormInputs
{
    /// <summary>The kit's title for the test (<c>BAD_INPUT_TEST</c> in <c>@endgame/appkit/testing</c>), before the field's test id.</summary>
    public const string TitlePrefix = "holds up against bad input: ";

    public const string Text = "text";

    public const string Number = "number";

    public const string Date = "date";

    public const string Select = "select";

    /// <summary>How a field failed: no passing test fed it bad values, or one did and the page broke.</summary>
    public const string Untested = "untested";

    public const string Broken = "broken";

    /// <summary>Whether a promised test id names a form field (<c>dive-when</c>), not a page, link, list, item or button.</summary>
    public static bool IsFieldId(string testId)
    {
        ArgumentNullException.ThrowIfNull(testId);
        return TestIdConvention.IsValid(testId) && !NotAField().IsMatch(testId);
    }

    /// <summary>The part's form fields, read from the app's source: each promised field id on an input, select or textarea.</summary>
    public static async Task<IReadOnlyList<FormField>> FindAsync(IWorkspace workspace, PlanItem item, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        ArgumentNullException.ThrowIfNull(item);
        var candidates = item.TestIds.Where(IsFieldId).Distinct(StringComparer.Ordinal).ToList();
        if (candidates.Count == 0)
        {
            return [];
        }

        var search = await workspace.ExecAsync(new WorkspaceCommand(["rg", "--no-messages", "--glob", "!*.test.*", "-e", "data-testid=", $"{workspace.Root}/web/src"], null, TimeoutSeconds: 60, MaxOutputBytes: 512 * 1024), cancellationToken);
        var files = search.Stdout.Split('\n')
            .Select(line => line.Split(':', 2)[0].Trim())
            .Where(path => path.EndsWith(".tsx", StringComparison.Ordinal) || path.EndsWith(".jsx", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var sources = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            if (await workspace.ReadBytesAsync(file, cancellationToken) is { } bytes)
            {
                sources[file.StartsWith(workspace.Root + "/", StringComparison.Ordinal) ? file[(workspace.Root.Length + 1)..] : file] = Encoding.UTF8.GetString(bytes);
            }
        }

        return Find(candidates, sources);
    }

    /// <summary>The fields among <paramref name="testIds"/> that some source file writes on a form control, with their kind.</summary>
    public static IReadOnlyList<FormField> Find(IEnumerable<string> testIds, IReadOnlyDictionary<string, string> sources)
    {
        ArgumentNullException.ThrowIfNull(testIds);
        ArgumentNullException.ThrowIfNull(sources);
        var fields = new List<FormField>();
        foreach (var id in testIds.Where(IsFieldId).Distinct(StringComparer.Ordinal))
        {
            foreach (var (file, source) in sources.OrderBy(s => s.Key, StringComparer.Ordinal))
            {
                if (KindOf(source, id) is { } kind)
                {
                    fields.Add(new FormField(id, kind, file));
                    break;
                }
            }
        }

        return fields;
    }

    /// <summary>
    /// What the JSX element carrying <c>data-testid="<paramref name="testId"/>"</c> takes — <see cref="Text"/>, <see cref="Number"/>,
    /// <see cref="Date"/> or <see cref="Select"/> — or null when it is not a control a person types into or picks from (a checkbox,
    /// a time, a list item, a button).
    /// </summary>
    public static string? KindOf(string source, string testId)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(testId);
        foreach (var quote in new[] { '"', '\'' })
        {
            var at = source.IndexOf($"data-testid={quote}{testId}{quote}", StringComparison.Ordinal);
            if (at >= 0 && Element(source, at) is { } element)
            {
                return Classify(element.Tag, element.Type);
            }
        }

        return null;
    }

    private static string? Classify(string tag, string? type)
    {
        var name = tag.Split('.')[^1];
        var lower = name.ToLowerInvariant();
        if (lower is "select" || name.EndsWith("Select", StringComparison.Ordinal))
        {
            return Select;
        }

        if (lower is "textarea" || name.EndsWith("Textarea", StringComparison.Ordinal) || name.EndsWith("TextArea", StringComparison.Ordinal))
        {
            return Text;
        }

        var control = lower is "input" || name.EndsWith("Input", StringComparison.Ordinal) || name.EndsWith("Field", StringComparison.Ordinal) || name.EndsWith("Picker", StringComparison.Ordinal);
        if (!control)
        {
            return null;
        }

        return (type ?? "").ToLowerInvariant() switch
        {
            "date" or "datetime-local" or "month" or "week" => Date,
            "number" or "range" => Number,
            "checkbox" or "radio" or "file" or "hidden" or "submit" or "button" or "reset" or "image" or "color" or "time" => null,
            "" when name.Contains("Date", StringComparison.Ordinal) => Date,
            "" when name.Contains("Number", StringComparison.Ordinal) => Number,
            _ => Text,
        };
    }

    /// <summary>The opening tag around position <paramref name="at"/>: its name and its literal <c>type</c>, braces and quotes respected.</summary>
    private static (string Tag, string? Type)? Element(string source, int at)
    {
        var depth = 0;
        var start = -1;
        for (var i = at - 1; i >= 0; i--)
        {
            var c = source[i];
            if (c == '}')
            {
                depth++;
            }
            else if (c == '{')
            {
                depth--;
            }
            else if (depth == 0 && c == '<' && i + 1 < source.Length && char.IsLetter(source[i + 1]))
            {
                start = i;
                break;
            }
            else if (depth == 0 && c == '>')
            {
                return null;
            }
        }

        if (start < 0)
        {
            return null;
        }

        var nameEnd = start + 1;
        while (nameEnd < source.Length && (char.IsLetterOrDigit(source[nameEnd]) || source[nameEnd] is '.' or '_'))
        {
            nameEnd++;
        }

        // The whole opening tag, to its closing '>' outside braces and strings.
        var end = nameEnd;
        depth = 0;
        char? quote = null;
        for (; end < source.Length; end++)
        {
            var c = source[end];
            if (quote is { } q)
            {
                if (c == q)
                {
                    quote = null;
                }
            }
            else if (c is '"' or '\'' && depth == 0)
            {
                quote = c;
            }
            else if (c == '{')
            {
                depth++;
            }
            else if (c == '}')
            {
                depth--;
            }
            else if (c == '>' && depth == 0)
            {
                break;
            }
        }

        var tag = source[start..Math.Min(end, source.Length)];
        var type = TypeAttribute().Match(tag);
        return (source[(start + 1)..nameEnd], type.Success ? type.Groups.Cast<System.Text.RegularExpressions.Group>().Skip(1).First(g => g.Success).Value : null);
    }

    /// <summary>
    /// The check, from the tests code ran: a field with a passing test titled <see cref="TitlePrefix"/> + its id, and none such
    /// failing, holds up. Returns each failing field's fault (in words, for the builder), its kind (<c>form:dive-when:broken</c>)
    /// and the tests that decided it.
    /// </summary>
    public static IReadOnlyList<(FormField Field, string Kind, string Fault, IReadOnlyList<string> Tests)> Check(IReadOnlyList<FormField> fields, IReadOnlyList<ScreenTest> tests, string? problem)
    {
        ArgumentNullException.ThrowIfNull(fields);
        ArgumentNullException.ThrowIfNull(tests);
        var failures = new List<(FormField, string, string, IReadOnlyList<string>)>();
        foreach (var field in fields)
        {
            var own = tests.Where(t => Names(t.Title, field.TestId)).ToList();
            var failed = own.Where(t => !t.Passed).ToList();
            if (failed.Count > 0)
            {
                failures.Add((field, Broken,
                    $"The form broke on a bad value in its {field.Described} field {field.TestId} ({field.File}): \"{failed[0].File} > {failed[0].Title}\" failed when code ran the app's front-end tests. Make the page hold up: give the field min and max, check what was typed on submit and show the error beside the field (checkDateInput, checkNumberInput), and format only through the kit's formatDate, formatDateTime and formatNumber, which never throw (AGENTS.md, \"Dates and numbers\").",
                    failed.Select(t => $"{t.File} > {t.Title} → failed").ToList()));
            }
            else if (own.Count == 0)
            {
                var ran = problem ?? (tests.Count == 0 ? "code ran no front-end tests" : $"code ran the app's front-end tests ({tests.Count}) and none is titled \"{TitlePrefix}{field.TestId}\"");
                failures.Add((field, Untested,
                    $"The form's {field.Described} field {field.TestId} ({field.File}) has no test that feeds it a bad value ({ran}). Every form field gets one, with the kit's helper: it.each([\"{field.TestId}\", …])(BAD_INPUT_TEST, (field) => holdsUpAgainstBadInput(field, {{ render, page: \"page-…\", submit: \"save-…\" }})) from @endgame/appkit/testing, and it must pass (the write-a-screen skill).",
                    []));
            }
        }

        return failures;
    }

    /// <summary>Whether a test's title is the bad-input test of that field: the prefix, the id, then nothing more of an id.</summary>
    private static bool Names(string title, string testId)
    {
        var expected = TitlePrefix + testId;
        var t = title.Trim();
        return t.StartsWith(expected, StringComparison.OrdinalIgnoreCase)
            && (t.Length == expected.Length || !(char.IsLetterOrDigit(t[expected.Length]) || t[expected.Length] == '-'));
    }

    /// <summary>The overruled entries for the escalation guard (<c>BuildWorkflow.NeedsLook</c>): each failing field with the tests that decided it.</summary>
    public static JsonArray Overruled(IEnumerable<(FormField Field, string Kind, string Fault, IReadOnlyList<string> Tests)> failures)
    {
        ArgumentNullException.ThrowIfNull(failures);
        return new JsonArray(failures.Select(f => (JsonNode)new JsonObject
        {
            ["id"] = $"form:{f.Field.TestId}",
            ["kind"] = f.Kind,
            ["calls"] = new JsonArray((f.Tests.Count > 0 ? f.Tests : [$"no test titled \"{TitlePrefix}{f.Field.TestId}\""]).Select(t => (JsonNode)t).ToArray()),
        }).ToArray());
    }

    /// <summary>Ids that are not a field: pages, links, lists, items, buttons that open or save or set.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"^(page|nav|new|open|save|set)-|-(list|item)$")]
    private static partial System.Text.RegularExpressions.Regex NotAField();

    [System.Text.RegularExpressions.GeneratedRegex(@"\stype=(?:""([^""]*)""|'([^']*)'|\{\s*""([^""]*)""\s*\}|\{\s*'([^']*)'\s*\})")]
    private static partial System.Text.RegularExpressions.Regex TypeAttribute();
}
