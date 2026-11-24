using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

public sealed record EmployeeView(
    Guid Id,
    string Scope,
    string Name,
    string Role,
    string JobDescription,
    string Status,
    decimal? MonthlyCreditLimit,
    int RunsFinished,
    int RunsSucceeded,
    Guid? CurrentRunId,
    Guid? LastRunId,
    DateTimeOffset? LastActiveAt,
    DateTimeOffset CreatedAt);

/// <summary>
/// The workforce records the control plane keeps: an employee's place in the tree, its own credit
/// cap and its state, which finishing a run updates in the same transaction. Hiring decisions,
/// memory and reviews are the Runner's (Phase 3).
/// </summary>
public sealed class EmployeeService(EndgameDbContext db, ScopeResolver scopes, TimeProvider clock)
{
    public async Task<EmployeeView> HireAsync(ResolvedScope scope, string name, string role, string? jobDescription, decimal? monthlyCreditLimit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var trimmedName = name?.Trim() ?? "";
        var trimmedRole = role?.Trim() ?? "";
        if (trimmedName.Length is 0 or > 200 || trimmedRole.Length is 0 or > 200)
        {
            throw EndgameProblem.Invalid("An employee needs a name and a role, each 1 to 200 characters.");
        }

        if (monthlyCreditLimit is < 0)
        {
            throw EndgameProblem.Invalid("A credit limit cannot be negative.");
        }

        var employee = new EmployeeRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            Name = trimmedName,
            Role = trimmedRole,
            JobDescription = jobDescription ?? "",
            Status = EmployeeStatuses.Idle,
            MonthlyCreditLimit = monthlyCreditLimit,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Employees.Add(employee);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(employee, scope.Path.ToString());
    }

    /// <summary>Employees placed at the scope or beneath it.</summary>
    public async Task<IReadOnlyList<EmployeeView>> ListAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var rows = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId)
            .Where(e => scope.DivisionId == null || e.DivisionId == scope.DivisionId)
            .Where(e => scope.ProjectId == null || e.ProjectId == scope.ProjectId)
            .Where(e => scope.AppId == null || e.AppId == scope.AppId)
            .OrderBy(e => e.Name)
            .ToListAsync(cancellationToken);
        var views = new List<EmployeeView>();
        foreach (var row in rows)
        {
            views.Add(View(row, (await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken)).Path.ToString()));
        }

        return views;
    }

    public static EmployeeView View(EmployeeRecord e, string scope) => new(
        e.Id, scope, e.Name, e.Role, e.JobDescription, e.Status, e.MonthlyCreditLimit, e.RunsFinished, e.RunsSucceeded, e.CurrentRunId, e.LastRunId, e.LastActiveAt, e.CreatedAt);
}
