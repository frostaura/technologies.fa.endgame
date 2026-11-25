using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Cascade;
using Endgame.Domain.Runs;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Work;

public sealed record PersonRef(Guid Id, string Name);

/// <summary>An employee's job description: its mandate, where in the cascade it works, what it may use, what it may spend and at which model tier.</summary>
public sealed record JobDescriptionView(string Mandate, string Scope, IReadOnlyList<string> Tools, IReadOnlyList<string> Services, decimal? MonthlyCreditLimit, string? ModelTier);

/// <summary>Whether the employee has had no work for longer than <see cref="AfterDays"/> (setting <c>workforce.idle_days</c>), and since when.</summary>
public sealed record IdleView(bool Flagged, DateTimeOffset? Since, int AfterDays);

public sealed record CurrentRunView(Guid Id, string Title);

/// <summary>A member of the workforce, as the console and the Runner read it.</summary>
/// <param name="Kind"><c>employee</c> or <c>contractor</c>.</param>
/// <param name="Status"><c>idle</c>, <c>working</c>, <c>paused</c> or <c>released</c>.</param>
/// <param name="Standing">A standing hire's role (<c>security-reviewer</c>), never released; null otherwise.</param>
public sealed record EmployeeView(
    Guid Id,
    string Kind,
    string Name,
    string Role,
    string Status,
    string? Standing,
    string Scope,
    PersonRef? ReportsTo,
    PersonRef? BriefedBy,
    JobDescriptionView JobDescription,
    IdleView Idle,
    CurrentRunView? CurrentRun,
    Guid? LastRunId,
    DateTimeOffset? LastActiveAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReleasedAt,
    int MemoryEntries,
    string? Brief);

/// <param name="Accepted">Pieces of work accepted: judgements of its work that passed, plus tasks it finished and runs of its own that nobody judged.</param>
/// <param name="SentBack">Pieces of work sent back: judgements of its work that failed.</param>
/// <param name="AcceptedPercent">Accepted out of accepted and sent back; null before any.</param>
/// <param name="Judged">Judgements it made of other employees' work (as the evaluator).</param>
public sealed record WorkCountsView(int Accepted, int SentBack, decimal? AcceptedPercent, int Judged);

public sealed record RunCountsView(int Finished, int Succeeded, int Failed, int Cancelled);

public sealed record CostToDateView(decimal ToDateCredits, decimal MonthCredits);

/// <summary>Repairs of its own failed work: recorded, never charged (CLAUDE.md rule 9).</summary>
public sealed record RepairsNotChargedView(decimal Credits, long Calls);

/// <summary>Contractors this employee briefed: how many, how many are working now, and what they cost (charged to the briefs' scopes).</summary>
public sealed record ContractorSpendView(int Engaged, int Working, decimal ToDateCredits, decimal MonthCredits);

/// <summary>An employee's track record, derived at read time from its runs, their logs and the ledger — never stored as counters.</summary>
public sealed record TrackRecordView(Guid EmployeeId, WorkCountsView Work, RunCountsView Runs, RepairsNotChargedView RepairsNotCharged, CostToDateView Cost, ContractorSpendView Contractors, EstimatesView? Estimates);

/// <summary><c>GET /api/employees/{id}</c>: the employee, its track record, the contractors it has working now and who reports to it.</summary>
public sealed record EmployeeDetailView(EmployeeView Employee, TrackRecordView TrackRecord, IReadOnlyList<EmployeeView> Contractors, IReadOnlyList<EmployeeView> Reports);

/// <summary>A job description as written by the owner, a proposal or the Runner. Null fields keep what is there.</summary>
public sealed record JobDescriptionInput(string? Mandate, IReadOnlyList<string>? Tools, IReadOnlyList<string>? Services, decimal? MonthlyCreditLimit, string? ModelTier);

