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

// Every node carries the viewer's effective role there (Role: owner, admin, builder or viewer; null where
// the node is shown only as the path down to something they hold), resolved exactly as the server checks
// it (RoleResolver: the deepest grant on the chain, the organisation's Owner everywhere), so the console
// never works it out itself. Archived marks a division, project or app that is archived: kept, not served.

/// <param name="Role">The viewer's effective role at the organisation itself; null when their grants all sit lower.</param>
/// <param name="NeverToppedUp">True while the organisation has never been topped up: it has no credits, so its first piece of work waits for budget (D63).</param>
public sealed record OrganisationNodeView(Guid Id, string Slug, string Name, string? Summary, SpendView Spend, IReadOnlyList<WorkerView> Workers, string? Role = null,
    bool NeverToppedUp = false);

public sealed record DivisionNodeView(Guid Id, string Slug, string Name, SpendView Spend, IReadOnlyList<WorkerView> Workers, IReadOnlyList<ProjectNodeView> Projects,
    string? Role = null, bool Archived = false);

/// <param name="Step">The step under way, counted from 1 (R2-9: never "step 0"); <paramref name="Of"/> when every step is done; 0 only when the run has no steps.</param>
/// <param name="Done">The steps finished, for a progress bar.</param>
public sealed record ProgressView(Guid RunId, string Label, int Step, int Of, decimal SpentCredits, decimal? EstimatedCredits, int Done = 0)
{
    /// <summary>The progress of a run with <paramref name="done"/> of <paramref name="of"/> steps finished.</summary>
    public static (int Step, int Done) Counting(int done, int of) => (of <= 0 ? 0 : Math.Min(done + 1, of), Math.Max(0, done));
}

/// <summary>
/// An app (or the project holding it) whose build ended without anything ever being published (D81): kept, not deleted, so
/// "Try again" still works, and said plainly so it does not read as live.
/// </summary>
/// <param name="Reason"><c>cancelled</c>, <c>failed</c>, <c>budget</c> or <c>plan-declined</c>: why the build stopped.</param>
/// <param name="Note">The line to show, for example "Not built — the build was cancelled."</param>
/// <param name="RunId">The build that stopped: the run "Try again" starts from.</param>
public sealed record NotBuiltView(string Reason, string Note, Guid RunId, Guid? IdeaId);

/// <param name="Stage"><c>researching</c>, <c>building</c>, <c>reviewing</c>, <c>live</c>, <c>planning</c>, <c>paused</c> or <c>not-built</c> (its build stopped before anything was published; see <paramref name="NotBuilt"/>).</param>
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
    IReadOnlyList<AppNodeView> Apps,
    string? Role = null,
    bool Archived = false,
    NotBuiltView? NotBuilt = null);

/// <param name="Access">private, shared or public, resolved down the cascade.</param>
/// <param name="SharedWith">How many addresses the app is shared with.</param>
/// <param name="VisitsToday">Page visits today (UTC) from the app's own telemetry. Null until the app has reported anything: unknown, never zero.</param>
/// <param name="Health"><c>healthy</c>, <c>degraded</c>, <c>down</c>, <c>unknown</c>, or <c>paused</c> while Edge serves its holding page (see <paramref name="Paused"/>).</param>
/// <param name="Paused">Why Edge is serving the holding page instead of the app, exactly as Edge serves it (D66); null when it is not paused.</param>
/// <param name="NotBuilt">Its build stopped before anything was published (D81); null otherwise.</param>
/// <param name="Status">The app's own status: draft, building, running, sleeping, stopped, failed or archived — a draft has never been built.</param>
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
    IReadOnlyList<WorkerView> Workers,
    string? Role = null,
    bool Archived = false,
    PausedView? Paused = null,
    NotBuiltView? NotBuilt = null,
    string? Status = null);

/// <summary>Why an app is paused behind Edge's holding page (D66): the routing table's own reason, in words.</summary>
/// <param name="Reason"><c>budget_exhausted</c> (a monthly budget on its chain is spent) or <c>overdraft_limit</c> (the organisation reached its overdraft limit).</param>
/// <param name="Note">For example "Paused: a monthly budget above it is spent. Raising the budget or the new month restores it."</param>
public sealed record PausedView(string Reason, string Note);

public sealed record VerdictNeed(string Kind, Guid Id, Guid IdeaId, string Title, string Verdict, string? Detail);

/// <param name="Technical">Technical mode's detail, beside the plain <paramref name="Detail"/>; null when none.</param>
public sealed record ApprovalNeed(string Kind, Guid Id, Guid RunId, Guid ApprovalId, string Title, string? Detail, string? Technical = null);

/// <summary>A hire proposal waiting for the owner: over budget, or the hire checkpoint is on.</summary>
public sealed record HireNeed(string Kind, Guid Id, Guid HireId, string Title, string? Detail, string Scope, decimal ExpectedMonthlyCredits);

/// <summary>An employee with nothing to do: release it (its memory is kept) or give it work.</summary>
public sealed record IdleNeed(string Kind, Guid Id, Guid EmployeeId, string Title, string? Detail);

