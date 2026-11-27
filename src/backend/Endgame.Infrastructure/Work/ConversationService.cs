using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

public sealed record ConversationTurn(Guid ConversationId, string Scope, RunView Run);

/// <summary>What one message asks whoever answers not to do (ARCH-012): only ever less than the rules allow, never more.</summary>
/// <param name="NoWebSearch">Do not search the web for this one.</param>
/// <param name="AnswerOnly">Answer only: start no work and change nothing.</param>
public sealed record MessageNarrowing(bool? NoWebSearch = null, bool? AnswerOnly = null)
{
    /// <summary>The narrowing as the owner message records it: only the flags that are set, or null for none.</summary>
    public JsonObject? ToPayload()
    {
        var o = new JsonObject();
        if (NoWebSearch == true)
        {
            o["noWebSearch"] = true;
        }

        if (AnswerOnly == true)
        {
            o["answerOnly"] = true;
        }

        return o.Count == 0 ? null : o;
    }
}

/// <summary>
/// The docked conversation: each message becomes a queued run whose first event is the message; the
/// reply streams back as that run's events. A conversation keeps its scope; continuing it in another
/// scope is refused rather than silently moved.
/// </summary>
public sealed class ConversationService(EndgameDbContext db, TenantSession session, RunService runs, ConversationAttachmentService attachments, TimeProvider clock)
{
    public const int MaxMessageLength = 20_000;

    /// <param name="estimate">What the turn is expected to cost and the most it can, shown before the message was sent; it opens the run's log.</param>
    /// <param name="files">The files sent with it, already checked by <see cref="ConversationAttachmentService.ForSendAsync"/>.</param>
    /// <param name="narrow">What this one message asks not to be done; recorded on the message, enforced by the Runner.</param>
    public async Task<ConversationTurn> PostAsync(ResolvedScope scope, string message, Guid? conversationId, Guid? employeeId, Guid by, CancellationToken cancellationToken, Application.Gateway.Estimate? estimate = null,
        IReadOnlyList<ConversationAttachmentView>? files = null, MessageNarrowing? narrow = null)
    {
        ArgumentNullException.ThrowIfNull(scope);
        files ??= [];
        var text = message?.Trim() ?? "";
        // A message may be files alone; with no file it needs words.
        if ((text.Length == 0 && files.Count == 0) || text.Length > MaxMessageLength)
        {
            throw EndgameProblem.Invalid($"A message is 1 to {MaxMessageLength} characters, or files with no words.");
        }

        session.UseOrganisation(scope.OrganisationId);
        ConversationRecord conversation;
        if (conversationId is { } id)
        {
            conversation = await db.Conversations.SingleOrDefaultAsync(c => c.OrganisationId == scope.OrganisationId && c.Id == id, cancellationToken)
                ?? throw EndgameProblem.NotFound("The conversation");
            if (conversation.DivisionId != scope.DivisionId || conversation.ProjectId != scope.ProjectId || conversation.AppId != scope.AppId)
            {
                throw EndgameProblem.Conflict("This conversation belongs to another scope; start a new one here.");
            }

            employeeId ??= conversation.EmployeeId;
        }
        else if (await db.Conversations.Where(c => c.OrganisationId == scope.OrganisationId && c.DivisionId == scope.DivisionId && c.ProjectId == scope.ProjectId
                         && c.AppId == scope.AppId && c.EmployeeId == employeeId).OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(cancellationToken) is { } latest)
        {
            // The conversation docked at a scope persists: a new message continues it.
            conversation = latest;
        }
        else
        {
            conversation = new ConversationRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = scope.OrganisationId,
                DivisionId = scope.DivisionId,
                ProjectId = scope.ProjectId,
                AppId = scope.AppId,
                EmployeeId = employeeId,
                CreatedBy = by,
                CreatedAt = clock.GetUtcNow(),
            };
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync(cancellationToken);
        }

        db.ChangeTracker.Clear();
        var title = text.Length > 0 ? text.Split('\n', 2)[0] : $"Sent {string.Join(", ", files.Select(f => f.Name))}";
        // The turn's run, its files, the owner's message and its estimate are one act (#7): committed together, so no Runner
        // can claim a turn whose message is not there yet, and a request that dies half-way leaves no message-less turn.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var run = await runs.CreateAsync(scope, RunKinds.Conversation, Endgame.Domain.Words.Clamp(title, 120), employeeId, null, conversation.Id, conversation.LastRunId, by, cancellationToken);
        if (!await attachments.LinkAsync(scope.OrganisationId, conversation.Id, run.Id, files.Select(f => f.Id).ToList(), cancellationToken))
        {
            // Another message took one of the files a moment ago: this one is not sent (nothing of it is kept), and says why.
            await transaction.RollbackAsync(cancellationToken);
            throw new EndgameProblem(409, "attachment_sent", "A file was already sent", "One of the files was sent with another message a moment ago. Attach it again to send it again.");
        }

        var said = new JsonObject
        {
            ["from"] = "owner",
            ["userId"] = by.ToString(),
            ["text"] = text,
        };
        if (files.Count > 0)
        {
            said["attachments"] = ConversationAttachmentService.Summary(files);
        }

        if (narrow?.ToPayload() is { } narrowed)
        {
            said["narrow"] = narrowed;
        }

        List<NewEvent> opening = [new NewEvent(RunEventTypes.Message, said)];
        if (estimate is not null)
        {
            opening.Add(new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate.Credits, ["basis"] = "conversation", ["reason"] = estimate.Basis, ["ceiling"] = estimate.Ceiling }));
        }

        await runs.AppendAsync(scope.OrganisationId, run.Id, opening, null, by, cancellationToken);
        session.UseOrganisation(scope.OrganisationId);
        await db.Conversations.Where(c => c.OrganisationId == scope.OrganisationId && c.Id == conversation.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.LastRunId, run.Id), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ConversationTurn(conversation.Id, scope.Path.ToString(), await runs.GetAsync(scope.OrganisationId, run.Id, cancellationToken));
    }
}
