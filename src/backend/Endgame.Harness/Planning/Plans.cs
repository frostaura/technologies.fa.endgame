using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;

namespace Endgame.Harness.Planning;

/// <summary>
/// One thing the work will make. <paramref name="Text"/> is what the owner gets, in plain words (normal mode);
/// <paramref name="Detail"/> is how, for technical mode and for the builder (files, endpoints, entities);
/// <paramref name="Check"/> how it will be verified; <paramref name="Covers"/> the requirements it delivers.
/// </summary>
public sealed record PlanItem(string Id, string Text, string Detail, string Check, IReadOnlyList<string> Covers)
{
    public PlanItem(string id, string deliverable, string check)
        : this(id, deliverable, deliverable, check, [])
    {
    }

    /// <summary>What a builder or evaluator is told the item is: the plain text, then the technical detail.</summary>
    public string Deliverable => string.IsNullOrWhiteSpace(Detail) || Detail == Text ? Text : $"{Text} — {Detail}";

    /// <summary>
    /// The stable test ids (<c>data-testid</c>) the item's screens carry, by the app kit's convention (<see cref="TestIdConvention"/>):
    /// the evaluator checks them, code's gate refuses an item whose screens lack one, and the browser proof drives the app by them.
    /// </summary>
    public IReadOnlyList<string> TestIds { get; init; } = [];
}

/// <summary>
/// The app kit's test-id convention (the template's AGENTS.md, the write-a-screen skill): <c>page-&lt;view&gt;</c>,
/// <c>nav-&lt;view&gt;</c>, <c>&lt;entity&gt;-list</c>, <c>&lt;entity&gt;-item</c>, <c>new-&lt;entity&gt;</c>, <c>open-&lt;entity&gt;</c>,
/// <c>&lt;entity&gt;-&lt;field&gt;</c>, <c>save-&lt;entity&gt;</c>, <c>set-&lt;field&gt;-&lt;value&gt;</c>, all lowercase kebab-case.
/// </summary>
public static partial class TestIdConvention
{

    public static bool IsValid(string id) => Shape().IsMatch(id);

    /// <summary>Whether an item builds something on screen, from its detail: such an item names its test ids.</summary>
    public static bool HasScreen(PlanItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return ScreenWords().IsMatch(item.Detail);
    }

    /// <summary>Every <c>data-testid="…"</c> written in the text (source files, or a search's output).</summary>
    public static IReadOnlySet<string> Found(string text) =>
        Written().Matches(text ?? "").Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);

    /// <summary>The words in an item's detail that say it builds something a person sees ("platform" is not a form).</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"\b(screens?|pages?|forms?|views?|buttons?|tabs?)\b|web/src|\.tsx\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex ScreenWords();

    [System.Text.RegularExpressions.GeneratedRegex("^[a-z][a-z0-9]*(-[a-z0-9]+)+$")]
    private static partial System.Text.RegularExpressions.Regex Shape();

    [System.Text.RegularExpressions.GeneratedRegex("data-testid=[\"']([a-z0-9-]+)[\"']")]
    private static partial System.Text.RegularExpressions.Regex Written();
}

/// <summary>One thing the idea asks for, in the idea's own words, as the planner extracted it.</summary>
public sealed partial record PlanRequirement(string Id, string Text)
{
    /// <summary>
    /// A clause quoted from the idea, read as a statement of its own: a leading "and", "then" or "also" dropped and its first
    /// letter capitalised, so "and the trip leader sees who is ready" reads "The trip leader sees who is ready". The words are
    /// the idea's, unchanged.
    /// </summary>
    public static string AsStatement(string text)
    {
        var t = Leading().Replace((text ?? "").Trim(), "");
        return t.Length == 0 ? t : char.ToUpperInvariant(t[0]) + t[1..];
    }

    /// <summary>
    /// Whether the words ask for something people do without signing in ("all without signing in", "with no account"). The
    /// platform's rule (ARCH-005): Edge admits only signed-in people with rights to a private or shared app, and making an app
    /// public is a person's act on its page; so such a requirement works only once the owner makes the app public, and is
    /// checked on the preview signed out (check_preview), never with a signed-in call (R2-11).
    /// </summary>
    public static bool NeedsNoSignIn(string? text) => NoSignIn().IsMatch(text ?? "");

