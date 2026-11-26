using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Gateway;

/// <summary>What the gateway needs from the tree and the run log, answered from the platform database.</summary>
public sealed class GatewayContext(EndgameDbContext db, ScopeResolver scopes, RunService runs) : IGatewayContext
{
    public async Task<Attribution> ResolveAsync(string scope, Guid? runId, Guid? employeeId, CancellationToken cancellationToken)
    {
        var resolved = await scopes.RequireAsync(scope, cancellationToken);
        DateTimeOffset? lease = null;
        if (runId is { } id)
        {
            var run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == resolved.OrganisationId && r.Id == id, cancellationToken)
                ?? throw EndgameProblem.NotFound("The run in this organisation");
            if (run.BudgetExhaustedAt is not null)
            {
                throw ModelGateway.BudgetExhausted(new Refused("This run already exhausted its budget.", "run", 0m, 0m));
            }

            if (RunStatuses.IsTerminal(run.Status))
            {
                throw EndgameProblem.Conflict($"The run has {run.Status}; it makes no more model calls.");
            }

            employeeId ??= run.EmployeeId;
            lease = run.LeaseExpiresAt;

            // A build moves to the app it builds once it is placed (D80); a Runner that started it still names the scope it
            // was started at. The call is the run's work, so it is charged — and capped — where the run now is.
            if (Narrower(run, resolved))
            {
                resolved = await scopes.ForRowAsync(run.OrganisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
            }
        }

        if (employeeId is { } employee
            && !await db.Employees.AnyAsync(e => e.OrganisationId == resolved.OrganisationId && e.Id == employee && e.Status != EmployeeStatuses.Released, cancellationToken))
        {
            throw EndgameProblem.NotFound("The employee in this organisation");
        }

        return new Attribution(resolved.OrganisationId, resolved.DivisionId, resolved.ProjectId, resolved.AppId, employeeId, runId, resolved.Path.ToString(), lease);
    }

    /// <summary>True when the run sits beneath <paramref name="scope"/>, on its own branch.</summary>
    private static bool Narrower(Persistence.Records.RunRecord run, ResolvedScope scope) =>
        (run.DivisionId, run.ProjectId, run.AppId) != (scope.DivisionId, scope.ProjectId, scope.AppId)
        && (scope.DivisionId == null || scope.DivisionId == run.DivisionId)
        && (scope.ProjectId == null || scope.ProjectId == run.ProjectId)
        && (scope.AppId == null || scope.AppId == run.AppId);

    public Task MarkBudgetExhaustedAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken) =>
        runs.MarkBudgetExhaustedAsync(organisationId, runId, cancellationToken);

    public async Task AppendEventAsync(Guid organisationId, Guid runId, string type, JsonObject payload, CancellationToken cancellationToken)
    {
        try
        {
            await runs.AppendAsync(organisationId, runId, [new NewEvent(type, payload)], null, null, cancellationToken);
        }
        catch (EndgameProblem problem) when (problem.Status == 409)
        {
            // The run finished while its call was in flight. The ledger still records the call in full.
        }
    }
}
