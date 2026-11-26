using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Runs;

/// <param name="Detail">The plain sentence the owner reads.</param>
/// <param name="Technical">What technical mode shows beside it — the tool, its arguments, the rule that asked (D71); null when none was sent.</param>
public sealed record ApprovalView(Guid Id, Guid RunId, string Title, string Detail, string Status, DateTimeOffset RequestedAt, DateTimeOffset? AnsweredAt, Guid? AnsweredBy, string? Comment,
    string? Technical = null);

/// <summary>Checkpoints: a run raises one and waits; a person with rights over the run's scope answers it.</summary>
public sealed class ApprovalService(EndgameDbContext db, TenantSession session, RunService runs, TimeProvider clock)
{
    public const int MaxTechnical = 4000;

    /// <param name="onDecline"><c>continues</c> or <c>stops</c>: what declining does to the work, so the console can say it truthfully.</param>
    /// <param name="technical">The technical detail, kept beside the plain one in the run's <c>approval.requested</c> event (never in its place).</param>
    public async Task<ApprovalView> RaiseAsync(Guid runId, string title, string? detail, CancellationToken cancellationToken, string? onDecline = null, string? technical = null)
    {
        var tech = string.IsNullOrWhiteSpace(technical) ? null : technical.Trim();
        if (tech is { Length: > MaxTechnical })
        {
            tech = tech[..MaxTechnical];
        }

        if (onDecline is not (null or "continues" or "stops"))
        {
            throw EndgameProblem.Invalid("onDecline is 'continues' or 'stops'.");
        }

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
            ["onDecline"] = onDecline ?? "continues",
            ["technical"] = tech,
        })], null, null, cancellationToken);
        return View(approval) with { Technical = tech };
    }

    /// <summary>Answers a pending approval, once. A second answer is a conflict.</summary>
    public async Task<ApprovalView> AnswerAsync(Guid organisationId, Guid runId, Guid approvalId, bool approve, string? comment, Guid by, CancellationToken cancellationToken)
    {
        if (comment is { Length: > 2000 })
        {
            throw EndgameProblem.Invalid("A note with an answer is at most 2000 characters.");
        }

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
            throw EndgameProblem.Conflict(approval.Status == ApprovalStatuses.Expired
                ? "The work ended before this was answered, so there is nothing left to approve."
                : $"This approval was already {approval.Status}.");
        }

        await runs.AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.ApprovalAnswered, new JsonObject
        {
            ["approvalId"] = approvalId.ToString(),
            ["answer"] = status,
            ["comment"] = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(),
            ["by"] = by.ToString(),
        })], null, by, cancellationToken);
        return View(approval);
    }

    public async Task<IReadOnlyList<ApprovalView>> ForRunAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        var (_, scope) = await runs.RequireAsync(runId, cancellationToken);
        session.UseOrganisation(organisationId);
        var rows = await db.Approvals.AsNoTracking().Where(a => a.OrganisationId == organisationId && a.RunId == runId).OrderBy(a => a.RequestedAt).ToListAsync(cancellationToken);
        var technical = await TechnicalAsync(db, organisationId, rows.Select(a => a.Id).ToList(), cancellationToken);
        return rows.Select(a =>
        {
            // Rows from before the plain-detail fix read as a new one would (R2-5).
            var (title, detail, tech) = OlderApprovals.Plain(a.Title, a.Detail, technical.GetValueOrDefault(a.Id), scope);
            return View(a) with { Title = title, Detail = detail, Technical = tech };
        }).ToList();
    }

    /// <summary>The technical detail each approval was raised with, read from its <c>approval.requested</c> event.</summary>
    public static async Task<Dictionary<Guid, string>> TechnicalAsync(EndgameDbContext db, Guid organisationId, IReadOnlyCollection<Guid> approvalIds, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        var result = new Dictionary<Guid, string>();
        if (approvalIds is not { Count: > 0 })
        {
            return result;
        }

        var ids = approvalIds.Distinct().ToList();
        var payloads = await db.RunEvents.AsNoTracking()
            .Where(e => e.OrganisationId == organisationId && e.Type == RunEventTypes.ApprovalRequested)
            .Join(db.Approvals.AsNoTracking().Where(a => a.OrganisationId == organisationId && ids.Contains(a.Id)),
                e => new { e.OrganisationId, e.RunId }, a => new { a.OrganisationId, a.RunId }, (e, a) => e.PayloadJson)
            .ToListAsync(cancellationToken);
        foreach (var payload in payloads)
        {
            if (JsonNode.Parse(payload) is JsonObject p && p["approvalId"] is JsonValue id && Guid.TryParse(id.ToString(), out var approval)
                && ids.Contains(approval) && p["technical"] is JsonValue t && t.GetValueKind() == System.Text.Json.JsonValueKind.String)
            {
                result[approval] = t.GetValue<string>();
            }
        }

        return result;
    }

    private static ApprovalView View(ApprovalRecord a) => new(a.Id, a.RunId, a.Title, a.Detail, a.Status, a.RequestedAt, a.AnsweredAt, a.AnsweredBy, a.Comment);
}
