using System.Text.Json.Nodes;

namespace Endgame.Infrastructure.Tree;

// The public API's read shapes, written to the console's typed contract
// (lane-console src/frontend/src/store/types.ts, UC-001). camelCase on the wire.

public sealed record SpendView(decimal MonthCredits);

/// <summary>Someone working at a node: an employee, or a contractor while it works.</summary>
/// <param name="Kind"><c>employee</c> or <c>contractor</c>.</param>
/// <param name="Activity">What it is doing now: its run's title (or a contractor's brief); "Paused"; null when idle.</param>
/// <param name="Status"><c>idle</c>, <c>working</c> or <c>paused</c>.</param>
/// <param name="Idle">True when it has had no work for longer than <c>workforce.idle_days</c>.</param>
/// <param name="BriefedBy">A contractor's briefing employee.</param>
public sealed record WorkerView(Guid Id, string Name, string Role, string Kind, string? Activity, string Status, bool Idle, string? Standing, Guid? BriefedBy);

public sealed record OrganisationNodeView(Guid Id, string Slug, string Name, string? Summary, SpendView Spend, IReadOnlyList<WorkerView> Workers);

public sealed record DivisionNodeView(Guid Id, string Slug, string Name, SpendView Spend, IReadOnlyList<WorkerView> Workers, IReadOnlyList<ProjectNodeView> Projects);

public sealed record ProgressView(Guid RunId, string Label, int Step, int Of, decimal SpentCredits, decimal? EstimatedCredits);

public sealed record ProjectNodeView(
    Guid Id,
    string Slug,
    string Name,
    string Stage,
    Guid? IdeaId,
    string? Note,
    ProgressView? Progress,
    SpendView Spend,
    IReadOnlyList<WorkerView> Workers,
    IReadOnlyList<AppNodeView> Apps);

/// <param name="Access">private, shared or public, resolved down the cascade.</param>
/// <param name="SharedWith">How many addresses the app is shared with.</param>
/// <param name="VisitsToday">Page visits today (UTC) from the app's own telemetry. Null until the app has reported anything: unknown, never zero.</param>
public sealed record AppNodeView(
    Guid Id,
    string Slug,
    string Name,
    string Health,
    string Running,
    string Access,
    int SharedWith,
    int? VisitsToday,
    DateTimeOffset? LastVisitAt,
    SpendView Spend,
    IReadOnlyList<WorkerView> Workers);

public sealed record VerdictNeed(string Kind, Guid Id, Guid IdeaId, string Title, string Verdict, string? Detail);

public sealed record ApprovalNeed(string Kind, Guid Id, Guid RunId, Guid ApprovalId, string Title, string? Detail);

/// <summary>A hire proposal waiting for the owner: over budget, or the hire checkpoint is on.</summary>
public sealed record HireNeed(string Kind, Guid Id, Guid HireId, string Title, string? Detail, string Scope, decimal ExpectedMonthlyCredits);

/// <summary>An employee with nothing to do: release it (its memory is kept) or give it work.</summary>
public sealed record IdleNeed(string Kind, Guid Id, Guid EmployeeId, string Title, string? Detail);

/// <summary><c>GET /api/tree</c>. <c>organisation</c> is null on first run.</summary>
public sealed record TreeView(DateTimeOffset GeneratedAt, string ViewerRole, OrganisationNodeView? Organisation, IReadOnlyList<DivisionNodeView> Divisions, IReadOnlyList<object> NeedsYou);

/// <summary>A run as the console reads it. Status words: queued, running, waiting, paused, finished, failed, cancelled.</summary>
public sealed record PublicRunView(
    Guid Id,
    string Kind,
    string Title,
    string Scope,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    long LastSeq,
    Guid? IdeaId,
    decimal? EstimateCredits,
    decimal SpentCredits,
    Guid? EmployeeId,
    Guid? ConversationId,
    bool BudgetExhausted,
    string? Outcome,
    string? Summary,
    DateTimeOffset CreatedAt);

public sealed record ResearchView(decimal EstimatedCredits, decimal SpentCredits, string? By);

/// <param name="Via"><c>person</c> or <c>auto-mode</c>.</param>
public sealed record DecisionView(string Choice, DateTimeOffset At, string By, bool Overruled, Guid? RunId, string Via);

public sealed record OverruledView(Guid IdeaId, string Title, string Verdict, string Outcome);

public sealed record VerdictRecordView(int Total, int Build, int Change, int DoNotBuild, IReadOnlyList<OverruledView> Overruled);

