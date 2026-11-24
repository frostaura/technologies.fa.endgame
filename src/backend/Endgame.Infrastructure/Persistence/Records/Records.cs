namespace Endgame.Infrastructure.Persistence.Records;

/// <summary>A role granted to a person at one node of the cascade.</summary>
public sealed class MembershipRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Role { get; set; } = "";

    public Guid? GrantedBy { get; set; }

    public DateTimeOffset GrantedAt { get; set; }
}

/// <summary>One value of one kind set at one node: a budget, a rule set, context, a setting or a secret.</summary>
public sealed class CascadeEntryRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Kind { get; set; } = "";

    public string Key { get; set; } = "";

    /// <summary>JSON. For a secret, only a marker; the value itself is in <see cref="ProtectedValue"/>.</summary>
    public string ValueJson { get; set; } = "null";

    /// <summary>A secret's value, encrypted with the platform's data-protection key ring. Never returned by any read.</summary>
    public string? ProtectedValue { get; set; }

    public Guid? SetBy { get; set; }

    public DateTimeOffset SetAt { get; set; }
}

/// <summary>A standing member of the agent workforce, placed at one node.</summary>
public sealed class EmployeeRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Name { get; set; } = "";

    public string Role { get; set; } = "";

    public string JobDescription { get; set; } = "";

    public string Status { get; set; } = "";

    /// <summary>The employee's own cap, in credits per calendar month. Null when the cascade above it is the only limit.</summary>
    public decimal? MonthlyCreditLimit { get; set; }

    public int RunsFinished { get; set; }

    public int RunsSucceeded { get; set; }

    public Guid? CurrentRunId { get; set; }

    public Guid? LastRunId { get; set; }

    public DateTimeOffset? LastActiveAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class RunRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Kind { get; set; } = "";

    public string Status { get; set; } = "";

    public string Title { get; set; } = "";

    public Guid? EmployeeId { get; set; }

    public Guid? IdeaId { get; set; }

    public Guid? ConversationId { get; set; }

    public Guid? ParentRunId { get; set; }

    public string? LeaseHolder { get; set; }

    public DateTimeOffset? LeaseExpiresAt { get; set; }

    /// <summary>The last sequence number assigned in this run's log. The next event gets this plus one.</summary>
    public long LastSeq { get; set; }

    /// <summary>Set once a model call for this run was refused for budget. Terminal: every later call is refused at once.</summary>
    public DateTimeOffset? BudgetExhaustedAt { get; set; }

    public string? Outcome { get; set; }

    public string? Summary { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? FinishedAt { get; set; }
}

/// <summary>One entry in a run's append-only log. <see cref="Seq"/> is assigned by the control plane, gapless per run.</summary>
public sealed class RunEventRecord
{
    public Guid OrganisationId { get; set; }

    public Guid RunId { get; set; }

    public long Seq { get; set; }

    public string Type { get; set; } = "";

    public DateTimeOffset At { get; set; }

    public string PayloadJson { get; set; } = "{}";
}

public sealed class TaskRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public Guid? RunId { get; set; }

    public Guid? ParentTaskId { get; set; }

    public string Title { get; set; } = "";

    public string Description { get; set; } = "";

    public string Status { get; set; } = "";

    public Guid? HolderRunId { get; set; }

    public Guid? HolderEmployeeId { get; set; }

    public DateTimeOffset? ClaimedAt { get; set; }

    public decimal? EstimateCredits { get; set; }

    public decimal? ActualCredits { get; set; }

    public Guid[] DependsOn { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class ApprovalRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid RunId { get; set; }

    public string Title { get; set; } = "";

    public string Detail { get; set; } = "";

    public string Status { get; set; } = "";

    public DateTimeOffset RequestedAt { get; set; }

    public DateTimeOffset? AnsweredAt { get; set; }

    public Guid? AnsweredBy { get; set; }

    public string? Comment { get; set; }
}

public sealed class IdeaRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Text { get; set; } = "";

    /// <summary>The owner's constraints, one per line.</summary>
    public string Constraints { get; set; } = "";

    public string Status { get; set; } = "";

    /// <summary>The research estimate shown before the research started (CLAUDE.md rule 11).</summary>
    public decimal ResearchEstimateCredits { get; set; }

    public string? Verdict { get; set; }

    public string? VerdictSummary { get; set; }

    public string? VerdictEvidenceJson { get; set; }

    public bool Overruled { get; set; }

    public string? Decision { get; set; }

    public string? DecisionNote { get; set; }

    public Guid? DecidedBy { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public Guid? ResearchRunId { get; set; }

    public Guid? BuildRunId { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ConversationRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public Guid? EmployeeId { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Guid? LastRunId { get; set; }
}

/// <summary>
/// One line of the one ledger. Append-only by database grant and trigger. A settlement or release
/// names the reservation it closes and copies its attribution, so every roll-up is a filter, not a join.
/// </summary>
public sealed class CreditEntryRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public string Kind { get; set; } = "";

    /// <summary>Credits, never negative. The kind gives the sign.</summary>
    public decimal Amount { get; set; }

    public Guid? ReservationId { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public Guid? EmployeeId { get; set; }

    public Guid? RunId { get; set; }

    public string? TaskType { get; set; }

    public string? Model { get; set; }

    /// <summary>False for an agent repairing its own failed work: recorded, never charged.</summary>
    public bool Billable { get; set; } = true;

    public decimal? CostUsd { get; set; }

    public string? GenerationId { get; set; }

    /// <summary>A reservation lapses at this moment unless its run's lease is still live.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public string? IdempotencyKey { get; set; }

    public string? Note { get; set; }

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Every operator (God-mode) action, readable by the organisation's Owner (CLAUDE.md rule 1).</summary>
public sealed class OperatorActionRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid OperatorUserId { get; set; }

    public string Action { get; set; } = "";

    public string DetailJson { get; set; } = "{}";

    public DateTimeOffset At { get; set; }
}
