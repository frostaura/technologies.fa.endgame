using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Runs;

public sealed record TaskView(
    Guid Id,
    string Scope,
    Guid? RunId,
    Guid? ParentTaskId,
    string Title,
    string Description,
    string Status,
    Guid? HolderRunId,
    Guid? HolderEmployeeId,
    DateTimeOffset? ClaimedAt,
    decimal? EstimateCredits,
    decimal? ActualCredits,
    IReadOnlyList<Guid> DependsOn,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record TaskPatch(string? Status, string? ExpectedStatus, string? Title, string? Description, decimal? EstimateCredits, decimal? ActualCredits, string? Summary);

/// <summary>
/// The persistent task graph. Checkout is ONE conditional update (ARCH-002, Paperclip's mechanic):
/// a task is claimed only where its status and current holder are what the claimer expected, and a
/// lock is taken over only from a holder run that is provably dead — finished, or its lease lapsed.
/// </summary>
public sealed class TaskService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, RunService runs, TimeProvider clock)
{
    public const int MaxList = 500;

    public async Task<TaskView> CreateAsync(ResolvedScope scope, Guid? runId, Guid? parentTaskId, string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var trimmed = title?.Trim() ?? "";
        if (trimmed.Length is 0 or > 300)
        {
            throw EndgameProblem.Invalid("A task's title is 1 to 300 characters.");
        }

        if (estimateCredits is < 0)
        {
            throw EndgameProblem.Invalid("An estimate cannot be negative.");
        }

        var dependencies = (dependsOn ?? []).Distinct().ToArray();
        var known = await db.Tasks.Where(t => t.OrganisationId == scope.OrganisationId && dependencies.Contains(t.Id)).CountAsync(cancellationToken);
        if (known != dependencies.Length)
        {
            throw EndgameProblem.Invalid("A task can only depend on tasks of the same organisation that exist.");
        }

        if (runId is { } run && !await db.Runs.AnyAsync(r => r.OrganisationId == scope.OrganisationId && r.Id == run, cancellationToken))
        {
            throw EndgameProblem.NotFound("The run");
        }

        if (parentTaskId is { } parent && !await db.Tasks.AnyAsync(t => t.OrganisationId == scope.OrganisationId && t.Id == parent, cancellationToken))
        {
            throw EndgameProblem.NotFound("The parent task");
        }

        var now = clock.GetUtcNow();
        var task = new TaskRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            RunId = runId,
            ParentTaskId = parentTaskId,
            Title = trimmed,
            Description = description ?? "",
            Status = TaskStatuses.Todo,
            EstimateCredits = estimateCredits,
            DependsOn = dependencies,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Tasks.Add(task);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        if (runId is { } owner)
        {
            await runs.AppendAsync(scope.OrganisationId, owner, [new NewEvent(RunEventTypes.TaskCreated, new JsonObject { ["taskId"] = task.Id.ToString(), ["summary"] = trimmed })], null, null, cancellationToken);
        }

        return View(task, scope.Path.ToString());
    }

