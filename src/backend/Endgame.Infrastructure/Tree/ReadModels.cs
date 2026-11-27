using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Tree;

/// <summary>
/// The public API's reads, projected from the records into the console's contract. Every number is
/// derived from its source of truth (the ledger, the run log, the tree) at read time; where the
/// control plane does not measure something yet, the field is null rather than an invented zero.
/// </summary>
public sealed class ReadModels(EndgameDbContext db, TenantSession session, ScopeResolver scopes, CascadeService cascade, CreditLedger ledger, TreeService tree, TimeProvider clock,
    Platform.TelemetryService telemetry, Platform.HostingMeter hosting)
{
    public const decimal EstimateTolerance = 0.10m;

    // ---------------------------------------------------------------- runs

    public static string RunStatus(string status) => status switch
    {
        RunStatuses.WaitingApproval => "waiting",
        RunStatuses.Succeeded => "finished",
        _ => status,
    };

    public static string RunKind(string kind) => kind is RunKinds.Task or RunKinds.Review ? "factory" : kind;

    public async Task<PublicRunView> RunAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == organisationId && r.Id == runId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The run");
        var scope = await scopes.ForRowAsync(run.OrganisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
        var (estimates, spent) = await RunCostsAsync(organisationId, [runId], cancellationToken);
        var (detail, reason) = RunStatuses.IsTerminal(run.Status) ? await FinishedAsync(run, cancellationToken) : (null, null);
        var (first, plan) = await EstimatesAsync(run, cancellationToken);
        return Run(run, scope.Path.ToString(), estimates.GetValueOrDefault(runId), spent.GetValueOrDefault(runId), await CanTryAgainAsync(run, cancellationToken))
            with
        { Detail = detail, Reason = reason, FirstEstimateCredits = first, PlanEstimateCredits = plan };
    }

    /// <summary>
    /// The estimate shown before the work began (the first) and the re-estimate from the plan (R2-8): the console says
    /// "Estimated 10 before the work began; 4.8 once planned", never the re-estimate as if it had been shown first.
    /// </summary>
    private async Task<(decimal? First, decimal? Plan)> EstimatesAsync(RunRecord run, CancellationToken cancellationToken)
    {
        var made = await db.RunEvents.AsNoTracking()
            .Where(e => e.OrganisationId == run.OrganisationId && e.RunId == run.Id && e.Type == RunEventTypes.EstimateMade)
            .OrderBy(e => e.Seq).Select(e => e.PayloadJson).ToListAsync(cancellationToken);
        var parsed = made.Select(p => JsonNode.Parse(p) as JsonObject).OfType<JsonObject>()
            .Select(p => (Credits: p["credits"] is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? v.GetValue<decimal>() : (decimal?)null, Stage: Text(p["stage"])))
            .Where(p => p.Credits is not null).ToList();
        return (parsed.Count > 0 ? parsed[0].Credits : null, parsed.LastOrDefault(p => p.Stage == "plan").Credits);
    }

    /// <summary>The technical <c>detail</c> and the <c>reason</c> a run's <c>run.finished</c> gave, when it gave them.</summary>
    private async Task<(string? Detail, string? Reason)> FinishedAsync(RunRecord run, CancellationToken cancellationToken)
    {
        var payload = await db.RunEvents.AsNoTracking()
            .Where(e => e.OrganisationId == run.OrganisationId && e.RunId == run.Id && e.Type == RunEventTypes.RunFinished)
            .OrderByDescending(e => e.Seq).Select(e => e.PayloadJson).FirstOrDefaultAsync(cancellationToken);
        return payload is not null && JsonNode.Parse(payload) is JsonObject p ? (Text(p["detail"]), Text(p["reason"])) : (null, null);
    }

    /// <summary>The <c>run.finished</c> reason when the owner declined to start the work.</summary>
    public const string DeclinedAtStart = "declined_at_start";

    /// <summary>Whether this run is the latest attempt at research, a build or a change, and stopped without finishing (CHG-03).</summary>
    private async Task<bool> CanTryAgainAsync(RunRecord run, CancellationToken cancellationToken)
    {
        if (run.Status is not (RunStatuses.Failed or RunStatuses.Cancelled))
        {
            return false;
        }

        if (run.Kind is RunKinds.Research or RunKinds.Build)
        {
            var idea = run.IdeaId is { } id ? await db.Ideas.AsNoTracking().Where(i => i.OrganisationId == run.OrganisationId && i.Id == id).Select(i => new { i.Status, i.ResearchRunId, i.BuildRunId }).SingleOrDefaultAsync(cancellationToken) : null;
            return run.Kind == RunKinds.Research
                ? idea is { Status: IdeaStatuses.Researching } && idea.ResearchRunId == run.Id
                : idea is { Status: IdeaStatuses.Building } && idea.BuildRunId == run.Id;
        }

        if (run.Kind != RunKinds.Task || await db.Runs.AsNoTracking().AnyAsync(r => r.OrganisationId == run.OrganisationId && r.ParentRunId == run.Id && r.Kind == RunKinds.Task, cancellationToken))
        {
            return false;
        }

        var first = await db.RunEvents.AsNoTracking().Where(e => e.OrganisationId == run.OrganisationId && e.RunId == run.Id && e.Type == RunEventTypes.Message)
            .OrderBy(e => e.Seq).Select(e => e.PayloadJson).FirstOrDefaultAsync(cancellationToken);
        return first is not null && JsonNode.Parse(first) is JsonObject p && Text(p["kind"]) == "change";
    }

    private static PublicRunView Run(RunRecord r, string scope, decimal? estimate, decimal spent, bool canTryAgain = false) => new(
        r.Id, RunKind(r.Kind), r.Title, scope, RunStatus(r.Status), r.StartedAt ?? r.CreatedAt, r.FinishedAt, r.LastSeq, r.IdeaId,
        estimate, spent, r.EmployeeId, r.ConversationId, r.BudgetExhaustedAt is not null, r.Outcome, r.Summary, r.CreatedAt, canTryAgain);

    /// <summary>Each run's latest estimate (from <c>estimate.made</c>) and its settled, billable spend.</summary>
    private async Task<(Dictionary<Guid, decimal> Estimates, Dictionary<Guid, decimal> Spent)> RunCostsAsync(Guid organisationId, Guid[] runIds, CancellationToken cancellationToken)
    {
        var estimates = new Dictionary<Guid, decimal>();
        var spent = new Dictionary<Guid, decimal>();
        if (runIds.Length == 0)
        {
            return (estimates, spent);
        }

        await using (var command = await db.CommandAsync("""
            SELECT DISTINCT ON (run_id) run_id, (payload ->> 'credits')::numeric
            FROM run_events
            WHERE organisation_id = @org AND run_id = ANY(@runs) AND type = 'estimate.made' AND jsonb_typeof(payload -> 'credits') = 'number'
            ORDER BY run_id, seq DESC
            """, cancellationToken, P("org", organisationId), new Npgsql.NpgsqlParameter("runs", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Uuid) { Value = runIds }))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                estimates[reader.GetGuid(0)] = reader.GetDecimal(1);
            }
        }

        await using (var command = await db.CommandAsync("""
            SELECT run_id, SUM(amount) FROM credit_entries
            WHERE organisation_id = @org AND run_id = ANY(@runs) AND kind = 'settlement' AND billable
            GROUP BY run_id
            """, cancellationToken, P("org", organisationId), new Npgsql.NpgsqlParameter("runs", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Uuid) { Value = runIds }))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                spent[reader.GetGuid(0)] = reader.GetDecimal(1);
            }
        }

        return (estimates, spent);
    }

    // ---------------------------------------------------------------- the tree

    /// <summary>
    /// The organisation as one document for the org chart. A member whose roles sit lower in the tree
    /// sees the branches they hold and the path down to them.
    /// </summary>
    public async Task<TreeView> TreeAsync(Guid organisationId, IReadOnlyList<RoleGrant> grants, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(grants);
        session.UseOrganisation(organisationId);
        var organisation = await db.Organisations.AsNoTracking().SingleOrDefaultAsync(o => o.Id == organisationId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The organisation");
        var divisions = await db.Divisions.AsNoTracking().Where(d => d.OrganisationId == organisationId).OrderBy(d => d.Name).ToListAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(p => p.OrganisationId == organisationId).OrderBy(p => p.Name).ToListAsync(cancellationToken);
        var apps = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == organisationId).OrderBy(a => a.Name).ToListAsync(cancellationToken);
        var employees = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && e.Status != EmployeeStatuses.Released).OrderBy(e => e.Name).ToListAsync(cancellationToken);
        var liveRuns = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == organisationId && r.Status != RunStatuses.Succeeded && r.Status != RunStatuses.Failed && r.Status != RunStatuses.Cancelled)
            .OrderByDescending(r => r.CreatedAt).ToListAsync(cancellationToken);
        var lastProjectRuns = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == organisationId && r.ProjectId != null)
            .GroupBy(r => r.ProjectId)
            .Select(g => g.OrderByDescending(r => r.CreatedAt).First())
            .ToListAsync(cancellationToken);
        var spend = await ledger.SpendThisMonthByNodeAsync(organisationId, cancellationToken);
        var sleepModes = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Kind == "setting" && e.Key == CascadeKeys.SleepMode).ToListAsync(cancellationToken);
        var liveIds = liveRuns.Select(r => r.Id).ToList();
        var tasks = await db.Tasks.AsNoTracking()
            .Where(t => t.OrganisationId == organisationId && t.RunId != null && liveIds.Contains(t.RunId.Value))
            .Select(t => new { t.RunId, t.Status, t.EmployeeId }).ToListAsync(cancellationToken);
        var charged = await db.CreditEntries.AsNoTracking()
            .Where(c => c.OrganisationId == organisationId && c.RunId != null && c.EmployeeId != null && liveIds.Contains(c.RunId.Value))
            .Select(c => new { c.RunId, c.EmployeeId }).Distinct().ToListAsync(cancellationToken);
        var (estimates, runSpend) = await RunCostsAsync(organisationId, liveRuns.Select(r => r.Id).ToArray(), cancellationToken);
        var measured = await telemetry.SummariesAsync(organisationId, null, cancellationToken);
        var shares = (await db.AppShares.AsNoTracking().Where(x => x.OrganisationId == organisationId).GroupBy(x => x.AppId).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken))
            .ToDictionary(x => x.Key, x => x.Count);
        var routes = (await tree.RoutesAsync(cancellationToken)).Routes.Where(r => r.OrganisationId == organisationId).ToDictionary(r => r.AppId);
        session.UseOrganisation(organisationId);
        var notBuilt = await NotBuiltAsync(organisationId, apps, cancellationToken);
        var neverToppedUp = !await db.CreditEntries.AsNoTracking().AnyAsync(c => c.OrganisationId == organisationId && c.Kind == "top_up", cancellationToken);

        var everything = grants.Any(g => g.Level == NodeLevel.Organisation);
        var visible = grants.Select(g => g.NodeId).ToHashSet();
        bool Visible(Guid id, params Guid[] ancestors) => everything || visible.Contains(id) || ancestors.Any(visible.Contains);
        string? RoleAt(Guid? division, Guid? project, Guid? app) => RoleResolver.Resolve(grants.Where(g => g.Level == NodeLevel.Organisation
            || (g.Level == NodeLevel.Division && g.NodeId == division) || (g.Level == NodeLevel.Project && g.NodeId == project) || (g.Level == NodeLevel.App && g.NodeId == app)))?.Role.ToWire();
        var runTitles = liveRuns.ToDictionary(r => r.Id, r => r.Title);
        // Who works in each run that is under way: its owner, whoever claimed a task in it, whoever its model calls were charged to.
        var working = WorkingIn(liveRuns.Where(r => r.Status is RunStatuses.Running or RunStatuses.WaitingApproval).ToList(),
            tasks.Where(t => t.EmployeeId != null).Select(t => (t.RunId!.Value, t.EmployeeId!.Value)).Concat(charged.Select(c => (c.RunId!.Value, c.EmployeeId!.Value))));

        var idleDays = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Kind == "setting" && e.Key == AgentSettings.WorkforceIdleDays).ToListAsync(cancellationToken);
        var now = clock.GetUtcNow();
        var idle = employees.ToDictionary(e => e.Id, e => Work.WorkforceRules.Idle(e, idleDays, now));
        string? Activity(EmployeeRecord e) => e.Status switch
        {
            EmployeeStatuses.Paused => "Paused",
            _ when e.CurrentRunId is { } run && runTitles.TryGetValue(run, out var title) => title,
            _ when working.TryGetValue(e.Id, out var worked) => runTitles[worked],
            _ when e.Kind == Domain.Workforce.EmployeeKinds.Contractor => e.Brief is { Length: > 120 } brief ? brief[..117] + "..." : e.Brief,
            _ => null,
        };

        IReadOnlyList<WorkerView> Workers(Guid? division, Guid? project, Guid? app) => employees
            .Where(e => e.DivisionId == division && e.ProjectId == project && e.AppId == app)
            .Select(e => new WorkerView(e.Id, e.Name, e.Role, e.Kind, Activity(e), e.Status == EmployeeStatuses.Idle && working.ContainsKey(e.Id) ? EmployeeStatuses.Working : e.Status,
                idle[e.Id].Flagged && !working.ContainsKey(e.Id), e.Standing, e.BriefedById))
            .ToList();

        SpendView Spend(Func<(Guid? DivisionId, Guid? ProjectId, Guid? AppId, Guid? EmployeeId, decimal Credits), bool> where) => new(spend.Where(where).Sum(s => s.Credits));

        var divisionViews = new List<DivisionNodeView>();
        foreach (var d in divisions)
        {
            var dProjects = projects.Where(p => p.DivisionId == d.Id).ToList();
            var dApps = apps.Where(a => dProjects.Any(p => p.Id == a.ProjectId)).ToList();
            if (!Visible(d.Id) && !dProjects.Any(p => visible.Contains(p.Id)) && !dApps.Any(a => visible.Contains(a.Id)))
            {
                continue;
            }

            var projectViews = new List<ProjectNodeView>();
            foreach (var p in dProjects)
            {
                var pApps = apps.Where(a => a.ProjectId == p.Id).ToList();
                if (!Visible(p.Id, d.Id) && !pApps.Any(a => visible.Contains(a.Id)))
                {
                    continue;
                }

                var appViews = pApps.Where(a => Visible(a.Id, d.Id, p.Id)).Select(a =>
                {
                    var mode = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.SleepMode, sleepModes
                        .Where(e => (e.DivisionId == null || e.DivisionId == d.Id) && (e.ProjectId == null || e.ProjectId == p.Id) && (e.AppId == null || e.AppId == a.Id))
                        .Select(e => new CascadeEntry(CascadeKind.Setting, e.Key, e.ValueJson, e.Level(), e.NodeId(), "", e.SetAt)));
                    var alwaysOn = mode is not null && JsonNode.Parse(mode.Entry.ValueJson)?.ToString() == "always_on";
                    var route = routes.GetValueOrDefault(a.Id);
                    var summary = measured.GetValueOrDefault(a.Id);
                    var paused = Paused(route);
                    return new AppNodeView(a.Id, a.Slug, a.Name, paused is null ? AppHealth(a.Status, summary) : "paused", paused is null ? AppRunning(a.Status, alwaysOn) : "paused",
                        route?.Access ?? Domain.Platform.AppAccess.Private, shares.GetValueOrDefault(a.Id), summary is null ? null : (int)Math.Min(int.MaxValue, summary.VisitsToday), summary?.LastVisitAt,
                        Spend(s => s.AppId == a.Id), Workers(d.Id, p.Id, a.Id), RoleAt(d.Id, p.Id, a.Id), a.Status == NodeStatuses.Archived, paused, notBuilt.GetValueOrDefault(a.Id), a.Status);
                }).ToList();

                var active = liveRuns.FirstOrDefault(r => r.ProjectId == p.Id && r.Kind != RunKinds.Conversation);
                var last = lastProjectRuns.FirstOrDefault(r => r.ProjectId == p.Id);
                // A project whose only apps were never built, because their build stopped, reads "Not built" — not as live, not as planning (D81).
                var projectNotBuilt = active is null && pApps.Count > 0 && pApps.All(a => notBuilt.ContainsKey(a.Id) || a.Status == NodeStatuses.Archived) && pApps.Any(a => notBuilt.ContainsKey(a.Id))
                    ? pApps.Select(a => notBuilt.GetValueOrDefault(a.Id)).OfType<NotBuiltView>().First()
                    : null;
                var (stage, note) = projectNotBuilt is not null ? ("not-built", projectNotBuilt.Note) : ProjectStage(p, active, last, pApps);
                ProgressView? progress = null;
                if (active is not null)
                {
                    var runTasks = tasks.Where(t => t.RunId == active.Id).ToList();
                    var (step, done) = ProgressView.Counting(runTasks.Count(t => t.Status == TaskStatuses.Done), runTasks.Count);
                    progress = new ProgressView(active.Id, active.Title, step, runTasks.Count,
                        runSpend.GetValueOrDefault(active.Id), estimates.TryGetValue(active.Id, out var estimate) ? estimate : null, done);
                }

                projectViews.Add(new ProjectNodeView(p.Id, p.Slug, p.Name, stage, (active ?? last)?.IdeaId ?? projectNotBuilt?.IdeaId, note, progress,
                    Spend(s => s.ProjectId == p.Id), Workers(d.Id, p.Id, null), appViews, RoleAt(d.Id, p.Id, null), p.Status == NodeStatuses.Archived, projectNotBuilt));
            }

            divisionViews.Add(new DivisionNodeView(d.Id, d.Slug, d.Name, Spend(s => s.DivisionId == d.Id), Workers(d.Id, null, null), projectViews,
                RoleAt(d.Id, null, null), d.Status == NodeStatuses.Archived));
        }

        var shownApps = divisionViews.Sum(d => d.Projects.Sum(p => p.Apps.Count));
        var shownProjects = divisionViews.Sum(d => d.Projects.Count);
        var summary = $"{Count(divisionViews.Count, "division")} · {Count(shownProjects, "project")} · {Count(shownApps, "app")} · {Count(employees.Count(e => e.Kind == Domain.Workforce.EmployeeKinds.Employee), "employee")}";
        var root = new OrganisationNodeView(organisation.Id, organisation.Slug, organisation.Name, summary,
            everything ? Spend(_ => true) : new SpendView(divisionViews.Sum(v => v.Spend.MonthCredits)),
            everything ? Workers(null, null, null) : [], RoleAt(null, null, null), neverToppedUp);
        var needs = await NeedsYouAsync(organisationId, everything, visible, cancellationToken);
        needs = [.. needs, .. await WorkforceNeedsAsync(organisationId, everything, visible, employees.Where(e => idle[e.Id].Flagged).ToList(), idle, cancellationToken)];
        var viewer = RoleResolver.Resolve(grants)?.Role.ToWire() ?? "none";
        return new TreeView(clock.GetUtcNow(), viewer, root, divisionViews, needs);
    }

    /// <summary>
    /// What is at <paramref name="scope"/> and beneath it, counted from the same tree document home counts, read as the
    /// organisation's Owner sees it (R5-1): the conversation's <c>read_organisation</c> answers "how many apps?" from this.
    /// </summary>
    public async Task<ScopeContentsView> ContentsAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var everything = new RoleGrant(Guid.Empty, MemberRole.Owner, NodeLevel.Organisation, scope.OrganisationId, scope.PathAt(NodeLevel.Organisation));
        return ScopeContents.From(await TreeAsync(scope.OrganisationId, [everything], cancellationToken), scope);
    }

    /// <summary>For each employee, the newest of <paramref name="runs"/> (newest first) it works in: as the run's owner, or by a task or a charged model call in it.</summary>
    public static Dictionary<Guid, Guid> WorkingIn(IReadOnlyList<RunRecord> runs, IEnumerable<(Guid RunId, Guid EmployeeId)> workedIn)
    {
        ArgumentNullException.ThrowIfNull(runs);
        var order = runs.Select((r, i) => (r.Id, i)).ToDictionary(x => x.Id, x => x.i);
        var working = new Dictionary<Guid, Guid>();
        foreach (var (run, employee) in runs.Where(r => r.EmployeeId is not null).Select(r => (r.Id, r.EmployeeId!.Value)).Concat(workedIn ?? []))
        {
            if (order.TryGetValue(run, out var at) && (!working.TryGetValue(employee, out var held) || order[held] > at))
            {
                working[employee] = run;
            }
        }

        return working;
    }

    /// <summary>No organisation to show: <paramref name="canName"/> is true only on a first run, when the person may name the first one.</summary>
    public TreeView FirstRun(bool canName = true) => new(clock.GetUtcNow(), "none", null, [], [], canName);

    /// <summary>
    /// What waits on a person at <paramref name="scope"/> and beneath it — the same items home's "Needs you" shows to
    /// someone whose role is set there: verdicts, approvals, hire proposals and idle employees. The organisation's
    /// conversation reads it, so "is anything waiting on me?" is answered from what is true (D11).
    /// </summary>
    public async Task<IReadOnlyList<object>> NeedsYouAtAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var organisationId = scope.OrganisationId;
        session.UseOrganisation(organisationId);
        var everything = scope.Level == NodeLevel.Organisation;
        var visible = new HashSet<Guid> { scope.Node.Id };
        var employees = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && e.Status != EmployeeStatuses.Released).OrderBy(e => e.Name).ToListAsync(cancellationToken);
        var idleDays = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Kind == "setting" && e.Key == AgentSettings.WorkforceIdleDays).ToListAsync(cancellationToken);
        var now = clock.GetUtcNow();
        var idle = employees.ToDictionary(e => e.Id, e => Work.WorkforceRules.Idle(e, idleDays, now));
        var needs = await NeedsYouAsync(organisationId, everything, visible, cancellationToken);
        return [.. needs, .. await WorkforceNeedsAsync(organisationId, everything, visible, employees.Where(e => idle[e.Id].Flagged).ToList(), idle, cancellationToken)];
    }

    private async Task<IReadOnlyList<object>> NeedsYouAsync(Guid organisationId, bool everything, HashSet<Guid> visible, CancellationToken cancellationToken)
    {
        var ideas = await db.Ideas.AsNoTracking()
            .Where(i => i.OrganisationId == organisationId && i.Status == IdeaStatuses.AwaitingDecision)
            .OrderBy(i => i.CreatedAt).ToListAsync(cancellationToken);
        var approvals = await (from a in db.Approvals.AsNoTracking()
                               join r in db.Runs.AsNoTracking() on new { a.OrganisationId, Id = a.RunId } equals new { r.OrganisationId, r.Id }
                               where a.OrganisationId == organisationId && a.Status == ApprovalStatuses.Pending
                               orderby a.RequestedAt
                               select new { Approval = a, r.DivisionId, r.ProjectId, r.AppId }).ToListAsync(cancellationToken);
        bool Sees(IScopedRecord row) => everything || new[] { row.DivisionId, row.ProjectId, row.AppId }.Any(id => id is { } x && visible.Contains(x));
        var technical = await Runs.ApprovalService.TechnicalAsync(db, organisationId, approvals.Select(a => a.Approval.Id).ToList(), cancellationToken);
        var needs = new List<object>();
        needs.AddRange(ideas.Where(Sees).Select(i => new VerdictNeed("verdict", i.Id, i.Id, IdeaTitle(i.Text), i.Verdict!, i.VerdictSummary)));
        foreach (var a in approvals.Where(a => everything || new[] { a.DivisionId, a.ProjectId, a.AppId }.Any(id => id is { } x && visible.Contains(x))))
        {
            // Rows from before the plain-detail fix read as a new one would (R2-5).
            var at = await scopes.ForRowAsync(organisationId, a.DivisionId, a.ProjectId, a.AppId, cancellationToken);
            var (title, detail, tech) = Runs.OlderApprovals.Plain(a.Approval.Title, a.Approval.Detail, technical.GetValueOrDefault(a.Approval.Id), at);
            needs.Add(new ApprovalNeed("approval", a.Approval.Id, a.Approval.RunId, a.Approval.Id, title, detail.Length == 0 ? null : detail, tech));
        }

        session.UseOrganisation(organisationId);
        return needs;
    }

    /// <summary>Hire proposals waiting for a decision, and employees flagged idle, in what the viewer can see.</summary>
    private async Task<IReadOnlyList<object>> WorkforceNeedsAsync(Guid organisationId, bool everything, HashSet<Guid> visible, IReadOnlyList<EmployeeRecord> idleEmployees, IReadOnlyDictionary<Guid, Work.IdleView> idle, CancellationToken cancellationToken)
    {
        bool Sees(IScopedRecord row) => everything || new[] { row.DivisionId, row.ProjectId, row.AppId }.Any(id => id is { } x && visible.Contains(x));
        var proposals = await db.HireProposals.AsNoTracking()
            .Where(h => h.OrganisationId == organisationId && h.Status == Domain.Workforce.HireStatuses.Proposed)
            .OrderBy(h => h.CreatedAt).ToListAsync(cancellationToken);
        var needs = new List<object>();
        foreach (var h in proposals.Where(Sees))
        {
            var path = (await scopes.ForRowAsync(h.OrganisationId, h.DivisionId, h.ProjectId, h.AppId, cancellationToken)).Path.ToString();
            needs.Add(new HireNeed("hire", h.Id, h.Id, $"Hire {h.Name} as {h.Role}?", h.Reason, path, h.ExpectedMonthlyCredits));
        }

        session.UseOrganisation(organisationId);
        needs.AddRange(idleEmployees.Where(Sees).Select(e => new IdleNeed("idle", e.Id, e.Id, $"{e.Name} has had no work for over {idle[e.Id].AfterDays} days",
            "Release them to stop paying for an idle workforce: their memory is kept, so a rehire starts where they left off.")));
        return needs;
    }

    private static (string Stage, string? Note) ProjectStage(Project project, RunRecord? active, RunRecord? last, IReadOnlyList<App> apps)
    {
        if (project.Status == NodeStatuses.Archived)
        {
            return ("paused", "Archived.");
        }

        if (active is not null)
        {
            var stage = active.Kind switch
            {
                RunKinds.Research => "researching",
                RunKinds.Review => "reviewing",
                _ => "building",
            };
            return active.Status switch
            {
                RunStatuses.Paused => ("paused", "Work here is paused."),
                RunStatuses.WaitingApproval => (stage, "Waiting for your approval."),
                _ => (stage, null),
            };
        }

        if (apps.Any(a => a.Status is NodeStatuses.Running or NodeStatuses.Sleeping))
        {
            return ("live", null);
        }

        return last?.Status == RunStatuses.Failed ? ("planning", "The last piece of work failed.") : ("planning", null);
    }

    /// <summary>Why Edge serves an app's holding page, from the same routing table Edge reads (D66); null when it is served.</summary>
    public static PausedView? Paused(RouteView? route) => route?.Paused != true
        ? null
        : route.PausedReason == Application.Gateway.Refusals.OverdraftLimit
            ? new PausedView(Application.Gateway.Refusals.OverdraftLimit, "Paused: the organisation reached its overdraft limit. A top-up restores it at once.")
            : new PausedView(Application.Gateway.Refusals.BudgetExhausted, "Paused: a monthly budget above it is spent. Raising the budget or the new month restores it.");

    /// <summary>
    /// The apps that were never built because their latest build stopped (D81): never published, and the newest build placed
    /// in them failed or was cancelled. Kept as they are, so "Try again" still works, and said plainly.
    /// </summary>
    private async Task<Dictionary<Guid, NotBuiltView>> NotBuiltAsync(Guid organisationId, IReadOnlyList<App> apps, CancellationToken cancellationToken)
    {
        var unbuilt = apps.Where(a => a.PublishedAt is null && a.Status is NodeStatuses.Draft or NodeStatuses.Building).Select(a => (Guid?)a.Id).ToList();
        if (unbuilt.Count == 0)
        {
            return [];
        }

        var builds = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == organisationId && r.Kind == RunKinds.Build && unbuilt.Contains(r.AppId))
            .GroupBy(r => r.AppId)
            .Select(g => g.OrderByDescending(r => r.CreatedAt).First())
            .ToListAsync(cancellationToken);
        return builds.Where(r => r.Status is RunStatuses.Failed or RunStatuses.Cancelled)
            .ToDictionary(r => r.AppId!.Value, NotBuilt);
    }

    /// <summary>What a build that stopped before publishing anything says on the chart and the app page.</summary>
    public static NotBuiltView NotBuilt(RunRecord build)
    {
        ArgumentNullException.ThrowIfNull(build);
        var reason = StopReason(build);
        var note = reason switch
        {
            "cancelled" => "Not built — the build was cancelled.",
            "budget" => "Not built — the build stopped when the budget ran out.",
            "plan-declined" => "Not built — the plan was declined.",
            _ => "Not built — the build stopped before it finished.",
        };
        return new NotBuiltView(reason, note, build.Id, build.IdeaId);
    }

    /// <summary>Why a failed or cancelled run stopped: <c>cancelled</c>, <c>budget</c>, <c>plan-declined</c> or <c>failed</c>.</summary>
    public static string StopReason(RunRecord run)
    {
        ArgumentNullException.ThrowIfNull(run);
        return run.Status == RunStatuses.Cancelled ? "cancelled"
            : run.BudgetExhaustedAt is not null ? "budget"
            : run.Summary?.StartsWith("The owner rejected the plan", StringComparison.Ordinal) == true ? "plan-declined"
            : "failed";
    }

    /// <summary>
    /// An app's health: down when it failed; otherwise what its own telemetry measured over the last
    /// fifteen minutes (degraded when more than one response in twenty failed); healthy for a running
    /// or sleeping app that has not reported yet; unknown before it runs.
    /// </summary>
    public static string AppHealth(string status, Platform.AppTelemetrySummary? measured = null) => status switch
    {
        NodeStatuses.Failed => "down",
        NodeStatuses.Running or NodeStatuses.Sleeping when measured is not null => measured.Health,
        NodeStatuses.Running or NodeStatuses.Sleeping => "healthy",
        _ => "unknown",
    };

    public static string AppRunning(string status, bool alwaysOn) => status switch
    {
        NodeStatuses.Sleeping => "asleep",
        NodeStatuses.Running => alwaysOn ? "always-on" : "awake",
        NodeStatuses.Draft or NodeStatuses.Building => "starting",
        _ => "paused",
    };

    private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";

    public static string IdeaTitle(string text)
    {
        var line = text.Split('\n', 2)[0].Trim();
        return line.Length <= 120 ? line : line[..117] + "...";
    }

    // ---------------------------------------------------------------- ideas

    public async Task<PublicIdeaView> IdeaAsync(Guid organisationId, Guid ideaId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        var researchRuns = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == organisationId && r.IdeaId == ideaId && r.Kind == RunKinds.Research)
            .OrderByDescending(r => r.CreatedAt).ToListAsync(cancellationToken);
        var (_, spent) = await RunCostsAsync(organisationId, researchRuns.Select(r => r.Id).ToArray(), cancellationToken);
        var latest = researchRuns.FirstOrDefault();
        var by = latest?.EmployeeId is { } employee
            ? await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && e.Id == employee).Select(e => e.Name).SingleOrDefaultAsync(cancellationToken)
            : null;
        var status = idea.Status switch
        {
            IdeaStatuses.Researching when latest is not null && latest.Status is RunStatuses.Failed or RunStatuses.Cancelled => "failed",
            IdeaStatuses.Researching => "researching",
            IdeaStatuses.AwaitingDecision => "verdict",
            _ => "decided",
        };
        DecisionView? decision = null;
        if (idea.Decision is not null && idea.DecidedAt is { } at)
        {
            var decider = idea.DecidedBy is { } user ? await db.Users.AsNoTracking().Where(u => u.Id == user).Select(u => u.DisplayName).SingleOrDefaultAsync(cancellationToken) : null;
            var follow = idea.Decision switch
            {
                IdeaDecisions.Build or IdeaDecisions.Overrule => idea.BuildRunId,
                IdeaDecisions.Change => idea.ResearchRunId,
                _ => null,
            };
            decision = new DecisionView(idea.Decision, at, idea.DecidedVia == IdeaDecisions.ByAutoMode ? "auto-mode" : decider ?? "", idea.Overruled, follow, idea.DecidedVia ?? IdeaDecisions.ByPerson);
        }

        string? placed = null;
        if (idea.BuildRunId is { } build && await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == organisationId && r.Id == build, cancellationToken) is { ProjectId: not null } buildRun)
        {
            placed = (await scopes.ForRowAsync(organisationId, buildRun.DivisionId, buildRun.ProjectId, buildRun.AppId, cancellationToken)).Path.ToString();
        }

        TryAgainView? tryAgain = null;
        if (status == "failed" && latest is not null)
        {
            tryAgain = new TryAgainView(latest.Id, "research", (await FinishedAsync(latest, cancellationToken)).Reason == DeclinedAtStart ? "start-declined"
                : latest.Status == RunStatuses.Cancelled ? "cancelled" : latest.BudgetExhaustedAt is not null ? "budget" : "failed");
        }
        else if (idea.Status == IdeaStatuses.Building && idea.BuildRunId is { } lastBuild
                 && await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == organisationId && r.Id == lastBuild, cancellationToken) is { Status: RunStatuses.Failed or RunStatuses.Cancelled } stopped)
        {
            tryAgain = new TryAgainView(stopped.Id, "build", (await FinishedAsync(stopped, cancellationToken)).Reason == DeclinedAtStart ? "start-declined" : StopReason(stopped));
        }

        var history = await DecisionHistoryAsync(organisationId, researchRuns, cancellationToken);
        session.UseOrganisation(organisationId);
        return new PublicIdeaView(
            idea.Id, IdeaTitle(idea.Text), idea.Text, SplitConstraints(idea.Constraints), status, idea.ResearchRunId ?? Guid.Empty, placed,
            new ResearchView(idea.ResearchEstimateCredits, spent.Values.Sum(), by),
            idea.Verdict is null || idea.VerdictEvidenceJson is null ? null : JsonNode.Parse(idea.VerdictEvidenceJson),
            decision,
            await VerdictRecordAsync(organisationId, cancellationToken),
            idea.RedLine,
            history,
            tryAgain);
    }

    /// <summary>
    /// The decisions taken on earlier rounds of research, oldest first, read from the research runs themselves: each round
    /// after the first was asked for by a "change" (with the owner's note) after a verdict, or started again after research
    /// that did not finish. The latest round's own decision is the idea's current one.
    /// </summary>
    private async Task<IReadOnlyList<DecisionHistoryView>> DecisionHistoryAsync(Guid organisationId, List<RunRecord> newestFirst, CancellationToken cancellationToken)
    {
        var rounds = newestFirst.AsEnumerable().Reverse().ToList();
        if (rounds.Count < 2)
        {
            return [];
        }

        var ids = rounds.Select(r => r.Id).ToList();
        var events = await db.RunEvents.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && ids.Contains(e.RunId) && e.Type == RunEventTypes.Message)
            .Select(e => new { e.RunId, e.Seq, e.PayloadJson }).ToListAsync(cancellationToken);
        JsonObject? Owner(Guid run) => events.Where(e => e.RunId == run).OrderBy(e => e.Seq).Select(e => JsonNode.Parse(e.PayloadJson) as JsonObject).FirstOrDefault(p => Text(p?["from"]) == "owner");
        JsonObject? Verdict(Guid run) => events.Where(e => e.RunId == run).OrderByDescending(e => e.Seq).Select(e => JsonNode.Parse(e.PayloadJson) as JsonObject)
            .FirstOrDefault(p => Text(p?["kind"]) == "workflow.step" && Text(p?["step"]) == "verdict")?["data"] as JsonObject;
        var people = rounds.Select(r => r.CreatedBy).OfType<Guid>().Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => people.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, cancellationToken);
        var history = new List<DecisionHistoryView>();
        for (var i = 0; i < rounds.Count - 1; i++)
        {
            var next = rounds[i + 1];
            var verdict = Verdict(rounds[i].Id);
            var owner = Owner(next.Id);
            var by = next.CreatedBy is { } who && names.TryGetValue(who, out var name) ? name : "";
            history.Add(new DecisionHistoryView(Text(verdict?["outcome"]), Text(verdict?["headline"]), Text(owner?["retryOf"]) is null ? "change" : "retry",
                Text(owner?["change"]), by, next.CreatedAt, next.Id));
        }

        return history;
    }

    public static IReadOnlyList<string> SplitConstraints(string constraints) =>
        constraints.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>How often the research said no, and how the overruled ones turned out (spec: a verdict that never says no is a fault).</summary>
    private async Task<VerdictRecordView> VerdictRecordAsync(Guid organisationId, CancellationToken cancellationToken)
    {
        var decided = await db.Ideas.AsNoTracking().Where(i => i.OrganisationId == organisationId && i.Verdict != null)
            .Select(i => new { i.Id, i.Text, i.Verdict, i.Overruled, i.BuildRunId }).ToListAsync(cancellationToken);
        var overruled = new List<OverruledView>();
        foreach (var idea in decided.Where(i => i.Overruled))
        {
            var outcome = idea.BuildRunId is { } run
                ? await db.Runs.AsNoTracking().Where(r => r.OrganisationId == organisationId && r.Id == run).Select(r => r.Status).SingleOrDefaultAsync(cancellationToken)
                : null;
            overruled.Add(new OverruledView(idea.Id, IdeaTitle(idea.Text), idea.Verdict!, outcome is null ? "not started" : RunStatus(outcome)));
        }

        return new VerdictRecordView(decided.Count, decided.Count(i => i.Verdict == Verdicts.Build), decided.Count(i => i.Verdict == Verdicts.Change),
            decided.Count(i => i.Verdict == Verdicts.DoNotBuild), overruled);
    }

    // ---------------------------------------------------------------- apps

    public async Task<PublicAppView> AppAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var app = await db.Apps.AsNoTracking().SingleAsync(a => a.OrganisationId == scope.OrganisationId && a.Id == scope.AppId, cancellationToken);
        var entries = await cascade.ChainEntriesAsync(scope, null, cancellationToken);
        var mode = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.SleepMode, entries);
        var idle = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.SleepIdleMinutes, entries);
        var cap = CascadeResolver.ResolveKey(CascadeKind.Budget, CascadeKeys.MonthlyCredits, entries);
        var accessEntry = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.Access, entries);
        var access = accessEntry is not null && JsonNode.Parse(accessEntry.Entry.ValueJson) is JsonValue av && av.GetValueKind() == JsonValueKind.String ? av.GetValue<string>() : Domain.Platform.AppAccess.Private;
        var alwaysOn = mode is not null && JsonNode.Parse(mode.Entry.ValueJson)?.ToString() == "always_on";
        var spent = (await ledger.SpendThisMonthByNodeAsync(scope.OrganisationId, cancellationToken)).Where(s => s.AppId == app.Id).Sum(s => s.Credits);
        var measured = (await telemetry.SummariesAsync(scope.OrganisationId, app.Id, cancellationToken)).GetValueOrDefault(app.Id);
        var sharedWith = await db.AppShares.AsNoTracking().CountAsync(x => x.OrganisationId == scope.OrganisationId && x.AppId == app.Id, cancellationToken);
        var endUsers = await db.AppEndUsers.AsNoTracking().CountAsync(x => x.OrganisationId == scope.OrganisationId && x.AppId == app.Id, cancellationToken);
        var runningCost = await hosting.RunningCostAsync(scope.OrganisationId, app.Id, cancellationToken);
        var route = (await tree.RoutesAsync(cancellationToken)).Routes.FirstOrDefault(r => r.AppId == app.Id);
        session.UseOrganisation(scope.OrganisationId);
        var addresses = tree.Addresses(scope.Path);
        var paused = Paused(route);
        var notBuilt = (await NotBuiltAsync(scope.OrganisationId, [app], cancellationToken)).GetValueOrDefault(app.Id);
        session.UseOrganisation(scope.OrganisationId);
        // While Edge serves the holding page, the app is paused, not healthy, whatever it measured before (D66).
        var health = paused is null ? AppHealth(app.Status, measured) : "paused";
        var summary = app.Status switch
        {
            _ when paused is not null => paused.Note,
            _ when notBuilt is not null => notBuilt.Note,
            NodeStatuses.Running when health == "degraded" => $"Running, but {measured!.RecentErrors} of the last {measured.RecentRequests} responses failed.",
            NodeStatuses.Running => app.CurrentVersion is null ? "Running." : $"Running version {app.CurrentVersion}.",
            NodeStatuses.Sleeping => "Asleep; it wakes on the next visit.",
            NodeStatuses.Failed => "It stopped working and needs attention.",
            NodeStatuses.Draft => "Not published yet.",
            NodeStatuses.Building => "Being built.",
            NodeStatuses.Stopped => "Stopped.",
            _ => "Archived.",
        };
        JsonNode? telemetryView = measured is null ? null : new JsonObject
        {
            ["visitsToday"] = measured.VisitsToday,
            ["requestsToday"] = measured.RequestsToday,
            ["errorsToday"] = measured.ErrorsToday,
            ["latencyP50Ms"] = measured.LatencyP50Ms,
            ["latencyP95Ms"] = measured.LatencyP95Ms,
            ["lastVisitAt"] = measured.LastVisitAt,
        };
        return new PublicAppView(app.Id, app.Name, scope.Path.ToString(), new HealthView(health, summary), paused is not null ? "paused" : AppRunning(app.Status, alwaysOn),
            new AppAddressesView(addresses.Path, addresses.Subdomain), telemetryView,
            new CostView(spent, cap is null ? null : CascadeService.NumberOf(JsonNode.Parse(cap.Entry.ValueJson))),
            new AppSettingsView(alwaysOn ? "always-on" : "sleep", access), runningCost, sharedWith, endUsers, app.Status, app.CurrentVersion, app.PublishedAt,
            idle is null ? TreeService.DefaultIdleMinutes : (int)(CascadeService.NumberOf(JsonNode.Parse(idle.Entry.ValueJson)) ?? TreeService.DefaultIdleMinutes),
            paused, notBuilt);
    }

    // ---------------------------------------------------------------- credits

    public async Task<CreditsView> CreditsAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var org = scope.OrganisationId;
        var now = clock.GetUtcNow();
        var month = CreditLedger.MonthStart(now);
        var position = await ledger.PositionAsync(scope, now, cancellationToken);

        decimal spent, ai, notCharged;
        long repairs;
        await using (var command = await db.CommandAsync("""
            SELECT COALESCE(SUM(amount) FILTER (WHERE billable), 0),
                   COALESCE(SUM(amount) FILTER (WHERE billable AND kind = 'settlement'), 0),
                   COALESCE(SUM(amount) FILTER (WHERE NOT billable), 0),
                   COUNT(*) FILTER (WHERE NOT billable)
            FROM credit_entries
            WHERE organisation_id = @org AND kind IN ('settlement', 'hosting') AND created_at >= @month
              AND (@division IS NULL OR division_id = @division) AND (@project IS NULL OR project_id = @project) AND (@app IS NULL OR app_id = @app)
            """, cancellationToken, P("org", org), P("month", month), P("division", scope.DivisionId), P("project", scope.ProjectId), P("app", scope.AppId)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            spent = reader.GetDecimal(0);
            ai = reader.GetDecimal(1);
            notCharged = reader.GetDecimal(2);
            repairs = reader.GetInt64(3);
        }

        // Pace: this month's organisation-wide spend so far, stretched to a month.
        var orgMonth = (await ledger.SpendThisMonthByNodeAsync(org, cancellationToken)).Sum(s => s.Credits);
        var elapsedDays = Math.Max((decimal)(now - month).TotalDays, 1m / 24m);
        decimal? monthsLeft = orgMonth <= 0 ? null : position.Balance <= 0 ? 0m : decimal.Round(position.Balance / (orgMonth / elapsedDays * 30m), 1);

        var budgets = await BudgetLinesAsync(scope, month, cancellationToken);
        var estimates = await EstimatesAsync(scope, cancellationToken, null);
        var settings = await cascade.ChainEntriesAsync(scope, CascadeKind.Setting, cancellationToken);
        var frostaura = CascadeService.OperatorOverdraft(settings);
        var own = settings.Where(e => (e.Key == CascadeKeys.OverdraftOwnLimit && e.Level == NodeLevel.Organisation) || (e.Key == CascadeKeys.OverdraftLimit && e.Level > NodeLevel.Organisation))
            .Select(e => CascadeService.NumberOf(JsonNode.Parse(e.ValueJson)) ?? 0m).DefaultIfEmpty(-1m).Min();
        var limits = await OverdraftLimitsAsync(scope, cancellationToken);
        var topUps = await db.CreditEntries.AsNoTracking().Where(e => e.OrganisationId == org && e.Kind == "top_up")
            .OrderByDescending(e => e.CreatedAt).Take(50)
            .Select(e => new TopUpView(e.CreatedAt, e.Amount, e.Note ?? "")).ToListAsync(cancellationToken);
        return new CreditsView(scope.Path.ToString(), position.Balance, new MonthView(spent, ai, spent - ai), monthsLeft, budgets, estimates,
            new NotChargedView(notCharged, repairs), new OverdraftView(frostaura, own < 0 ? null : own, limits), topUps,
            position.HeldOrganisation, position.Balance + position.OverdraftLimit, topUps.Count == 0);
    }

    /// <summary>The narrower overdraft limits (division, project, app) on the scope's chain above it and beneath it, in tree order.</summary>
    private async Task<IReadOnlyList<OverdraftLimitView>> OverdraftLimitsAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        var org = scope.OrganisationId;
        var rows = (await (from e in db.CascadeEntries.AsNoTracking()
                           join u in db.Users.AsNoTracking() on e.SetBy equals u.Id into people
                           from u in people.DefaultIfEmpty()
                           where e.OrganisationId == org && e.Kind == "setting" && e.Key == CascadeKeys.OverdraftLimit && e.DivisionId != null
                           select new { Entry = e, SetByName = u == null ? null : u.DisplayName }).ToListAsync(cancellationToken))
            .Where(r => scope.OnChain(r.Entry) || scope.Contains(r.Entry)).ToList();
        var views = new List<OverdraftLimitView>();
        foreach (var r in rows)
        {
            var node = await scopes.ForRowAsync(org, r.Entry.DivisionId, r.Entry.ProjectId, r.Entry.AppId, cancellationToken);
            views.Add(new OverdraftLimitView(node.Path.ToString(), node.Node.Name, node.Level.ToWire(), CascadeService.NumberOf(JsonNode.Parse(r.Entry.ValueJson)) ?? 0m,
                r.Entry.SetAt, r.Entry.SetBy, r.SetByName));
        }

        session.UseOrganisation(org);
        return views.OrderBy(v => v.Scope, StringComparer.Ordinal).ToList();
    }

    /// <summary>Every node at and beneath the scope, in tree order, with its own cap and this month's spend; employees with a cap follow their node.</summary>
    private async Task<IReadOnlyList<BudgetLineView>> BudgetLinesAsync(ResolvedScope scope, DateTimeOffset month, CancellationToken cancellationToken)
    {
        var org = scope.OrganisationId;
        var spend = await ledger.SpendThisMonthByNodeAsync(org, cancellationToken);
        var caps = await db.CascadeEntries.AsNoTracking().Where(e => e.OrganisationId == org && e.Kind == "budget" && e.Key == CascadeKeys.MonthlyCredits).ToListAsync(cancellationToken);
        var employees = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == org && e.MonthlyCreditLimit != null && e.Status != EmployeeStatuses.Released).ToListAsync(cancellationToken);
        // An employee's cap covers the contractors it briefs (CreditLedger), so its row counts their spend too.
        var briefers = employees.Select(e => (Guid?)e.Id).ToList();
        var contractorsOf = (await db.Employees.AsNoTracking().Where(e => e.OrganisationId == org && e.BriefedById != null && briefers.Contains(e.BriefedById))
                .Select(e => new { e.Id, e.BriefedById }).ToListAsync(cancellationToken))
            .ToLookup(e => e.BriefedById!.Value, e => e.Id);
        var divisions = await db.Divisions.AsNoTracking().Where(d => d.OrganisationId == org && (scope.DivisionId == null || d.Id == scope.DivisionId)).OrderBy(d => d.Name).ToListAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(p => p.OrganisationId == org && (scope.ProjectId == null || p.Id == scope.ProjectId)).OrderBy(p => p.Name).ToListAsync(cancellationToken);
        var apps = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == org && (scope.AppId == null || a.Id == scope.AppId)).OrderBy(a => a.Name).ToListAsync(cancellationToken);
        _ = month;
        var lines = new List<BudgetLineView>();
        var top = (int)scope.Level;

        decimal? Cap(Guid? d, Guid? p, Guid? a) => caps.FirstOrDefault(c => c.DivisionId == d && c.ProjectId == p && c.AppId == a) is { } c ? CascadeService.NumberOf(JsonNode.Parse(c.ValueJson)) : null;

        void Add(string path, string name, NodeLevel level, decimal spent, decimal? cap, Guid? appId, Guid? d, Guid? p, Guid? a)
        {
            lines.Add(new BudgetLineView(path, name, level.ToWire(), (int)level - top, spent, cap, appId));
            foreach (var e in employees.Where(e => e.DivisionId == d && e.ProjectId == p && e.AppId == a).OrderBy(e => e.Name))
            {
                var counted = contractorsOf[e.Id].Append(e.Id).ToHashSet();
                lines.Add(new BudgetLineView(path, e.Name, "employee", (int)level - top + 1, spend.Where(s => s.EmployeeId is { } x && counted.Contains(x)).Sum(s => s.Credits), e.MonthlyCreditLimit, null, e.Id));
            }
        }

        var orgNode = scope.Nodes[0];
        if (scope.Level == NodeLevel.Organisation)
        {
            Add(orgNode.Path, orgNode.Name, NodeLevel.Organisation, spend.Sum(s => s.Credits), Cap(null, null, null), null, null, null, null);
        }

        foreach (var d in divisions)
        {
            var dPath = $"{orgNode.Slug}/{d.Slug}";
            if (scope.Level <= NodeLevel.Division)
            {
                Add(dPath, d.Name, NodeLevel.Division, spend.Where(s => s.DivisionId == d.Id).Sum(s => s.Credits), Cap(d.Id, null, null), null, d.Id, null, null);
            }

            foreach (var p in projects.Where(p => p.DivisionId == d.Id))
            {
                var pPath = $"{dPath}/{p.Slug}";
                if (scope.Level <= NodeLevel.Project)
                {
                    Add(pPath, p.Name, NodeLevel.Project, spend.Where(s => s.ProjectId == p.Id).Sum(s => s.Credits), Cap(d.Id, p.Id, null), null, d.Id, p.Id, null);
                }

                foreach (var a in apps.Where(a => a.ProjectId == p.Id))
                {
                    Add($"{pPath}/{a.Slug}", a.Name, NodeLevel.App, spend.Where(s => s.AppId == a.Id).Sum(s => s.Credits), Cap(d.Id, p.Id, a.Id), a.Id, d.Id, p.Id, a.Id);
                }
            }
        }

        return lines;
    }

    /// <summary>
    /// Estimates scored against what the work cost, in the scope (and for one employee when given — the run's owner, or
    /// for a run nobody owns, such as a factory build or research, the employee its billable model calls were mostly charged
    /// to, a contractor's calls counting as its briefer's, so the researcher who led the work is scored for it (D75)): the
    /// Runner's <c>estimate.scored { expectedCredits, actualCredits }</c>, and the older
    /// <c>{ estimated, actual }</c>. Null before any was scored.
    /// </summary>
    public async Task<EstimatesView?> EstimatesAsync(ResolvedScope scope, CancellationToken cancellationToken, Guid? employeeId = null)
    {
        ArgumentNullException.ThrowIfNull(scope);
        await using var command = await db.CommandAsync("""
            SELECT x.estimated, x.actual FROM (
                SELECT CASE WHEN jsonb_typeof(e.payload -> 'expectedCredits') = 'number' THEN (e.payload ->> 'expectedCredits')::numeric
                            WHEN jsonb_typeof(e.payload -> 'estimated') = 'number' THEN (e.payload ->> 'estimated')::numeric END AS estimated,
                       CASE WHEN jsonb_typeof(e.payload -> 'actualCredits') = 'number' THEN (e.payload ->> 'actualCredits')::numeric
                            WHEN jsonb_typeof(e.payload -> 'actual') = 'number' THEN (e.payload ->> 'actual')::numeric END AS actual
                FROM run_events e
                JOIN runs r ON r.organisation_id = e.organisation_id AND r.id = e.run_id
                WHERE e.organisation_id = @org AND e.type = 'estimate.scored'
                  AND (@division IS NULL OR r.division_id = @division) AND (@project IS NULL OR r.project_id = @project) AND (@app IS NULL OR r.app_id = @app)
                  AND (@employee IS NULL OR COALESCE(r.employee_id, (
                        SELECT COALESCE(w.briefed_by, c.employee_id) FROM credit_entries c
                        LEFT JOIN employees w ON w.organisation_id = c.organisation_id AND w.id = c.employee_id
                        WHERE c.organisation_id = r.organisation_id AND c.run_id = r.id AND c.kind = 'settlement' AND c.billable AND c.employee_id IS NOT NULL
                        GROUP BY COALESCE(w.briefed_by, c.employee_id) ORDER BY SUM(c.amount) DESC, COALESCE(w.briefed_by, c.employee_id) LIMIT 1)) = @employee)) x
            WHERE x.estimated IS NOT NULL AND x.actual IS NOT NULL
            """, cancellationToken, P("org", scope.OrganisationId), P("division", scope.DivisionId), P("project", scope.ProjectId), P("app", scope.AppId), P("employee", employeeId));
        var pieces = new List<(decimal Estimated, decimal Actual)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                pieces.Add((reader.GetDecimal(0), reader.GetDecimal(1)));
            }
        }

        if (pieces.Count == 0)
        {
            return null;
        }

        static decimal Miss((decimal Estimated, decimal Actual) p) => p.Estimated == 0 ? (p.Actual == 0 ? 0 : 1) : Math.Abs(p.Actual - p.Estimated) / p.Estimated;
        var within = pieces.Count(p => Miss(p) <= EstimateTolerance);
        var gap = TypicalGap(pieces);
        return new EstimatesView(pieces.Count, decimal.Round(100m * within / pieces.Count, 1),
            pieces.Count(p => p.Actual < p.Estimated && Miss(p) > EstimateTolerance), pieces.Count(p => p.Actual > p.Estimated && Miss(p) > EstimateTolerance),
            decimal.Round(pieces.Max(Miss) * 100m, 1),
            gap is { } typical ? decimal.Round(typical * 100m, 1) : null,
            gap switch { null => null, var g when Math.Abs(g.Value) <= EstimateTolerance => "within", < 0 => "under", _ => "over" });
    }

    /// <summary>The median of (actual − estimate) / estimate over the pieces that had an estimate above zero: the typical gap, with its direction.</summary>
    public static decimal? TypicalGap(IReadOnlyList<(decimal Estimated, decimal Actual)> pieces)
    {
        ArgumentNullException.ThrowIfNull(pieces);
        var gaps = pieces.Where(p => p.Estimated > 0).Select(p => (p.Actual - p.Estimated) / p.Estimated).Order().ToList();
        return gaps.Count == 0 ? null : gaps.Count % 2 == 1 ? gaps[gaps.Count / 2] : (gaps[(gaps.Count / 2) - 1] + gaps[gaps.Count / 2]) / 2m;
    }

    /// <summary>
    /// What finished runs of a kind actually cost, newest first, in one organisation only (tenant data is
    /// never used across organisations): billable settlements per run and its model calls.
    /// </summary>
    public async Task<IReadOnlyList<CostHistoryView>> CostHistoryAsync(Guid organisationId, string kind, int limit, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        await using var command = await db.CommandAsync("""
            SELECT r.id, r.finished_at,
                   COALESCE((SELECT SUM(c.amount) FROM credit_entries c
                             WHERE c.organisation_id = r.organisation_id AND c.run_id = r.id AND c.kind = 'settlement' AND c.billable), 0),
                   (SELECT COUNT(*) FROM run_events e WHERE e.organisation_id = r.organisation_id AND e.run_id = r.id AND e.type = 'model.replied')
            FROM runs r
            WHERE r.organisation_id = @org AND r.kind = @kind AND r.status = 'succeeded'
            ORDER BY r.finished_at DESC
            LIMIT @limit
            """, cancellationToken, P("org", organisationId), P("kind", kind), P("limit", Math.Clamp(limit, 1, MaxCostHistory)));
        var rows = new List<CostHistoryView>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new CostHistoryView(reader.GetGuid(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetDecimal(2), (int)reader.GetInt64(3)));
        }

        return rows;
    }

    public const int MaxCostHistory = 200;

    // ---------------------------------------------------------------- conversations

    public const int MaxConversationMessages = 200;

    public async Task<ConversationHistoryView> ConversationAsync(ResolvedScope scope, Guid? employeeId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var conversation = await db.Conversations.AsNoTracking()
            .Where(c => c.OrganisationId == scope.OrganisationId && c.DivisionId == scope.DivisionId && c.ProjectId == scope.ProjectId && c.AppId == scope.AppId && c.EmployeeId == employeeId)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        if (conversation is null)
        {
            return new ConversationHistoryView(scope.Path.ToString(), null, employeeId, []);
        }

        var rows = await (from e in db.RunEvents.AsNoTracking()
                          join r in db.Runs.AsNoTracking() on new { e.OrganisationId, Id = e.RunId } equals new { r.OrganisationId, r.Id }
                          where e.OrganisationId == scope.OrganisationId && r.ConversationId == conversation.Id && e.Type == RunEventTypes.Message
                          orderby e.At descending, e.Seq descending
                          select new { e.RunId, e.Seq, e.At, e.PayloadJson }).Take(MaxConversationMessages).ToListAsync(cancellationToken);
        var parsed = rows.AsEnumerable().Reverse().Select(m => (m.RunId, m.Seq, m.At, Payload: JsonNode.Parse(m.PayloadJson) as JsonObject))
            // Bookkeeping (a workflow's journal, an agent's start) is not something anyone said.
            .Where(m => Text(m.Payload?["kind"]) is null && !string.IsNullOrEmpty(Text(m.Payload?["text"])))
            .ToList();
        // A conversation at a level is shared by everyone there, so each message says who sent it (TALK-11).
        var senders = parsed.Select(m => Guid.TryParse(Text(m.Payload?["userId"]), out var u) ? u : (Guid?)null).OfType<Guid>().Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => senders.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, cancellationToken);
        var messages = parsed.Select(m =>
        {
            var from = Text(m.Payload?["from"]) ?? "employee";
            var by = from == "owner"
                ? Guid.TryParse(Text(m.Payload?["userId"]), out var user) && names.TryGetValue(user, out var name) ? name : null
                : Text(m.Payload?["by"]);
            return new ConversationMessageView(m.RunId, m.Seq, m.At, from, Text(m.Payload?["text"]) ?? "", by, Text(m.Payload?["code"]));
        }).ToList();
        return new ConversationHistoryView(scope.Path.ToString(), conversation.Id, employeeId, messages);
    }

    private static string? Text(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;
}
