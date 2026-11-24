namespace Endgame.Infrastructure.Persistence.Records;

/// <summary>
/// A need for a hire, held until it is accepted, edited or declined: the drafted job description, the
/// expected monthly cost and why. Placed at the node the employee would work at.
/// </summary>
public sealed class HireProposalRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Status { get; set; } = "";

    public string Trigger { get; set; } = "";

    /// <summary>The need's identity, so the same need raised twice is one proposal (for example <c>stage:building:&lt;project id&gt;</c>).</summary>
    public string? NeedKey { get; set; }

    public string Reason { get; set; } = "";

    public string Name { get; set; } = "";

    public string Role { get; set; } = "";

    public string Mandate { get; set; } = "";

    public string[] Tools { get; set; } = [];

    public string[] Services { get; set; } = [];

    public decimal? MonthlyCreditLimit { get; set; }

    public string? ModelTier { get; set; }

    public Guid? ReportsToId { get; set; }

    public decimal ExpectedMonthlyCredits { get; set; }

    /// <summary>For a promotion: the contractor role that kept recurring.</summary>
    public string? ContractorRole { get; set; }

    public Guid? RaisedByUserId { get; set; }

    public Guid? RaisedByRunId { get; set; }

    /// <summary><c>person</c> or <c>auto-mode</c>, once decided.</summary>
    public string? DecidedVia { get; set; }

    public Guid? DecidedBy { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public string? DecisionNote { get; set; }

    public Guid? EmployeeId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// One curated memory entry of one employee, about one place in the cascade. Keyed by employee and
/// scope, never by directory (ARCH-002). Archived, not deleted, when its employee is released.
/// </summary>
public sealed class EmployeeMemoryRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public Guid EmployeeId { get; set; }

    public string Title { get; set; } = "";

    public string Body { get; set; } = "";

    public string Kind { get; set; } = "";

    public Guid? SourceRunId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateTimeOffset? LastReviewedAt { get; set; }

    public DateTimeOffset? ArchivedAt { get; set; }
}

/// <summary>One change to an employee's memory, append-only: what was added, corrected, merged, removed, archived or restored, by whom.</summary>
public sealed class EmployeeMemoryChangeRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid EmployeeId { get; set; }

    /// <summary>The entry changed. Not a foreign key: a removed entry's history outlives it.</summary>
    public Guid? MemoryId { get; set; }

    public string Action { get; set; } = "";

    public string By { get; set; } = "";

    public Guid? UserId { get; set; }

    public Guid? RunId { get; set; }

    public string DetailJson { get; set; } = "{}";

    public DateTimeOffset At { get; set; }
}
