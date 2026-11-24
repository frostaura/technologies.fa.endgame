using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Cascade;
using Endgame.Domain.Credits;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Credits;

/// <summary>
/// The one ledger (ARCH-004, <i>Credits</i>). Balance, spend and what is held are all derived from
/// <c>credit_entries</c>; there is no counter anywhere else. Admission takes the organisation's lock,
/// measures every cap on the call's chain and inserts the reservation in the same transaction, so N
/// concurrent calls against a budget that fits K admit exactly K.
/// </summary>
public sealed class CreditLedger(EndgameDbContext db, TenantSession session, ScopeResolver scopes, CascadeService cascade, TimeProvider clock) : ICreditLedger
{
    /// <summary>
    /// A reservation is held while nothing has closed it and either its own expiry or its run's lease
    /// is still in the future: it expires with the run's lease, and a leaked hold releases itself.
    /// </summary>
    private const string HeldReservations = """
        SELECT r.amount, r.division_id, r.project_id, r.app_id, r.employee_id
        FROM credit_entries r
        LEFT JOIN runs run ON run.organisation_id = r.organisation_id AND run.id = r.run_id
        WHERE r.organisation_id = @org AND r.kind = 'reservation' AND r.billable
          AND NOT EXISTS (SELECT 1 FROM credit_entries c WHERE c.organisation_id = r.organisation_id AND c.reservation_id = r.id)
          AND GREATEST(r.expires_at, run.lease_expires_at) > @now
        """;

