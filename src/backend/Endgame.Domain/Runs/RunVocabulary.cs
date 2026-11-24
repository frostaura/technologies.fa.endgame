namespace Endgame.Domain.Runs;

/// <summary>Every status column's allowed values. Each set is also a database check constraint.</summary>
public static class RunStatuses
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Paused = "paused";
    public const string WaitingApproval = "waiting_approval";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static readonly IReadOnlyList<string> All = [Queued, Running, Paused, WaitingApproval, Succeeded, Failed, Cancelled];

    public static readonly IReadOnlyList<string> Terminal = [Succeeded, Failed, Cancelled];

    public static bool IsTerminal(string status) => Terminal.Contains(status);
}

public static class RunKinds
{
    public const string Research = "research";
    public const string Conversation = "conversation";
    public const string Build = "build";
    public const string Task = "task";
    public const string Review = "review";

    public static readonly IReadOnlyList<string> All = [Research, Conversation, Build, Task, Review];
}

/// <summary>The run log's event types (ARCH-004, <i>Run log</i>).</summary>
public static class RunEventTypes
{
    public const string RunStarted = "run.started";
    public const string RunPaused = "run.paused";
    public const string RunResumed = "run.resumed";
    public const string RunFinished = "run.finished";
    public const string ModelRequested = "model.requested";
    public const string ModelReplied = "model.replied";
    public const string ApprovalRequested = "approval.requested";
    public const string ApprovalAnswered = "approval.answered";
    public const string TaskCreated = "task.created";
    public const string TaskClaimed = "task.claimed";
    public const string TaskDone = "task.done";
    public const string TaskFailed = "task.failed";
    public const string Message = "message";

    public static readonly IReadOnlyList<string> All =
    [
        RunStarted, RunPaused, RunResumed, RunFinished,
        "plan.proposed", "plan.accepted",
        TaskCreated, TaskClaimed, TaskDone, TaskFailed,
        ModelRequested, ModelReplied,
        "tool.requested", "tool.permitted", "tool.denied", "tool.result",
        "subagent.started", "subagent.finished",
        ApprovalRequested, ApprovalAnswered,
        "evaluation.passed", "evaluation.failed",
        "estimate.made", "estimate.scored",
        Message,
    ];
}

public static class TaskStatuses
{
    public const string Todo = "todo";
    public const string InProgress = "in_progress";
    public const string Blocked = "blocked";
    public const string Done = "done";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static readonly IReadOnlyList<string> All = [Todo, InProgress, Blocked, Done, Failed, Cancelled];
}

public static class ApprovalStatuses
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";

    public static readonly IReadOnlyList<string> All = [Pending, Approved, Rejected];
}

public static class EmployeeStatuses
{
    public const string Idle = "idle";
    public const string Working = "working";
    public const string Paused = "paused";
    public const string Released = "released";

    public static readonly IReadOnlyList<string> All = [Idle, Working, Paused, Released];
}

/// <summary>An idea moves from research to a verdict to the owner's decision.</summary>
public static class IdeaStatuses
{
    public const string Researching = "researching";
    public const string AwaitingDecision = "awaiting_decision";
    public const string Building = "building";
    public const string Dropped = "dropped";

    public static readonly IReadOnlyList<string> All = [Researching, AwaitingDecision, Building, Dropped];
}

public static class Verdicts
{
    public const string Build = "build";
    public const string Change = "change";
    public const string DoNotBuild = "do-not-build";

    public static readonly IReadOnlyList<string> All = [Build, Change, DoNotBuild];
}

public static class IdeaDecisions
{
    public const string Build = "build";
    public const string Change = "change";
    public const string Overrule = "overrule";
    public const string Drop = "drop";

    public static readonly IReadOnlyList<string> All = [Build, Change, Overrule, Drop];

    /// <summary>Who decided: a person in the console, or auto-mode after a build verdict.</summary>
    public const string ByPerson = "person";
    public const string ByAutoMode = "auto-mode";

    public static readonly IReadOnlyList<string> Via = [ByPerson, ByAutoMode];

    /// <summary>
    /// Which decisions a verdict allows. Building over a "do not build" takes an explicit overrule, so
    /// the project records that it was overruled; an overrule of a verdict that already said build is
    /// meaningless and refused.
    /// </summary>
    public static bool IsAllowed(string decision, string verdict) => decision switch
    {
        Build => verdict is Verdicts.Build or Verdicts.Change,
        Overrule => verdict == Verdicts.DoNotBuild,
        Change or Drop => true,
        _ => false,
    };
}
