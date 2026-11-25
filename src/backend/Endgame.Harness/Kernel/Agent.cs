using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness.Context;
using Endgame.Harness.Hooks;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Planning;
using Endgame.Harness.Skills;
using Endgame.Harness.Tasks;
using Endgame.Harness.Tools;

namespace Endgame.Harness;

/// <summary>
/// The limits ARCH-006 found ample: 50 steps and 16,000 output tokens. Hitting the step limit was
/// always a weak model looping.
/// </summary>
public sealed record AgentLimits
{
    public int MaxSteps { get; init; } = 50;

    /// <summary>Tool calls run per model turn; the rest are answered "not run".</summary>
    public int MaxToolCallsPerTurn { get; init; } = 16;

    public int MaxOutputTokens { get; init; } = 16_000;

    /// <summary>The same failing call with the same result this many times in a row stops the run early.</summary>
    public int MaxRepeatedFailures { get; init; } = 3;

    /// <summary>Corrective nudges for a tool call written as plain text.</summary>
    public int MaxTextToolNudges { get; init; } = 3;

    /// <summary>The fan-out cap: sub-agents one agent may start.</summary>
    public int MaxSubagents { get; init; } = 4;

    /// <summary>A credit ceiling for this agent alone (a sub-agent's budget slice), on top of the gateway's budgets.</summary>
    public decimal? CreditBudget { get; init; }
}

/// <summary>Everything that defines one agent in a run. A resumed run is rebuilt from the same definition plus its log.</summary>
public sealed record AgentDefinition
{
    /// <summary><c>main</c>, or a sub-agent's id; it tags every event the agent writes.</summary>
    public string Id { get; init; } = Events.HarnessEvents.MainAgent;

    /// <summary>The routing-table task type every model call is made under.</summary>
    public required string TaskType { get; init; }

    public required string Scope { get; init; }

    public Guid? RunId { get; init; }

    public Guid? EmployeeId { get; init; }

    public required string SystemPrompt { get; init; }

    public required ToolRegistry Tools { get; init; }

    public AgentLimits Limits { get; init; } = new();

    public PermissionPolicy Permissions { get; init; } = new();

    /// <summary>Repairing its own failed work: the gateway records it as not billable.</summary>
    public bool Repair { get; init; }

    public string AuthorName { get; init; } = "Endgame agent";

    public string AuthorEmail { get; init; } = "agent@endgame.local";

    public IReadOnlyList<IToolHook> ToolHooks { get; init; } = [];

    public IReadOnlyList<IStopHook> StopHooks { get; init; } = [new VerifyAfterEditStopHook()];

    /// <summary>A <c>run</c> command matching this counts as verification (build, test, lint).</summary>
    public Regex VerifyCommand { get; init; } = DefaultVerify;

    public CompactionOptions Compaction { get; init; } = new();

    /// <summary>A plan is accepted as soon as it is valid (auto-mode); otherwise the workflow accepts it.</summary>
    public bool AutoAcceptPlan { get; init; } = true;

    /// <summary>Task type for compaction summaries.</summary>
    public string SummaryTaskType { get; init; } = "summarise";

    public static readonly Regex DefaultVerify = new(@"\b(dotnet\s+(build|test|format)|npm\s+(run\s+)?(build|test|lint|typecheck)|vitest|tsc|make\s+(build|test|lint)|npx\s+(vitest|tsc|eslint))\b", RegexOptions.Compiled | RegexOptions.CultureInvariant);
}

/// <summary>What one agent knows, all of it rebuildable from the run log (<see cref="Replay"/>).</summary>
public sealed class AgentState
{
    public string AgentId { get; init; } = Events.HarnessEvents.MainAgent;

    public JsonArray Messages { get; set; } = [];

    public int Steps { get; set; }

    public int ToolCalls { get; set; }

    public int MalformedCalls { get; set; }

    public int UnknownToolCalls { get; set; }

    public int ToolErrors { get; set; }

    public int EditCalls { get; set; }

    public int FailedEdits { get; set; }

    public int DeniedCalls { get; set; }

    public int TextToolNudges { get; set; }

