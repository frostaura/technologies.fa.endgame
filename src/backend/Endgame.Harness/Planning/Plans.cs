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
}

/// <summary>One thing the idea asks for, in the idea's own words, as the planner extracted it.</summary>
public sealed record PlanRequirement(string Id, string Text);

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
                return new PlanItem(Json.Str(i, "id") is { Length: > 0 } id ? id : $"item-{n + 1}", text, detail, Json.Str(i, "check") ?? "", Json.Strings(i, "covers"));
            })
            .ToList();
        var requirements = (o["requirements"] as JsonArray ?? []).OfType<JsonObject>()
            .Select((r, n) => new PlanRequirement(Json.Str(r, "id") is { Length: > 0 } id ? id : $"r{n + 1}", Json.Str(r, "text") ?? ""))
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

    public string Render()
    {
        var lines = Items.Select(i => $"- [{i.Id}] {i.Deliverable} — checked by: {i.Check}{(i.Covers.Count > 0 ? $" (delivers {string.Join(", ", i.Covers)})" : "")}");
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
