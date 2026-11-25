using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Code's check of the evaluator's answer, whatever the model wrote (ARCH-006, <i>Checking the work</i>): an item
/// passes only when every requirement it delivers is marked met with evidence that names a call the evaluator
/// actually made to the running app, signed in. A requirement with no such evidence fails the item, so an app can no
/// longer pass while missing something the idea asked for.
/// </summary>
public static class EvaluationGate
{
    /// <summary>The evaluator's answer with the gate applied: <c>passed</c> recomputed, a fault added for each requirement not evidenced.</summary>
    public static JsonObject Apply(PlanContract plan, PlanItem item, JsonObject answer, IReadOnlyList<string> calls)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(answer);
        ArgumentNullException.ThrowIfNull(calls);
        var gated = answer.DeepClone().AsObject();
        var requirements = plan.RequirementsOf(item);
        if (requirements.Count == 0)
        {
            return gated;
        }

        var faults = Json.Strings(gated, "faults").ToList();
        var marks = (gated["requirements"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var checkedOut = new JsonArray();
        var allMet = true;
        if (calls.Count == 0)
        {
            faults.Add("The running app was never called signed in (call_app), so no requirement is shown working; call it for each requirement.");
        }

        foreach (var requirement in requirements)
        {
            var mark = marks.FirstOrDefault(m => Json.Str(m, "id") == requirement.Id);
            var evidence = Json.Str(mark, "evidence") ?? "";
            var cited = calls.Where(c => Cites(evidence, c)).ToList();
            var met = Json.Bool(mark, "met") == true && cited.Count > 0;
            if (!met)
            {
                allMet = false;
                faults.Add(mark is null
                    ? $"Requirement {requirement.Id} (\"{requirement.Text}\") was not checked in the running app."
                    : Json.Bool(mark, "met") != true
                        ? $"Requirement {requirement.Id} (\"{requirement.Text}\") is not met: {evidence}"
                        : $"Requirement {requirement.Id} (\"{requirement.Text}\") is marked met, but its evidence names no call_app call that was made (calls made: {(calls.Count == 0 ? "none" : string.Join(", ", calls))}).");
            }

            checkedOut.Add(new JsonObject { ["id"] = requirement.Id, ["text"] = requirement.Text, ["met"] = met, ["evidence"] = evidence, ["calls"] = new JsonArray(cited.Select(c => (JsonNode)c).ToArray()) });
        }

        gated["requirements"] = checkedOut;
        gated["faults"] = new JsonArray(faults.Distinct(StringComparer.Ordinal).Select(f => (JsonNode)f).ToArray());
        gated["passed"] = Json.Bool(answer, "passed") == true && allMet && calls.Count > 0;
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

        return false;
    }
}