    /// <summary>
    /// Whether the words are about how a screen presents something — what a view leads with, its layout, how it reads on a
    /// phone — rather than what the app does with data ("Make the trip leader's readiness view the product", "on their
    /// phone"). No call to the running app can show that: a call shows the data, never the screen. Such a requirement is
    /// shown by the screen's own test, which code runs itself (ARCH-006); a requirement about data never is. "View" counts
    /// as the noun ("the readiness view"), not the verb ("members view their bookings"); a phone number is data.
    /// </summary>
    public static bool IsAboutScreen(string? text) => !NeedsNoSignIn(text) && (Screen().IsMatch(text ?? "") || ViewNoun().IsMatch(text ?? ""));

    /// <summary>
    /// Whether the words ask for something a signed-in person makes or joins that is their own — joining a trip, signing up,
    /// registering, an RSVP, their own list or checklist (R3-5). Such a record must be found again when the person comes back,
    /// never made a second time, so the check of it comes back later: the same person, signed in afresh, does it again and
    /// reads it back, and code sees one record, not two (<c>EvaluationGate</c>, ARCH-006). Never a requirement for people who
    /// do not sign in.
    /// </summary>
    public static bool IsOwnRecord(string? text) => !NeedsNoSignIn(text) && OwnRecord().IsMatch(text ?? "");

