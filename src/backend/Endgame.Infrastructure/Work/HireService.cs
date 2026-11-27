using Endgame.Application.Common;
using Endgame.Domain.Cascade;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Endgame.Infrastructure.Work;

public sealed record HireDecisionView(string Via, string By, DateTimeOffset At, string? Note);

/// <summary>A hire proposal as the console shows it: the drafted job description, the expected monthly cost and why, and whether it fits the budget now.</summary>
/// <param name="Status"><c>proposed</c>, <c>accepted</c> or <c>declined</c>; in the answer to a raise only, <c>covered</c> (see <see cref="HireRaised"/>).</param>
/// <param name="Trigger"><c>division</c>, <c>stage</c>, <c>recurring</c>, <c>promotion</c> or <c>owner</c>.</param>
/// <param name="RaisedBy"><c>person</c> or <c>runner</c>.</param>
/// <param name="ExpectedMonthlyCredits">What it should cost a month: never more than its own budget (<c>jobDescription.monthlyCreditLimit</c>) when it has one.</param>
/// <param name="Withdrawn">Declined by the platform, not by a person: the work it was for stopped before anything was built (D81). <c>decision.note</c> says why.</param>
/// <param name="HoldDays">
/// On an open proposal the platform raised for a recurring contractor role: how many days a decline holds — no new proposal for
/// this role here before then (R5-3, <see cref="WorkforceLimits.DeclinedHireHoldDays"/>). Null where a decline holds nothing.
/// </param>
/// <param name="ProposedAgainFrom">On such a proposal a person declined: the moment it can be proposed again; null otherwise.</param>
public sealed record HireView(
    Guid Id,
    string Status,
    string Trigger,
    string? NeedKey,
    string Scope,
    string Reason,
    string Name,
    string Role,
    JobDescriptionView JobDescription,
    PersonRef? ReportsTo,
    decimal ExpectedMonthlyCredits,
    bool WithinBudget,
    decimal HeadroomCredits,
    string? ContractorRole,
    string RaisedBy,
    Guid? RaisedByRunId,
    HireDecisionView? Decision,
    Guid? EmployeeId,
    DateTimeOffset CreatedAt,
    bool Withdrawn = false,
    int? HoldDays = null,
    DateTimeOffset? ProposedAgainFrom = null);

/// <summary>A need for a hire: the drafted job description, what it should cost a month and why.</summary>
public sealed record HireInput(
    string? Trigger,
    string? NeedKey,
    string? Reason,
    string? Name,
    string? Role,
    JobDescriptionInput? JobDescription,
    Guid? ReportsTo,
    decimal? ExpectedMonthlyCredits,
    string? ContractorRole);

/// <summary>The proposal, and whether this call created it (false: the same need was already raised).</summary>
/// <param name="CoveredBy">
/// The factory raised a need that someone already covers (D22, D70): an employee with that role works at the need's level or
/// above it, so their "works at … and everything beneath it" reaches it. Nothing is proposed; <c>hire</c> then has status
/// <c>covered</c>, its <c>id</c> and <c>employeeId</c> are that employee's, and the work is theirs.
/// </param>
public sealed record HireRaised(HireView Hire, bool Created, EmployeeView? CoveredBy = null);

