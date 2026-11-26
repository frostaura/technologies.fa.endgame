using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Harness.Skills;
using Endgame.Runner.Platform;

namespace Endgame.Runner.Execution;

/// <summary>How a workflow ended.</summary>
public enum WorkflowEnd
{
    Succeeded,
    Failed,

    /// <summary>Paused by the owner, waiting for the owner (a do-not-build verdict, an estimate over budget), or the lease was lost: the run stays open and resumes later.</summary>
    Suspended,

    /// <summary>The owner cancelled; the control plane has already finished the run.</summary>
    Cancelled,

    /// <summary>
    /// The owner declined to start the work at its estimate (D19): not a failure, nothing done and nothing scored. The run
    /// finishes as <c>cancelled</c> with the reason <see cref="WorkflowOutcome.DeclinedReason"/>, until the control plane
    /// has an outcome of its own for it.
    /// </summary>
    Declined,
}

public sealed record WorkflowOutcome(WorkflowEnd End, string Summary)
{
    /// <summary>The workflow already told the owner how it ended (a milestone message): the Runner adds no closing message of its own.</summary>
    public bool Announced { get; init; }

    /// <summary>How the ending reads to the owner, in plain words, when <see cref="Summary"/> carries technical detail (it stays in <c>run.finished</c>).</summary>
    public string? ForOwner { get; init; }

    /// <summary>
    /// Technical detail of the ending — faults, refusals, what the gateway said — for technical mode only: written as
    /// <c>run.finished</c>'s <c>detail</c>, never in its summary, which normal mode shows as the outcome (D64).
    /// </summary>
    public string? Detail { get; init; }

    /// <summary>The reason a declined run's <c>run.finished</c> carries, so the console tells it from a cancel.</summary>
    public const string DeclinedReason = "declined_at_start";

    /// <summary>What the owner reads when no AI model could be reached.</summary>
    public const string UnreachableForOwner = "Endgame could not reach its AI models, so the work stopped before it was finished. What was done is kept; try again, and if it keeps happening, tell FrostAura.";

    /// <summary>A declined start: the summary begins "The owner declined to start", which the console keys on; the owner reads <paramref name="forOwner"/>.</summary>
    public static WorkflowOutcome Declined(string summary, string forOwner) => new(WorkflowEnd.Declined, summary) { ForOwner = forOwner };

    /// <summary>No model could be reached: said plainly, with what the gateway answered kept for technical mode.</summary>
    public static WorkflowOutcome Unreachable(string forOwner, string? detail) =>
        new(WorkflowEnd.Failed, forOwner) { ForOwner = forOwner, Detail = detail };

    public static WorkflowOutcome Success(string summary) => new(WorkflowEnd.Succeeded, summary);

    public static WorkflowOutcome Failure(string summary) => new(WorkflowEnd.Failed, summary);

    public static WorkflowOutcome Suspend(string why) => new(WorkflowEnd.Suspended, why);

    /// <summary>The workflow-level meaning of an agent stopping the way it did.</summary>
    public static WorkflowOutcome? FromAgent(AgentResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.StopReason switch
        {
            StopReasons.Paused or StopReasons.LeaseLost => Suspend(result.StopReason),
            StopReasons.Cancelled or StopReasons.RunClosed => new WorkflowOutcome(WorkflowEnd.Cancelled, result.StopReason),
            StopReasons.BudgetExhausted => Failure("The credit budget ran out, so the work stopped. Top up or raise the budget, then try it again; what was finished is kept."),
            StopReasons.ModelUnreachable => Unreachable(UnreachableForOwner, result.FinalText),
            _ => null,
        };
    }
}

/// <summary>One kind of run's deterministic procedure: code owns the loops, gates and stop conditions; agents supply judgement.</summary>
public interface IWorkflow
{
    string Kind { get; }

    Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken);
}

/// <summary>Everything a workflow needs for one run.</summary>
public sealed class RunContext
{
    public required RunInfo Run { get; init; }

    public required string Holder { get; init; }

    public required ControlPlaneClient ControlPlane { get; init; }

