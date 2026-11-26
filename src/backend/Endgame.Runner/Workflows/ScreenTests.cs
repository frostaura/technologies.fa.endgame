using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Workspaces;

namespace Endgame.Runner.Workflows;

/// <summary>One of the app's front-end tests as code saw it run: its file (<c>web/src/…</c>), its title, and whether it passed.</summary>
public sealed record ScreenTest(string File, string Title, string FullName, bool Passed);

/// <summary>
/// The app's own front-end tests, run by code — never taken from the evaluator's word (ARCH-006, <i>Checking the work</i>).
/// A requirement about how a screen presents something ("make the readiness view the product", "on their phone") cannot be
/// shown by a call to the running app: a call shows the data, not what the screen leads with. Such a requirement is shown by
/// the screen's own test, named in the evidence, and it counts only when code ran that test itself and saw it pass. The
/// real dive-club build (run cafe1c2e, part 3) failed four rounds because the evaluator named exactly such a test and the
/// gate counted calls alone.
/// </summary>
public static partial class ScreenTests
{
    /// <summary>The kit's front-end suite, its JSON report on standard output, after its dependencies are in place.</summary>
    public const string Command = "make -s web-deps >/dev/null 2>&1; cd web && ./node_modules/.bin/vitest run --reporter=json --outputFile=/dev/stdout";

    /// <summary>The run's outcome: every test it reported, or why there is none.</summary>
    public sealed record Outcome(IReadOnlyList<ScreenTest> Tests, string? Problem)
    {
        public static readonly Outcome NotRun = new([], null);
    }

    public static async Task<Outcome> RunAsync(IWorkspace workspace, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        var exec = await workspace.ExecAsync(new WorkspaceCommand(null, Command, TimeoutSeconds: 600, MaxOutputBytes: 4 * 1024 * 1024, WorkingDirectory: workspace.Root), cancellationToken);
        var tests = Parse(exec.Stdout, workspace.Root);
        return tests.Count > 0
            ? new Outcome(tests, null)
            : new Outcome([], $"code ran the app's front-end tests and got no report (exit code {exec.ExitCode}: {OutputText.Truncate(OutputText.StripAnsi(exec.Stderr + exec.Stdout).Trim(), 300)})");
    }

    /// <summary>The tests in a vitest JSON report (<c>testResults[].assertionResults[]</c>); anything around the JSON is ignored.</summary>
    public static IReadOnlyList<ScreenTest> Parse(string? stdout, string root)
    {
        var text = stdout ?? "";
        // What a test prints goes to the same output; the report starts with its own first key.
        var report0 = text.IndexOf("{\"numTotalTestSuites\"", StringComparison.Ordinal);
        var (start, end) = (report0 >= 0 ? report0 : text.IndexOf('{', StringComparison.Ordinal), text.LastIndexOf('}'));
        if (start < 0 || end <= start || Json.ParseTolerant(text[start..(end + 1)]) is not JsonObject report)
        {
            return [];
        }

        var prefix = root.TrimEnd('/') + "/";
        var tests = new List<ScreenTest>();
        foreach (var file in (report["testResults"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var name = Json.Str(file, "name") ?? "";
            var relative = name.StartsWith(prefix, StringComparison.Ordinal) ? name[prefix.Length..] : name.TrimStart('/');
            foreach (var test in (file["assertionResults"] as JsonArray ?? []).OfType<JsonObject>())
            {
                var title = Json.Str(test, "title") ?? "";
                if (title.Length > 0)
                {
                    tests.Add(new ScreenTest(relative, title, Json.Str(test, "fullName") ?? title, Json.Str(test, "status") == "passed"));
                }
            }
        }

        return tests;
    }

    /// <summary>
    /// The tests a requirement's evidence names: each entry of its <c>tests</c> list ("web/src/trips/TripPage.test.tsx &gt; leads
    /// with readiness"), and each quoted phrase in its evidence ("The test 'leads with readiness, …' verifies …"). A name
    /// matches a test whose title (or full name) it is, or — at three words or more — the start of exactly one test's title,
    /// within the file named when the evidence names one. Nothing is matched loosely: a phrase that fits two tests names none.
    /// </summary>
    public static IReadOnlyList<ScreenTest> Named(JsonObject? mark, IReadOnlyList<ScreenTest> tests)
    {
        ArgumentNullException.ThrowIfNull(tests);
        if (mark is null || tests.Count == 0)
        {
            return [];
        }

        var evidence = Json.Str(mark, "evidence") ?? "";
        var references = new List<(string? File, string Name)>();
        foreach (var entry in Json.Strings(mark, "tests"))
        {
            var cut = Separator().Match(entry);
            references.Add(cut.Success ? (entry[..cut.Index].Trim(), entry[(cut.Index + cut.Length)..]) : (null, entry));
        }

        var files = FileName().Matches(evidence).Select(m => m.Value).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (System.Text.RegularExpressions.Match m in Quoted().Matches(evidence))
        {
            var phrase = m.Groups.Cast<System.Text.RegularExpressions.Group>().Skip(1).First(g => g.Success).Value;
            references.Add((files.Count == 1 ? files[0] : null, phrase));
        }

        var found = new List<ScreenTest>();
        foreach (var (file, name) in references)
        {
            var phrase = Normal(name);
            if (phrase.Length == 0)
            {
                continue;
            }

            var pool = file is { Length: > 0 } f && tests.Any(t => InFile(t, f)) ? tests.Where(t => InFile(t, f)).ToList() : tests;
            var exact = pool.Where(t => Normal(t.Title) == phrase || Normal(t.FullName) == phrase).ToList();
            var match = exact.Count > 0
                ? exact
                : phrase.Split(' ').Length >= 3 && pool.Where(t => Normal(t.Title).StartsWith(phrase, StringComparison.Ordinal)).ToList() is { Count: 1 } one ? one : [];
            found.AddRange(match.Where(t => !found.Contains(t)));
        }

        return found;
    }

    private static bool InFile(ScreenTest test, string file)
    {
        var name = file.Replace('\\', '/').Trim().TrimStart('.', '/');
        return test.File.EndsWith(name, StringComparison.OrdinalIgnoreCase) || test.File.EndsWith("/" + name.Split('/')[^1], StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A name as compared: lowercase, its quotes and closing punctuation dropped, its spaces collapsed.</summary>
    private static string Normal(string text) =>
        Spaces().Replace(text.Trim().Trim('\'', '"', '“', '”', '‘', '’', '`').TrimEnd('.', ',', ';', ':').Trim(), " ").ToLowerInvariant();

    [System.Text.RegularExpressions.GeneratedRegex(@"\s+(>|›|»|::)\s+")]
    private static partial System.Text.RegularExpressions.Regex Separator();

    [System.Text.RegularExpressions.GeneratedRegex(@"[A-Za-z0-9_./-]+\.test\.(tsx|ts|jsx|js)\b")]
    private static partial System.Text.RegularExpressions.Regex FileName();

    // A quoted phrase of at least eight characters; a single quote counts only where it is not an apostrophe ("leader's").
    [System.Text.RegularExpressions.GeneratedRegex(@"(?<![A-Za-z0-9])'([^'\n]{8,200})'(?![A-Za-z0-9])|""([^""\n]{8,200})""|“([^”\n]{8,200})”|‘([^’\n]{8,200})’")]
    private static partial System.Text.RegularExpressions.Regex Quoted();

    [System.Text.RegularExpressions.GeneratedRegex(@"\s+")]
    private static partial System.Text.RegularExpressions.Regex Spaces();
}