/// <summary>
/// Hiring (spec: <i>hiring is triggered by the ontology</i>). A need is raised by the Runner or the
/// owner and held as a proposal. In auto-mode a proposal whose expected monthly cost fits the budget
/// is accepted at once; otherwise, or with the hire checkpoint on, it waits in needsYou for the owner
/// to accept, edit or decline. The same need raised twice is one proposal.
/// </summary>
public sealed class HireService(
    EndgameDbContext db,
    TenantSession session,
    ScopeResolver scopes,
    CascadeService cascade,
    CreditLedger ledger,
    EmployeeService employees,
    MemoryService memory,
    TimeProvider clock)
{
    public async Task<HireRaised> RaiseAsync(ResolvedScope scope, HireInput input, Guid? byUser, Guid? byRun, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(input);
        var trigger = input.Trigger ?? (byUser is null ? HireTriggers.Recurring : HireTriggers.Owner);
        if (!HireTriggers.All.Contains(trigger))
        {
            throw EndgameProblem.Invalid($"trigger is one of {string.Join(", ", HireTriggers.All)}.");
        }

        var needKey = input.NeedKey?.Trim();
        if (needKey is null && trigger == HireTriggers.Promotion && input.ContractorRole?.Trim() is { Length: > 0 } recurringRole)
        {
            // A person proposing a recurring role raises the same need the system raises when a contractor finishes.
            needKey = PromotionNeedKey(scope, recurringRole);
        }

        if (needKey is { Length: 0 or > 200 })
        {
            throw EndgameProblem.Invalid("needKey is 1 to 200 characters, the same each time the same need is raised.");
        }

        session.UseOrganisation(scope.OrganisationId);
        var existing = needKey is null ? null : await ExistingAsync(scope.OrganisationId, needKey, cancellationToken);
        if (existing is { Status: HireStatuses.Accepted })
        {
            return new HireRaised(await ViewAsync(existing, cancellationToken), false);
        }

        // The factory's needs are met from the chain above first (D22, D70): nobody is proposed for work someone already covers.
        if (byUser is null && trigger is HireTriggers.Stage or HireTriggers.Division or HireTriggers.Recurring
            && await CoveringAsync(scope, input.Role, cancellationToken) is { } covering)
        {
            return await CoveredAsync(scope, covering, needKey, cancellationToken);
        }

        if (existing is not null)
        {
            return new HireRaised(await ViewAsync(existing, cancellationToken), false);
        }

        // A person's decline holds (R5-3): the platform does not propose the same recurring role here again inside the hold,
        // however many more contractors are briefed. Answered with the declined proposal, nothing created. A person asking
        // for the hire is never held.
        if (byUser is null && needKey is not null && Holds(trigger) && await DeclinedHoldingAsync(scope.OrganisationId, needKey, cancellationToken) is { } declined)
        {
            return new HireRaised(await ViewAsync(declined, cancellationToken), false);
        }

        if (input.ExpectedMonthlyCredits is not { } asked || asked < 0)
        {
            throw EndgameProblem.Invalid("expectedMonthlyCredits is what the employee should cost a month, in credits (0 or more): shown before anyone accepts it.");
        }

        if (byRun is { } run && !await db.Runs.AnyAsync(r => r.OrganisationId == scope.OrganisationId && r.Id == run, cancellationToken))
        {
            throw EndgameProblem.NotFound("The run in this organisation");
        }

        // Validated as the employee it would become, so a proposal can always be accepted as it stands.
        var job = input.JobDescription ?? new JobDescriptionInput(null, null, null, null, null);
        var draft = employees.NewEmployee(scope, input.Name ?? "", input.Role ?? "", job, input.ReportsTo);
        await employees.RequireManagerAsync(scope.OrganisationId, draft.Id, input.ReportsTo, cancellationToken);
        // A hire with a budget of its own never costs more than it (a recurring role's cost so far can be higher).
        var expected = Capped(asked, draft.MonthlyCreditLimit);
        var reason = input.Reason?.Trim() ?? "";
        if (reason.Length is 0 or > 4000)
        {
            throw EndgameProblem.Invalid("A hire proposal says why it is needed, in 1 to 4000 characters.");
        }

        var now = clock.GetUtcNow();
        var proposal = new HireProposalRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            Status = HireStatuses.Proposed,
            Trigger = trigger,
            NeedKey = needKey,
            Reason = reason,
            Name = draft.Name,
            Role = draft.Role,
            Mandate = draft.JobDescription,
            Tools = draft.Tools,
            Services = draft.Services,
            MonthlyCreditLimit = draft.MonthlyCreditLimit,
            ModelTier = draft.ModelTier,
            ReportsToId = input.ReportsTo,
            ExpectedMonthlyCredits = expected,
            ContractorRole = input.ContractorRole?.Trim() is { Length: > 0 } role ? role[..Math.Min(role.Length, 200)] : null,
            RaisedByUserId = byUser,
            RaisedByRunId = byRun,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.HireProposals.Add(proposal);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } && needKey is not null)
        {
            // The same need raised at the same moment: one proposal.
            db.ChangeTracker.Clear();
            return new HireRaised(await ViewAsync((await ExistingAsync(scope.OrganisationId, needKey, cancellationToken))!, cancellationToken), false);
        }

        db.ChangeTracker.Clear();

        // Within budget and with no hire checkpoint on, hired at once; anything else waits for the owner.
        if (!await cascade.CheckpointAsync(scope, Autonomy.CheckpointHire, cancellationToken) && expected <= await HeadroomAsync(scope, cancellationToken))
        {
            await AcceptAsync(scope.OrganisationId, proposal.Id, null, IdeaDecisions.ByAutoMode, null, "Within budget, so auto-mode hired.", cancellationToken);
        }

        return new HireRaised(await GetAsync(scope.OrganisationId, proposal.Id, cancellationToken), true);
    }

    public async Task<HireView> GetAsync(Guid organisationId, Guid hireId, CancellationToken cancellationToken) =>
        await ViewAsync(await RequireAsync(organisationId, hireId, tracking: false, cancellationToken), cancellationToken);

    public async Task<Guid> OrganisationOfAsync(Guid hireId, CancellationToken cancellationToken) =>
        await scopes.OrganisationOfAsync(db.HireProposals, q => q.Where(h => h.Id == hireId).Select(h => h.OrganisationId), cancellationToken)
        ?? throw EndgameProblem.NotFound("The hire proposal");

    public async Task<ResolvedScope> ScopeOfAsync(Guid organisationId, Guid hireId, CancellationToken cancellationToken)
    {
        var row = await RequireAsync(organisationId, hireId, tracking: false, cancellationToken);
        return await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
    }

    public async Task<IReadOnlyList<HireView>> ListAsync(ResolvedScope scope, string? status, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (status is not null && !HireStatuses.All.Contains(status))
        {
            throw EndgameProblem.Invalid($"status is one of {string.Join(", ", HireStatuses.All)}.");
        }

        session.UseOrganisation(scope.OrganisationId);
        var rows = await db.HireProposals.AsNoTracking()
            .Where(h => h.OrganisationId == scope.OrganisationId)
            .Where(h => scope.DivisionId == null || h.DivisionId == scope.DivisionId)
            .Where(h => scope.ProjectId == null || h.ProjectId == scope.ProjectId)
            .Where(h => scope.AppId == null || h.AppId == scope.AppId)
            .Where(h => status == null || h.Status == status)
            .OrderByDescending(h => h.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);
        var views = new List<HireView>();
        foreach (var row in rows)
        {
            views.Add(await ViewAsync(row, cancellationToken));
        }

        return views;
    }

    /// <summary>The one need key for "this contractor role keeps recurring here", whoever raises it.</summary>
    public static string PromotionNeedKey(ResolvedScope at, string contractorRole)
    {
        ArgumentNullException.ThrowIfNull(at);
        ArgumentNullException.ThrowIfNull(contractorRole);
        return $"promotion:{at.NodeId:N}:{contractorRole.Trim().ToLowerInvariant()}";
    }

    /// <summary>
    /// The owner edits a proposal before deciding: any field of the drafted job description, the expected cost or the reason.
    /// <paramref name="clearMonthlyCreditLimit"/> removes the budget the proposal carried, so the hire would have none of its own.
    /// </summary>
    public async Task<HireView> EditAsync(Guid organisationId, Guid hireId, HireInput edit, bool clearReportsTo, CancellationToken cancellationToken, bool clearMonthlyCreditLimit = false)
    {
        ArgumentNullException.ThrowIfNull(edit);
        var row = await RequireAsync(organisationId, hireId, tracking: true, cancellationToken);
        if (row.Status != HireStatuses.Proposed)
        {
            throw EndgameProblem.Conflict($"The proposal was {row.Status}; only an open proposal is edited.");
        }

        var scope = await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
        var job = edit.JobDescription;
        var merged = new JobDescriptionInput(job?.Mandate ?? row.Mandate, job?.Tools ?? row.Tools, job?.Services ?? row.Services,
            clearMonthlyCreditLimit ? null : job?.MonthlyCreditLimit ?? row.MonthlyCreditLimit, job?.ModelTier ?? row.ModelTier);
        var reportsTo = clearReportsTo ? null : edit.ReportsTo ?? row.ReportsToId;
        var draft = employees.NewEmployee(scope, edit.Name ?? row.Name, edit.Role ?? row.Role, merged, reportsTo);
        await employees.RequireManagerAsync(organisationId, draft.Id, reportsTo, cancellationToken);
        if (edit.ExpectedMonthlyCredits is < 0)
        {
            throw EndgameProblem.Invalid("expectedMonthlyCredits is 0 or more.");
        }

        session.UseOrganisation(organisationId);
        row.Name = draft.Name;
        row.Role = draft.Role;
        row.Mandate = draft.JobDescription;
        row.Tools = draft.Tools;
        row.Services = draft.Services;
        row.MonthlyCreditLimit = draft.MonthlyCreditLimit;
        row.ModelTier = draft.ModelTier;
        row.ReportsToId = reportsTo;
        row.ExpectedMonthlyCredits = Capped(edit.ExpectedMonthlyCredits ?? row.ExpectedMonthlyCredits, draft.MonthlyCreditLimit);
        row.Reason = edit.Reason?.Trim() is { Length: > 0 } reason ? reason : row.Reason;
        row.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, hireId, cancellationToken);
    }

    /// <summary>Accepts a proposal: the employee is hired with its job description, in the same transaction that closes the proposal.</summary>
    public async Task<HireView> AcceptAsync(Guid organisationId, Guid hireId, Guid? by, string via, Guid? reportsToOverride, string? note, CancellationToken cancellationToken)
    {
        var row = await RequireAsync(organisationId, hireId, tracking: false, cancellationToken);
        var scope = await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
        var employee = employees.NewEmployee(scope, row.Name, row.Role,
            new JobDescriptionInput(row.Mandate, row.Tools, row.Services, row.MonthlyCreditLimit, row.ModelTier), reportsToOverride ?? row.ReportsToId);
        await employees.RequireManagerAsync(organisationId, employee.Id, employee.ReportsToId, cancellationToken);
        session.UseOrganisation(organisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        db.Employees.Add(employee);
        await db.SaveChangesAsync(cancellationToken);
        var now = clock.GetUtcNow();
        var closed = await db.HireProposals
            .Where(h => h.OrganisationId == organisationId && h.Id == hireId && h.Status == HireStatuses.Proposed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(h => h.Status, HireStatuses.Accepted)
                .SetProperty(h => h.EmployeeId, employee.Id)
                .SetProperty(h => h.DecidedVia, via)
                .SetProperty(h => h.DecidedBy, by)
                .SetProperty(h => h.DecidedAt, now)
                .SetProperty(h => h.DecisionNote, note)
                .SetProperty(h => h.UpdatedAt, now), cancellationToken);
        if (closed == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            throw EndgameProblem.Conflict($"The proposal was already {row.Status}.");
        }

        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await GetAsync(organisationId, hireId, cancellationToken);
    }

    public async Task<HireView> DeclineAsync(Guid organisationId, Guid hireId, Guid by, string? note, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var now = clock.GetUtcNow();
        var closed = await db.HireProposals
            .Where(h => h.OrganisationId == organisationId && h.Id == hireId && h.Status == HireStatuses.Proposed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(h => h.Status, HireStatuses.Declined)
                .SetProperty(h => h.DecidedVia, IdeaDecisions.ByPerson)
                .SetProperty(h => h.DecidedBy, by)
                .SetProperty(h => h.DecidedAt, now)
                .SetProperty(h => h.DecisionNote, note == null ? null : note.Trim())
                .SetProperty(h => h.UpdatedAt, now), cancellationToken);
        if (closed == 0)
        {
            var row = await RequireAsync(organisationId, hireId, tracking: false, cancellationToken);
            throw EndgameProblem.Conflict($"The proposal was already {row.Status}.");
        }

        return await GetAsync(organisationId, hireId, cancellationToken);
    }

    /// <summary>
    /// A contractor finished: it leaves the chart, what it learned goes into its briefer's memory, and a
    /// role that keeps recurring at the node is proposed as a permanent hire.
    /// </summary>
    public async Task<(EmployeeView Contractor, IReadOnlyList<MemoryEntryView> Learned, HireView? Promotion)> FinishContractorAsync(Guid organisationId, Guid contractorId, IReadOnlyList<MemoryInput> learned, Guid? runId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(learned);
        var contractor = await employees.FinishContractorAsync(organisationId, contractorId, cancellationToken);
        IReadOnlyList<MemoryEntryView> written = [];
        if (learned.Count > 0)
        {
            var scope = await scopes.ForRowAsync(contractor.OrganisationId, contractor.DivisionId, contractor.ProjectId, contractor.AppId, cancellationToken);
            written = await memory.AddAsync(organisationId, contractor.BriefedById!.Value, runId ?? contractor.LastRunId,
                learned.Select(l => l with { Scope = l.Scope ?? scope.Path.ToString() }).ToList(), MemoryActors.Employee, null, cancellationToken);
        }

        var at = await scopes.ForRowAsync(contractor.OrganisationId, contractor.DivisionId, contractor.ProjectId, contractor.AppId, cancellationToken);
        HireView? promotion = null;
        var recurring = (await employees.RecurringRolesAsync(at, cancellationToken))
            .FirstOrDefault(r => r.Scope == at.Path.ToString() && string.Equals(r.Role, contractor.Role, StringComparison.OrdinalIgnoreCase));
        if (recurring is not null)
        {
            var briefer = await employees.GetAsync(organisationId, contractor.BriefedById!.Value, cancellationToken);
            var raised = await RaiseAsync(at, new HireInput(
                HireTriggers.Promotion,
                PromotionNeedKey(at, contractor.Role),
                $"{recurring.Contractors} {contractor.Role} contractors were briefed here in the last {recurring.WindowDays} days, costing {recurring.CostCredits:0.##} credits. Standing work is cheaper, and better remembered, done by an employee.",
                contractor.Role,
                contractor.Role,
                new JobDescriptionInput($"The work {briefer.Name} kept briefing contractors for. The latest brief: {recurring.LastBrief}", briefer.JobDescription.Tools, briefer.JobDescription.Services, null, briefer.JobDescription.ModelTier),
                briefer.Id,
                decimal.Round(recurring.CostCredits * 30m / recurring.WindowDays, 2),
                contractor.Role), null, runId, cancellationToken);
            // A decline still holding answers with the declined proposal: nothing new was proposed (R5-3).
            promotion = raised.Hire.Status == HireStatuses.Declined ? null : raised.Hire;
        }

        return (await employees.GetAsync(organisationId, contractorId, cancellationToken), written, promotion);
    }

    /// <summary>The expected monthly cost, held to the hire's own budget when it has one and that is lower.</summary>
    public static decimal Capped(decimal expected, decimal? monthlyCreditLimit) =>
        monthlyCreditLimit is { } limit && limit < expected ? limit : expected;

    /// <summary>
    /// The rule for a need the factory raises (assumption 48 in docs/assumptions-log.md): before anyone is proposed, look up
    /// the chain from the need's level. An employee on the payroll with that role who works at that level or above it — their
    /// "works at … and everything beneath it" reaches the need — does the work; nobody is proposed. A sibling's employee (the
    /// engineer of another project) does not reach it. The nearest one wins, then the longest serving.
    /// </summary>
    public async Task<EmployeeRecord?> CoveringAsync(ResolvedScope scope, string? role, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var wanted = role?.Trim();
        if (string.IsNullOrEmpty(wanted))
        {
            return null;
        }

        session.UseOrganisation(scope.OrganisationId);
        var candidates = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId && e.Kind == EmployeeKinds.Employee && e.Status != EmployeeStatuses.Released)
            .Where(e => (e.DivisionId == null || e.DivisionId == scope.DivisionId) && (e.ProjectId == null || e.ProjectId == scope.ProjectId) && (e.AppId == null || e.AppId == scope.AppId))
            .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
            .ToListAsync(cancellationToken);
        return candidates
            .Where(e => string.Equals(e.Role.Trim(), wanted, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(e => e.AppId is not null ? 3 : e.ProjectId is not null ? 2 : e.DivisionId is not null ? 1 : 0)
            .FirstOrDefault();
    }

    /// <summary>A need someone already covers: nothing is proposed, and an open proposal for the same need is withdrawn.</summary>
    private async Task<HireRaised> CoveredAsync(ResolvedScope scope, EmployeeRecord covering, string? needKey, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (needKey is not null)
        {
            session.UseOrganisation(scope.OrganisationId);
            await db.HireProposals
                .Where(h => h.OrganisationId == scope.OrganisationId && h.NeedKey == needKey && h.Status == HireStatuses.Proposed)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(h => h.Status, HireStatuses.Declined)
                    .SetProperty(h => h.DecidedVia, IdeaDecisions.ByAutoMode)
                    .SetProperty(h => h.DecidedBy, (Guid?)null)
                    .SetProperty(h => h.DecidedAt, now)
                    .SetProperty(h => h.DecisionNote, $"Withdrawn: {covering.Name} already does this work here.")
                    .SetProperty(h => h.UpdatedAt, now), cancellationToken);
        }

        var employee = await employees.GetAsync(scope.OrganisationId, covering.Id, cancellationToken);
        var hire = new HireView(covering.Id, HireCovered, HireTriggers.Stage, needKey, employee.Scope, $"{covering.Name} already works here as {covering.Role}.", covering.Name, covering.Role,
            employee.JobDescription, employee.ReportsTo, 0m, true, 0m, null, "runner", null, null, covering.Id, covering.CreatedAt);
        return new HireRaised(hire, false, employee);
    }

    /// <summary>
    /// The sweep's repair of open proposals the live rules would never have left waiting (R2-3) — rows from before those
    /// rules existed, or raised just before the work ended: a factory need someone up the chain now covers is withdrawn
    /// ("Withdrawn: {name} already does this work here."), and a hire raised by a build that ended unpublished, with nothing
    /// built, is withdrawn with the build's reason (D81). Idempotent: only proposals still open are touched, and each is
    /// declined by the platform with no person deciding. Runs as the platform, across organisations. Returns how many.
    /// </summary>
    public async Task<int> TidyOpenProposalsAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var open = await db.HireProposals.AsNoTracking()
            .Where(h => h.Status == HireStatuses.Proposed && h.RaisedByUserId == null
                && (h.Trigger == HireTriggers.Stage || h.Trigger == HireTriggers.Division || h.Trigger == HireTriggers.Recurring))
            .OrderBy(h => h.CreatedAt).ThenBy(h => h.Id)
            .ToListAsync(cancellationToken);
        var runIds = open.Select(h => h.RaisedByRunId).OfType<Guid>().Distinct().ToList();
        var builds = await db.Runs.AsNoTracking()
            .Where(r => runIds.Contains(r.Id) && r.Kind == RunKinds.Build && (r.Status == RunStatuses.Failed || r.Status == RunStatuses.Cancelled))
            .Select(r => new { r.Id, r.Status, r.AppId, r.CreatedAt }).ToListAsync(cancellationToken);
        var appIds = builds.Select(b => b.AppId).OfType<Guid>().ToList();
        var apps = await db.Apps.AsNoTracking().Where(a => appIds.Contains(a.Id)).Select(a => new { a.Id, a.Name, a.PublishedAt }).ToDictionaryAsync(a => a.Id, cancellationToken);
        var tidied = 0;
        foreach (var hire in open)
        {
            string? note = null;
            if (builds.FirstOrDefault(b => b.Id == hire.RaisedByRunId) is { } build
                && (build.AppId is not { } placed || !apps.TryGetValue(placed, out var app) || Runs.RunService.PublishedNothing(app.PublishedAt, build.CreatedAt)))
            {
                note = Runs.RunService.WithdrawnReason(build.Status, build.AppId is { } a && apps.TryGetValue(a, out var named) && named.PublishedAt is null ? named.Name : null);
            }
            else if (await ScopeOfAsync(hire, cancellationToken) is { } scope && await CoveringAsync(scope, hire.Role, cancellationToken) is { } covering && covering.Id != hire.EmployeeId)
            {
                note = $"Withdrawn: {covering.Name} already does this work here.";
            }

            if (note is null)
            {
                continue;
            }

            var now = clock.GetUtcNow();
            session.UseOrganisation(hire.OrganisationId);
            tidied += await db.HireProposals
                .Where(h => h.OrganisationId == hire.OrganisationId && h.Id == hire.Id && h.Status == HireStatuses.Proposed)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(h => h.Status, HireStatuses.Declined)
                    .SetProperty(h => h.DecidedVia, IdeaDecisions.ByAutoMode)
                    .SetProperty(h => h.DecidedBy, (Guid?)null)
                    .SetProperty(h => h.DecidedAt, now)
                    .SetProperty(h => h.DecisionNote, note)
                    .SetProperty(h => h.UpdatedAt, now), cancellationToken);
            session.UseSystem();
        }

        session.Clear();
        return tidied;
    }

    /// <summary>The narrowest level a proposal is for, or null for one at the organisation itself.</summary>
    private async Task<ResolvedScope?> ScopeOfAsync(HireProposalRecord hire, CancellationToken cancellationToken) =>
        hire.AppId is { } app ? await scopes.FindNodeAsync(NodeLevel.App, app, cancellationToken)
        : hire.ProjectId is { } project ? await scopes.FindNodeAsync(NodeLevel.Project, project, cancellationToken)
        : hire.DivisionId is { } division ? await scopes.FindNodeAsync(NodeLevel.Division, division, cancellationToken)
        : null;

    /// <summary>The status a raise answers with when someone already covers the need; never stored.</summary>
    public const string HireCovered = "covered";

    /// <summary>True for a proposal the platform withdrew (declined with no person deciding), never for a person's decline.</summary>
    public static bool IsWithdrawn(string status, string? decidedVia, Guid? decidedBy) =>
        status == HireStatuses.Declined && decidedVia == IdeaDecisions.ByAutoMode && decidedBy is null;

    private async Task<decimal> HeadroomAsync(ResolvedScope scope, CancellationToken cancellationToken) =>
        (await ledger.PositionAsync(scope, null, clock.GetUtcNow(), cancellationToken)).Headroom().Credits;

    /// <summary>The needs a person's decline holds for <see cref="WorkforceLimits.DeclinedHireHoldDays"/>: a contractor role that kept recurring.</summary>
    public static bool Holds(string trigger) => trigger is HireTriggers.Promotion or HireTriggers.Recurring;

    /// <summary>When a proposal a person declined can be proposed again by the platform; null when the decline holds nothing.</summary>
    public static DateTimeOffset? ProposedAgainFrom(string status, string trigger, string? needKey, Guid? raisedBy, string? decidedVia, Guid? decidedBy, DateTimeOffset? decidedAt) =>
        status == HireStatuses.Declined && Holds(trigger) && needKey is not null && raisedBy is null && decidedVia == IdeaDecisions.ByPerson && decidedBy is not null && decidedAt is { } at
            ? at.AddDays(WorkforceLimits.DeclinedHireHoldDays)
            : null;

    /// <summary>The newest proposal for <paramref name="needKey"/> a person declined whose hold has not lapsed.</summary>
    private async Task<HireProposalRecord?> DeclinedHoldingAsync(Guid organisationId, string needKey, CancellationToken cancellationToken)
    {
        var since = clock.GetUtcNow().AddDays(-WorkforceLimits.DeclinedHireHoldDays);
        session.UseOrganisation(organisationId);
        var declined = await db.HireProposals.AsNoTracking()
            .Where(h => h.OrganisationId == organisationId && h.NeedKey == needKey && h.Status == HireStatuses.Declined
                && h.DecidedVia == IdeaDecisions.ByPerson && h.DecidedBy != null && h.DecidedAt > since)
            .OrderByDescending(h => h.DecidedAt)
            .ToListAsync(cancellationToken);
        return declined.FirstOrDefault(h => ProposedAgainFrom(h.Status, h.Trigger, h.NeedKey, h.RaisedByUserId, h.DecidedVia, h.DecidedBy, h.DecidedAt) is not null);
    }

    private async Task<HireProposalRecord?> ExistingAsync(Guid organisationId, string needKey, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        return await db.HireProposals.AsNoTracking()
            .Where(h => h.OrganisationId == organisationId && h.NeedKey == needKey && h.Status != HireStatuses.Declined)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<HireProposalRecord> RequireAsync(Guid organisationId, Guid hireId, bool tracking, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var query = tracking ? db.HireProposals : db.HireProposals.AsNoTracking();
        return await query.SingleOrDefaultAsync(h => h.OrganisationId == organisationId && h.Id == hireId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The hire proposal");
    }

    private async Task<HireView> ViewAsync(HireProposalRecord h, CancellationToken cancellationToken)
    {
        var scope = await scopes.ForRowAsync(h.OrganisationId, h.DivisionId, h.ProjectId, h.AppId, cancellationToken);
        var headroom = await HeadroomAsync(scope, cancellationToken);
        session.UseOrganisation(h.OrganisationId);
        var manager = h.ReportsToId is { } m
            ? await db.Employees.AsNoTracking().Where(e => e.OrganisationId == h.OrganisationId && e.Id == m).Select(e => new PersonRef(e.Id, e.Name)).SingleOrDefaultAsync(cancellationToken)
            : null;
        HireDecisionView? decision = null;
        if (h.DecidedAt is { } at)
        {
            var by = IsWithdrawn(h.Status, h.DecidedVia, h.DecidedBy) ? "Endgame"
                : h.DecidedVia == IdeaDecisions.ByAutoMode
                ? "auto-mode"
                : await db.Users.AsNoTracking().Where(u => u.Id == h.DecidedBy).Select(u => u.DisplayName).SingleOrDefaultAsync(cancellationToken) ?? "";
            decision = new HireDecisionView(h.DecidedVia ?? IdeaDecisions.ByPerson, by, at, h.DecisionNote);
        }

        var path = scope.Path.ToString();
        return new HireView(h.Id, h.Status, h.Trigger, h.NeedKey, path, h.Reason, h.Name, h.Role,
            new JobDescriptionView(h.Mandate, path, h.Tools, h.Services, h.MonthlyCreditLimit, h.ModelTier), manager,
            h.ExpectedMonthlyCredits, h.ExpectedMonthlyCredits <= headroom, headroom, h.ContractorRole,
            h.RaisedByUserId is null ? "runner" : "person", h.RaisedByRunId, decision, h.EmployeeId, h.CreatedAt, IsWithdrawn(h.Status, h.DecidedVia, h.DecidedBy),
            h.Status == HireStatuses.Proposed && Holds(h.Trigger) && h.NeedKey is not null && h.RaisedByUserId is null ? WorkforceLimits.DeclinedHireHoldDays : null,
            ProposedAgainFrom(h.Status, h.Trigger, h.NeedKey, h.RaisedByUserId, h.DecidedVia, h.DecidedBy, h.DecidedAt));
    }
}