    public required IEventSink Sink { get; init; }

    public required IRunLogReader LogReader { get; init; }

    /// <summary>The whole log as it stood when this process took the run: what replay works from.</summary>
    public required IReadOnlyList<RunEvent> History { get; init; }

    public required IRunControl Control { get; init; }

    public required IModelClient Model { get; init; }

    public required IWorkspaceProvider Workspaces { get; init; }

    public required RunnerOptions Options { get; init; }

    public required AgentFactory Agents { get; init; }

    public required JsonObject Context { get; init; }

    public DockClient? Dock { get; init; }

    public ISkillLibrary? Skills { get; init; }

    public TimeProvider Clock { get; init; } = TimeProvider.System;

    public Func<DateTimeOffset> LeaseExpiry { get; init; } = () => DateTimeOffset.UtcNow.AddMinutes(2);

    public required WorkflowJournal Journal { get; init; }

    /// <summary>The milestones told to the owner in this process, so each is said once.</summary>
    public HashSet<string> Said { get; } = new(StringComparer.Ordinal);

    /// <summary>The services every agent of this run shares.</summary>
    public AgentServices Services(bool withTasks = true) => new()
    {
        Model = Model,
        Control = Control,
        Approvals = new ControlPlaneApprovals(ControlPlane, Run.Id),
        Skills = Skills,
        Tasks = withTasks ? new ControlPlaneTaskBoard(ControlPlane, Run.Scope, Run.Id, Run.EmployeeId) : null,
    };

    /// <summary>The id of the tree node at a level of the run's scope (organisation, division, project, app).</summary>
    public Guid? LevelId(string level) =>
        (Context["levels"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(l => Json.Str(l, "level") == level) is { } node && Guid.TryParse(Json.Str(node, "id"), out var id) ? id : null;

    public Guid OrganisationId => LevelId("organisation") ?? throw new InvalidOperationException("The run's scope has no organisation.");

    /// <summary>A cascade setting's effective value, or null.</summary>
    public JsonNode? Setting(string key) =>
        (Context["settings"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(s => Json.Str(s, "key") == key)?["value"];

    /// <summary>The owner's first message on the run: the idea, the request, the question.</summary>
    public JsonObject? OwnerMessage() =>
        History.FirstOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "from") == "owner")?.Payload;

    public Task<IReadOnlyList<RunEvent>> AppendAsync(string type, JsonObject payload, CancellationToken cancellationToken) =>
        Sink.AppendAsync([new RunEvent(type, payload)], cancellationToken);
}

/// <summary>
/// The workflow's own decisions in the run log (<c>message</c> events of kind <c>workflow.step</c>),
/// so a resumed workflow skips what it already did and takes the same branches again.
/// </summary>
public sealed class WorkflowJournal(IReadOnlyList<RunEvent> history, IEventSink sink)
{
    public const string Agent = "workflow";

    private readonly Dictionary<string, JsonObject> steps = history
        .Where(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "kind") == MessageKinds.Workflow)
        .GroupBy(e => Json.Str(e.Payload, "step") ?? "")
        .ToDictionary(g => g.Key, g => g.Last().Payload["data"] as JsonObject ?? [], StringComparer.Ordinal);

    public JsonObject? Get(string step) => steps.GetValueOrDefault(step);

    public bool Done(string step) => steps.ContainsKey(step);

    public async Task<JsonObject> RecordAsync(string step, JsonObject data, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(data);
        await new AgentEventWriter(sink, Agent).WriteAsync(HarnessEvents.Message, new JsonObject
        {
            ["kind"] = MessageKinds.Workflow,
            ["step"] = step,
            ["data"] = data.DeepClone(),
        }, cancellationToken);
        steps[step] = data;
        return data;
    }

    /// <summary>The recorded result of a step, or the step run now and recorded.</summary>
    public async Task<JsonObject> OnceAsync(string step, Func<Task<JsonObject>> work, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(work);
        return Get(step) ?? await RecordAsync(step, await work(), cancellationToken);
    }
}