/// <summary>
/// The workforce records the control plane keeps (spec, <i>Workforce</i>): employees with their job
/// descriptions and their place on the org chart, contractors, movement (reassign, change budget or
/// tier, release, rehire), the idle flag and the track record. State moves with the run that changes
/// it; the track record is derived from runs and the ledger at read time (ARCH-002).
/// </summary>
public sealed partial class EmployeeService(
    EndgameDbContext db,
    TenantSession session,
    ScopeResolver scopes,
    CascadeService cascade,
    MemoryService memory,
    ReadModels reads,
    ModelGatewayOptions routes,
    TimeProvider clock)
{
    /// <summary>The platform services an employee may be allowed to use.</summary>
    public static readonly IReadOnlyList<string> PlatformServices = ["identity", "models", "secrets", "email", "schedules", "webhooks", "telemetry"];

    public const string SecurityReviewerName = "Security reviewer";

    /// <summary>The standing security reviewer every organisation has from creation (spec: one standing hire).</summary>
    public static EmployeeRecord SecurityReviewer(Guid organisationId, DateTimeOffset now) => new()
    {
        Id = Guid.NewGuid(),
        OrganisationId = organisationId,
        Kind = EmployeeKinds.Employee,
        Name = SecurityReviewerName,
        Role = SecurityReviewerName,
        JobDescription = "Checks every app before it is published for misuse of the platform's services — secrets, sign-in, data, model calls and outbound calls — and blocks publishing on a finding until it is fixed. Reads code; never changes it.",
        Tools = ["read_file", "list_files", "search", "git_diff", "load_skill", "notes"],
        Services = [],
        ModelTier = "evaluate",
        Status = EmployeeStatuses.Idle,
        Standing = StandingRoles.SecurityReviewer,
        CreatedAt = now,
        LastActiveAt = now,
    };

    // ------------------------------------------------------------------ reads

    public async Task<EmployeeRecord> RequireAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        var org = await scopes.OrganisationOfAsync(db.Employees, q => q.Where(e => e.Id == employeeId).Select(e => e.OrganisationId), cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        return await db.Employees.AsNoTracking().SingleAsync(e => e.OrganisationId == org && e.Id == employeeId, cancellationToken);
    }

    public async Task<ResolvedScope> ScopeOfAsync(EmployeeRecord employee, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(employee);
        return await scopes.ForRowAsync(employee.OrganisationId, employee.DivisionId, employee.ProjectId, employee.AppId, cancellationToken);
    }

    /// <summary>The workforce at the scope and beneath it: employees, and contractors while they work. Released employees only when asked for.</summary>
    public async Task<IReadOnlyList<EmployeeView>> ListAsync(ResolvedScope scope, bool includeReleased, CancellationToken cancellationToken, string? kind = null)
    {
        ArgumentNullException.ThrowIfNull(scope);
        session.UseOrganisation(scope.OrganisationId);
        var rows = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId)
            .Where(e => scope.DivisionId == null || e.DivisionId == scope.DivisionId)
            .Where(e => scope.ProjectId == null || e.ProjectId == scope.ProjectId)
            .Where(e => scope.AppId == null || e.AppId == scope.AppId)
            .Where(e => includeReleased || e.Status != EmployeeStatuses.Released)
            .Where(e => kind == null || e.Kind == kind)
            .OrderBy(e => e.Kind).ThenBy(e => e.Name)
            .ToListAsync(cancellationToken);
        return await ViewsAsync(scope.OrganisationId, rows, cancellationToken);
    }

    public async Task<EmployeeView> GetAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var row = await db.Employees.AsNoTracking().SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        return (await ViewsAsync(organisationId, [row], cancellationToken))[0];
    }

    public async Task<EmployeeDetailView> DetailAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        var employee = await GetAsync(organisationId, employeeId, cancellationToken);
        var track = await TrackRecordAsync(organisationId, employeeId, cancellationToken);
        session.UseOrganisation(organisationId);
        var related = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Status != EmployeeStatuses.Released && (e.BriefedById == employeeId || e.ReportsToId == employeeId))
            .OrderBy(e => e.Name).ToListAsync(cancellationToken);
        var views = await ViewsAsync(organisationId, related, cancellationToken);
        return new EmployeeDetailView(employee, track, views.Where(v => v.Kind == EmployeeKinds.Contractor).ToList(), views.Where(v => v.Kind == EmployeeKinds.Employee).ToList());
    }

    /// <summary>
    /// The track record: work accepted and sent back, judgements made, runs, repairs not charged, cost to date and this
    /// month, contractors, estimate accuracy. Work is the employee's wherever the run belongs: a judgement
    /// (<c>evaluation.*</c>) names whose work it judges (<c>employeeId</c>; an older one without it judges the run's owner)
    /// and who judged it (<c>judgedBy</c>); a task the employee claimed and finished that nobody judged counts as accepted,
    /// and so does a finished run of its own with neither. A run counts when the employee worked in it: its owner, a task
    /// claimed in it, or a model call charged to the employee.
    /// </summary>
    public async Task<TrackRecordView> TrackRecordAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var month = CreditLedger.MonthStart(clock.GetUtcNow());
        await using var command = await db.CommandAsync("""
            WITH mine AS (SELECT id, status FROM runs WHERE organisation_id = @org AND employee_id = @employee),
                 worked AS (
                     SELECT r.id, r.status FROM runs r
                     WHERE r.organisation_id = @org AND (r.employee_id = @employee
                        OR EXISTS (SELECT 1 FROM tasks t WHERE t.organisation_id = r.organisation_id AND t.run_id = r.id AND t.employee_id = @employee)
                        OR EXISTS (SELECT 1 FROM credit_entries c WHERE c.organisation_id = r.organisation_id AND c.run_id = r.id AND c.employee_id = @employee))),
                 evaluations AS (
                     SELECT e.run_id, e.type, e.payload ->> 'employeeId' AS worker, e.payload ->> 'judgedBy' AS judge, e.payload ->> 'taskId' AS task
                     FROM run_events e
                     WHERE e.organisation_id = @org AND e.type IN ('evaluation.passed', 'evaluation.failed')),
                 judged AS (
                     SELECT v.type FROM evaluations v
                     WHERE v.worker = @employeeText OR (v.worker IS NULL AND v.run_id IN (SELECT id FROM mine))),
                 done AS (SELECT t.id, t.run_id FROM tasks t WHERE t.organisation_id = @org AND t.employee_id = @employee AND t.status = 'done'),
                 briefed AS (SELECT id, status FROM employees WHERE organisation_id = @org AND briefed_by = @employee)
            SELECT
                (SELECT COUNT(*) FROM worked WHERE status IN ('succeeded', 'failed', 'cancelled')),
                (SELECT COUNT(*) FROM worked WHERE status = 'succeeded'),
                (SELECT COUNT(*) FROM worked WHERE status = 'failed'),
                (SELECT COUNT(*) FROM worked WHERE status = 'cancelled'),
                (SELECT COUNT(*) FROM judged WHERE type = 'evaluation.passed')
                  + (SELECT COUNT(*) FROM done d WHERE NOT EXISTS (SELECT 1 FROM evaluations v WHERE v.task = d.id::text))
                  + (SELECT COUNT(*) FROM mine WHERE status = 'succeeded'
                       AND NOT EXISTS (SELECT 1 FROM evaluations v WHERE v.run_id = mine.id)
                       AND NOT EXISTS (SELECT 1 FROM done d WHERE d.run_id = mine.id)),
                (SELECT COUNT(*) FROM judged WHERE type = 'evaluation.failed'),
                COALESCE((SELECT SUM(amount) FROM credit_entries WHERE organisation_id = @org AND employee_id = @employee AND kind IN ('settlement', 'hosting') AND billable), 0),
                COALESCE((SELECT SUM(amount) FROM credit_entries WHERE organisation_id = @org AND employee_id = @employee AND kind IN ('settlement', 'hosting') AND billable AND created_at >= @month), 0),
                COALESCE((SELECT SUM(amount) FROM credit_entries WHERE organisation_id = @org AND employee_id = @employee AND kind = 'settlement' AND NOT billable), 0),
                (SELECT COUNT(*) FROM credit_entries WHERE organisation_id = @org AND employee_id = @employee AND kind = 'settlement' AND NOT billable),
                (SELECT COUNT(*) FROM briefed),
                (SELECT COUNT(*) FROM briefed WHERE status = 'working'),
                COALESCE((SELECT SUM(amount) FROM credit_entries c WHERE c.organisation_id = @org AND c.employee_id IN (SELECT id FROM briefed) AND c.kind IN ('settlement', 'hosting') AND c.billable), 0),
                COALESCE((SELECT SUM(amount) FROM credit_entries c WHERE c.organisation_id = @org AND c.employee_id IN (SELECT id FROM briefed) AND c.kind IN ('settlement', 'hosting') AND c.billable AND c.created_at >= @month), 0),
                (SELECT COUNT(*) FROM evaluations WHERE judge = @employeeText)
            """, cancellationToken, P("org", organisationId), P("employee", employeeId), P("employeeText", employeeId.ToString()), P("month", month));
        long[] n;
        decimal[] credits;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            n = [reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3), reader.GetInt64(4), reader.GetInt64(5), reader.GetInt64(9), reader.GetInt64(10), reader.GetInt64(11), reader.GetInt64(14)];
            credits = [reader.GetDecimal(6), reader.GetDecimal(7), reader.GetDecimal(8), reader.GetDecimal(12), reader.GetDecimal(13)];
        }

        var organisation = await scopes.ForRowAsync(organisationId, null, null, null, cancellationToken);
        var estimates = await reads.EstimatesAsync(organisation, cancellationToken, employeeId);
        var accepted = (int)n[4];
        var sentBack = (int)n[5];
        return new TrackRecordView(
            employeeId,
            new WorkCountsView(accepted, sentBack, accepted + sentBack == 0 ? null : decimal.Round(100m * accepted / (accepted + sentBack), 1), (int)n[9]),
            new RunCountsView((int)n[0], (int)n[1], (int)n[2], (int)n[3]),
            new RepairsNotChargedView(credits[2], n[6]),
            new CostToDateView(credits[0], credits[1]),
            new ContractorSpendView((int)n[7], (int)n[8], credits[3], credits[4]),
            estimates);
    }

    // ------------------------------------------------------------------ hiring and movement

    /// <summary>Records an employee at a node with its job description (an accepted proposal, or the factory's own hire).</summary>
    public async Task<EmployeeView> HireAsync(ResolvedScope scope, string name, string role, JobDescriptionInput job, Guid? reportsTo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(job);
        var record = NewEmployee(scope, name, role, job, reportsTo);
        await RequireManagerAsync(scope.OrganisationId, record.Id, reportsTo, cancellationToken);
        session.UseOrganisation(scope.OrganisationId);
        db.Employees.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(scope.OrganisationId, record.Id, cancellationToken);
    }

    /// <summary>A new employee record from a job description, validated, not yet saved.</summary>
    public EmployeeRecord NewEmployee(ResolvedScope scope, string name, string role, JobDescriptionInput job, Guid? reportsTo)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(job);
        var now = clock.GetUtcNow();
        var record = new EmployeeRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            Kind = EmployeeKinds.Employee,
            Name = Text(name, "name", WorkforceLimits.MaxName),
            Role = Text(role, "role", WorkforceLimits.MaxName),
            Status = EmployeeStatuses.Idle,
            ReportsToId = reportsTo,
            CreatedAt = now,
            LastActiveAt = now,
        };
        ApplyJob(record, job, creating: true);
        return record;
    }

    /// <summary>Changes the name, role, job description (budget, tier, tools, services, mandate), manager, or pauses and resumes.</summary>
    public async Task<EmployeeView> UpdateAsync(Guid organisationId, Guid employeeId, string? name, string? role, JobDescriptionInput? job, Guid? reportsTo, bool clearReportsTo, bool clearLimit, string? status, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var row = await db.Employees.SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        if (row.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict($"{row.Name} has been released; rehire them first.");
        }

        if (name is not null)
        {
            row.Name = Text(name, "name", WorkforceLimits.MaxName);
        }

        if (role is not null)
        {
            row.Role = Text(role, "role", WorkforceLimits.MaxName);
        }

        if (job is not null)
        {
            ApplyJob(row, job, creating: false);
        }

        if (clearLimit)
        {
            row.MonthlyCreditLimit = null;
        }

        if (reportsTo is not null || clearReportsTo)
        {
            await RequireManagerAsync(organisationId, row.Id, reportsTo, cancellationToken);
            row.ReportsToId = clearReportsTo ? null : reportsTo;
        }

        switch (status)
        {
            case null:
                break;
            case EmployeeStatuses.Paused when row.Status is EmployeeStatuses.Idle or EmployeeStatuses.Working:
                row.Status = EmployeeStatuses.Paused;
                break;
            case EmployeeStatuses.Idle when row.Status == EmployeeStatuses.Paused:
                row.Status = row.CurrentRunId is null ? EmployeeStatuses.Idle : EmployeeStatuses.Working;
                break;
            case EmployeeStatuses.Paused or EmployeeStatuses.Idle:
                break;
            default:
                throw EndgameProblem.Invalid("status is 'paused' (stop giving it work) or 'idle' (resume). Release and rehire have their own actions.");
        }

        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, employeeId, cancellationToken);
    }

    /// <summary>Moves an employee to another node, optionally under a new manager. Its memory travels with it.</summary>
    public async Task<EmployeeView> ReassignAsync(Guid organisationId, Guid employeeId, ResolvedScope to, Guid? reportsTo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(to);
        if (to.OrganisationId != organisationId)
        {
            throw EndgameProblem.Invalid("An employee moves within its own organisation.");
        }

        await RequireManagerAsync(organisationId, employeeId, reportsTo, cancellationToken);
        session.UseOrganisation(organisationId);
        var row = await db.Employees.SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        if (row.Status == EmployeeStatuses.Released || row.Kind == EmployeeKinds.Contractor)
        {
            throw EndgameProblem.Conflict(row.Kind == EmployeeKinds.Contractor ? "A contractor works on its brief; it is not reassigned." : $"{row.Name} has been released; rehire them first.");
        }

        row.DivisionId = to.DivisionId;
        row.ProjectId = to.ProjectId;
        row.AppId = to.AppId;
        row.ReportsToId = reportsTo;
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, employeeId, cancellationToken);
    }

    /// <summary>
    /// Lets an employee go: released, its memory archived (kept, so a rehire is not a cold start), and
    /// anyone who reported to it moved up to its own manager. A standing hire is never released.
    /// </summary>
    public async Task<EmployeeView> ReleaseAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        var row = await db.Employees.SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        if (row.Standing is not null)
        {
            throw new EndgameProblem(409, "standing_hire", "A standing hire is never released", $"{row.Name} is a standing hire every organisation keeps.");
        }

        if (row.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict($"{row.Name} has already been released.");
        }

        if (row.CurrentRunId is not null)
        {
            throw EndgameProblem.Conflict($"{row.Name} is working on a run; let it finish or cancel it first.");
        }

        var now = clock.GetUtcNow();
        row.Status = EmployeeStatuses.Released;
        row.ReleasedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await db.Employees.Where(e => e.OrganisationId == organisationId && e.ReportsToId == employeeId)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.ReportsToId, row.ReportsToId), cancellationToken);
        if (row.Kind == EmployeeKinds.Employee)
        {
            await memory.ArchiveAsync(organisationId, employeeId, archive: true, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, employeeId, cancellationToken);
    }

    /// <summary>Brings a released employee back, optionally somewhere else, with its archived memory restored.</summary>
    public async Task<EmployeeView> RehireAsync(Guid organisationId, Guid employeeId, ResolvedScope? to, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        var row = await db.Employees.SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
        if (row.Status != EmployeeStatuses.Released || row.Kind != EmployeeKinds.Employee)
        {
            throw EndgameProblem.Conflict($"Only a released employee is rehired; {row.Name} is {row.Status}.");
        }

        if (to is not null)
        {
            if (to.OrganisationId != organisationId)
            {
                throw EndgameProblem.Invalid("An employee is rehired into its own organisation.");
            }

            row.DivisionId = to.DivisionId;
            row.ProjectId = to.ProjectId;
            row.AppId = to.AppId;
        }

        row.Status = EmployeeStatuses.Idle;
        row.ReleasedAt = null;
        row.ReportsToId = await db.Employees.AnyAsync(e => e.OrganisationId == organisationId && e.Id == row.ReportsToId && e.Status != EmployeeStatuses.Released, cancellationToken) ? row.ReportsToId : null;
        row.LastActiveAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        await memory.ArchiveAsync(organisationId, employeeId, archive: false, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, employeeId, cancellationToken);
    }

    // ------------------------------------------------------------------ contractors

    /// <summary>A contractor briefed by an employee: visible while it works, charged to the brief's scope, attributed to its briefer.</summary>
    public async Task<EmployeeView> StartContractorAsync(ResolvedScope scope, Guid briefedBy, string role, string? name, string brief, Guid? runId, decimal? monthlyCreditLimit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        session.UseOrganisation(scope.OrganisationId);
        var briefer = await db.Employees.AsNoTracking().SingleOrDefaultAsync(e => e.OrganisationId == scope.OrganisationId && e.Id == briefedBy, cancellationToken)
            ?? throw EndgameProblem.NotFound("The briefing employee");
        if (briefer.Kind != EmployeeKinds.Employee || briefer.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict("A contractor is briefed by an employee who is on the payroll.");
        }

        if (runId is { } run && !await db.Runs.AnyAsync(r => r.OrganisationId == scope.OrganisationId && r.Id == run, cancellationToken))
        {
            throw EndgameProblem.NotFound("The run in this organisation");
        }

        if (monthlyCreditLimit is < 0)
        {
            throw EndgameProblem.Invalid("A credit limit cannot be negative.");
        }

        var roleText = Text(role, "role", WorkforceLimits.MaxName);
        var now = clock.GetUtcNow();
        var record = new EmployeeRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            Kind = EmployeeKinds.Contractor,
            Name = string.IsNullOrWhiteSpace(name) ? $"{roleText} (contractor)" : Text(name, "name", WorkforceLimits.MaxName),
            Role = roleText,
            JobDescription = Text(brief, "brief", WorkforceLimits.MaxMandate),
            Brief = brief.Trim(),
            BriefedById = briefedBy,
            BriefRunId = runId,
            ModelTier = briefer.ModelTier,
            Tools = briefer.Tools,
            Services = briefer.Services,
            MonthlyCreditLimit = monthlyCreditLimit,
            Status = EmployeeStatuses.Working,
            CurrentRunId = runId,
            CreatedAt = now,
            LastActiveAt = now,
        };
        db.Employees.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(scope.OrganisationId, record.Id, cancellationToken);
    }

    /// <summary>Marks a contractor done: gone from the chart and the bill. Returns it as it was released.</summary>
    public async Task<EmployeeRecord> FinishContractorAsync(Guid organisationId, Guid contractorId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var row = await db.Employees.SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == contractorId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The contractor");
        if (row.Kind != EmployeeKinds.Contractor)
        {
            throw EndgameProblem.Invalid("Only a contractor finishes; an employee is released.");
        }

        if (row.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict("This contractor has already finished.");
        }

        var now = clock.GetUtcNow();
        row.Status = EmployeeStatuses.Released;
        row.ReleasedAt = now;
        row.LastRunId = row.CurrentRunId ?? row.LastRunId;
        row.CurrentRunId = null;
        row.LastActiveAt = now;
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return row;
    }

    /// <summary>
    /// Contractor roles that keep recurring at a node — <see cref="WorkforceLimits.PromotionThreshold"/> or more
    /// in <see cref="WorkforceLimits.PromotionWindowDays"/> days — where no employee holds that role yet.
    /// </summary>
    public async Task<IReadOnlyList<RecurringRoleView>> RecurringRolesAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        session.UseOrganisation(scope.OrganisationId);
        var since = clock.GetUtcNow().AddDays(-WorkforceLimits.PromotionWindowDays);
        var rows = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId && e.CreatedAt >= since)
            .Where(e => scope.DivisionId == null || e.DivisionId == scope.DivisionId)
            .Where(e => scope.ProjectId == null || e.ProjectId == scope.ProjectId)
            .Where(e => scope.AppId == null || e.AppId == scope.AppId)
            .ToListAsync(cancellationToken);
        var payroll = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId && e.Kind == EmployeeKinds.Employee && e.Status != EmployeeStatuses.Released)
            .ToListAsync(cancellationToken);
        var paths = await memory.PathsAsync(scope.OrganisationId, cancellationToken);
        var recurring = new List<RecurringRoleView>();
        foreach (var group in rows.Where(e => e.Kind == EmployeeKinds.Contractor)
                     .GroupBy(e => (e.DivisionId, e.ProjectId, e.AppId, Role: e.Role.ToLowerInvariant())))
        {
            var list = group.ToList();
            if (list.Count < WorkforceLimits.PromotionThreshold
                || payroll.Any(e => e.DivisionId == group.Key.DivisionId && e.ProjectId == group.Key.ProjectId && e.AppId == group.Key.AppId && string.Equals(e.Role, list[0].Role, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var ids = list.Select(c => c.Id).ToArray();
            var cost = await ContractorCostAsync(scope.OrganisationId, ids, since, cancellationToken);
            recurring.Add(new RecurringRoleView(paths(list[0]), list[0].Role, list.Count, WorkforceLimits.PromotionWindowDays, cost,
                list.OrderByDescending(c => c.CreatedAt).Select(c => c.BriefedById!.Value).First(), list.OrderByDescending(c => c.CreatedAt).First().Brief ?? ""));
        }

        return recurring;
    }

    private async Task<decimal> ContractorCostAsync(Guid organisationId, Guid[] contractors, DateTimeOffset since, CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("""
            SELECT COALESCE(SUM(amount), 0) FROM credit_entries
            WHERE organisation_id = @org AND employee_id = ANY(@ids) AND kind IN ('settlement', 'hosting') AND billable AND created_at >= @since
            """, cancellationToken, P("org", organisationId), new Npgsql.NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Uuid) { Value = contractors }, P("since", since));
        return (decimal)(await command.ExecuteScalarAsync(cancellationToken) ?? 0m);
    }

    // ------------------------------------------------------------------ idle

    /// <summary>
    /// Releases every employee flagged idle where autonomy is auto (spec: an idle workforce is never paid
    /// for; in auto-mode this happens on its own). Where checkpoints are on, the flag waits in needsYou.
    /// Standing hires are never released. Runs as the platform, across organisations.
    /// </summary>
    public async Task<int> ReleaseIdleAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var candidates = await db.Employees.AsNoTracking()
            .Where(e => e.Kind == EmployeeKinds.Employee && e.Status == EmployeeStatuses.Idle && e.Standing == null && e.CurrentRunId == null)
            .ToListAsync(cancellationToken);
        session.Clear();
        var released = 0;
        foreach (var organisation in candidates.GroupBy(c => c.OrganisationId))
        {
            var idleDays = await IdleDaySettingsAsync(organisation.Key, cancellationToken);
            foreach (var employee in organisation)
            {
                if (!WorkforceRules.Idle(employee, idleDays, clock.GetUtcNow()).Flagged)
                {
                    continue;
                }

                var scope = await ScopeOfAsync(employee, cancellationToken);
                if (await cascade.AutonomyAsync(scope, cancellationToken) != Autonomy.Auto)
                {
                    continue;
                }

                await ReleaseAsync(employee.OrganisationId, employee.Id, cancellationToken);
                released++;
            }
        }

        session.Clear();
        return released;
    }

    /// <summary>Every <c>workforce.idle_days</c> setting in an organisation, for <see cref="WorkforceRules.Idle"/>.</summary>
    public async Task<IReadOnlyList<CascadeEntryRecord>> IdleDaySettingsAsync(Guid organisationId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        return await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Kind == "setting" && e.Key == AgentSettings.WorkforceIdleDays)
            .ToListAsync(cancellationToken);
    }

    // ------------------------------------------------------------------ views and rules

    private async Task<IReadOnlyList<EmployeeView>> ViewsAsync(Guid organisationId, IReadOnlyList<EmployeeRecord> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
        {
            return [];
        }

        var paths = await memory.PathsAsync(organisationId, cancellationToken);
        var idleDays = await IdleDaySettingsAsync(organisationId, cancellationToken);
        var related = rows.SelectMany(r => new[] { r.ReportsToId, r.BriefedById }).OfType<Guid>().Distinct().ToList();
        var names = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && related.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken);
        var runIds = rows.Select(r => r.CurrentRunId).OfType<Guid>().Distinct().ToList();
        var runTitles = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == organisationId && runIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.Title, cancellationToken);
        var ids = rows.Select(r => r.Id).ToList();
        // A run under way that an employee works in without owning it (a factory build's engineer, its QA engineer, the reviewer).
        var underWay = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == organisationId && (r.Status == RunStatuses.Running || r.Status == RunStatuses.WaitingApproval))
            .OrderByDescending(r => r.CreatedAt).ToListAsync(cancellationToken);
        var underWayIds = underWay.Select(r => r.Id).ToList();
        var claimed = await db.Tasks.AsNoTracking()
            .Where(t => t.OrganisationId == organisationId && t.RunId != null && t.EmployeeId != null && underWayIds.Contains(t.RunId.Value) && ids.Contains(t.EmployeeId.Value))
            .Select(t => new { RunId = t.RunId!.Value, EmployeeId = t.EmployeeId!.Value }).ToListAsync(cancellationToken);
        var charged = await db.CreditEntries.AsNoTracking()
            .Where(c => c.OrganisationId == organisationId && c.RunId != null && c.EmployeeId != null && underWayIds.Contains(c.RunId.Value) && ids.Contains(c.EmployeeId.Value))
            .Select(c => new { RunId = c.RunId!.Value, EmployeeId = c.EmployeeId!.Value }).Distinct().ToListAsync(cancellationToken);
        var working = ReadModels.WorkingIn(underWay, claimed.Select(x => (x.RunId, x.EmployeeId)).Concat(charged.Select(x => (x.RunId, x.EmployeeId))));
        var underWayTitles = underWay.ToDictionary(r => r.Id, r => r.Title);
        var memoryCounts = await db.EmployeeMemories.AsNoTracking()
            .Where(m => m.OrganisationId == organisationId && ids.Contains(m.EmployeeId) && m.ArchivedAt == null)
            .GroupBy(m => m.EmployeeId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, cancellationToken);
        var now = clock.GetUtcNow();
        return rows.Select(e => new EmployeeView(
            e.Id, e.Kind, e.Name, e.Role, e.Status == EmployeeStatuses.Idle && e.CurrentRunId is null && working.ContainsKey(e.Id) ? EmployeeStatuses.Working : e.Status, e.Standing, paths(e),
            e.ReportsToId is { } m ? new PersonRef(m, names.GetValueOrDefault(m, "")) : null,
            e.BriefedById is { } b ? new PersonRef(b, names.GetValueOrDefault(b, "")) : null,
            new JobDescriptionView(e.JobDescription, paths(e), e.Tools, e.Services, e.MonthlyCreditLimit, e.ModelTier),
            working.ContainsKey(e.Id) && e.CurrentRunId is null ? new IdleView(false, null, WorkforceRules.Idle(e, idleDays, now).AfterDays) : WorkforceRules.Idle(e, idleDays, now),
            e.CurrentRunId is { } r ? new CurrentRunView(r, runTitles.GetValueOrDefault(r, ""))
                : working.TryGetValue(e.Id, out var worked) ? new CurrentRunView(worked, underWayTitles[worked]) : null,
            e.LastRunId, e.LastActiveAt, e.CreatedAt, e.ReleasedAt, memoryCounts.GetValueOrDefault(e.Id), e.Brief)).ToList();
    }

    private void ApplyJob(EmployeeRecord record, JobDescriptionInput job, bool creating)
    {
        if (job.Mandate is not null || creating)
        {
            record.JobDescription = (job.Mandate ?? "").Trim();
            if (record.JobDescription.Length > WorkforceLimits.MaxMandate)
            {
                throw EndgameProblem.Invalid($"A mandate is at most {WorkforceLimits.MaxMandate} characters.");
            }
        }

        if (job.Tools is not null)
        {
            record.Tools = Names(job.Tools, "tools", t => ToolName().IsMatch(t), "lower-case tool names such as read_file or edit_file");
        }

        if (job.Services is not null)
        {
            record.Services = Names(job.Services, "services", PlatformServices.Contains, string.Join(", ", PlatformServices));
        }

        if (job.MonthlyCreditLimit is { } limit)
        {
            record.MonthlyCreditLimit = limit >= 0 ? limit : throw EndgameProblem.Invalid("A credit limit cannot be negative.");
        }

        if (job.ModelTier is not null)
        {
            record.ModelTier = routes.Routes.ContainsKey(job.ModelTier)
                ? job.ModelTier
                : throw EndgameProblem.Invalid($"'{job.ModelTier}' is not a model tier: use a routing-table task type such as {string.Join(", ", routes.Routes.Keys.Where(k => !k.StartsWith("app.", StringComparison.Ordinal)).Order(StringComparer.Ordinal))}.");
        }
    }

    /// <summary>A manager is another employee of the organisation, on the payroll, and not someone who already reports to this one.</summary>
    public async Task RequireManagerAsync(Guid organisationId, Guid employeeId, Guid? reportsTo, CancellationToken cancellationToken)
    {
        if (reportsTo is not { } manager)
        {
            return;
        }

        session.UseOrganisation(organisationId);
        var chain = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId)
            .Select(e => new { e.Id, e.ReportsToId, e.Kind, e.Status }).ToDictionaryAsync(e => e.Id, cancellationToken);
        if (!chain.TryGetValue(manager, out var boss) || boss.Kind != EmployeeKinds.Employee || boss.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Invalid("reportsTo names an employee of this organisation who is on the payroll.");
        }

        for (Guid? at = manager; at is { } current; at = chain.TryGetValue(current, out var next) ? next.ReportsToId : null)
        {
            if (current == employeeId)
            {
                throw EndgameProblem.Invalid("That would make a reporting loop: the manager already reports, directly or not, to this employee.");
            }
        }
    }

    private static string[] Names(IReadOnlyList<string> values, string field, Func<string, bool> valid, string hint)
    {
        var cleaned = values.Select(v => v?.Trim() ?? "").Where(v => v.Length > 0).Distinct(StringComparer.Ordinal).ToArray();
        if (cleaned.Length > WorkforceLimits.MaxListItems || cleaned.Any(v => v.Length > WorkforceLimits.MaxListItem || !valid(v)))
        {
            throw EndgameProblem.Invalid($"{field} is a list of up to {WorkforceLimits.MaxListItems} names: {hint}.");
        }

        return cleaned;
    }

    private static string Text(string? value, string field, int max)
    {
        var trimmed = value?.Trim() ?? "";
        return trimmed.Length is 0 || trimmed.Length > max ? throw EndgameProblem.Invalid($"An employee's {field} is 1 to {max} characters.") : trimmed;
    }

    [GeneratedRegex("^[a-z][a-z0-9_]{0,59}$", RegexOptions.CultureInvariant)]
    private static partial Regex ToolName();
}

