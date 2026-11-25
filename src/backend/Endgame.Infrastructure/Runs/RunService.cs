using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Runs;

public sealed record NewEvent(string Type, JsonObject? Payload);

public sealed record RunEventView(long Seq, string Type, DateTimeOffset At, JsonNode? Payload);

public sealed record RunView(
    Guid Id,
    string Scope,
    string Kind,
    string Status,
    string Title,
    Guid? EmployeeId,
    Guid? IdeaId,
    Guid? ConversationId,
    Guid? ParentRunId,
    string? LeaseHolder,
    DateTimeOffset? LeaseExpiresAt,
    long LastSeq,
    bool BudgetExhausted,
    string? Outcome,
    string? Summary,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt);

/// <summary>
/// Runs and their append-only log (ARCH-004, <i>Run log</i>). Sequence numbers are assigned here by
/// bumping the run's <c>last_seq</c> inside the same transaction that inserts the events, so they are
/// gapless per run and two writers serialise on the run's row. Lifecycle events move the run's status
/// in that same transaction; <c>run.finished</c> also settles the employee and releases the run's
/// open reservations, all at once (ARCH-002: no repair sweep).
/// </summary>
public sealed class RunService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, CreditLedger ledger, TimeProvider clock)
{
    public const int MaxEventsPerRead = 500;
    public const int MaxEventsPerAppend = 100;
    public const int MaxPayloadBytes = 64 * 1024;
    public static readonly TimeSpan MaxLease = TimeSpan.FromMinutes(30);

    public async Task<RunView> CreateAsync(ResolvedScope scope, string kind, string title, Guid? employeeId, Guid? ideaId, Guid? conversationId, Guid? parentRunId, Guid? createdBy, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (!RunKinds.All.Contains(kind))
        {
            throw EndgameProblem.Invalid($"'{kind}' is not a kind of run: use {string.Join(", ", RunKinds.All)}.");
        }

        var trimmed = title?.Trim() ?? "";
        if (trimmed.Length is 0 or > 300)
        {
            throw EndgameProblem.Invalid("A run's title is 1 to 300 characters.");
        }

        EmployeeRecord? worker = null;
        if (employeeId is { } employee)
        {
            worker = await db.Employees.AsNoTracking().SingleOrDefaultAsync(e => e.OrganisationId == scope.OrganisationId && e.Id == employee && e.Status != EmployeeStatuses.Released, cancellationToken)
                ?? throw EndgameProblem.NotFound("The employee");
            if (worker.Status == EmployeeStatuses.Paused && createdBy is not null)
            {
                // A person starting work for a paused employee is told so; the factory's work waits instead (below).
                throw EndgameProblem.Conflict($"{worker.Name} is paused, so they are given no new work. Resume them first.");
            }
        }

        if (parentRunId is { } parent && !await db.Runs.AnyAsync(r => r.OrganisationId == scope.OrganisationId && r.Id == parent, cancellationToken))
        {
            throw EndgameProblem.NotFound("The parent run");
        }

        var run = new RunRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            Kind = kind,
            Status = RunStatuses.Queued,
            Title = trimmed,
            EmployeeId = employeeId,
            IdeaId = ideaId,
            ConversationId = conversationId,
            ParentRunId = parentRunId,
            CreatedBy = createdBy,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Runs.Add(run);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        if (worker?.Status == EmployeeStatuses.Paused)
        {
            // The factory gave a paused employee work: it waits, and says so, until they are resumed (EMP-04).
            await AppendAsync(scope.OrganisationId, run.Id, EmployeePaused(worker.Id, worker.Name), null, null, cancellationToken);
            return await GetAsync(scope.OrganisationId, run.Id, cancellationToken);
        }

        return View(run, scope.Path.ToString());
    }

    /// <summary>The <c>run.paused</c> reason when a run waits because the employee doing it is paused.</summary>
    public const string EmployeePausedReason = "employee_paused";

