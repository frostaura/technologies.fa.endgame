using System.Text.Json.Nodes;

namespace Endgame.Infrastructure.Tree;

// The public API's read shapes, written to the console's typed contract
// (lane-console src/frontend/src/store/types.ts, UC-001). camelCase on the wire.

public sealed record SpendView(decimal MonthCredits);

public sealed record WorkerView(Guid Id, string Name, string Role, string Kind, string? Activity);

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

public sealed record DecisionView(string Choice, DateTimeOffset At, string By, bool Overruled, Guid? RunId);

public sealed record OverruledView(Guid IdeaId, string Title, string Verdict, string Outcome);

public sealed record VerdictRecordView(int Total, int Build, int Change, int DoNotBuild, IReadOnlyList<OverruledView> Overruled);

/// <summary><c>GET /api/ideas/{id}</c>. <c>verdict</c> is the research's own verdict document, null until it is ready.</summary>
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
    VerdictRecordView Record);

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
/// Expected monthly credits for each running choice, <c>{ sleep, alwaysOn }</c>, from the app's measured hosting over the
/// last seven days. Null until Dock has reported any.
/// </param>
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
    JsonNode? RunningCost,
    int SharedWith,
    string Status,
    string? Version,
    DateTimeOffset? PublishedAt,
    int IdleMinutes);

public sealed record BudgetLineView(string Scope, string Name, string Level, int Depth, decimal SpentCredits, decimal? CapCredits, Guid? AppId);

public sealed record MonthView(decimal Spent, decimal Ai, decimal Hosting);

public sealed record EstimatesView(long Pieces, decimal WithinPercent, long Under, long Over, decimal LargestMissPercent);

public sealed record NotChargedView(decimal Credits, long Repairs);

public sealed record OverdraftView(decimal FrostauraLimit, decimal? OwnLimit);

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
