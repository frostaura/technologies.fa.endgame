using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;

namespace Endgame.Harness.Planning;

/// <summary>One thing the work will make, and how it will be checked.</summary>
public sealed record PlanItem(string Id, string Deliverable, string Check);

/// <summary>
/// The contract a piece of work starts as (the build plan's part 4): what will be made and how each
/// item will be checked. Stored as <c>plan.proposed</c>, and what the evaluator marks against.
/// </summary>
public sealed record PlanContract(string Summary, IReadOnlyList<PlanItem> Items)
{
    public const int MaxItems = 30;

    public JsonObject ToJson() => new()
    {
        ["summary"] = Summary,
        ["items"] = new JsonArray(Items.Select(i => (JsonNode)new JsonObject { ["id"] = i.Id, ["deliverable"] = i.Deliverable, ["check"] = i.Check }).ToArray()),
    };

    public static PlanContract? FromJson(JsonObject? o)
    {
        if (o is null)
        {
            return null;
        }

        var items = (o["items"] as JsonArray ?? []).OfType<JsonObject>()
            .Select((i, n) => new PlanItem(Json.Str(i, "id") is { Length: > 0 } id ? id : $"item-{n + 1}", Json.Str(i, "deliverable") ?? "", Json.Str(i, "check") ?? ""))
            .ToList();
        return new PlanContract(Json.Str(o, "summary") ?? "", items);
    }

    /// <summary>Every fault that stops this being a contract, as sentences the model can act on.</summary>
    public IReadOnlyList<string> Faults()
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
            if (string.IsNullOrWhiteSpace(item.Deliverable))
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

        return faults;
    }

    public string Render()
    {
        var lines = Items.Select(i => $"- [{i.Id}] {i.Deliverable} — checked by: {i.Check}");
        return $"{Summary}\n{string.Join('\n', lines)}";
    }
}

/// <summary>The agent's own mark against a plan item. The evaluator's marks are separate events.</summary>
public sealed record PlanMark(string ItemId, string Status, string Evidence);

/// <summary><c>propose_plan</c>: emits the contract as <c>plan.proposed</c>, before any edit.</summary>
public sealed class ProposePlanTool : ITool
{
    public string Name => "propose_plan";

    public string Description => "Propose the plan for this work as a contract: a summary, then items, each saying what will be made and how it will be checked (a test, a command, an observable behaviour). Call it once you have explored and before changing any file.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["summary"] = Schema.Str("What will be built and the approach, in a short paragraph."),
        ["items"] = new JsonObject
        {
            ["type"] = "array",
            ["description"] = "The contract items.",
            ["items"] = Schema.Object(new JsonObject
            {
                ["id"] = Schema.Str("A short id, for example 'api-endpoint'."),
                ["deliverable"] = Schema.Str("What will exist when this item is done."),
                ["check"] = Schema.Str("How it will be checked."),
            }, "id", "deliverable", "check"),
        },
    }, "summary", "items");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var plan = PlanContract.FromJson(call.Arguments)!;
        if (plan.Faults() is { Count: > 0 } faults)
        {
            return ToolOutcome.Error("The plan is not a contract yet: " + string.Join(" ", faults) + " Send propose_plan again.", "bad_arguments");
        }

        var state = call.Context.State;
        state.Plan = plan;
        await call.Context.Events.WriteAsync(HarnessEvents.PlanProposed, new JsonObject { ["plan"] = plan.ToJson(), ["callId"] = call.CallId }, cancellationToken);
        if (call.Context.Agent.AutoAcceptPlan)
        {
            state.PlanAccepted = true;
            await call.Context.Events.WriteAsync(HarnessEvents.PlanAccepted, new JsonObject { ["by"] = "auto-mode", ["items"] = plan.Items.Count }, cancellationToken);
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