    /// <summary>What a run waiting on a paused employee logs: a plain line, then the pause itself.</summary>
    public static IReadOnlyList<NewEvent> EmployeePaused(Guid employeeId, string name) =>
    [
        new(RunEventTypes.Message, new JsonObject { ["text"] = $"Waiting for {name}, who is paused. This work carries on when they are resumed.", ["code"] = EmployeePausedReason }),
        new(RunEventTypes.RunPaused, new JsonObject { ["by"] = "workforce", ["reason"] = EmployeePausedReason, ["employeeId"] = employeeId.ToString() }),
    ];

    /// <summary>
    /// An employee was paused: every run under way that is theirs, or in which they hold a task, pauses.
    /// The Runner learns it at its next lease renewal and stops at the next step boundary. Returns how many.
    /// </summary>
    public async Task<int> PauseForEmployeeAsync(Guid organisationId, Guid employeeId, string name, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        string[] live = [RunStatuses.Queued, RunStatuses.Running, RunStatuses.WaitingApproval];
        var ids = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == organisationId && live.Contains(r.Status))
            .Where(r => r.EmployeeId == employeeId || db.Tasks.Any(t => t.OrganisationId == organisationId && t.HolderRunId == r.Id && t.HolderEmployeeId == employeeId && t.Status == TaskStatuses.InProgress))
            .Select(r => r.Id).ToListAsync(cancellationToken);
        foreach (var id in ids)
        {
            await AppendAsync(organisationId, id, EmployeePaused(employeeId, name), null, null, cancellationToken);
        }

