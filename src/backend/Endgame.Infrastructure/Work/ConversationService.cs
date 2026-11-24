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

/// <summary>
/// The docked conversation: each message becomes a queued run whose first event is the message; the
/// reply streams back as that run's events. A conversation keeps its scope; continuing it in another
/// scope is refused rather than silently moved.
/// </summary>
public sealed class ConversationService(EndgameDbContext db, TenantSession session, RunService runs, TimeProvider clock)
{
    public const int MaxMessageLength = 20_000;

    public async Task<ConversationTurn> PostAsync(ResolvedScope scope, string message, Guid? conversationId, Guid? employeeId, Guid by, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var text = message?.Trim() ?? "";
        if (text.Length is 0 or > MaxMessageLength)
        {
            throw EndgameProblem.Invalid($"A message is 1 to {MaxMessageLength} characters.");
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
        var title = text.Split('\n', 2)[0];
        var run = await runs.CreateAsync(scope, RunKinds.Conversation, title.Length <= 120 ? title : title[..117] + "...", employeeId, null, conversation.Id, conversation.LastRunId, by, cancellationToken);
        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
        {
            ["from"] = "owner",
            ["userId"] = by.ToString(),
            ["text"] = text,
        })], null, by, cancellationToken);
        session.UseOrganisation(scope.OrganisationId);
        await db.Conversations.Where(c => c.OrganisationId == scope.OrganisationId && c.Id == conversation.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.LastRunId, run.Id), cancellationToken);
        return new ConversationTurn(conversation.Id, scope.Path.ToString(), await runs.GetAsync(scope.OrganisationId, run.Id, cancellationToken));
    }
}
