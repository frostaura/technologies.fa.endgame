using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Runs;

public sealed record ApprovalView(Guid Id, Guid RunId, string Title, string Detail, string Status, DateTimeOffset RequestedAt, DateTimeOffset? AnsweredAt, Guid? AnsweredBy, string? Comment);

/// <summary>Checkpoints: a run raises one and waits; a person with rights over the run's scope answers it.</summary>
public sealed class ApprovalService(EndgameDbContext db, TenantSession session, RunService runs, TimeProvider clock)
{
    public async Task<ApprovalView> RaiseAsync(Guid runId, string title, string? detail, CancellationToken cancellationToken)
    {
        var trimmed = title?.Trim() ?? "";
        if (trimmed.Length is 0 or > 300)
        {
            throw EndgameProblem.Invalid("An approval's title is 1 to 300 characters.");
        }

        var (run, _) = await runs.RequireAsync(runId, cancellationToken);
        if (RunStatuses.IsTerminal(run.Status))
        {
            throw EndgameProblem.Conflict($"A {run.Status} run cannot ask for approval.");
        }

        var approval = new ApprovalRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = run.OrganisationId,
            RunId = runId,
            Title = trimmed,
            Detail = detail ?? "",
            Status = ApprovalStatuses.Pending,
            RequestedAt = clock.GetUtcNow(),
        };
        db.Approvals.Add(approval);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await runs.AppendAsync(run.OrganisationId, runId, [new NewEvent(RunEventTypes.ApprovalRequested, new JsonObject
        {
            ["approvalId"] = approval.Id.ToString(),
            ["title"] = trimmed,
            ["question"] = trimmed,
            ["detail"] = approval.Detail,
        })], null, null, cancellationToken);
        return View(approval);
    }

    /// <summary>Answers a pending approval, once. A second answer is a conflict.</summary>
    public async Task<ApprovalView> AnswerAsync(Guid organisationId, Guid runId, Guid approvalId, bool approve, string? comment, Guid by, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var now = clock.GetUtcNow();
        var status = approve ? ApprovalStatuses.Approved : ApprovalStatuses.Rejected;
        var changed = await db.Approvals
            .Where(a => a.OrganisationId == organisationId && a.RunId == runId && a.Id == approvalId && a.Status == ApprovalStatuses.Pending)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, status).SetProperty(a => a.AnsweredAt, now).SetProperty(a => a.AnsweredBy, by).SetProperty(a => a.Comment, comment), cancellationToken);
        var approval = await db.Approvals.AsNoTracking().SingleOrDefaultAsync(a => a.OrganisationId == organisationId && a.RunId == runId && a.Id == approvalId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The approval");
        if (changed == 0)
        {
            throw EndgameProblem.Conflict($"This approval was already {approval.Status}.");
        }

        await runs.AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.ApprovalAnswered, new JsonObject
        {
            ["approvalId"] = approvalId.ToString(),
            ["answer"] = status,
            ["comment"] = comment,
            ["by"] = by.ToString(),
        })], null, by, cancellationToken);
        return View(approval);
    }

    public async Task<IReadOnlyList<ApprovalView>> ForRunAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var rows = await db.Approvals.AsNoTracking().Where(a => a.OrganisationId == organisationId && a.RunId == runId).OrderBy(a => a.RequestedAt).ToListAsync(cancellationToken);
        return rows.Select(View).ToList();
    }

    private static ApprovalView View(ApprovalRecord a) => new(a.Id, a.RunId, a.Title, a.Detail, a.Status, a.RequestedAt, a.AnsweredAt, a.AnsweredBy, a.Comment);
}