        return ids.Count;
    }

    /// <summary>An employee was resumed: the runs that paused because of them go back to the queue. Returns how many.</summary>
    public async Task<int> ResumeForEmployeeAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var ids = new List<Guid>();
        await using (var command = await db.CommandAsync("""
            SELECT r.id FROM runs r
            WHERE r.organisation_id = @org AND r.status = 'paused'
              AND (SELECT e.payload FROM run_events e
                   WHERE e.organisation_id = r.organisation_id AND e.run_id = r.id AND e.type = 'run.paused'
                   ORDER BY e.seq DESC LIMIT 1) @> jsonb_build_object('reason', @reason::text, 'employeeId', @employee::text)
            """, cancellationToken, P("org", organisationId), P("reason", EmployeePausedReason), P("employee", employeeId.ToString())))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                ids.Add(reader.GetGuid(0));
            }
        }

        foreach (var id in ids)
        {
            await AppendAsync(organisationId, id, [new NewEvent(RunEventTypes.RunResumed, new JsonObject { ["by"] = "workforce", ["reason"] = "employee_resumed", ["employeeId"] = employeeId.ToString() })],
                null, null, cancellationToken);
        }

        return ids.Count;
    }

    /// <summary>Finds a run by id in whichever organisation holds it, and confines the session there.</summary>
    public async Task<(RunRecord Run, ResolvedScope Scope)> RequireAsync(Guid runId, CancellationToken cancellationToken)
    {
        var org = await scopes.OrganisationOfAsync(db.Runs, q => q.Where(r => r.Id == runId).Select(r => r.OrganisationId), cancellationToken)
            ?? throw EndgameProblem.NotFound("The run");
        var run = await db.Runs.AsNoTracking().SingleAsync(r => r.OrganisationId == org && r.Id == runId, cancellationToken);
        var scope = await scopes.ForRowAsync(run.OrganisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
        return (run, scope);
    }

    public async Task<RunView> GetAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == organisationId && r.Id == runId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The run");
        var scope = await scopes.ForRowAsync(run.OrganisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
        return View(run, scope.Path.ToString());
    }

    public const int MaxRunsPerList = 200;

    /// <summary>Runs at the scope and beneath it, newest first: the conversation's view of what is happening; one employee's when given.</summary>
    public async Task<IReadOnlyList<RunView>> ListAsync(ResolvedScope scope, string? kind, string? status, int limit, CancellationToken cancellationToken, Guid? employeeId = null)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (kind is not null && !RunKinds.All.Contains(kind))
        {
            throw EndgameProblem.Invalid($"'{kind}' is not a kind of run: use {string.Join(", ", RunKinds.All)}.");
        }

        if (status is not null && !RunStatuses.All.Contains(status))
        {
            throw EndgameProblem.Invalid($"'{status}' is not a run status: use {string.Join(", ", RunStatuses.All)}.");
        }

        var rows = await db.Runs.AsNoTracking()
            .Where(r => r.OrganisationId == scope.OrganisationId)
            .Where(r => scope.DivisionId == null || r.DivisionId == scope.DivisionId)
            .Where(r => scope.ProjectId == null || r.ProjectId == scope.ProjectId)
            .Where(r => scope.AppId == null || r.AppId == scope.AppId)
            .Where(r => kind == null || r.Kind == kind)
            .Where(r => status == null || r.Status == status)
            // An employee's runs are the ones it worked in: its own, one it claimed a task in, or one with a model call charged to it.
            .Where(r => employeeId == null || r.EmployeeId == employeeId
                || db.Tasks.Any(t => t.OrganisationId == r.OrganisationId && t.RunId == r.Id && t.EmployeeId == employeeId)
                || db.CreditEntries.Any(c => c.OrganisationId == r.OrganisationId && c.RunId == r.Id && c.EmployeeId == employeeId))
            .OrderByDescending(r => r.CreatedAt)
            .Take(Math.Clamp(limit, 1, MaxRunsPerList))
            .ToListAsync(cancellationToken);
        var paths = new Dictionary<(Guid?, Guid?, Guid?), string>();
        var views = new List<RunView>();
        foreach (var row in rows)
        {
            if (!paths.TryGetValue((row.DivisionId, row.ProjectId, row.AppId), out var path))
            {
                path = (await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken)).Path.ToString();
                paths[(row.DivisionId, row.ProjectId, row.AppId)] = path;
            }

            views.Add(View(row, path));
        }

        return views;
    }

    public async Task<IReadOnlyList<RunEventView>> ReadEventsAsync(Guid organisationId, Guid runId, long afterSeq, int limit, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var take = Math.Clamp(limit, 1, MaxEventsPerRead);
        var rows = await db.RunEvents.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.RunId == runId && e.Seq > afterSeq)
            .OrderBy(e => e.Seq)
            .Take(take)
            .ToListAsync(cancellationToken);
        return rows.Select(e => new RunEventView(e.Seq, e.Type, e.At, JsonNode.Parse(e.PayloadJson))).ToList();
    }

    /// <summary>
    /// Appends events, assigning the next sequence numbers. When <paramref name="leaseHolder"/> is given
    /// it must hold the run's live lease. A finished run's log is closed.
    /// </summary>
    /// <summary>The path of the first string or key holding U+0000 in a payload, or null.</summary>
    private static string? NulPath(JsonNode? node, string path)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var (key, value) in o)
                {
                    if (key.Contains('\0', StringComparison.Ordinal))
                    {
                        return $"{path} (a key)";
                    }

                    if (NulPath(value, $"{path}.{key}") is { } inner)
                    {
                        return inner;
                    }
                }

                return null;
            case JsonArray a:
                for (var i = 0; i < a.Count; i++)
                {
                    if (NulPath(a[i], $"{path}[{i}]") is { } inner)
                    {
                        return inner;
                    }
                }

                return null;
            case JsonValue v when v.GetValueKind() == System.Text.Json.JsonValueKind.String:
                return v.GetValue<string>().Contains('\0', StringComparison.Ordinal) ? path : null;
            default:
                return null;
        }
    }

    public async Task<IReadOnlyList<RunEventView>> AppendAsync(Guid organisationId, Guid runId, IReadOnlyList<NewEvent> events, string? leaseHolder, Guid? actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (events.Count is 0 or > MaxEventsPerAppend)
        {
            throw EndgameProblem.Invalid($"Append 1 to {MaxEventsPerAppend} events at a time.");
        }

        for (var index = 0; index < events.Count; index++)
        {
            var e = events[index];
            // PostgreSQL's jsonb cannot hold U+0000: refused here, precisely, rather than failing the insert with a 500.
            if (NulPath(e.Payload, $"events[{index}].payload") is { } where)
            {
                throw new EndgameProblem(400, "event_invalid", "The event cannot be stored",
                    $"{where}: contains a NUL character (U+0000), which the run log cannot store; remove it or replace it before logging.");
            }

            if (!RunEventTypes.All.Contains(e.Type))
            {
                throw EndgameProblem.Invalid($"'{e.Type}' is not a run event type.");
            }

            if ((e.Payload?.ToJsonString().Length ?? 2) > MaxPayloadBytes)
            {
                throw EndgameProblem.Invalid($"An event's payload is at most {MaxPayloadBytes} bytes; truncate tool results before logging them.");
            }
        }

        if (events.Take(events.Count - 1).Any(e => e.Type == RunEventTypes.RunFinished))
        {
            throw EndgameProblem.Invalid("run.finished must be the last event appended.");
        }

        session.UseOrganisation(organisationId);
        var now = clock.GetUtcNow();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);

        // The row lock taken here serialises every writer of this run's log.
        long last;
        string status;
        Guid? employeeId;
        await using (var bump = await db.CommandAsync("""
            UPDATE runs SET last_seq = last_seq + @n
            WHERE organisation_id = @org AND id = @run
              AND status NOT IN ('succeeded', 'failed', 'cancelled')
              AND (@holder IS NULL OR (lease_holder = @holder AND lease_expires_at > @now))
            RETURNING last_seq, status, employee_id
            """, cancellationToken, P("n", (long)events.Count), P("org", organisationId), P("run", runId), P("holder", leaseHolder), P("now", now)))
        await using (var reader = await bump.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                await reader.DisposeAsync();
                await transaction.RollbackAsync(cancellationToken);
                throw await AppendRefusalAsync(organisationId, runId, leaseHolder, cancellationToken);
            }

            last = reader.GetInt64(0);
            status = reader.GetString(1);
            employeeId = reader.GuidOrNull("employee_id");
        }

        var first = last - events.Count + 1;
        var appended = new List<RunEventView>();
        for (var i = 0; i < events.Count; i++)
        {
            var payload = events[i].Payload ?? new JsonObject();
            await using var insert = await db.CommandAsync(
                "INSERT INTO run_events (organisation_id, run_id, seq, type, at, payload) VALUES (@org, @run, @seq, @type, @at, @payload)",
                cancellationToken, P("org", organisationId), P("run", runId), P("seq", first + i), P("type", events[i].Type), P("at", now), Json("payload", payload.ToJsonString()));
            await insert.ExecuteNonQueryAsync(cancellationToken);
            appended.Add(new RunEventView(first + i, events[i].Type, now, payload));
            status = await ApplyLifecycleAsync(organisationId, runId, employeeId, status, events[i], actor, now, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return appended;
    }

    /// <summary>
    /// Takes or renews a run's lease. A queued run becomes running (and its first lease appends
    /// <c>run.started</c>); a lease held by someone else is only taken once it has lapsed. A paused or
    /// waiting run keeps its status, so the holder learns from the answer that it must wait.
    /// </summary>
    public async Task<RunView> LeaseAsync(Guid organisationId, Guid runId, string holder, TimeSpan ttl, CancellationToken cancellationToken)
    {
        RequireHolder(holder);
        var duration = ttl <= TimeSpan.Zero || ttl > MaxLease ? throw EndgameProblem.Invalid($"A lease lasts between 1 second and {MaxLease.TotalMinutes} minutes.") : ttl;
        session.UseOrganisation(organisationId);
        var now = Microseconds(clock.GetUtcNow());
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        bool firstStart;
        await using (var command = await db.CommandAsync("""
            UPDATE runs SET lease_holder = @holder, lease_expires_at = @until,
                            status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
                            started_at = COALESCE(started_at, @now)
            WHERE organisation_id = @org AND id = @run
              AND status NOT IN ('succeeded', 'failed', 'cancelled')
              AND (lease_holder IS NULL OR lease_holder = @holder OR lease_expires_at <= @now)
            RETURNING (started_at = @now)
            """, cancellationToken, P("holder", holder), P("until", now + duration), P("now", now), P("org", organisationId), P("run", runId)))
        {
            var result = await command.ExecuteScalarAsync(cancellationToken);
            if (result is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                throw await LeaseRefusalAsync(organisationId, runId, cancellationToken);
            }

            firstStart = (bool)result;
        }

        await transaction.CommitAsync(cancellationToken);
        if (firstStart)
        {
            await AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.RunStarted, new JsonObject { ["holder"] = holder })], holder, null, cancellationToken);
        }

        return await GetAsync(organisationId, runId, cancellationToken);
    }

    /// <summary>
    /// The Runner asks for work: claims the oldest queued run (or one whose lease lapsed) across every
    /// organisation, with one conditional update that skips rows another claimer holds.
    /// </summary>
    public async Task<RunView?> ClaimNextAsync(string holder, TimeSpan ttl, IReadOnlyList<string> kinds, CancellationToken cancellationToken)
    {
        RequireHolder(holder);
        if (ttl <= TimeSpan.Zero || ttl > MaxLease)
        {
            throw EndgameProblem.Invalid($"A lease lasts between 1 second and {MaxLease.TotalMinutes} minutes.");
        }

        if (kinds.Any(k => !RunKinds.All.Contains(k)))
        {
            throw EndgameProblem.Invalid($"Kinds are any of {string.Join(", ", RunKinds.All)}.");
        }

        session.UseSystem();
        var now = Microseconds(clock.GetUtcNow());
        Guid org, run;
        bool firstStart;
        await using (var command = await db.CommandAsync("""
            UPDATE runs SET lease_holder = @holder, lease_expires_at = @until, status = 'running', started_at = COALESCE(started_at, @now)
            WHERE id = (
                SELECT id FROM runs
                WHERE ((status = 'queued' AND (lease_holder IS NULL OR lease_expires_at <= @now))
                       OR (status = 'running' AND lease_expires_at <= @now))
                  AND (cardinality(@kinds) = 0 OR kind = ANY(@kinds))
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1)
            RETURNING organisation_id, id, (started_at = @now)
            """, cancellationToken, P("holder", holder), P("until", now + ttl), P("now", now), Texts("kinds", kinds)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                session.Clear();
                return null;
            }

            org = reader.GetGuid(0);
            run = reader.GetGuid(1);
            firstStart = reader.GetBoolean(2);
        }

        if (firstStart)
        {
            await AppendAsync(org, run, [new NewEvent(RunEventTypes.RunStarted, new JsonObject { ["holder"] = holder })], holder, null, cancellationToken);
        }

        return await GetAsync(org, run, cancellationToken);
    }

    public async Task<RunView> PauseAsync(Guid organisationId, Guid runId, Guid by, string? reason, CancellationToken cancellationToken)
    {
        var run = await GetAsync(organisationId, runId, cancellationToken);
        if (run.Status is not (RunStatuses.Queued or RunStatuses.Running or RunStatuses.WaitingApproval))
        {
            throw EndgameProblem.Conflict($"A {run.Status} run cannot be paused.");
        }

        await AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.RunPaused, new JsonObject { ["by"] = by.ToString(), ["reason"] = reason })], null, by, cancellationToken);
        return await GetAsync(organisationId, runId, cancellationToken);
    }

    public async Task<RunView> ResumeAsync(Guid organisationId, Guid runId, Guid by, CancellationToken cancellationToken)
    {
        var run = await GetAsync(organisationId, runId, cancellationToken);
        if (run.Status != RunStatuses.Paused)
        {
            throw EndgameProblem.Conflict($"Only a paused run can be resumed; this one is {run.Status}.");
        }

        await AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.RunResumed, new JsonObject { ["by"] = by.ToString() })], null, by, cancellationToken);
        return await GetAsync(organisationId, runId, cancellationToken);
    }

    public async Task<RunView> CancelAsync(Guid organisationId, Guid runId, Guid by, string? reason, CancellationToken cancellationToken)
    {
        var run = await GetAsync(organisationId, runId, cancellationToken);
        if (RunStatuses.IsTerminal(run.Status))
        {
            throw EndgameProblem.Conflict($"The run has already {run.Status}.");
        }

        await AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.RunFinished, new JsonObject { ["outcome"] = RunStatuses.Cancelled, ["by"] = by.ToString(), ["reason"] = reason })], null, by, cancellationToken);
        return await GetAsync(organisationId, runId, cancellationToken);
    }

    /// <summary>Sets the run as budget-exhausted; its later model calls are refused without a reservation.</summary>
    public async Task MarkBudgetExhaustedAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var now = clock.GetUtcNow();
        await db.Runs.Where(r => r.OrganisationId == organisationId && r.Id == runId && r.BudgetExhaustedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.BudgetExhaustedAt, now), cancellationToken);
        await AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.Message, new JsonObject
        {
            ["text"] = "The credit budget is exhausted, so this run cannot call a model again. Top up or raise the budget, then start new work.",
            ["code"] = "budget_exhausted",
        })], null, null, cancellationToken);
    }

    /// <summary>
    /// The status change a lifecycle event implies, made in the append's own transaction. Finishing
    /// also updates the employee and releases the run's open reservations in that transaction.
    /// </summary>
    private async Task<string> ApplyLifecycleAsync(Guid org, Guid run, Guid? employeeId, string status, NewEvent e, Guid? actor, DateTimeOffset now, CancellationToken cancellationToken)
    {
        switch (e.Type)
        {
            case RunEventTypes.RunStarted:
                await SetStatusAsync(org, run, RunStatuses.Running, now, cancellationToken);
                if (employeeId is { } starter)
                {
                    // A paused employee stays paused: starting a run never resumes them.
                    await db.Employees.Where(x => x.OrganisationId == org && x.Id == starter && x.Status != EmployeeStatuses.Released)
                        .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, x => x.Status == EmployeeStatuses.Paused ? EmployeeStatuses.Paused : EmployeeStatuses.Working)
                            .SetProperty(x => x.CurrentRunId, run).SetProperty(x => x.LastActiveAt, now), cancellationToken);
                }

                return RunStatuses.Running;
            case RunEventTypes.RunPaused:
                await SetStatusAsync(org, run, RunStatuses.Paused, now, cancellationToken);
                return RunStatuses.Paused;
            case RunEventTypes.RunResumed:
                // Back in the queue with no lease: the Runner claims it again and replays its log.
                await db.Runs.Where(r => r.OrganisationId == org && r.Id == run)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, RunStatuses.Queued).SetProperty(r => r.LeaseHolder, (string?)null).SetProperty(r => r.LeaseExpiresAt, (DateTimeOffset?)null), cancellationToken);
                return RunStatuses.Queued;
            case RunEventTypes.ApprovalRequested:
                await SetStatusAsync(org, run, RunStatuses.WaitingApproval, now, cancellationToken);
                return RunStatuses.WaitingApproval;
            case RunEventTypes.ApprovalAnswered when status == RunStatuses.WaitingApproval:
                var stillWaiting = await db.Approvals.AnyAsync(a => a.OrganisationId == org && a.RunId == run && a.Status == ApprovalStatuses.Pending, cancellationToken);
                if (stillWaiting)
                {
                    return status;
                }

                await db.Runs.Where(r => r.OrganisationId == org && r.Id == run)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, r => r.LeaseExpiresAt != null && r.LeaseExpiresAt > now ? RunStatuses.Running : RunStatuses.Queued), cancellationToken);
                return RunStatuses.Running;
            case RunEventTypes.RunFinished:
                var outcome = e.Payload?["outcome"]?.GetValueKind() == JsonValueKind.String ? e.Payload["outcome"]!.GetValue<string>() : null;
                if (outcome is not (RunStatuses.Succeeded or RunStatuses.Failed or RunStatuses.Cancelled))
                {
                    throw EndgameProblem.Invalid("run.finished needs an outcome: succeeded, failed or cancelled.");
                }

                var summary = e.Payload?["summary"]?.GetValueKind() == JsonValueKind.String ? e.Payload["summary"]!.GetValue<string>() : null;
                await db.Runs.Where(r => r.OrganisationId == org && r.Id == run)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(r => r.Status, outcome)
                        .SetProperty(r => r.Outcome, outcome)
                        .SetProperty(r => r.Summary, summary)
                        .SetProperty(r => r.FinishedAt, now)
                        .SetProperty(r => r.LeaseHolder, (string?)null)
                        .SetProperty(r => r.LeaseExpiresAt, (DateTimeOffset?)null), cancellationToken);
                if (employeeId is { } worker)
                {
                    // The employee's state moves in the same transaction; its track record is derived from the runs themselves.
                    await db.Employees.Where(x => x.OrganisationId == org && x.Id == worker)
                        .ExecuteUpdateAsync(s => s
                            .SetProperty(x => x.Status, x => x.Status == EmployeeStatuses.Released || x.Status == EmployeeStatuses.Paused ? x.Status : EmployeeStatuses.Idle)
                            .SetProperty(x => x.CurrentRunId, (Guid?)null)
                            .SetProperty(x => x.LastRunId, run)
                            .SetProperty(x => x.LastActiveAt, now), cancellationToken);
                }

                await ledger.ReleaseOpenForRunAsync(org, run, $"run {outcome}", cancellationToken);
                _ = actor;
                return outcome;
            default:
                return status;
        }
    }

    private async Task SetStatusAsync(Guid org, Guid run, string status, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.Runs.Where(r => r.OrganisationId == org && r.Id == run)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, status).SetProperty(r => r.StartedAt, r => r.StartedAt ?? now), cancellationToken);

    private async Task<EndgameProblem> AppendRefusalAsync(Guid org, Guid run, string? holder, CancellationToken cancellationToken)
    {
        var current = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == org && r.Id == run, cancellationToken);
        if (current is null)
        {
            return EndgameProblem.NotFound("The run");
        }

        return RunStatuses.IsTerminal(current.Status)
            ? EndgameProblem.Conflict($"The run has {current.Status}; its log is closed.")
            : EndgameProblem.Conflict($"'{holder}' does not hold this run's live lease.");
    }

    private async Task<EndgameProblem> LeaseRefusalAsync(Guid org, Guid run, CancellationToken cancellationToken)
    {
        var current = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == org && r.Id == run, cancellationToken);
        if (current is null)
        {
            return EndgameProblem.NotFound("The run");
        }

        var problem = RunStatuses.IsTerminal(current.Status)
            ? EndgameProblem.Conflict($"The run has {current.Status}.")
            : EndgameProblem.Conflict($"The run's lease is held by '{current.LeaseHolder}' until {current.LeaseExpiresAt:O}.");
        problem.Extensions["status"] = current.Status;
        return problem;
    }

    /// <summary>PostgreSQL keeps microseconds; comparing a stored time with the moment it was written needs the same precision.</summary>
    private static DateTimeOffset Microseconds(DateTimeOffset t) => new(t.Ticks - (t.Ticks % 10), t.Offset);

    private static void RequireHolder(string holder)
    {
        if (string.IsNullOrWhiteSpace(holder) || holder.Length > 200)
        {
            throw EndgameProblem.Invalid("A lease holder names itself in 1 to 200 characters.");
        }
    }

    public static RunView View(RunRecord r, string scope) => new(
        r.Id, scope, r.Kind, r.Status, r.Title, r.EmployeeId, r.IdeaId, r.ConversationId, r.ParentRunId, r.LeaseHolder, r.LeaseExpiresAt,
        r.LastSeq, r.BudgetExhaustedAt is not null, r.Outcome, r.Summary, r.CreatedAt, r.StartedAt, r.FinishedAt);
}