    public int Compactions { get; set; }

    public bool EditedSinceVerify { get; set; }

    public bool EverEdited { get; set; }

    public decimal SettledCredits { get; set; }

    public long PromptTokens { get; set; }

    public long CompletionTokens { get; set; }

    public long CachedTokens { get; set; }

    /// <summary>Server-side web searches this agent's calls made, as the provider reported them.</summary>
    public int Searches { get; set; }

    /// <summary>The addresses its replies cited, each once, in order.</summary>
    public List<string> Citations { get; } = [];

    /// <summary>The provider that served the run's first reply; every later call asks for it first (ARCH-006).</summary>
    public string? PinnedProvider { get; set; }

    public string? LastModel { get; set; }

    public PlanContract? Plan { get; set; }

    public bool PlanAccepted { get; set; }

    public Dictionary<string, PlanMark> Marks { get; } = new(StringComparer.Ordinal);

    /// <summary>Notes kept outside the context: they survive compaction and are read on demand.</summary>
    public List<string> Notes { get; } = [];

    public Dictionary<Guid, TaskInfo> Tasks { get; } = [];

    public HashSet<string> LoadedSkills { get; } = new(StringComparer.Ordinal);

    public List<string> Commits { get; } = [];

    public Dictionary<string, int> StopHookRuns { get; } = new(StringComparer.Ordinal);

    public int SubagentsStarted { get; set; }

    public string? LastFailureSignature { get; set; }

    public int RepeatedFailures { get; set; }

    public string? FinalText { get; set; }

    public string? StopReason { get; set; }

    /// <summary>Tool calls requested before a crash whose results were never recorded.</summary>
    public int InterruptedCalls { get; set; }

    public bool Started => Messages.Count > 0;
}

/// <summary>What the loop does between steps: carry on, or stop because the run was paused, cancelled or lost.</summary>
public enum RunSignal
{
    Continue,
    Pause,
    Cancel,
    LeaseLost,
}

/// <summary>Asked between steps. Production: the lease keeper, which learns pause and cancel from lease renewals.</summary>
public interface IRunControl
{
    ValueTask<RunSignal> CheckAsync(CancellationToken cancellationToken);
}

public sealed class AlwaysContinue : IRunControl
{
    public static readonly AlwaysContinue Instance = new();

    public ValueTask<RunSignal> CheckAsync(CancellationToken cancellationToken) => ValueTask.FromResult(RunSignal.Continue);
}

/// <summary>The services a run gives its agents.</summary>
public sealed record AgentServices
{
    public required IModelClient Model { get; init; }

    public RetryPolicy Retry { get; init; } = new();

    public IRunControl Control { get; init; } = AlwaysContinue.Instance;

    public IApprovalGate? Approvals { get; init; }

    public ISkillLibrary? Skills { get; init; }

    public ITaskBoard? Tasks { get; init; }

    /// <summary>Distinguishes this process's idempotency keys from a crashed one's.</summary>
    public string SessionNonce { get; init; } = Guid.NewGuid().ToString("N")[..8];
}

/// <summary>How an agent's session ended.</summary>
public sealed record AgentResult(string StopReason, string? FinalText, AgentState State)
{
    public bool Completed => StopReason is StopReasons.Completed or StopReasons.CompletedNoEdits;
}

/// <summary>Every way an agent's session can end.</summary>
public static class StopReasons
{
    public const string Completed = "completed";
    public const string CompletedNoEdits = "completed_no_edits";
    public const string MaxSteps = "max_steps";
    public const string RepeatedFailure = "repeated_failure";
    public const string BudgetExhausted = "budget_exhausted";
    public const string BudgetSliceSpent = "budget_slice_spent";
    public const string CeilingUnreachable = "ceiling_unreachable";
    public const string ModelError = "model_error";
    public const string RunClosed = "run_closed";
    public const string Paused = "paused";
    public const string Cancelled = "cancelled";
    public const string LeaseLost = "lease_lost";

    /// <summary>Stops that leave the run resumable rather than finished.</summary>
    public static bool IsSuspension(string reason) => reason is Paused or LeaseLost;
}