/// <summary>
/// <c>GET /api/ideas/{id}</c>. <c>verdict</c> is the research's own verdict document, null until it is ready.
/// <c>redLine</c> names the red line the verdict found breached: no one can build over it.
/// </summary>
public sealed record PublicIdeaView(
    Guid Id,
    string Title,
    string Text,
    IReadOnlyList<string> Constraints,
    string Status,
    Guid RunId,
    string? Scope,
    ResearchView Research,
    JsonNode? Verdict,
    DecisionView? Decision,
    VerdictRecordView Record,
    string? RedLine);

public sealed record IdeaEstimateView(decimal Credits, string Basis);

public sealed record HealthView(string State, string Summary);

public sealed record AppAddressesView(string Path, string? Subdomain);

public sealed record CostView(decimal MonthCredits, decimal? CapCredits);

public sealed record AppSettingsView(string Running, string Access);

/// <param name="Telemetry">
/// From the app's own telemetry: <c>{ visitsToday, requestsToday, errorsToday, latencyP50Ms, latencyP95Ms, lastVisitAt }</c>
/// (today is the UTC day). Null only while the app has measured nothing yet — never zeros that were not measured.
/// </param>
/// <param name="RunningCost">
/// What each running choice would cost a month, from the app's own measured hosting over the last 14 days and the current
/// prices, each with what it assumes; or <c>state: not-enough-history</c> (under 24 hours measured) with no figures. Never null.
/// </param>
/// <param name="EndUsers">How many end users have registered for the app (members who open it are not counted).</param>
public sealed record PublicAppView(
    Guid Id,
    string Name,
    string Scope,
    HealthView Health,
    string Running,
    AppAddressesView Addresses,
    JsonNode? Telemetry,
    CostView Cost,
    AppSettingsView Settings,
    Platform.RunningCostView RunningCost,
    int SharedWith,
    int EndUsers,
    string Status,
    string? Version,
    DateTimeOffset? PublishedAt,
    int IdleMinutes);

public sealed record BudgetLineView(string Scope, string Name, string Level, int Depth, decimal SpentCredits, decimal? CapCredits, Guid? AppId);

public sealed record MonthView(decimal Spent, decimal Ai, decimal Hosting);

public sealed record EstimatesView(long Pieces, decimal WithinPercent, long Under, long Over, decimal LargestMissPercent);

public sealed record NotChargedView(decimal Credits, long Repairs);

/// <summary>A narrower overdraft limit set at a division, project or app.</summary>
/// <param name="Scope">The node's path.</param>
/// <param name="Level"><c>division</c>, <c>project</c> or <c>app</c>.</param>
/// <param name="SetByName">The display name of who set it; null when unknown.</param>
public sealed record OverdraftLimitView(string Scope, string Name, string Level, decimal Credits, DateTimeOffset SetAt, Guid? SetBy, string? SetByName);

/// <param name="FrostauraLimit">The deepest FrostAura allows the organisation.</param>
/// <param name="OwnLimit">The tightest of the organisation's own limit and any narrower one on the scope's chain; null when none.</param>
/// <param name="Limits">Every narrower limit at a division, project or app that applies at the scope (on its chain above it)
/// or is set beneath it, in tree order.</param>
public sealed record OverdraftView(decimal FrostauraLimit, decimal? OwnLimit, IReadOnlyList<OverdraftLimitView> Limits);

public sealed record TopUpView(DateTimeOffset At, decimal Credits, string Note);

/// <summary><c>GET /api/credits?scope=</c>.</summary>
public sealed record CreditsView(
    string Scope,
    decimal Balance,
    MonthView Month,
    decimal? MonthsLeftAtPace,
    IReadOnlyList<BudgetLineView> Budgets,
    EstimatesView? Estimates,
    NotChargedView NotCharged,
    OverdraftView? Overdraft,
    IReadOnlyList<TopUpView> TopUps,
    decimal HeldCredits,
    decimal Available);

public sealed record ConversationMessageView(Guid RunId, long Seq, DateTimeOffset At, string From, string Text);

/// <summary><c>GET /api/conversations?scope=</c>: the messages of the conversation docked at a scope, oldest first.</summary>
public sealed record ConversationHistoryView(string Scope, Guid? ConversationId, Guid? EmployeeId, IReadOnlyList<ConversationMessageView> Messages);

/// <summary>One finished run's actual cost (<c>GET /internal/estimates/history</c>).</summary>
public sealed record CostHistoryView(Guid RunId, DateTimeOffset FinishedAt, decimal Credits, int Steps);
