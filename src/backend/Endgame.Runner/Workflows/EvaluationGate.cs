using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Code's check of the evaluator's answer, whatever the model wrote (ARCH-006, <i>Checking the work</i>): an item
/// passes only when every requirement it delivers is marked met with evidence that names a call the evaluator
/// actually made to the running app, signed in. A requirement with no such evidence fails the item, so an app can no
/// longer pass while missing something the idea asked for. Something people do without signing in is shown the way they
/// would do it: with a call made signed out on the preview (<c>check_preview</c>), which is the only kind of call that can
/// show it — before R2-11 the gate counted signed-in calls alone, so such a part failed every repair round. Evidence may
/// name a path with placeholders for the ids it made (<c>PUT api/trips/{tripId}/items/{itemId}</c>).
/// </summary>
public static partial class EvaluationGate
{
    /// <summary>
    /// The evaluator's answer with the gate applied: <c>passed</c> recomputed, a fault added for each requirement not evidenced
    /// and for each test id the plan promised that the app's screens do not carry (<paramref name="missingTestIds"/>).
    /// </summary>
    public static JsonObject Apply(PlanContract plan, PlanItem item, JsonObject answer, IReadOnlyList<string> calls, IReadOnlyList<string>? missingTestIds = null, IReadOnlyList<string>? signedOutCalls = null)
    {
        signedOutCalls ??= [];
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(answer);
        ArgumentNullException.ThrowIfNull(calls);
        var gated = answer.DeepClone().AsObject();
        if (missingTestIds is { Count: > 0 })
        {
            var missing = Json.Strings(gated, "faults").Prepend(
                $"The screens do not carry the test ids the plan promised: {string.Join(", ", missingTestIds)}. Put each on its element as data-testid=\"…\" (the kit's convention in AGENTS.md), and select by it in the page's tests.").ToList();
            gated["faults"] = new JsonArray(missing.Distinct(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
            gated["missingTestIds"] = new JsonArray(missingTestIds.Select(t => (JsonNode)t).ToArray());
            gated["passed"] = false;
        }

        var requirements = plan.RequirementsOf(item);
        if (requirements.Count == 0)
        {
            return gated;
        }

        var faults = Json.Strings(gated, "faults").ToList();
        var marks = (gated["requirements"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var checkedOut = new JsonArray();
        var allMet = true;
        // A part for people who do not sign in may be shown with signed-out calls throughout; any other, signed in only.
        var signedOutPart = PlanRequirement.NeedsNoSignIn(item.Text) || requirements.Any(r => PlanRequirement.NeedsNoSignIn(r.Text));
        var counted = signedOutPart ? calls.Concat(signedOutCalls).Distinct(StringComparer.Ordinal).ToList() : calls.ToList();
        if (counted.Count == 0)
        {
            faults.Add(signedOutPart
                ? "The running app was never called, signed in (call_app) or signed out (check_preview), so no requirement is shown working; call it for each requirement."
                : "The running app was never called signed in (call_app), so no requirement is shown working; call it for each requirement.");
        }

        foreach (var requirement in requirements)
        {
            var mark = marks.FirstOrDefault(m => Json.Str(m, "id") == requirement.Id);
            var evidence = Json.Str(mark, "evidence") ?? "";
            var noSignIn = PlanRequirement.NeedsNoSignIn(requirement.Text);
            var usable = noSignIn ? signedOutCalls : counted;
            var cited = usable.Where(c => Cites(evidence, c)).ToList();
            var met = Json.Bool(mark, "met") == true && cited.Count > 0;
            if (!met)
            {
                allMet = false;
                faults.Add(mark is null
                    ? $"Requirement {requirement.Id} (\"{requirement.Text}\") was not checked in the running app."
                    : Json.Bool(mark, "met") != true
                        ? $"Requirement {requirement.Id} (\"{requirement.Text}\") is not met: {evidence}"
                        : noSignIn
                            ? $"Requirement {requirement.Id} (\"{requirement.Text}\") is about people who do not sign in, so it is shown with check_preview, signed out; its evidence names no such call that was made (signed-out calls made: {(signedOutCalls.Count == 0 ? "none" : string.Join(", ", signedOutCalls))})."
                            : $"Requirement {requirement.Id} (\"{requirement.Text}\") is marked met, but its evidence names no {(signedOutPart ? "call_app or check_preview" : "call_app")} call that was made (calls made: {(counted.Count == 0 ? "none" : string.Join(", ", counted))}).");
            }

            checkedOut.Add(new JsonObject { ["id"] = requirement.Id, ["text"] = requirement.Text, ["met"] = met, ["evidence"] = evidence, ["calls"] = new JsonArray(cited.Select(c => (JsonNode)c).ToArray()) });
        }

        gated["requirements"] = checkedOut;
        gated["faults"] = new JsonArray(faults.Distinct(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
        gated["passed"] = Json.Bool(answer, "passed") == true && allMet && counted.Count > 0 && missingTestIds is not { Count: > 0 };
        return gated;
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
}