    public async Task<Admission> AdmitAsync(ReservationRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var a = request.Attribution;
        session.UseOrganisation(a.OrganisationId);
        var scope = await scopes.ForRowAsync(a.OrganisationId, a.DivisionId, a.ProjectId, a.AppId, cancellationToken);
        var now = clock.GetUtcNow();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        await db.LockOrganisationAsync(a.OrganisationId, cancellationToken);

        if (request.IdempotencyKey is { } key
            && await db.CreditEntries.AsNoTracking().FirstOrDefaultAsync(e => e.OrganisationId == a.OrganisationId && e.IdempotencyKey == key, cancellationToken) is { } existing)
        {
            await transaction.CommitAsync(cancellationToken);
            return new Admitted(existing.Id, existing.Amount);
        }

        if (request.Billable)
        {
            var position = await PositionAsync(scope, a.EmployeeId, now, cancellationToken);
            var refusal = position.Refuse(request.Credits);
            if (refusal is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return refusal;
            }
        }

        var reservation = new CreditEntryRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = a.OrganisationId,
            Kind = CreditEntryKinds.Reservation,
            Amount = request.Credits,
            DivisionId = a.DivisionId,
            ProjectId = a.ProjectId,
            AppId = a.AppId,
            EmployeeId = a.EmployeeId,
            RunId = a.RunId,
            TaskType = request.TaskType,
            Model = Truncate(request.Models, 200),
            Billable = request.Billable,
            CostUsd = request.WorstCaseUsd,
            ExpiresAt = request.ExpiresAt,
            IdempotencyKey = request.IdempotencyKey,
            CreatedAt = now,
        };
        db.CreditEntries.Add(reservation);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return new Admitted(reservation.Id, reservation.Amount);
    }

    public async Task SettleAsync(Settlement settlement, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settlement);
        await CloseAsync(settlement.OrganisationId, settlement.ReservationId, CreditEntryKinds.Settlement, settlement.Credits, settlement.CostUsd, settlement.Model, settlement.GenerationId, settlement.Note, cancellationToken);
    }

    public async Task ReleaseAsync(Guid organisationId, Guid reservationId, string reason, CancellationToken cancellationToken) =>
        await CloseAsync(organisationId, reservationId, CreditEntryKinds.Release, 0m, null, null, null, reason, cancellationToken);

    /// <summary>Releases every reservation of a run that nothing has closed yet. Part of finishing the run.</summary>
    public async Task<int> ReleaseOpenForRunAsync(Guid organisationId, Guid runId, string reason, CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("""
            INSERT INTO credit_entries (id, organisation_id, kind, amount, reservation_id, division_id, project_id, app_id, employee_id, run_id,
                                        task_type, model, billable, note, created_at)
            SELECT gen_random_uuid(), r.organisation_id, 'release', 0, r.id, r.division_id, r.project_id, r.app_id, r.employee_id, r.run_id,
                   r.task_type, r.model, r.billable, @note, @now
            FROM credit_entries r
            WHERE r.organisation_id = @org AND r.run_id = @run AND r.kind = 'reservation'
              AND NOT EXISTS (SELECT 1 FROM credit_entries c WHERE c.organisation_id = r.organisation_id AND c.reservation_id = r.id)
            """, cancellationToken, P("org", organisationId), P("run", runId), P("note", Truncate(reason, 500)), P("now", clock.GetUtcNow()));
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Appends a release for every reservation that lapsed without being closed. Runs as the platform.</summary>
    public async Task<int> ReleaseLapsedAsync(TimeSpan grace, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var now = clock.GetUtcNow();
        await using var command = await db.CommandAsync("""
            INSERT INTO credit_entries (id, organisation_id, kind, amount, reservation_id, division_id, project_id, app_id, employee_id, run_id,
                                        task_type, model, billable, note, created_at)
            SELECT gen_random_uuid(), r.organisation_id, 'release', 0, r.id, r.division_id, r.project_id, r.app_id, r.employee_id, r.run_id,
                   r.task_type, r.model, r.billable, 'lapsed with its lease', @now
            FROM credit_entries r
            LEFT JOIN runs run ON run.organisation_id = r.organisation_id AND run.id = r.run_id
            WHERE r.kind = 'reservation'
              AND NOT EXISTS (SELECT 1 FROM credit_entries c WHERE c.organisation_id = r.organisation_id AND c.reservation_id = r.id)
              AND GREATEST(r.expires_at, run.lease_expires_at) < @cutoff
            """, cancellationToken, P("now", now), P("cutoff", now - grace));
        var released = await command.ExecuteNonQueryAsync(cancellationToken);
        session.Clear();
        return released;
    }

    /// <summary>A manual top-up (spec: no payment gateway). The caller has already checked who may do this.</summary>
    public async Task<CreditEntryRecord> TopUpAsync(Guid organisationId, decimal credits, string? note, Guid by, string? idempotencyKey, CancellationToken cancellationToken)
    {
        if (credits <= 0 || decimal.Round(credits, 6) != credits)
        {
            throw EndgameProblem.Invalid("A top-up is a positive number of credits, to at most six decimal places.");
        }

        session.UseOrganisation(organisationId);
        if (idempotencyKey is not null
            && await db.CreditEntries.AsNoTracking().FirstOrDefaultAsync(e => e.OrganisationId == organisationId && e.IdempotencyKey == idempotencyKey, cancellationToken) is { } existing)
        {
            return existing;
        }

        var entry = new CreditEntryRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Kind = CreditEntryKinds.TopUp,
            Amount = credits,
            Billable = true,
            Note = note is null ? null : Truncate(note, 500),
            IdempotencyKey = idempotencyKey,
            CreatedBy = by,
            CreatedAt = clock.GetUtcNow(),
        };
        db.CreditEntries.Add(entry);
        db.OperatorActions.Add(new OperatorActionRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            OperatorUserId = by,
            Action = "credits.top_up",
            DetailJson = new JsonObject { ["credits"] = credits, ["note"] = note, ["entryId"] = entry.Id.ToString() }.ToJsonString(),
            At = entry.CreatedAt,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return entry;
    }

    /// <summary>This month's billable spend for every node of an organisation, for the org chart.</summary>
    public async Task<IReadOnlyList<(Guid? DivisionId, Guid? ProjectId, Guid? AppId, Guid? EmployeeId, decimal Credits)>> SpendThisMonthByNodeAsync(Guid organisationId, CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("""
            SELECT division_id, project_id, app_id, employee_id, SUM(amount) AS credits
            FROM credit_entries
            WHERE organisation_id = @org AND kind = 'settlement' AND billable AND created_at >= @month
            GROUP BY division_id, project_id, app_id, employee_id
            """, cancellationToken, P("org", organisationId), P("month", MonthStart(clock.GetUtcNow())));
        var rows = new List<(Guid?, Guid?, Guid?, Guid?, decimal)>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add((reader.GuidOrNull("division_id"), reader.GuidOrNull("project_id"), reader.GuidOrNull("app_id"), reader.GuidOrNull("employee_id"), reader.GetDecimal(4)));
        }

        return rows;
    }

    public static DateTimeOffset MonthStart(DateTimeOffset now) => new(now.UtcDateTime.Year, now.UtcDateTime.Month, 1, 0, 0, 0, TimeSpan.Zero);

    private async Task CloseAsync(Guid organisationId, Guid reservationId, string kind, decimal credits, decimal? costUsd, string? model, string? generationId, string? note, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        // Copies the reservation's attribution, so every roll-up is a filter. The unique index on
        // (organisation, reservation, kind) makes a second close of the same kind a no-op.
        await using var command = await db.CommandAsync("""
            INSERT INTO credit_entries (id, organisation_id, kind, amount, reservation_id, division_id, project_id, app_id, employee_id, run_id,
                                        task_type, model, billable, cost_usd, generation_id, note, created_at)
            SELECT gen_random_uuid(), r.organisation_id, @kind, @amount, r.id, r.division_id, r.project_id, r.app_id, r.employee_id, r.run_id,
                   r.task_type, COALESCE(@model, r.model), r.billable, @cost, @generation, @note, @now
            FROM credit_entries r
            WHERE r.organisation_id = @org AND r.id = @reservation AND r.kind = 'reservation'
            ON CONFLICT DO NOTHING
            """, cancellationToken,
            P("kind", kind), P("amount", credits), P("model", model is null ? null : Truncate(model, 200)), P("cost", costUsd),
            P("generation", generationId is null ? null : Truncate(generationId, 200)), P("note", note is null ? null : Truncate(note, 500)),
            P("now", clock.GetUtcNow()), P("org", organisationId), P("reservation", reservationId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>The organisation's balance, what is held, its overdraft and every cap on the scope's chain.</summary>
    public Task<Position> PositionAsync(ResolvedScope scope, DateTimeOffset now, CancellationToken cancellationToken) =>
        PositionAsync(scope, null, now, cancellationToken);

    private async Task<Position> PositionAsync(ResolvedScope scope, Guid? employeeId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        decimal topUps, settledAll;
        await using (var totals = await db.CommandAsync("""
            SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'top_up'), 0),
                   COALESCE(SUM(amount) FILTER (WHERE kind = 'settlement' AND billable), 0)
            FROM credit_entries WHERE organisation_id = @org
            """, cancellationToken, P("org", scope.OrganisationId)))
        await using (var reader = await totals.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            topUps = reader.GetDecimal(0);
            settledAll = reader.GetDecimal(1);
        }

        var held = new List<(decimal Amount, Guid? Division, Guid? Project, Guid? App, Guid? Employee)>();
        await using (var heldCommand = await db.CommandAsync(HeldReservations, cancellationToken, P("org", scope.OrganisationId), P("now", now)))
        await using (var reader = await heldCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                held.Add((reader.GetDecimal(0), reader.GuidOrNull("division_id"), reader.GuidOrNull("project_id"), reader.GuidOrNull("app_id"), reader.GuidOrNull("employee_id")));
            }
        }

        var spend = await MonthSpendOnChainAsync(scope, employeeId, now, cancellationToken);
        var entries = await cascade.ChainEntriesAsync(scope, null, cancellationToken);
        var overdraft = entries.Where(e => e.Kind == CascadeKind.Setting && e.Key == CascadeKeys.OverdraftLimit)
            .Select(e => CascadeService.NumberOf(JsonNode.Parse(e.ValueJson)) ?? 0m)
            .DefaultIfEmpty(0m)
            .Min();

        var budgets = new List<BudgetLine>();
        foreach (var entry in entries.Where(e => e.Kind == CascadeKind.Budget && e.Key == CascadeKeys.MonthlyCredits).OrderBy(e => e.Level))
        {
            var limit = CascadeService.NumberOf(JsonNode.Parse(entry.ValueJson)) ?? 0m;
            var heldHere = held.Where(h => OnNode(entry.Level, scope, h.Division, h.Project, h.App)).Sum(h => h.Amount);
            budgets.Add(new BudgetLine(entry.Path, entry.Level.ToWire(), limit, spend[(int)entry.Level], heldHere));
        }

        if (employeeId is { } employee
            && await db.Employees.AsNoTracking().Where(e => e.OrganisationId == scope.OrganisationId && e.Id == employee).Select(e => new { e.Name, e.MonthlyCreditLimit }).SingleOrDefaultAsync(cancellationToken) is { MonthlyCreditLimit: { } employeeLimit } worker)
        {
            budgets.Add(new BudgetLine($"employee:{worker.Name}", "employee", employeeLimit, spend[4], held.Where(h => h.Employee == employee).Sum(h => h.Amount)));
        }

        var heldAll = held.Sum(h => h.Amount);
        return new Position(topUps, topUps - settledAll - heldAll, heldAll, overdraft, budgets);
    }

    private static bool OnNode(NodeLevel level, ResolvedScope scope, Guid? division, Guid? project, Guid? app) => level switch
    {
        NodeLevel.Organisation => true,
        NodeLevel.Division => division == scope.DivisionId,
        NodeLevel.Project => project == scope.ProjectId,
        _ => app == scope.AppId,
    };

    /// <summary>This month's billable spend at each level of the chain, plus the employee's: [org, division, project, app, employee].</summary>
    private async Task<decimal[]> MonthSpendOnChainAsync(ResolvedScope scope, Guid? employeeId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("""
            SELECT COALESCE(SUM(amount), 0),
                   COALESCE(SUM(amount) FILTER (WHERE division_id = @division), 0),
                   COALESCE(SUM(amount) FILTER (WHERE project_id = @project), 0),
                   COALESCE(SUM(amount) FILTER (WHERE app_id = @app), 0),
                   COALESCE(SUM(amount) FILTER (WHERE employee_id = @employee), 0)
            FROM credit_entries
            WHERE organisation_id = @org AND kind = 'settlement' AND billable AND created_at >= @month
            """, cancellationToken,
            P("division", scope.DivisionId), P("project", scope.ProjectId), P("app", scope.AppId), P("employee", employeeId),
            P("org", scope.OrganisationId), P("month", MonthStart(now)));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return [reader.GetDecimal(0), reader.GetDecimal(1), reader.GetDecimal(2), reader.GetDecimal(3), reader.GetDecimal(4)];
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    public sealed record BudgetLine(string Scope, string Level, decimal Limit, decimal SpentThisMonth, decimal Held)
    {
        public decimal Headroom => Limit - SpentThisMonth - Held;

    }

    public sealed record Position(decimal TopUps, decimal Balance, decimal HeldOrganisation, decimal OverdraftLimit, IReadOnlyList<BudgetLine> Budgets)
    {
        public BudgetLine? BindingBudget => Budgets.OrderBy(b => b.Headroom).FirstOrDefault();

        public Refused? Refuse(decimal needed)
        {
            foreach (var budget in Budgets.OrderBy(b => b.Headroom))
            {
                if (budget.Headroom < needed)
                {
                    return new Refused(
                        $"The monthly budget at {budget.Scope} has {budget.Headroom.ToString("0.######", CultureInfo.InvariantCulture)} credits left; this call needs up to {needed.ToString("0.######", CultureInfo.InvariantCulture)}.",
                        budget.Scope, budget.Headroom, needed);
                }
            }

            var available = Balance + OverdraftLimit;
            return available < needed
                ? new Refused(
                    $"The organisation has {available.ToString("0.######", CultureInfo.InvariantCulture)} credits available including its overdraft; this call needs up to {needed.ToString("0.######", CultureInfo.InvariantCulture)}.",
                    "organisation balance", available, needed)
                : null;
        }
    }
}