    // Present forms only: "joins a trip" is the person doing it; "sees how many have joined" is somebody reading it.
    [System.Text.RegularExpressions.GeneratedRegex(@"\b(join(s|ing)?|sign(s|ing)? (themselves )?up|register(s|ing)?|enrol(l)?(s|ing)?|rsvps?|claim(s|ing)?|subscrib(e|es|ing)|check(s|ing)? in|book(s|ing)? (a|their|my|your) (place|spot|seat)|keep(s|ing)? (their|my|your|his|her) own|tick(s|ing)? off (their|my|your|his|her))\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex OwnRecord();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(screens?|pages?|layout|laid out|dashboards?|on (their|a|the|your|my|his|her|any) (phones?|mobiles?|tablets?)|phones?(?!\s+numbers?)|mobile(?!\s+numbers?)|tablets?|responsive|looks?|design(ed)?|styl(e|ed|ing)|themes?|dark mode|colou?rs?|fonts?|icons?|highlight(ed|s)?|prominent(ly)?|at a glance|front and cent(re|er)|the product)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex Screen();

    [System.Text.RegularExpressions.GeneratedRegex(@"(?<!\b(can|to|and|or|they|members|people|users|who|i|we|you|admins?|leaders?|owners?|divers?|players?|customers?|everyone|anyone)\s+)\bviews?\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex ViewNoun();

    /// <summary>What the owner is told when a plan builds something for people who do not sign in (R2-11).</summary>
    public const string PublicOnlyNote = "People can use it without signing in only once you make the app public, which only you can do on its page.";

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(without (signing|logging) (in|on|up)|without (an? |any )?(account|login|sign[- ]?in|registering|registration)|with no (account|login|sign[- ]?in)|no (account|login|sign[- ]?in) (needed|required)|(don't|do not|doesn't|does not|never) (need to |have to )?(sign|log) in|not signed in|signed[- ]out|anonymous(ly)?)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex NoSignIn();

    /// <summary>An example or a qualifier cut off from the statement it belongs to ("as a line above the list", "for example …").</summary>
    public static bool IsFragment(string text) => Qualifier().IsMatch((text ?? "").Trim());

    [System.Text.RegularExpressions.GeneratedRegex(@"^(and|then|also|plus)\s+", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex Leading();

    [System.Text.RegularExpressions.GeneratedRegex(@"^[""“'(]*(for example|for instance|e\.g\.?|i\.e\.?|such as|like|as an?|as the|so that|including|which|where)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex Qualifier();
}

/// <summary>A requirement the plan deliberately does not build, and why — shown to the owner.</summary>
public sealed record PlanLeftOut(string Requirement, string Reason);

/// <summary>
/// The contract a piece of work starts as (the build plan's part 4): what will be made and how each item will be
/// checked. Stored as <c>plan.proposed</c>, and what the evaluator marks against. A factory plan is also a faithful
/// contract with the idea: <see cref="Requirements"/> are what the idea asks for in its own words, every one is
/// covered by an item or listed in <see cref="LeftOut"/> with a reason, and <see cref="Faults(string?)"/> refuses
/// anything else.
/// </summary>
public sealed partial record PlanContract(string Summary, IReadOnlyList<PlanItem> Items, IReadOnlyList<PlanRequirement>? Requirements = null, IReadOnlyList<PlanLeftOut>? LeftOut = null)
{
    public const int MaxItems = 30;
    public const int MaxRequirements = 30;

    /// <summary>The share of a requirement's words that must appear in the idea: requirements are quoted, not invented.</summary>
    public const double OwnWordsShare = 0.6;

    public IReadOnlyList<PlanRequirement> Requirements { get; init; } = Requirements ?? [];

    public IReadOnlyList<PlanLeftOut> LeftOut { get; init; } = LeftOut ?? [];

    public JsonObject ToJson() => new()
    {
        ["summary"] = Summary,
        ["requirements"] = RequirementsJson(),
        ["items"] = new JsonArray(Items.Select(i => (JsonNode)new JsonObject
        {
            ["id"] = i.Id,
            ["text"] = i.Text,
            ["detail"] = i.Detail,
            ["check"] = i.Check,
            ["covers"] = Strings(i.Covers),
            ["testIds"] = Strings(i.TestIds),
        }).ToArray()),
        ["leftOut"] = new JsonArray(LeftOut.Select(l => (JsonNode)new JsonObject { ["requirement"] = l.Requirement, ["reason"] = l.Reason }).ToArray()),
    };

    /// <summary>
    /// The shape of <c>plan.proposed</c> and <c>plan.accepted</c> (ARCH-004): <c>{ summary, requirements: [{ id, text }],
    /// items: [{ id, text, detail, check, covers[] }], leftOut: [{ requirement, text, reason }] }</c>. Normal mode reads
    /// <c>summary</c>, the requirements, each item's <c>text</c> and what was left out; <c>detail</c> and <c>check</c> are technical.
    /// </summary>
    public JsonObject ToEvent() => new()
    {
        ["summary"] = Summary,
        ["requirements"] = RequirementsJson(),
        ["items"] = new JsonArray(Items.Select(i => (JsonNode)new JsonObject
        {
            ["id"] = i.Id,
            ["text"] = i.Text,
            ["detail"] = i.Detail,
            ["check"] = i.Check,
            ["covers"] = Strings(i.Covers),
            ["testIds"] = Strings(i.TestIds),
        }).ToArray()),
        ["leftOut"] = new JsonArray(LeftOut.Select(l => (JsonNode)new JsonObject
        {
            ["requirement"] = l.Requirement,
            ["text"] = Requirements.FirstOrDefault(r => r.Id == l.Requirement)?.Text ?? "",
            ["reason"] = l.Reason,
        }).ToArray()),
    };

    /// <summary>A plan read back from a <c>plan.proposed</c> event, in its event shape or the older <c>{ plan }</c> one.</summary>
    public static PlanContract? FromEvent(JsonObject? payload)
    {
        if (payload?["plan"] is JsonObject older)
        {
            return FromJson(older);
        }

        return payload is null || payload["items"] is not JsonArray ? null : FromJson(payload);
    }

    /// <summary>Read from a tool call, the journal or an event; an older item's <c>deliverable</c> is its text and detail.</summary>
    public static PlanContract? FromJson(JsonObject? o)
    {
        if (o is null)
        {
            return null;
        }

        var items = (o["items"] as JsonArray ?? []).OfType<JsonObject>()
            .Select((i, n) =>
            {
                var text = Json.Str(i, "text") ?? Json.Str(i, "deliverable") ?? "";
                var detail = Json.Str(i, "detail") ?? Json.Str(i, "deliverable") ?? text;
                return new PlanItem(Json.Str(i, "id") is { Length: > 0 } id ? id : $"item-{n + 1}", text, detail, Json.Str(i, "check") ?? "", Json.Strings(i, "covers"))
                {
                    TestIds = Json.Strings(i, "testIds").Select(t => t.Trim()).Where(t => t.Length > 0).Distinct(StringComparer.Ordinal).ToList(),
                };
            })
            .ToList();
        var requirements = (o["requirements"] as JsonArray ?? []).OfType<JsonObject>()
            .Select((r, n) => new PlanRequirement(Json.Str(r, "id") is { Length: > 0 } id ? id : $"r{n + 1}", PlanRequirement.AsStatement(Json.Str(r, "text") ?? "")))
            .ToList();
        var leftOut = (o["leftOut"] as JsonArray ?? []).OfType<JsonObject>()
            .Select(l => new PlanLeftOut(Json.Str(l, "requirement") ?? "", Json.Str(l, "reason") ?? ""))
            .ToList();
        return new PlanContract(Json.Str(o, "summary") ?? "", items, requirements, leftOut);
    }

    /// <summary>Every fault that stops this being a contract, as sentences the model can act on.</summary>
    public IReadOnlyList<string> Faults() => Faults(null);

    /// <summary>
    /// Every fault that stops this being a contract. Given the idea (a factory plan), the plan must also be faithful
    /// to it: requirements quoted from the idea, each covered by an item or left out with a reason, and every item's
    /// text plain words for the owner with the technical detail kept apart.
    /// </summary>
    public IReadOnlyList<string> Faults(string? idea)
    {
        var faults = new List<string>();
        if (string.IsNullOrWhiteSpace(Summary))
        {
            faults.Add("The plan needs a one-paragraph summary.");
        }

        if (Items.Count == 0)
        {
            faults.Add("The plan needs at least one item.");
        }

        if (Items.Count > MaxItems)
        {
            faults.Add($"The plan has {Items.Count} items; at most {MaxItems}. Group related work.");
        }

        foreach (var item in Items)
        {
            if (string.IsNullOrWhiteSpace(item.Text))
            {
                faults.Add($"Item '{item.Id}' does not say what will be made.");
            }

            if (string.IsNullOrWhiteSpace(item.Check))
            {
                faults.Add($"Item '{item.Id}' does not say how it will be checked: name the test, command or observable behaviour.");
            }
        }

        if (Items.Select(i => i.Id).Distinct(StringComparer.Ordinal).Count() != Items.Count)
        {
            faults.Add("Two items share an id.");
        }

        if (idea is not null)
        {
            faults.AddRange(Faithfulness(idea));
        }

        return faults;
    }

    private List<string> Faithfulness(string idea)
    {
        var faults = new List<string>();
        if (Requirements.Count == 0)
        {
            faults.Add("List the idea's requirements first: every distinct thing the idea asks for, each quoted in the idea's own words, with an id (r1, r2, …).");
            return faults;
        }

        if (Requirements.Count > MaxRequirements)
        {
            faults.Add($"The plan lists {Requirements.Count} requirements; at most {MaxRequirements}.");
        }

        if (Requirements.Select(r => r.Id).Distinct(StringComparer.Ordinal).Count() != Requirements.Count)
        {
            faults.Add("Two requirements share an id.");
        }

        var ideaWords = Words(idea).ToHashSet(StringComparer.Ordinal);
        foreach (var requirement in Requirements)
        {
            var words = Words(requirement.Text).ToList();
            if (words.Count == 0)
            {
                faults.Add($"Requirement '{requirement.Id}' is empty: quote what the idea asks for.");
                continue;
            }

            // A requirement is a whole statement the person made (D83): an example or a qualifier split off by a comma is not
            // something an app can be shown doing, and the checker counted it as a requirement not met.
            if (PlanRequirement.IsFragment(requirement.Text))
            {
                faults.Add($"Requirement '{requirement.Id}' (\"{requirement.Text}\") is part of another statement, not one of its own: keep an example or a qualifier (\"as …\", \"for example …\", \"such as …\") with the statement it belongs to, as one requirement.");
                continue;
            }

            var share = words.Count(ideaWords.Contains) / (double)words.Count;
            if (share < OwnWordsShare)
            {
                faults.Add($"Requirement '{requirement.Id}' (\"{requirement.Text}\") is not in the idea's own words: quote the idea, do not paraphrase or add to it.");
            }
        }

        var known = Requirements.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var item in Items)
        {
            if (item.Covers.Count == 0)
            {
                faults.Add($"Item '{item.Id}' covers no requirement: say which requirement ids it delivers in covers.");
            }

            foreach (var unknown in item.Covers.Where(c => !known.Contains(c)))
            {
                faults.Add($"Item '{item.Id}' covers '{unknown}', which is not one of the requirements ({string.Join(", ", known)}).");
            }

            if (item.TestIds.FirstOrDefault(t => !TestIdConvention.IsValid(t)) is { } badId)
            {
                faults.Add($"Item '{item.Id}' names the test id '{badId}', which is not in the kit's form: lowercase kebab-case such as page-home, book-list, book-item, new-book, book-title, save-book, set-status-finished.");
            }
            else if (item.TestIds.Count == 0 && TestIdConvention.HasScreen(item))
            {
                faults.Add($"Item '{item.Id}' builds something on screen but names no test ids: list in testIds every data-testid its screens carry, by the kit's convention (page-<view>, nav-<view>, <entity>-list, <entity>-item, new-<entity>, open-<entity>, <entity>-<field>, save-<entity>, set-<field>-<value>).");
            }

            // Something people do without signing in is checked as they would do it: signed out, on the preview (R2-11). A check
            // that names only signed-in calls can never show it, and fails every repair round.
            var signedOut = item.Covers.Select(c => Requirements.FirstOrDefault(r => r.Id == c)).Any(r => r is not null && PlanRequirement.NeedsNoSignIn(r.Text));
            if (signedOut && !SignedOutCheck().IsMatch(item.Check ?? ""))
            {
                faults.Add($"Item '{item.Id}' delivers something people do without signing in, so its check must be made signed out: say in check which calls are made with check_preview (signed out) and what they answer. A private app admits only people who are signed in; this works for others once the owner makes the app public, which only a person can do.");
            }

            if (OwnerText.Technical(item.Text) is { Count: > 0 } technical)
            {
                faults.Add($"Item '{item.Id}' text names technical detail ({string.Join(", ", technical.Take(4))}): say in plain words what the owner gets, and put files, endpoints and entities in detail.");
            }
        }

        if (OwnerText.Technical(Summary) is { Count: > 0 } inSummary)
        {
            faults.Add($"The summary names technical detail ({string.Join(", ", inSummary.Take(4))}): it is read by the owner; say what will be built in plain words.");
        }

        var covered = Items.SelectMany(i => i.Covers).ToHashSet(StringComparer.Ordinal);
        foreach (var left in LeftOut)
        {
            if (!known.Contains(left.Requirement))
            {
                faults.Add($"leftOut names '{left.Requirement}', which is not one of the requirements.");
            }
            else if (covered.Contains(left.Requirement))
            {
                faults.Add($"Requirement '{left.Requirement}' is both covered by an item and left out; it is one or the other.");
            }

            if (string.IsNullOrWhiteSpace(left.Reason))
            {
                faults.Add($"Requirement '{left.Requirement}' is left out without a reason; the owner is told why.");
            }
        }

        var leftOut = LeftOut.Select(l => l.Requirement).ToHashSet(StringComparer.Ordinal);
        foreach (var missing in Requirements.Where(r => !covered.Contains(r.Id) && !leftOut.Contains(r.Id)))
        {
            faults.Add($"Requirement '{missing.Id}' (\"{missing.Text}\") is covered by no item: add an item that delivers it, or list it in leftOut with the reason the owner will read.");
        }

        return faults;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"check_preview|signed[- ]out", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex SignedOutCheck();

    public string Render()
    {
        var lines = Items.Select(i => $"- [{i.Id}] {i.Deliverable} — checked by: {i.Check}{(i.Covers.Count > 0 ? $" (delivers {string.Join(", ", i.Covers)})" : "")}{(i.TestIds.Count > 0 ? $" (test ids: {string.Join(", ", i.TestIds)})" : "")}");
        var requirements = Requirements.Count == 0 ? "" : "\nRequirements:\n" + string.Join('\n', Requirements.Select(r => $"- {r.Id}: {r.Text}")) + "\n";
        var left = LeftOut.Count == 0 ? "" : "\nLeft out:\n" + string.Join('\n', LeftOut.Select(l => $"- {l.Requirement}: {l.Reason}"));
        return $"{Summary}\n{requirements}{string.Join('\n', lines)}{left}";
    }

    /// <summary>The plan as the owner reads it: requirements, what each item gives them, and what was left out and why. No technical detail.</summary>
    public string ForOwner()
    {
        var items = string.Join(" ", Items.Select((i, n) => $"{n + 1}. {i.Text.TrimEnd('.')}."));
        var left = LeftOut.Count == 0 ? "" : " Left out: " + string.Join(" ", LeftOut.Select(l => $"{Requirements.FirstOrDefault(r => r.Id == l.Requirement)?.Text ?? l.Requirement} — {l.Reason.TrimEnd('.')}."));
        return $"{Summary.TrimEnd()} {items}{left}".Trim();
    }

    /// <summary>The requirements an item delivers, with their text.</summary>
    public IReadOnlyList<PlanRequirement> RequirementsOf(PlanItem item) =>
        Requirements.Where(r => item.Covers.Contains(r.Id, StringComparer.Ordinal)).ToList();

    private JsonArray RequirementsJson() => new(Requirements.Select(r => (JsonNode)new JsonObject { ["id"] = r.Id, ["text"] = r.Text }).ToArray());

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode)v).ToArray());

    private static readonly HashSet<string> Stop = new(StringComparer.Ordinal)
    {
        "the", "and", "for", "are", "can", "with", "their", "they", "them", "that", "this", "from", "into", "when", "what",
        "who", "how", "has", "have", "its", "it's", "our", "your", "you", "will", "should", "must", "each", "any", "all",
        "app", "lets", "let", "allow", "allows", "able", "want", "wants", "who's", "been", "being", "than", "then", "there",
        "also", "use", "uses", "using", "via", "per", "one", "see", "sees",
    };

    /// <summary>The words that carry meaning, lower-cased, a plural or "-ing" folded so "books" matches "book".</summary>
    private static IEnumerable<string> Words(string text)
    {
        foreach (var raw in WordPattern().Matches(text.ToLowerInvariant()).Select(m => m.Value))
        {
            if (raw.Length < 3 || Stop.Contains(raw))
            {
                continue;
            }

            yield return Fold(raw);
        }
    }

    private static string Fold(string word) =>
        word.EndsWith("ies", StringComparison.Ordinal) && word.Length > 4 ? word[..^3] + "y"
        : word.EndsWith("ing", StringComparison.Ordinal) && word.Length > 5 ? word[..^3]
        : word.EndsWith("es", StringComparison.Ordinal) && word.Length > 4 && "sxz".Contains(word[^3], StringComparison.Ordinal) ? word[..^2]
        : word.EndsWith('s') && !word.EndsWith("ss", StringComparison.Ordinal) && word.Length > 3 ? word[..^1]
        : word;

    [System.Text.RegularExpressions.GeneratedRegex(@"[a-z0-9']+")]
    private static partial System.Text.RegularExpressions.Regex WordPattern();
}

/// <summary>The agent's own mark against a plan item. The evaluator's marks are separate events.</summary>
public sealed record PlanMark(string ItemId, string Status, string Evidence);

/// <summary>
/// <c>propose_plan</c>: emits the contract as <c>plan.proposed</c>, before any edit. Given the idea (the factory's
/// planner), the contract must be faithful to it — requirements quoted from the idea, each delivered by an item or
/// left out with a reason — and a plan that is not is refused with every fault, so the planner corrects it.
/// </summary>
public sealed class ProposePlanTool(string? idea = null) : ITool
{
    public string Name => "propose_plan";

    public string Description => idea is null
        ? "Propose the plan for this work as a contract: a summary, then items, each saying what will be made and how it will be checked (a test, a command, an observable behaviour). Call it once you have explored and before changing any file."
        : "Propose the plan as a contract with the idea: first every requirement the idea states, quoted in its own words; then items, each with plain text for the owner, the technical detail, how it will be checked, and which requirements it covers; and any requirement you deliberately leave out, with the reason the owner will read. Every requirement must be covered or left out.";

    public JsonObject Parameters
    {
        get
        {
            var item = new JsonObject
            {
                ["id"] = Schema.Str("A short id, for example 'readings-api'."),
                ["deliverable"] = Schema.Str("What will exist when this item is done."),
                ["check"] = Schema.Str("How it will be checked."),
            };
            if (idea is null)
            {
                return Schema.Object(new JsonObject
                {
                    ["summary"] = Schema.Str("What will be built and the approach, in a short paragraph."),
                    ["items"] = new JsonObject { ["type"] = "array", ["description"] = "The contract items.", ["items"] = Schema.Object(item, "id", "deliverable", "check") },
                }, "summary", "items");
            }

            item.Remove("deliverable");
            item["text"] = Schema.Str("What the owner gets, in one plain sentence: no file names, endpoints, code or technical words.");
            item["detail"] = Schema.Str("How it is built, for the builder and technical mode: entities, endpoints, screens, files.");
            item["check"] = Schema.Str("How it will be checked: the test that will pass, and the call to the running app (signed in) and its expected answer.");
            item["covers"] = Schema.Strings("The ids of the requirements this item delivers (at least one).");
            item["testIds"] = Schema.Strings("Every data-testid this item's screens carry, by the app kit's convention: page-<view>, nav-<view>, <entity>-list, <entity>-item, new-<entity>, open-<entity>, <entity>-<field>, save-<entity>, set-<field>-<value> (lowercase kebab-case; e.g. page-home, book-list, book-item, new-book, book-title, save-book, set-status-finished). Empty for an item with nothing on screen.");
            return Schema.Object(new JsonObject
            {
                ["summary"] = Schema.Str("What will be built, in two or three plain sentences for the owner."),
                ["requirements"] = new JsonObject
                {
                    ["type"] = "array",
                    ["description"] = "Every distinct thing the idea asks for, each quoted in the idea's own words. Leave none out here, even one you will not build.",
                    ["items"] = Schema.Object(new JsonObject { ["id"] = Schema.Str("r1, r2, …"), ["text"] = Schema.Str("The requirement, in the idea's own words.") }, "id", "text"),
                },
                ["items"] = new JsonObject { ["type"] = "array", ["description"] = "The contract items, in build order.", ["items"] = Schema.Object(item, "id", "text", "detail", "check", "covers") },
                ["leftOut"] = new JsonObject
                {
                    ["type"] = "array",
                    ["description"] = "Requirements deliberately not built, each with the reason the owner will read. Usually empty.",
                    ["items"] = Schema.Object(new JsonObject { ["requirement"] = Schema.Str("The requirement's id."), ["reason"] = Schema.Str("Why it is left out, in plain words.") }, "requirement", "reason"),
                },
            }, "summary", "requirements", "items");
        }
    }

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var plan = PlanContract.FromJson(call.Arguments)!;
        if (plan.Faults(idea) is { Count: > 0 } faults)
        {
            return ToolOutcome.Error("The plan is not a contract yet: " + string.Join(" ", faults) + " Send propose_plan again with all of it fixed.", "bad_arguments");
        }

        var state = call.Context.State;
        state.Plan = plan;
        var proposed = plan.ToEvent();
        proposed["callId"] = call.CallId;
        await call.Context.Events.WriteAsync(HarnessEvents.PlanProposed, proposed, cancellationToken);
        if (call.Context.Agent.AutoAcceptPlan)
        {
            state.PlanAccepted = true;
            var accepted = plan.ToEvent();
            accepted["by"] = "auto-mode";
            await call.Context.Events.WriteAsync(HarnessEvents.PlanAccepted, accepted, cancellationToken);
            return new ToolOutcome($"Plan accepted ({plan.Items.Count} items). Carry it out item by item; call mark_item as each one is done and checked.");
        }

        return new ToolOutcome($"Plan recorded ({plan.Items.Count} items). Finish now with a short summary; the plan will be reviewed before any change is made.");
    }
}

/// <summary><c>mark_item</c>: the agent marks its own progress against the plan.</summary>
public sealed class MarkItemTool : ITool
{
    public string Name => "mark_item";

    public string Description => "Mark a plan item done or blocked once you have checked it, with the evidence (the command you ran and what it showed).";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["id"] = Schema.Str("The plan item's id."),
        ["status"] = Schema.Enum("Its status.", "done", "blocked"),
        ["evidence"] = Schema.Str("What shows it: a command and its result, or why it is blocked."),
    }, "id", "status", "evidence");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var state = call.Context.State;
        if (state.Plan is null)
        {
            return ToolOutcome.Error("There is no plan to mark yet. Call propose_plan first.", "bad_arguments");
        }

        var id = Json.Str(call.Arguments, "id") ?? "";
        if (state.Plan.Items.All(i => i.Id != id))
        {
            return ToolOutcome.Error($"No plan item is called '{id}'. The items are: {string.Join(", ", state.Plan.Items.Select(i => i.Id))}.", "bad_arguments");
        }

        var status = Json.Str(call.Arguments, "status") is "blocked" ? "blocked" : "done";
        var mark = new PlanMark(id, status, Json.Str(call.Arguments, "evidence") ?? "");
        state.Marks[id] = mark;
        await call.Context.Events.WriteAsync(HarnessEvents.Message, new JsonObject { ["kind"] = "plan.mark", ["item"] = id, ["status"] = status, ["evidence"] = OutputText.Truncate(mark.Evidence, 2000) }, cancellationToken);
        var left = state.Plan.Items.Count(i => !state.Marks.ContainsKey(i.Id));
        return new ToolOutcome($"Marked {id} {status}. {left} item{(left == 1 ? "" : "s")} left.");
    }
}