/// <summary><c>GET /api/tree</c>. <c>organisation</c> is null on first run, and for someone given no role yet.</summary>
/// <param name="FirstRun">With no organisation: true only while none exists anywhere, so the signed-in person may name the first. False for someone who must be invited.</param>
public sealed record TreeView(DateTimeOffset GeneratedAt, string ViewerRole, OrganisationNodeView? Organisation, IReadOnlyList<DivisionNodeView> Divisions, IReadOnlyList<object> NeedsYou,
    bool FirstRun = false);

/// <summary>A run as the console reads it. Status words: queued, running, waiting, paused, finished, failed, cancelled.</summary>
/// <param name="Detail">How it ended, technically (the faults), from its <c>run.finished</c>; for technical mode. Null while it runs or when none was given.</param>
/// <param name="Reason">Why it ended when that is more than its outcome, for example <c>declined_at_start</c>; null otherwise.</param>
/// <param name="EstimateCredits">The latest estimate: the re-estimate from the plan once there is one.</param>
/// <param name="FirstEstimateCredits">The estimate shown before the work began (the run's first <c>estimate.made</c>); null when none was made (R2-8).</param>
/// <param name="PlanEstimateCredits">The re-estimate from the plan (<c>estimate.made</c> with stage <c>plan</c>), null until the plan is priced (R2-8).</param>
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
    DateTimeOffset CreatedAt,
    bool CanTryAgain = false,
    string? Detail = null,
    string? Reason = null,
    decimal? FirstEstimateCredits = null,
    decimal? PlanEstimateCredits = null);

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
    string? RedLine,
    IReadOnlyList<DecisionHistoryView>? History = null,
    TryAgainView? TryAgain = null);

/// <summary>A decision taken on an earlier verdict, kept after a new verdict cleared it (VERD-07).</summary>
/// <param name="Choice"><c>change</c> (researched again with a note), or <c>retry</c> (research that did not finish, started again).</param>
/// <param name="RunId">The research that followed.</param>
public sealed record DecisionHistoryView(string? Verdict, string? Headline, string Choice, string? Note, string By, DateTimeOffset At, Guid RunId);

/// <summary>Work on this idea that stopped and can be tried again (CHG-03): its run, what it was, and why it stopped.</summary>
/// <param name="What"><c>research</c> or <c>build</c>.</param>
/// <param name="Why"><c>failed</c>, <c>cancelled</c>, <c>budget</c>, <c>plan-declined</c> or <c>start-declined</c> (the owner declined to start it).</param>
public sealed record TryAgainView(Guid RunId, string What, string Why);

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
/// <param name="Health"><c>state</c> is <c>healthy</c>, <c>degraded</c>, <c>down</c>, <c>unknown</c>, or <c>paused</c> while Edge serves its holding page; <c>summary</c> says why.</param>
/// <param name="Paused">Why Edge serves the holding page instead of the app (D66), exactly as Edge serves it; null when it is not paused.</param>
/// <param name="NotBuilt">Its build stopped before anything was published (D81); null otherwise.</param>
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
    int IdleMinutes,
    PausedView? Paused = null,
    NotBuiltView? NotBuilt = null);

/// <param name="EmployeeId">On an employee's row: the employee, whose cap is set on its own record.</param>
/// <param name="SpentCredits">On an employee's row: its own spend and that of the contractors it briefs, which its cap also covers.</param>
public sealed record BudgetLineView(string Scope, string Name, string Level, int Depth, decimal SpentCredits, decimal? CapCredits, Guid? AppId, Guid? EmployeeId = null);

public sealed record MonthView(decimal Spent, decimal Ai, decimal Hosting);

/// <summary>
/// Estimates scored against actuals. <paramref name="WithinPercent"/> is the share of pieces that came within 10% of their
/// estimate; <paramref name="TypicalGapPercent"/> the typical gap with its sign — the median across scored pieces of
/// (actual − estimate) / estimate, in percent (−84 is "usually 84% under the estimate"), null when no piece had an
/// estimate above zero; <paramref name="Typically"/> says it in a word: <c>under</c>, <c>over</c>, or <c>within</c>
/// when the typical gap is within 10% either way.
/// </summary>
public sealed record EstimatesView(long Pieces, decimal WithinPercent, long Under, long Over, decimal LargestMissPercent, decimal? TypicalGapPercent, string? Typically);

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
/// <param name="NeverToppedUp">True while the organisation has never been topped up: it has no credits until FrostAura tops it up, so its first piece of work waits for budget (D63).</param>
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
    decimal Available,
    bool NeverToppedUp = false);

/// <param name="By">Who said it, by name: the person who sent it, or the employee who answered; null for Endgame's own assistant.</param>
/// <param name="Code">A machine-readable reason on Endgame's own notices, such as <c>budget_exhausted</c>.</param>
public sealed record ConversationMessageView(Guid RunId, long Seq, DateTimeOffset At, string From, string Text, string? By = null, string? Code = null);

/// <summary><c>GET /api/conversations?scope=</c>: the messages of the conversation docked at a scope, oldest first.</summary>
public sealed record ConversationHistoryView(string Scope, Guid? ConversationId, Guid? EmployeeId, IReadOnlyList<ConversationMessageView> Messages);

/// <summary>One finished run's actual cost (<c>GET /internal/estimates/history</c>).</summary>
public sealed record CostHistoryView(Guid RunId, DateTimeOffset FinishedAt, decimal Credits, int Steps);