/// <summary>A contractor role that keeps recurring at a node: a candidate for a permanent hire.</summary>
public sealed record RecurringRoleView(string Scope, string Role, int Contractors, int WindowDays, decimal CostCredits, Guid LastBriefedBy, string LastBrief);

/// <summary>The workforce rules both the services and the read models apply.</summary>
public static class WorkforceRules
{
    /// <summary>
    /// The idle flag: an employee (not a contractor, not a standing hire) that is idle and has had no
    /// work for longer than <c>workforce.idle_days</c> at its scope (default
    /// <see cref="WorkforceLimits.DefaultIdleDays"/>).
    /// </summary>
    public static IdleView Idle(EmployeeRecord employee, IReadOnlyList<CascadeEntryRecord> idleDaySettings, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(employee);
        ArgumentNullException.ThrowIfNull(idleDaySettings);
        var chain = idleDaySettings
            .Where(e => (e.DivisionId == null || e.DivisionId == employee.DivisionId) && (e.ProjectId == null || e.ProjectId == employee.ProjectId) && (e.AppId == null || e.AppId == employee.AppId))
            .Select(e => new CascadeEntry(CascadeKind.Setting, e.Key, e.ValueJson, e.Level(), e.NodeId(), "", e.SetAt));
        var set = CascadeResolver.ResolveKey(CascadeKind.Setting, AgentSettings.WorkforceIdleDays, chain);
        var days = set is not null && JsonNode.Parse(set.Entry.ValueJson) is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<int>(out var d) ? d : WorkforceLimits.DefaultIdleDays;
        if (employee.Kind != EmployeeKinds.Employee || employee.Status != EmployeeStatuses.Idle)
        {
            return new IdleView(false, null, days);
        }

        var since = employee.LastActiveAt ?? employee.CreatedAt;
        return new IdleView(employee.Standing is null && now - since > TimeSpan.FromDays(days), since, days);
    }
}
