using Endgame.Application.Email;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <summary>
/// The hand-over of an invitation (a new member, or the Owner of a newly provisioned organisation):
/// the one-time code is always returned to the person who invited, and is also e-mailed through the
/// outbox when a mail server is configured. Nothing is queued otherwise, so a stale code never
/// arrives later.
/// </summary>
public sealed class InvitationMailer(EndgameDbContext db, TenantSession session, IEmailSender sender, IOptions<AddressOptions> addresses, TimeProvider clock)
{
    public bool CanSend => sender.IsConfigured;

    /// <returns>True when the invitation was queued for e-mail.</returns>
    public async Task<bool> SendAsync(ResolvedScope scope, string email, string code, DateTimeOffset expiresAt, string role, string invitedBy, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (!sender.IsConfigured)
        {
            return false;
        }

        var console = addresses.Value.Origin(addresses.Value.PathHost) + "/";
        var now = clock.GetUtcNow();
        session.UseOrganisation(scope.OrganisationId);
        db.EmailMessages.Add(new EmailMessageRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            AppId = null,
            Recipients = [email],
            Subject = $"You are invited to {scope.Nodes[0].Name} on Endgame",
            TextBody = $"""
                {invitedBy} invited you to {scope.Node.Name} ({scope.Path}) as {role}.

                Open {console} and register a passkey with this e-mail address and the code below.
                No password is ever set.

                Invitation code: {code}
                It works once, until {expiresAt:yyyy-MM-dd HH:mm} UTC.
                """,
            Status = "queued",
            NextAttemptAt = now,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return true;
    }
}
