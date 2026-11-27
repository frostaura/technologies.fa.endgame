using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;
using Endgame.Runner.Agents;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Code's check of the evaluator's answer, whatever the model wrote (ARCH-006, <i>Checking the work</i>): an item
/// passes only when every requirement it delivers is marked met with evidence code can verify. For what the app does, that
/// is a call the evaluator actually made to the running app, signed in. Something people do without signing in is shown the
/// way they would do it: with a call made signed out on the preview (<c>check_preview</c>), which is the only kind of call
/// that can show it (R2-11). Evidence may name a path with placeholders for the ids it made
/// (<c>PUT api/trips/{tripId}/items/{itemId}</c>). A requirement about how a screen presents something
/// (<see cref="PlanRequirement.IsAboutScreen"/>) may instead be shown by the screen's own test, named in the evidence,
/// which code ran itself and saw pass (<see cref="ScreenTests"/>); a test never shows what the app does with data. A
/// requirement where a signed-in person makes or joins something of their own (<see cref="PlanRequirement.IsOwnRecord"/>)
/// is shown coming back later (<see cref="ComingBack"/>): the same person, signed in afresh, makes the same call again and
/// reads it back, and code sees the record found again, never a second one (R3-5).
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
    public static JsonObject Apply(PlanContract plan, PlanItem item, JsonObject answer, IReadOnlyList<string> calls, IReadOnlyList<string>? missingTestIds = null, IReadOnlyList<string>? signedOutCalls = null, IReadOnlyList<ScreenTest>? screenTests = null, string? testsProblem = null, IReadOnlyList<AppAttempt>? attempts = null)
    {
        signedOutCalls ??= [];
        screenTests ??= [];
        attempts ??= [];
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
            // Something a signed-in person has of their own is shown coming back later, whatever the evaluator wrote (R3-5); a
            // part for people who do not sign in has nobody to come back as.
            var back = met && !signedOutPart && PlanRequirement.IsOwnRecord(requirement.Text) ? ComingBack(requirement, evidence, attempts) : null;
            if (back is not null)
            {
                met = false;
            }

            if (!met)
            {
                allMet = false;
                var kind = back is not null ? back.Value.Kind : mark is null ? Unchecked : marked ? Unshown : NotMet;
                onlyShowing &= kind != NotMet;
                failing.Add($"{requirement.Id}:{kind}");
                faults.Add(back is not null ? back.Value.Fault : mark is null
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

    /// <summary>
    /// The check of coming back later, for a requirement where a signed-in person makes or joins something of their own: among
    /// the writes its evidence names, the same person made one call again — same method, path and body; every call signs in
    /// afresh — while the record was still theirs, and then read it back. The second answer must find the first record: the
    /// same <c>id</c>, or a 409, never a 201 or another id. Everything after the evidence names the write is decided from the
    /// calls themselves, in the order made, never from the evidence's words (R6: run 67018a21 failed a correct app on a read
    /// that was in the log but not in the prose). A repeat counts only within one <see cref="Episode"/>: giving the record up
    /// ends it, and a join after that is a fresh one, rightly a new record. Null when it was shown; otherwise how it failed
    /// (<see cref="NotMet"/> for a second record, which the builder must fix; <see cref="Unshown"/> when it was never shown)
    /// and the fault, in words.
    /// </summary>
    public static (string Kind, string Fault)? ComingBack(PlanRequirement requirement, string evidence, IReadOnlyList<AppAttempt> attempts)
    {
        ArgumentNullException.ThrowIfNull(requirement);
        ArgumentNullException.ThrowIfNull(evidence);
        ArgumentNullException.ThrowIfNull(attempts);
        var head = $"Requirement {requirement.Id} (\"{requirement.Text}\") is something a signed-in person makes or joins of their own, so it is shown coming back later";
        var writes = attempts.Where(a => a.Method is "POST" or "PUT" or "PATCH" && Cites(evidence, a.Call)).ToList();
        var episodes = writes.Select(a => (a.Persona, a.Call, Sent: Normal(a.Sent))).Distinct()
            .SelectMany(key => Episodes(key.Persona, key.Call, key.Sent, attempts))
            .Where(e => e.Writes.Count > 1 && Ok(attempts[e.Writes[0]].Status))
            .ToList();
        if (episodes.Count == 0)
        {
            return (Unshown, $"{head}: make the call as one member, then make the same call again as that same member while it is still theirs (every call_app signs them in afresh, as coming back does), and read it back. Code found no write its evidence names made twice by the same member with the same body, with nothing given up between (writes cited: {CallList(writes.Select(w => w.Call).Distinct(StringComparer.Ordinal).ToList())}).");
        }

        foreach (var episode in episodes)
        {
            var first = attempts[episode.Writes[0]];
            var firstId = IdOf(first.Body);
            foreach (var again in episode.Writes.Skip(1).Select(i => attempts[i]))
            {
                var againId = IdOf(again.Body);
                var duplicate = again.Status == 201 || (Ok(again.Status) && firstId is not null && againId is not null && firstId != againId);
                if (duplicate)
                {
                    return (NotMet, SecondRecord(head, first, firstId is not null && againId is not null ? $"id {firstId}, then id {againId}" : $"HTTP {first.Status}, then HTTP {again.Status}"));
                }

                if (!Ok(again.Status) && again.Status != 409)
                {
                    return (NotMet, $"{head}, and it failed: {first.Persona} made {first.Call}, then, signed in again, made it again and the app answered HTTP {again.Status}. Coming back must find the record they already have (the same record, or 409), never fail.");
                }
            }

            // A repeat answered with no record of its own (204, an empty 200) is held to what the person's reads show next.
            if (firstId is not null && episode.Writes.Skip(1).Any(i => IdOf(attempts[i].Body) is null && Ok(attempts[i].Status)))
            {
                var other = episode.Reads(attempts).Select(i => IdOf(attempts[i].Body)).FirstOrDefault(id => id is not null && id != firstId);
                if (other is not null)
                {
                    return (NotMet, SecondRecord(head, first, $"id {firstId}, then, read back after the repeat, id {other}"));
                }
            }
        }

        return episodes.Any(e => e.Reads(attempts).Any(i => i > e.Writes[^1]))
            ? null
            : (Unshown, $"{head}: after making the same call again, read what the person has, as that member, while it is still theirs (before giving it up), so one record and no duplicate is seen. Code found no read of it by that member after the repeat (it reads the calls that were made, in order).");
    }

    private static string SecondRecord(string head, AppAttempt first, string ids) =>
        $"{head}, and it failed: {first.Persona} made {first.Call}, then, signed in again, made it again and the app made a second record ({ids}), with nothing given up between. A person's own record is keyed by their user id with a unique index and found again on return, never made twice: the second call answers the record they already have (see AGENTS.md, \"A person's own record\").";

    /// <summary>
    /// One stretch of a person's own record, from a write that made or answered it until it was given up: the indexes (into
    /// the calls, in order) of that person's same write made in it, and where it ends. It ends at a call that removes the
    /// record — a successful DELETE of its path by that person, or of the record's own path (<c>…/{id}</c>, <c>…/me</c>) —
    /// or at a read by that person showing it gone (an answer whose <c>id</c> is null, or a 404 where the same read answered
    /// before). A join after that is a fresh one, and its new record is right.
    /// </summary>
    private sealed record Episode(string Persona, string Path, List<int> Writes, int End)
    {
        /// <summary>The person's own successful reads of the record inside this stretch, after its first write.</summary>
        public IEnumerable<int> Reads(IReadOnlyList<AppAttempt> attempts) =>
            Enumerable.Range(Writes[0] + 1, Math.Max(0, End - Writes[0] - 1))
                .Where(i => attempts[i] is { Method: "GET" } a && a.Persona == Persona && Ok(a.Status) && OfRecord(a.Path, Path, Ids(attempts)));

        public HashSet<string> Ids(IReadOnlyList<AppAttempt> attempts) => Writes.Select(i => IdOf(attempts[i].Body)).OfType<string>().ToHashSet(StringComparer.Ordinal);
    }

    private static IEnumerable<Episode> Episodes(string persona, string call, string sent, IReadOnlyList<AppAttempt> attempts)
    {
        var path = call[(call.IndexOf(' ', StringComparison.Ordinal) + 1)..];
        var writes = new List<int>();
        var readOk = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < attempts.Count; i++)
        {
            var a = attempts[i];
            if (a.Persona == persona && a.Call == call && Normal(a.Sent) == sent)
            {
                writes.Add(i);
                continue;
            }

            if (writes.Count == 0)
            {
                continue;
            }

            var ids = writes.Select(w => IdOf(attempts[w].Body)).OfType<string>().ToHashSet(StringComparer.Ordinal);
            var own = OfRecord(a.Path, path, ids);
            var removed = a.Method == "DELETE" && Ok(a.Status) && ((a.Persona == persona && own) || ids.Any(id => a.Path == $"{path}/{id}"));
            var shownGone = a.Method == "GET" && a.Persona == persona && own
                && ((Ok(a.Status) && NullId(a.Body)) || (a.Status == 404 && readOk.Contains(a.Path)));
            if (a.Method == "GET" && a.Persona == persona && own && Ok(a.Status))
            {
                readOk.Add(a.Path);
            }

            if (removed || shownGone)
            {
                yield return new Episode(persona, path, writes, i);
                writes = [];
                readOk.Clear();
            }
        }

        if (writes.Count > 0)
        {
            yield return new Episode(persona, path, writes, attempts.Count);
        }
    }

    /// <summary>Whether <paramref name="path"/> is the record written at <paramref name="written"/>: that path, <c>…/me</c>, or <c>…/{its id}</c>.</summary>
    private static bool OfRecord(string path, string written, IReadOnlySet<string> ids) =>
        path == written || path == written + "/me" || ids.Any(id => path == $"{written}/{id}");

    /// <summary>An answer that says the record is not there: <c>"id": null</c> at the top, or in the one object it holds.</summary>
    private static bool NullId(string body)
    {
        try
        {
            if (JsonNode.Parse(string.IsNullOrWhiteSpace(body) ? "null" : body) is not JsonObject o)
            {
                return false;
            }

            if (o.ContainsKey("id"))
            {
                return o["id"] is null;
            }

            var inner = o.Select(p => p.Value).OfType<JsonObject>().ToList();
            return inner.Count == 1 && inner[0].ContainsKey("id") && inner[0]["id"] is null;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool Ok(int status) => status is >= 200 and < 300;

    private static string Normal(string? sent)
    {
        if (string.IsNullOrWhiteSpace(sent))
        {
            return "";
        }

        try
        {
            return JsonNode.Parse(sent)?.ToJsonString() ?? sent.Trim();
        }
        catch (JsonException)
        {
            return sent.Trim();
        }
    }

    /// <summary>The record's id in an answer: a top-level <c>id</c>, or the <c>id</c> of the one object it holds (<c>{"member":{"id":…}}</c>).</summary>
    public static string? IdOf(string body)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(string.IsNullOrWhiteSpace(body) ? "null" : body);
        }
        catch (JsonException)
        {
            return null;
        }

        if (node is not JsonObject o)
        {
            return null;
        }

        if (o["id"] is JsonValue id)
        {
            return id.ToString();
        }

        var inner = o.Select(p => p.Value).OfType<JsonObject>().ToList();
        return inner.Count == 1 && inner[0]["id"] is JsonValue nested ? nested.ToString() : null;
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
