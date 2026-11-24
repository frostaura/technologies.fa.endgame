namespace Endgame.Domain.Workforce;

/// <summary>
/// The workforce (spec, <i>Workforce — employees and contractors, hired on demand</i>). Every set here
/// is also a database check constraint.
/// </summary>
public static class EmployeeKinds
{
    /// <summary>Named and lasting: a job description, a place on the org chart, a track record and a curated memory.</summary>
    public const string Employee = "employee";

    /// <summary>Short-lived, briefed by an employee for a burst; gone from the chart when done.</summary>
    public const string Contractor = "contractor";

    public static readonly IReadOnlyList<string> All = [Employee, Contractor];
}

/// <summary>Standing hires: exist in every organisation from its creation and are never released.</summary>
public static class StandingRoles
{
    public const string SecurityReviewer = "security-reviewer";

    public static readonly IReadOnlyList<string> All = [SecurityReviewer];
}

public static class HireStatuses
{
    public const string Proposed = "proposed";
    public const string Accepted = "accepted";
    public const string Declined = "declined";

    public static readonly IReadOnlyList<string> All = [Proposed, Accepted, Declined];
}

/// <summary>What raised the need for a hire: the ontology (a new division, a project entering a stage, a recurring job), a recurring contractor role, or the owner.</summary>
public static class HireTriggers
{
    public const string Division = "division";
    public const string Stage = "stage";
    public const string Recurring = "recurring";
    public const string Promotion = "promotion";
    public const string Owner = "owner";

    public static readonly IReadOnlyList<string> All = [Division, Stage, Recurring, Promotion, Owner];
}

/// <summary>What one curated memory entry is: something true about the organisation, a way of working, an owner's preference, or a lesson from work sent back.</summary>
public static class MemoryKinds
{
    public const string Fact = "fact";
    public const string Practice = "practice";
    public const string Preference = "preference";
    public const string Lesson = "lesson";

    public static readonly IReadOnlyList<string> All = [Fact, Practice, Preference, Lesson];
}

/// <summary>The append-only record of every change to an employee's memory.</summary>
public static class MemoryActions
{
    public const string Added = "added";
    public const string Corrected = "corrected";
    public const string Merged = "merged";
    public const string Removed = "removed";
    public const string Archived = "archived";
    public const string Restored = "restored";
    public const string Reviewed = "reviewed";

    public static readonly IReadOnlyList<string> All = [Added, Corrected, Merged, Removed, Archived, Restored, Reviewed];
}

/// <summary>Who changed a memory: the employee after a task, a person in the console, a review run, or the platform (release and rehire).</summary>
public static class MemoryActors
{
    public const string Employee = "employee";
    public const string Person = "person";
    public const string Review = "review";
    public const string Platform = "platform";

    public static readonly IReadOnlyList<string> All = [Employee, Person, Review, Platform];
}

/// <summary>Limits on what a job description and a memory entry may hold.</summary>
public static class WorkforceLimits
{
    public const int MaxName = 200;
    public const int MaxMandate = 8_000;
    public const int MaxListItems = 40;
    public const int MaxListItem = 100;
    public const int MaxMemoryTitle = 200;
    public const int MaxMemoryBody = 4_000;
    public const int MaxMemoryPerWrite = 20;

    /// <summary>Every memory read for a run has a limit (ARCH-002).</summary>
    public const int MaxMemoryPerRead = 200;

    /// <summary>Days without work before an employee is flagged idle, unless the cascade sets <c>workforce.idle_days</c>.</summary>
    public const int DefaultIdleDays = 14;

    /// <summary>How many contractors in a role at one node, within <see cref="PromotionWindowDays"/>, make it a recurring role worth an employee.</summary>
    public const int PromotionThreshold = 3;

    public const int PromotionWindowDays = 30;
}