    /// <summary>Claims a task for a run. Returns null when the task's status or holder were not what the claimer expected.</summary>
    public async Task<TaskView?> CheckoutAsync(Guid taskId, Guid runId, Guid? employeeId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken)
    {
        if (!TaskStatuses.All.Contains(expectedStatus) || expectedStatus is TaskStatuses.Done or TaskStatuses.Cancelled)
        {
            throw EndgameProblem.Invalid("expectedStatus is the task's current status: todo, blocked, failed or in_progress (to take over a dead holder's lock).");
        }

        var (run, _) = await runs.RequireAsync(runId, cancellationToken);
        if (RunStatuses.IsTerminal(run.Status))
        {
            throw EndgameProblem.Conflict($"A {run.Status} run cannot claim work.");
        }

        var org = run.OrganisationId;
        session.UseOrganisation(org);
        var now = clock.GetUtcNow();
        Guid? claimed;
        await using (var command = await db.CommandAsync("""
            UPDATE tasks t
            SET status = 'in_progress', holder_run_id = @run, holder_employee_id = @employee, claimed_at = @now, updated_at = @now
            WHERE t.organisation_id = @org AND t.id = @task
              AND t.status = @expected
              AND t.holder_run_id IS NOT DISTINCT FROM @holder
              AND (@holder IS NULL OR @holder = @run OR EXISTS (
                    SELECT 1 FROM runs h
                    WHERE h.organisation_id = t.organisation_id AND h.id = t.holder_run_id
                      AND (h.status IN ('succeeded', 'failed', 'cancelled') OR h.lease_expires_at IS NULL OR h.lease_expires_at <= @now)))
              AND NOT EXISTS (
                    SELECT 1 FROM tasks d
                    WHERE d.organisation_id = t.organisation_id AND d.id = ANY(t.depends_on) AND d.status <> 'done')
            RETURNING t.id
            """, cancellationToken,
            P("run", runId), P("employee", employeeId), P("now", now), P("org", org), P("task", taskId), P("expected", expectedStatus), P("holder", expectedHolderRunId)))
        {
            claimed = await command.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        if (claimed is null)
        {
            return null;
        }

        await runs.AppendAsync(org, runId, [new NewEvent(RunEventTypes.TaskClaimed, new JsonObject { ["taskId"] = taskId.ToString(), ["previousHolder"] = expectedHolderRunId?.ToString() })], null, null, cancellationToken);
        return await GetAsync(org, taskId, cancellationToken);
    }

    /// <summary>The task as it is now: what a refused claimer is shown.</summary>
    public async Task<TaskView> GetAsync(Guid organisationId, Guid taskId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var task = await db.Tasks.AsNoTracking().SingleOrDefaultAsync(t => t.OrganisationId == organisationId && t.Id == taskId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The task");
        var scope = await scopes.ForRowAsync(task.OrganisationId, task.DivisionId, task.ProjectId, task.AppId, cancellationToken);
        return View(task, scope.Path.ToString());
    }

    public async Task<Guid> OrganisationOfAsync(Guid taskId, CancellationToken cancellationToken) =>
        await scopes.OrganisationOfAsync(db.Tasks, q => q.Where(t => t.Id == taskId).Select(t => t.OrganisationId), cancellationToken)
        ?? throw EndgameProblem.NotFound("The task");

    /// <summary>
    /// Changes a task. Moving it to in_progress is checkout's job alone; finishing it (done, failed,
    /// cancelled) or blocking it clears its holder and is logged on the holder's run. With
    /// <c>expectedStatus</c> the change is conditional, like checkout.
    /// </summary>
    public async Task<TaskView> UpdateAsync(Guid taskId, TaskPatch patch, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(patch);
        var org = await OrganisationOfAsync(taskId, cancellationToken);
        var task = await db.Tasks.SingleAsync(t => t.OrganisationId == org && t.Id == taskId, cancellationToken);
        if (patch.ExpectedStatus is { } expected && task.Status != expected)
        {
            throw Conflict(await GetAsync(org, taskId, cancellationToken), $"The task is {task.Status}, not {expected}.");
        }

        var holder = task.HolderRunId;
        string? finishedAs = null;
        if (patch.Status is { } status && status != task.Status)
        {
            if (!TaskStatuses.All.Contains(status))
            {
                throw EndgameProblem.Invalid($"'{status}' is not a task status: use {string.Join(", ", TaskStatuses.All)}.");
            }

            if (status == TaskStatuses.InProgress)
            {
                throw EndgameProblem.Invalid("A task moves to in_progress only through checkout.");
            }

            task.Status = status;
            task.HolderRunId = null;
            task.HolderEmployeeId = null;
            finishedAs = status;
        }

        if (patch.Title is { } title)
        {
            var trimmed = title.Trim();
            task.Title = trimmed.Length is 0 or > 300 ? throw EndgameProblem.Invalid("A task's title is 1 to 300 characters.") : trimmed;
        }

        task.Description = patch.Description ?? task.Description;
        task.EstimateCredits = patch.EstimateCredits is < 0 ? throw EndgameProblem.Invalid("An estimate cannot be negative.") : patch.EstimateCredits ?? task.EstimateCredits;
        task.ActualCredits = patch.ActualCredits is < 0 ? throw EndgameProblem.Invalid("Actual credits cannot be negative.") : patch.ActualCredits ?? task.ActualCredits;
        task.UpdatedAt = clock.GetUtcNow();
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.CheckViolation })
        {
            throw EndgameProblem.Conflict("That change would leave the task inconsistent.");
        }

        db.ChangeTracker.Clear();
        var logOn = holder ?? task.RunId;
        if (finishedAs is TaskStatuses.Done or TaskStatuses.Failed && logOn is { } run)
        {
            var type = finishedAs == TaskStatuses.Done ? RunEventTypes.TaskDone : RunEventTypes.TaskFailed;
            try
            {
                await runs.AppendAsync(org, run, [new NewEvent(type, new JsonObject { ["taskId"] = taskId.ToString(), ["summary"] = patch.Summary ?? task.Title })], null, null, cancellationToken);
            }
            catch (EndgameProblem problem) when (problem.Status == 409)
            {
                // The run has finished and its log is closed; the task's own record still changed.
            }
        }

        return await GetAsync(org, taskId, cancellationToken);
    }

    public async Task<IReadOnlyList<TaskView>> ListAsync(ResolvedScope scope, string? status, int limit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (status is not null && !TaskStatuses.All.Contains(status))
        {
            throw EndgameProblem.Invalid($"'{status}' is not a task status.");
        }

        var rows = await db.Tasks.AsNoTracking()
            .Where(t => t.OrganisationId == scope.OrganisationId)
            .Where(t => scope.DivisionId == null || t.DivisionId == scope.DivisionId)
            .Where(t => scope.ProjectId == null || t.ProjectId == scope.ProjectId)
            .Where(t => scope.AppId == null || t.AppId == scope.AppId)
            .Where(t => status == null || t.Status == status)
            .OrderByDescending(t => t.UpdatedAt)
            .Take(Math.Clamp(limit, 1, MaxList))
            .ToListAsync(cancellationToken);
        var views = new List<TaskView>();
        var paths = new Dictionary<(Guid?, Guid?, Guid?), string>();
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

    public static EndgameProblem Conflict(TaskView current, string detail)
    {
        var problem = EndgameProblem.Conflict(detail);
        problem.Extensions["task"] = current;
        return problem;
    }

    private static TaskView View(TaskRecord t, string scope) => new(
        t.Id, scope, t.RunId, t.ParentTaskId, t.Title, t.Description, t.Status, t.HolderRunId, t.HolderEmployeeId, t.ClaimedAt,
        t.EstimateCredits, t.ActualCredits, t.DependsOn, t.CreatedAt, t.UpdatedAt);
}
