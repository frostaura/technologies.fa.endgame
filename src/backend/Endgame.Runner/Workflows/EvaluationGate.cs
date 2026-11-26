using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Code's check of the evaluator's answer, whatever the model wrote (ARCH-006, <i>Checking the work</i>): an item
/// passes only when every requirement it delivers is marked met with evidence code can verify. For what the app does, that
/// is a call the evaluator actually made to the running app, signed in. Something people do without signing in is shown the
/// way they would do it: with a call made signed out on the preview (<c>check_preview</c>), which is the only kind of call
/// that can show it (R2-11). Evidence may name a path with placeholders for the ids it made
/// (<c>PUT api/trips/{tripId}/items/{itemId}</c>). A requirement about how a screen presents something
/// (<see cref="PlanRequirement.IsAboutScreen"/>) may instead be shown by the screen's own test, named in the evidence,
/// which code ran itself and saw pass (<see cref="ScreenTests"/>); a test never shows what the app does with data.
/// </summary>
public static partial class EvaluationGate
{
    /// <summary>How a failing requirement failed, for the repair brief and for spotting the same failure twice.</summary>
    public const string Unshown = "unshown";

    public const string NotMet = "not-met";

    public const string Unchecked = "unchecked";

    /// <summary>
    /// The evaluator's answer with the gate applied: <c>passed</c> recomputed, a fault added for each requirement not evidenced
    /// and for each test id the plan promised that the app's screens do not carry (<paramref name="missingTestIds"/>).
    /// <c>failing</c> lists how each failing requirement failed (<c>r4:unshown</c>); <c>recheck</c> is true when the only
    /// reason it failed is how the evaluator showed the work — a requirement it marked met with nothing code can verify, or
    /// no verdict at all — which a builder cannot repair: the work is checked again instead (<c>BuildWorkflow</c>).
    /// </summary>
    public static JsonObject Apply(PlanContract plan, PlanItem item, JsonObject answer, IReadOnlyList<string> calls, IReadOnlyList<string>? missingTestIds = null, IReadOnlyList<string>? signedOutCalls = null, IReadOnlyList<ScreenTest>? screenTests = null, string? testsProblem = null)
    {
        signedOutCalls ??= [];
        screenTests ??= [];
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(answer);
        ArgumentNullException.ThrowIfNull(calls);
        var gated = answer.DeepClone().AsObject();
        var failing = new List<string>();
        var evaluatorFaults = Json.Strings(answer, "faults").Count;
        var notChecked = Json.Bool(answer, "unchecked") == true;
        if (notChecked)
        {
            failing.Add($"item:{Unchecked}");
        }

        if (missingTestIds is { Count: > 0 })
        {
            var missing = Json.Strings(gated, "faults").Prepend(
                $"The screens do not carry the test ids the plan promised: {string.Join(", ", missingTestIds)}. Put each on its element as data-testid=\"…\" (the kit's convention in AGENTS.md), and select by it in the page's tests.").ToList();
            gated["faults"] = new JsonArray(missing.Distinct(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
            gated["missingTestIds"] = new JsonArray(missingTestIds.Select(t => (JsonNode)t).ToArray());
            gated["passed"] = false;
            failing.Add("testids:" + string.Join(",", missingTestIds.Order(StringComparer.Ordinal)));
        }

        var requirements = plan.RequirementsOf(item);
        if (requirements.Count == 0)
        {
            Finish(gated, answer, failing, evaluatorFaults, notChecked, onlyShowing: notChecked);
            return gated;
        }

        var faults = Json.Strings(gated, "faults").ToList();
        var marks = (gated["requirements"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var checkedOut = new JsonArray();
        var allMet = true;
        var onlyShowing = true;
        // A part for people who do not sign in may be shown with signed-out calls throughout; any other, signed in only.
        var signedOutPart = PlanRequirement.NeedsNoSignIn(item.Text) || requirements.Any(r => PlanRequirement.NeedsNoSignIn(r.Text));
        var counted = signedOutPart ? calls.Concat(signedOutCalls).Distinct(StringComparer.Ordinal).ToList() : calls.ToList();
        if (counted.Count == 0)
        {
            faults.Add(signedOutPart
                ? "The running app was never called, signed in (call_app) or signed out (check_preview), so no requirement is shown working; call it for each requirement."
                : "The running app was never called signed in (call_app), so no requirement is shown working; call it for each requirement.");
        }

        // A screen's test counts only beside the data it shows, read from the running app: some requirement's evidence cites a
        // call that was made. A mocked screen test alone never stands in for the app.
        var dataShown = marks.Any(m => counted.Any(c => Cites(Json.Str(m, "evidence") ?? "", c)));
        foreach (var requirement in requirements)
        {
            var mark = marks.FirstOrDefault(m => Json.Str(m, "id") == requirement.Id);
            var evidence = Json.Str(mark, "evidence") ?? "";
            var noSignIn = PlanRequirement.NeedsNoSignIn(requirement.Text);
            var screen = PlanRequirement.IsAboutScreen(requirement.Text);
            var usable = noSignIn ? signedOutCalls : counted;
            var cited = usable.Where(c => Cites(evidence, c)).ToList();
            var marked = Json.Bool(mark, "met") == true;
            // A requirement about a screen may be shown by the screen's own test, which code ran: never one about data.
            var named = screen && marked && cited.Count == 0 && dataShown ? ScreenTests.Named(mark, screenTests) : [];
            var passedTests = named.Where(t => t.Passed).ToList();
            var met = marked && (cited.Count > 0 || passedTests.Count > 0) && counted.Count > 0;
            if (!met)
            {
                allMet = false;
                var kind = mark is null ? Unchecked : marked ? Unshown : NotMet;
                onlyShowing &= kind != NotMet;
                failing.Add($"{requirement.Id}:{kind}");
                faults.Add(mark is null
                    ? $"Requirement {requirement.Id} (\"{requirement.Text}\") was not checked in the running app."
                    : !marked
                        ? $"Requirement {requirement.Id} (\"{requirement.Text}\") is not met: {evidence}"
                        : noSignIn
                            ? $"Requirement {requirement.Id} (\"{requirement.Text}\") is about people who do not sign in, so it is shown with check_preview, signed out; its evidence names no such call that was made (signed-out calls made: {CallList(signedOutCalls)})."
                            : screen
                                ? ScreenFault(requirement, named, counted, signedOutPart, dataShown, screenTests, testsProblem)
                                : $"Requirement {requirement.Id} (\"{requirement.Text}\") is marked met, but its evidence names no {(signedOutPart ? "call_app or check_preview" : "call_app")} call that was made (calls made: {CallList(counted)}).");
            }

            var shown = new JsonObject { ["id"] = requirement.Id, ["text"] = requirement.Text, ["met"] = met, ["evidence"] = evidence, ["calls"] = new JsonArray(cited.Select(c => (JsonNode)c).ToArray()) };
            if (met && passedTests.Count > 0)
            {
                shown["tests"] = new JsonArray(passedTests.Select(t => (JsonNode)$"{t.File} > {t.Title}").ToArray());
            }

            checkedOut.Add(shown);
        }

        gated["requirements"] = checkedOut;
        gated["faults"] = new JsonArray(faults.Distinct(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
        gated["passed"] = Json.Bool(answer, "passed") == true && allMet && counted.Count > 0 && missingTestIds is not { Count: > 0 };
        Finish(gated, answer, failing, evaluatorFaults, notChecked, onlyShowing);
        return gated;
    }

    private static void Finish(JsonObject gated, JsonObject answer, List<string> failing, int evaluatorFaults, bool notChecked, bool onlyShowing)
    {
        var passed = Json.Bool(gated, "passed") == true;
        if (!passed && evaluatorFaults > 0 && !notChecked)
        {
            failing.Add("item:faults");
        }

        gated["failing"] = passed ? new JsonArray() : new JsonArray(failing.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
        // Checked again, not repaired: the evaluator said it works (or gave no verdict), and code could not verify how it was shown.
        var claimedWorking = Json.Bool(answer, "passed") == true && evaluatorFaults == 0;
        gated["recheck"] = !passed && onlyShowing && !failing.Any(f => f.StartsWith("testids:", StringComparison.Ordinal)) && (claimedWorking || notChecked);
    }

    private static string ScreenFault(PlanRequirement requirement, IReadOnlyList<ScreenTest> named, IReadOnlyList<string> counted, bool signedOutPart, bool dataShown, IReadOnlyList<ScreenTest> tests, string? problem)
    {
        var head = $"Requirement {requirement.Id} (\"{requirement.Text}\") is about how a screen presents something, so it is shown by a {(signedOutPart ? "call_app or check_preview" : "call_app")} call that reads the data the screen shows, or by the screen's own test, named exactly as it is written, which code runs itself";
        if (named.Count > 0)
        {
            return $"{head}. The test its evidence names did not pass when code ran it: {string.Join("; ", named.Select(t => $"{t.File} > \"{t.Title}\""))}.";
        }

        var ran = problem is not null ? $"; {problem}" : tests.Count == 0 ? "" : $"; code ran the app's front-end tests and none is the one named ({tests.Count} tests ran)";
        if (!dataShown)
        {
            return $"{head}, beside a call that shows the data it presents: no requirement's evidence names a call that was made (calls made: {CallList(counted)}{ran}).";
        }

        return $"{head}. Its evidence names neither (calls made: {CallList(counted)}{ran}).";
    }

    /// <summary>The calls made, as people read them: ids written as {id}, each shape once, at most ten.</summary>
    public static string CallList(IReadOnlyList<string> calls)
    {
        ArgumentNullException.ThrowIfNull(calls);
        if (calls.Count == 0)
        {
            return "none";
        }

        var shapes = calls.Select(c => string.Join('/', c.Split('/').Select(s => IdSegment().IsMatch(s) ? "{id}" : s))).Distinct(StringComparer.Ordinal).ToList();
        return string.Join(", ", shapes.Take(10)) + (shapes.Count > 10 ? $", and {shapes.Count - 10} more" : "");
    }

    /// <summary>Whether the evidence names the call <paramref name="call"/> (<c>"GET api/books"</c>): its method and its path, with or without a leading slash.</summary>
    public static bool Cites(string evidence, string call)
    {
        ArgumentNullException.ThrowIfNull(evidence);
        ArgumentNullException.ThrowIfNull(call);
        var space = call.IndexOf(' ', StringComparison.Ordinal);
        var (method, path) = (call[..space], call[(space + 1)..]);
        foreach (var form in new[] { $"{method} {path}", $"{method} /{path}" })
        {
            for (var at = evidence.IndexOf(form, StringComparison.OrdinalIgnoreCase); at >= 0; at = evidence.IndexOf(form, at + 1, StringComparison.OrdinalIgnoreCase))
            {
                var end = at + form.Length;
                // "GET api/books" cites "GET api/books?x" and "GET api/books → 200", never "GET api/books-archive".
                if (end >= evidence.Length || !(char.IsLetterOrDigit(evidence[end]) || evidence[end] is '-' or '_' or '/'))
                {
                    return true;
                }
            }
        }

        // A path written with placeholders for ids it made: "PUT api/trips/{tripId}/items/{id}" cites "PUT api/trips/7/items/9".
        var segments = path.Split('/');
        foreach (System.Text.RegularExpressions.Match m in Named().Matches(evidence))
        {
            if (!string.Equals(m.Groups[1].Value, method, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var written = m.Groups[2].Value.TrimStart('/').Split('?')[0].TrimEnd('.', ',', ';', ':', ')').Split('/');
            if (written.Length == segments.Length && written.Zip(segments).All(p => string.Equals(p.First, p.Second, StringComparison.OrdinalIgnoreCase) || Placeholder().IsMatch(p.First))
                && written.Any(w => Placeholder().IsMatch(w)))
            {
                return true;
            }
        }

        return false;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(GET|POST|PUT|PATCH|DELETE)\s+(\S+)")]
    private static partial System.Text.RegularExpressions.Regex Named();

    [System.Text.RegularExpressions.GeneratedRegex(@"^(\{[^/{}]+\}|:[A-Za-z_][A-Za-z0-9_]*|<[^/<>]+>)$")]
    private static partial System.Text.RegularExpressions.Regex Placeholder();

    /// <summary>A path segment that is an id the app made: a GUID, a long hex token, or a number.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"^([0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}|[0-9a-fA-F]{16,}|\d+)$")]
    private static partial System.Text.RegularExpressions.Regex IdSegment();
}
