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
        var views = rows.Select(e => new RunEventView(e.Seq, e.Type, e.At, JsonNode.Parse(e.PayloadJson))).ToList();
        // An approval asked before the plain-detail fix reads as a new one would (R2-5): its tool line kept for technical mode.
        if (views.Any(v => v.Type == RunEventTypes.ApprovalRequested && v.Payload is JsonObject p && PayloadText(p, "technical") is null))
        {
            var run = await db.Runs.AsNoTracking().SingleAsync(r => r.OrganisationId == organisationId && r.Id == runId, cancellationToken);
            var scope = await scopes.ForRowAsync(organisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
            foreach (var view in views.Where(v => v.Type == RunEventTypes.ApprovalRequested))
            {
                if (view.Payload is JsonObject p && PayloadText(p, "technical") is null && PayloadText(p, "detail") is { } detail)
                {
                    var (title, plain, technical) = OlderApprovals.Plain(PayloadText(p, "title") ?? "", detail, null, scope);
                    if (technical is not null)
                    {
                        p["title"] = title;
                        p["question"] = title;
                        p["detail"] = plain;
                        p["technical"] = technical;
                    }
                }
            }

            session.UseOrganisation(organisationId);
        }

        return views;
    }

    private static string? PayloadText(JsonObject payload, string key) =>
        payload[key] is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.String ? v.GetValue<string>() : null;

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
            ["text"] = "The credit budget is exhausted, so this run cannot call a model again. Top up or raise the budget; what was finished is kept, and the work can then be tried again.",
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
                await CloseContractorsAsync(org, run, now, cancellationToken);
                await ExpireOpenApprovalsAsync(org, run, now, cancellationToken);
                if (outcome is RunStatuses.Failed or RunStatuses.Cancelled)
                {
                    await WithdrawUnbuiltHiresAsync(org, run, outcome, now, cancellationToken);
                }

                _ = actor;
                return outcome;
            case RunEventTypes.Message when PlacedApp(e.Payload) is { } placed:
                await MoveToPlacementAsync(org, run, placed, cancellationToken);
                return status;
            default:
                return status;
        }
    }

    /// <summary>
    /// Every contractor the run briefed that is still open finishes with the run, whatever ended it — finished, failed,
    /// cancelled, stopped by a budget (D73): released, its activity cleared, gone from the chart and the bill. The model
    /// gateway then refuses any call still made in its name.
    /// </summary>
    private async Task CloseContractorsAsync(Guid org, Guid run, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.Employees
            .Where(x => x.OrganisationId == org && x.Kind == Domain.Workforce.EmployeeKinds.Contractor && x.Status != EmployeeStatuses.Released
                && (x.BriefRunId == run || x.CurrentRunId == run))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.Status, EmployeeStatuses.Released)
                .SetProperty(x => x.ReleasedAt, now)
                .SetProperty(x => x.LastRunId, run)
                .SetProperty(x => x.CurrentRunId, (Guid?)null)
                .SetProperty(x => x.LastActiveAt, now), cancellationToken);

    /// <summary>
    /// Every approval the run still waits on closes with it, whatever ended it (R3-2): expired, with no one as its answerer and
    /// the plain note <see cref="ApprovalStatuses.ExpiredNote"/>. A question about work that no longer happens is not left on
    /// anyone's "needs you" strip or in their notifications.
    /// </summary>
    private async Task ExpireOpenApprovalsAsync(Guid org, Guid run, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.Approvals
            .Where(a => a.OrganisationId == org && a.RunId == run && a.Status == ApprovalStatuses.Pending)
            .ExecuteUpdateAsync(s => s
                .SetProperty(a => a.Status, ApprovalStatuses.Expired)
                .SetProperty(a => a.AnsweredAt, now)
                .SetProperty(a => a.AnsweredBy, (Guid?)null)
                .SetProperty(a => a.Comment, ApprovalStatuses.ExpiredNote), cancellationToken);

    /// <summary>
    /// Repairs approvals left waiting by a run that already ended (rows from before <see cref="ExpireOpenApprovalsAsync"/>):
    /// the sweep expires them. Runs as the platform, across organisations. Returns how many.
    /// </summary>
    public async Task<int> ExpireStrandedApprovalsAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        await using var command = await db.CommandAsync("""
            UPDATE approvals a SET status = 'expired', answered_at = @now, answered_by = NULL, comment = @note
            FROM runs r
            WHERE a.status = 'pending' AND r.organisation_id = a.organisation_id AND r.id = a.run_id
              AND r.status IN ('succeeded', 'failed', 'cancelled')
            """, cancellationToken, P("now", clock.GetUtcNow()), P("note", ApprovalStatuses.ExpiredNote));
        var expired = await command.ExecuteNonQueryAsync(cancellationToken);
        session.Clear();
        return expired;
    }

    /// <summary>
    /// Repairs contractors left open by a run that already ended (rows from before <see cref="CloseContractorsAsync"/>, or a
    /// run ended behind the platform's back): the sweep closes them. Runs as the platform, across organisations. Returns how many.
    /// </summary>
    public async Task<int> CloseStrandedContractorsAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        await using var command = await db.CommandAsync("""
            UPDATE employees e SET status = 'released', released_at = @now, last_run_id = r.id, current_run_id = NULL, last_active_at = @now
            FROM runs r
            WHERE e.kind = 'contractor' AND e.status <> 'released'
              AND r.organisation_id = e.organisation_id AND r.id = COALESCE(e.current_run_id, e.brief_run_id)
              AND r.status IN ('succeeded', 'failed', 'cancelled')
            """, cancellationToken, P("now", clock.GetUtcNow()));
        var closed = await command.ExecuteNonQueryAsync(cancellationToken);
        session.Clear();
        return closed;
    }

    /// <summary>The reason a withdrawn hire proposal gives, when the build that raised it stopped before anything was built (D81).</summary>
    public static string WithdrawnReason(string outcome, string? appName) =>
        $"Withdrawn: the build{(appName is null ? "" : $" of {appName}")} {(outcome == RunStatuses.Cancelled ? "was cancelled" : "stopped")} before anything was built. Trying the build again proposes this hire again.";

    /// <summary>
    /// A build that ends without ever publishing withdraws the hires it proposed that nobody has answered (D81): they were
    /// for work that did not happen. Its project and app stay, marked not built, so "Try again" still works — and raises the
    /// hires again. Withdrawn is declined by the platform: no person decided, and the reason says why.
    /// </summary>
    private async Task WithdrawUnbuiltHiresAsync(Guid org, Guid run, string outcome, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var build = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == org && r.Id == run).Select(r => new { r.Kind, r.AppId, r.CreatedAt }).SingleAsync(cancellationToken);
        if (build.Kind != RunKinds.Build)
        {
            return;
        }

        var app = build.AppId is { } placed
            ? await db.Apps.AsNoTracking().Where(a => a.OrganisationId == org && a.Id == placed).Select(a => new { a.Name, a.PublishedAt }).SingleOrDefaultAsync(cancellationToken)
            : null;
        if (!PublishedNothing(app?.PublishedAt, build.CreatedAt))
        {
            return;
        }

        // An app published before this build began is another's: the build is not named after it.
        var reason = WithdrawnReason(outcome, app?.PublishedAt is null ? app?.Name : null);
        await db.HireProposals
            .Where(h => h.OrganisationId == org && h.RaisedByRunId == run && h.Status == Domain.Workforce.HireStatuses.Proposed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(h => h.Status, Domain.Workforce.HireStatuses.Declined)
                .SetProperty(h => h.DecidedVia, IdeaDecisions.ByAutoMode)
                .SetProperty(h => h.DecidedBy, (Guid?)null)
                .SetProperty(h => h.DecidedAt, now)
                .SetProperty(h => h.DecisionNote, reason)
                .SetProperty(h => h.UpdatedAt, now), cancellationToken);
    }

    /// <summary>The app a build's <c>placement</c> journal step placed it in (<c>workflow.step</c>, step <c>placement</c>, <c>data.appId</c>); null for any other event.</summary>
    public static Guid? PlacedApp(JsonObject? payload) =>
        payload is not null && payload["kind"] is JsonValue k && k.GetValueKind() == JsonValueKind.String && k.GetValue<string>() == "workflow.step"
        && payload["step"] is JsonValue st && st.GetValueKind() == JsonValueKind.String && st.GetValue<string>() == "placement"
        && payload["data"] is JsonObject data && data["appId"] is JsonValue id && id.GetValueKind() == JsonValueKind.String && Guid.TryParse(id.GetValue<string>(), out var app)
            ? app
            : null;

    /// <summary>
    /// A build is placed: from that moment it is the work of the app it builds, so the run moves to that app's scope (D80) — the
    /// project's card shows it under way, and its spend lands on the app, the project and the division (the model gateway
    /// attributes a run's calls to the run's own scope when it is narrower). Only a build moves, and only down its own branch.
    /// </summary>
    private async Task MoveToPlacementAsync(Guid org, Guid run, Guid appId, CancellationToken cancellationToken)
    {
        var place = await (from a in db.Apps.AsNoTracking()
                           join p in db.Projects.AsNoTracking() on new { a.OrganisationId, Id = a.ProjectId } equals new { p.OrganisationId, p.Id }
                           where a.OrganisationId == org && a.Id == appId
                           select new { AppId = a.Id, ProjectId = p.Id, p.DivisionId, a.Name, a.PublishedAt, a.CurrentVersion }).SingleOrDefaultAsync(cancellationToken);
        if (place is null)
        {
            return;
        }

        var build = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == org && r.Id == run).Select(r => new { r.Kind, r.IdeaId }).SingleAsync(cancellationToken);
        if (build.Kind == RunKinds.Build && await PlacementTakenAsync(org, run, build.IdeaId, appId, place.PublishedAt is not null || place.CurrentVersion is not null, cancellationToken))
        {
            var refused = new EndgameProblem(409, PlacementRefusals.Taken, "That app is not this build's",
                $"{place.Name} already exists and is not this idea's: a build from an idea always makes a new app. A change to {place.Name} is asked for from the app itself.");
            refused.Extensions["appId"] = appId;
            throw refused;
        }

        await db.Runs
            .Where(r => r.OrganisationId == org && r.Id == run && r.Kind == RunKinds.Build
                && (r.DivisionId == null || r.DivisionId == place.DivisionId)
                && (r.ProjectId == null || r.ProjectId == place.ProjectId)
                && (r.AppId == null || r.AppId == place.AppId))
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.DivisionId, place.DivisionId)
                .SetProperty(r => r.ProjectId, place.ProjectId)
                .SetProperty(r => r.AppId, place.AppId), cancellationToken);
    }

    /// <summary>
    /// Whether a build may not be placed in this app (R9-1): a build starts from an idea, so its app must be new. The app is
    /// another's when work that makes or changes an app was ever on it — a change or a task, or another idea's build — or
    /// when it was published, has a version or holds end users' data and no earlier attempt of this same idea is on it.
    /// Only an earlier attempt of the same idea ("Try again") may find its own app again; a conversation about the app or a
    /// memory review changes nothing in it, so neither takes it from that idea.
    /// </summary>
    private async Task<bool> PlacementTakenAsync(Guid org, Guid run, Guid? ideaId, Guid appId, bool built, CancellationToken cancellationToken)
    {
        var others = db.Runs.AsNoTracking().Where(r => r.OrganisationId == org && r.AppId == appId && r.Id != run);
        if (await others.AnyAsync(r => r.Kind == RunKinds.Task || (r.Kind == RunKinds.Build && (ideaId == null || r.IdeaId != ideaId)), cancellationToken))
        {
            return true;
        }

        var holdsData = built || await db.AppEndUsers.AsNoTracking().AnyAsync(u => u.OrganisationId == org && u.AppId == appId, cancellationToken);
        return holdsData && !await others.AnyAsync(r => r.Kind == RunKinds.Build && r.IdeaId == ideaId, cancellationToken);
    }

    /// <summary>
    /// Whether a build that ended published nothing itself (D81): its app was never published, or was published before the build
    /// began — by other work, as an app a build from before R9-1 was wrongly placed in. Its hires were for work that did not happen.
    /// </summary>
    public static bool PublishedNothing(DateTimeOffset? appPublishedAt, DateTimeOffset buildCreatedAt) =>
        appPublishedAt is not { } published || published < buildCreatedAt;

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
        // Not "status": that is the problem document's HTTP status (RFC 9457), and the same key twice cannot be parsed (D25).
        problem.Extensions["runStatus"] = current.Status;
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
