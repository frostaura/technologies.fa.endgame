using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>What a requested change is expected to cost, shown before it starts (CLAUDE.md rule 11).</summary>
public sealed record ChangeEstimateView(decimal Credits, string Basis);

/// <summary>
/// A change to an app that is already built (CHG-01): a <c>task</c> run at the app whose owner message is the request
/// (<c>kind: change</c>). The Runner screens it against the red lines, plans it, builds and checks it part by part, checks again
/// what worked before, reviews it and publishes the new version. Research is not repeated: it is the same product.
/// </summary>
public sealed class ChangeService(EndgameDbContext db, TenantSession session, RunService runs, FactoryEstimates estimates)
{
    public const int MaxRequestLength = 20_000;

    public const string ChangeKind = "change";

    public async Task<Estimate> EstimateAsync(ResolvedScope app, string? request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        Validate(app, request);
        return await estimates.ChangeAsync(app.OrganisationId, 1, 1, cancellationToken);
    }

    /// <param name="via"><c>console</c>, <c>conversation</c> or <c>api</c>: where the change was asked for.</param>
    public async Task<RunView> CreateAsync(ResolvedScope app, string? request, Guid? by, string via, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var text = Validate(app, request);
        session.UseOrganisation(app.OrganisationId);
        var published = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == app.OrganisationId && a.Id == app.AppId).Select(a => a.PublishedAt).SingleOrDefaultAsync(cancellationToken);
        if (published is null)
        {
            throw new EndgameProblem(409, "app_not_built", "This app has not been built yet",
                "An app is changed once it has been built and published. Finish or try again its build first.");
        }

        var busy = await db.Runs.AsNoTracking().AnyAsync(r => r.OrganisationId == app.OrganisationId && r.AppId == app.AppId
            && (r.Kind == RunKinds.Build || r.Kind == RunKinds.Task)
            && r.Status != RunStatuses.Succeeded && r.Status != RunStatuses.Failed && r.Status != RunStatuses.Cancelled, cancellationToken);
        if (busy)
        {
            throw new EndgameProblem(409, "app_busy", "This app is already being worked on",
                "Another build or change of this app is under way. Wait for it to finish, or cancel it, then ask for this change.");
        }

        await RefusePausedAsync(db, app.OrganisationId, app.ProjectId, cancellationToken);
        var estimate = await estimates.ChangeAsync(app.OrganisationId, 1, 1, cancellationToken);
        var run = await runs.CreateAsync(app, RunKinds.Task, $"Change: {Title(text)}", null, null, null, null, by, cancellationToken);
        await runs.AppendAsync(app.OrganisationId, run.Id, [
            new NewEvent(RunEventTypes.Message, new JsonObject { ["from"] = "owner", ["kind"] = ChangeKind, ["text"] = text, ["userId"] = by?.ToString(), ["via"] = via }),
            new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate.Credits, ["basis"] = ChangeKind, ["reason"] = estimate.Basis }),
        ], null, by, cancellationToken);
        return await runs.GetAsync(app.OrganisationId, run.Id, cancellationToken);
    }

    /// <summary>
    /// A person's change or try again is refused, plainly, while an employee who works on that project is paused: pausing an
    /// employee gives them no new work (EMP-04), and the factory's build and change stages are theirs.
    /// </summary>
    public static async Task RefusePausedAsync(EndgameDbContext db, Guid organisationId, Guid? projectId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (projectId is null)
        {
            return;
        }

        var paused = await db.Employees.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.ProjectId == projectId && e.Status == Domain.Runs.EmployeeStatuses.Paused)
            .OrderBy(e => e.Name).Select(e => e.Name).ToListAsync(cancellationToken);
        if (paused.Count > 0)
        {
            var who = string.Join(" and ", paused);
            throw new EndgameProblem(409, "employee_paused", $"{who} {(paused.Count == 1 ? "is" : "are")} paused",
                $"{who}, who {(paused.Count == 1 ? "works" : "work")} on this app, {(paused.Count == 1 ? "is" : "are")} paused, so no new work is started for {(paused.Count == 1 ? "them" : "them")}. Resume {(paused.Count == 1 ? "them" : "them")} first.");
        }
    }

    private static string Validate(ResolvedScope app, string? request)
    {
        if (app.AppId is null)
        {
            throw EndgameProblem.Invalid("A change is asked of one app: name the app's scope.");
        }

        var text = request?.Trim() ?? "";
        if (text.Length is 0 or > MaxRequestLength)
        {
            throw EndgameProblem.Invalid($"Describe the change in 1 to {MaxRequestLength} characters.");
        }

        return text;
    }

    private static string Title(string text)
    {
        var line = text.Split('\n', 2)[0].Trim();
        return line.Length <= 110 ? line : line[..107] + "...";
    }
}
