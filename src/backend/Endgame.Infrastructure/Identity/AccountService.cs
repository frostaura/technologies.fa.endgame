using System.Security.Cryptography;
using System.Text;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Access;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Identity;

public sealed record NewOrganisation(string Name, string Slug);

/// <param name="InvitationExpiresAt">For someone with no passkey yet: until when their invitation code works.</param>
public sealed record MemberView(Guid MembershipId, Guid UserId, string Email, string DisplayName, string Scope, string Role, bool HasPasskey, DateTimeOffset GrantedAt,
    DateTimeOffset? InvitationExpiresAt = null);

/// <param name="Emailed">The code was also e-mailed to the person (only when a mail server is configured).</param>
public sealed record Invitation(MemberView Member, string? InvitationCode, DateTimeOffset? ExpiresAt, bool Emailed = false);

/// <summary>
/// People and their memberships. Endgame is invite-only: a passkey can be registered by the very first
/// person (who creates the first organisation and becomes its Owner), by someone holding an invitation
/// code, or by a signed-in person adding a passkey to their own account.
/// </summary>
public sealed class AccountService(EndgameDbContext db, TenantSession session, UserManager<EndgameUser> users, TreeService tree, EdgeNotifier edge, TimeProvider clock)
{
    public static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    /// <summary>True until the first organisation exists. Runs as the platform.</summary>
    public async Task<bool> IsFirstRunAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var any = await db.Organisations.AnyAsync(cancellationToken);
        session.Clear();
        return !any;
    }

    public static string NormaliseEmail(string? email)
    {
        var trimmed = email?.Trim().ToLowerInvariant() ?? "";
        var at = trimmed.IndexOf('@', StringComparison.Ordinal);
        return trimmed.Length is > 3 and <= 254 && at > 0 && at < trimmed.Length - 1 && trimmed.IndexOf('@', at + 1) < 0 && !trimmed.Contains(' ', StringComparison.Ordinal)
            ? trimmed
            : throw EndgameProblem.Invalid("Give a valid e-mail address.");
    }

    public static string DisplayName(string? name, string email)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrEmpty(trimmed) ? email[..email.IndexOf('@', StringComparison.Ordinal)]
            : trimmed.Length > EndgameUser.MaxDisplayNameLength ? throw EndgameProblem.Invalid($"A display name is at most {EndgameUser.MaxDisplayNameLength} characters.")
            : trimmed;
    }

    public static NewOrganisation ValidateOrganisation(NewOrganisation? organisation)
    {
        if (organisation is null)
        {
            throw EndgameProblem.Invalid("Endgame has no organisation yet: name the first one (organisation.name and organisation.slug), and you become its Owner.");
        }

        try
        {
            SlugRules.RequireOrganisationSlug(organisation.Slug);
        }
        catch (DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }

        return string.IsNullOrWhiteSpace(organisation.Name) ? throw EndgameProblem.Invalid("The organisation needs a name.") : organisation;
    }

    /// <summary>The invited person an invitation code belongs to, if the code is right and still open.</summary>
    public async Task<EndgameUser?> FindInvitedAsync(string email, string code, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(email);
        if (user?.InvitationCodeHash is null || user.InvitationExpiresAt is null || user.InvitationExpiresAt < clock.GetUtcNow())
        {
            return null;
        }

        var expected = Convert.FromHexString(user.InvitationCodeHash);
        var given = SHA256.HashData(Encoding.UTF8.GetBytes(code.Trim()));
        return CryptographicOperations.FixedTimeEquals(expected, given) ? user : null;
    }

    /// <summary>True on a fresh install: no organisation and nobody registered. The first person needs no invitation.</summary>
    public async Task<bool> IsFreshInstallAsync(CancellationToken cancellationToken) =>
        await IsFirstRunAsync(cancellationToken) && !await db.Users.AnyAsync(cancellationToken);

    /// <summary>Creates the very first person, under a lock so two first registrations cannot both win.</summary>
    public async Task<EndgameUser> CreateFirstUserAsync(Guid userId, string email, string displayName, CancellationToken cancellationToken)
    {
        await using var transaction = await FirstRunLockAsync(cancellationToken);
        if (await db.Users.AnyAsync(cancellationToken) || await db.Organisations.AnyAsync(cancellationToken))
        {
            throw EndgameProblem.Conflict("Someone has already registered first; ask them for an invitation.");
        }

        var user = await CreateUserAsync(userId, email, displayName);
        await transaction.CommitAsync(cancellationToken);
        return user;
    }

    /// <summary>
    /// First run: the first organisation, created by a signed-in person who becomes its Owner. Under
    /// the same lock, so only one first organisation can ever be made this way; later ones are
    /// provisioned by FrostAura.
    /// </summary>
    public async Task<Organisation> CreateFirstOrganisationAsync(NewOrganisation organisation, Guid owner, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(organisation);
        await using var transaction = await FirstRunLockAsync(cancellationToken);
        if (await db.Organisations.AnyAsync(cancellationToken))
        {
            throw EndgameProblem.Forbidden("Organisations are provisioned by FrostAura; there is no self-serve sign-up.");
        }

        var created = await tree.CreateOrganisationAsync(organisation.Name, organisation.Slug, owner, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return created;
    }

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction> FirstRunLockAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await using var command = await db.CommandAsync("SELECT pg_advisory_xact_lock(7002)", cancellationToken);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return transaction;
    }

    /// <summary>An existing person, or a new one with no passkey yet. Used by invitations and development sign-in.</summary>
    public async Task<EndgameUser> FindOrCreateAsync(string email, string? displayName, CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        return await users.FindByEmailAsync(email) ?? await CreateUserAsync(Guid.NewGuid(), email, DisplayName(displayName, email));
    }

    public async Task<EndgameUser> CreateUserAsync(Guid id, string email, string displayName)
    {
        var user = new EndgameUser { Id = id, UserName = email, Email = email, DisplayName = displayName, CreatedAt = clock.GetUtcNow() };
        var result = await users.CreateAsync(user);
        return result.Succeeded
            ? user
            : throw EndgameProblem.Conflict(string.Join(" ", result.Errors.Select(e => e.Description)));
    }

    public async Task ClearInvitationAsync(EndgameUser given)
    {
        ArgumentNullException.ThrowIfNull(given);
        var user = await Fresh(given);
        user.InvitationCodeHash = null;
        user.InvitationExpiresAt = null;
        await users.UpdateAsync(user);
    }

    /// <summary>
    /// Grants a role at a scope. The person is created if they are new, and then gets a one-time
    /// invitation code (returned once, stored only as a hash) to register their passkey with — unless
    /// <paramref name="issueInvitation"/> is false (a role change), when the code they already hold is kept.
    /// </summary>
    public async Task<Invitation> GrantAsync(ResolvedScope scope, MemberRole grantorRole, string email, string? displayName, MemberRole role, Guid grantedBy, CancellationToken cancellationToken,
        bool issueInvitation = true)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (role == MemberRole.Owner)
        {
            throw EndgameProblem.Forbidden("An organisation has one Owner, the person it was provisioned for.");
        }

        if (role == MemberRole.Admin && grantorRole != MemberRole.Owner)
        {
            throw EndgameProblem.Forbidden("Only the Owner manages Admins.");
        }

        var user = await FindOrCreateAsync(NormaliseEmail(email), displayName, cancellationToken);
        var (code, expires) = issueInvitation ? await IssueInvitationIfNeededAsync(user) : (null, null);
        var current = await Fresh(user);
        var hasPasskey = issueInvitation ? code is null : (await users.GetPasskeysAsync(current)).Count > 0;

        session.UseOrganisation(scope.OrganisationId);
        var existing = await db.Memberships.SingleOrDefaultAsync(m => m.OrganisationId == scope.OrganisationId && m.UserId == user.Id
            && m.DivisionId == scope.DivisionId && m.ProjectId == scope.ProjectId && m.AppId == scope.AppId, cancellationToken);
        if (existing?.Role == MemberRole.Owner.ToWire())
        {
            throw EndgameProblem.Conflict("That person is the Owner here; their role is not changed by a grant.");
        }

        if (existing is null)
        {
            existing = new MembershipRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = scope.OrganisationId,
                DivisionId = scope.DivisionId,
                ProjectId = scope.ProjectId,
                AppId = scope.AppId,
                UserId = user.Id,
            };
            db.Memberships.Add(existing);
        }

        existing.Role = role.ToWire();
        existing.GrantedBy = grantedBy;
        existing.GrantedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return new Invitation(new MemberView(existing.Id, user.Id, user.Email!, user.DisplayName, scope.Path.ToString(), existing.Role, hasPasskey, existing.GrantedAt,
            hasPasskey ? null : expires ?? current.InvitationExpiresAt), code, expires);
    }

    /// <summary>
    /// A new invitation code for someone who was invited and has not made a passkey yet (PPL-05): the old
    /// code stops working, the new one is returned once. Someone with a passkey is refused: they need none.
    /// </summary>
    public async Task<Invitation> ReissueInvitationAsync(ResolvedScope scope, MembershipRecord membership, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(membership);
        var user = await users.FindByIdAsync(membership.UserId.ToString()) ?? throw EndgameProblem.NotFound("The member");
        var (code, expires) = await IssueInvitationIfNeededAsync(user);
        if (code is null)
        {
            throw EndgameProblem.Conflict($"{user.DisplayName} already has a passkey, so they sign in with it and need no code.");
        }

        session.UseOrganisation(scope.OrganisationId);
        return new Invitation(new MemberView(membership.Id, user.Id, user.Email!, user.DisplayName, scope.Path.ToString(), membership.Role, false, membership.GrantedAt, expires), code, expires);
    }

    /// <summary>
    /// A fresh one-time invitation code for someone who has no passkey yet — returned once, stored only
    /// as a hash, open for <see cref="InvitationLifetime"/>. Someone with a passkey needs none.
    /// </summary>
    public async Task<(string? Code, DateTimeOffset? ExpiresAt)> IssueInvitationIfNeededAsync(EndgameUser given)
    {
        ArgumentNullException.ThrowIfNull(given);
        var user = await Fresh(given);
        if ((await users.GetPasskeysAsync(user)).Count > 0)
        {
            return (null, null);
        }

        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var expires = clock.GetUtcNow() + InvitationLifetime;
        user.InvitationCodeHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
        user.InvitationExpiresAt = expires;
        await users.UpdateAsync(user);
        return (code, expires);
    }

    /// <summary>The tracked copy of a person: other work in the request may have cleared the change tracker since it was read.</summary>
    private async Task<EndgameUser> Fresh(EndgameUser user) =>
        await users.FindByIdAsync(user.Id.ToString()) ?? throw EndgameProblem.NotFound("The account");

    /// <summary>
    /// Everyone whose grant holds at the scope: granted there or beneath it, and granted above it on its
    /// chain (the Owner, organisation-wide Admins), each with where the grant was set (PPL-01).
    /// </summary>
    public async Task<IReadOnlyList<MemberView>> MembersAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var rows = await (from m in db.Memberships.AsNoTracking()
                          join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                          where m.OrganisationId == scope.OrganisationId
                                && (((scope.DivisionId == null || m.DivisionId == scope.DivisionId)
                                     && (scope.ProjectId == null || m.ProjectId == scope.ProjectId)
                                     && (scope.AppId == null || m.AppId == scope.AppId))
                                    || m.DivisionId == null
                                    || (m.DivisionId == scope.DivisionId && m.ProjectId == null)
                                    || (scope.ProjectId != null && m.ProjectId == scope.ProjectId && m.AppId == null))
                          select new { Membership = m, u.Email, u.DisplayName, u.InvitationExpiresAt, HasPasskey = db.Set<IdentityUserPasskey<Guid>>().Any(p => p.UserId == u.Id) })
            .ToListAsync(cancellationToken);
        var resolver = new Dictionary<(Guid?, Guid?, Guid?), string>();
        var views = new List<MemberView>();
        foreach (var row in rows)
        {
            var m = row.Membership;
            if (!resolver.TryGetValue((m.DivisionId, m.ProjectId, m.AppId), out var path))
            {
                path = m.Level() switch
                {
                    NodeLevel.Organisation => scope.Nodes[0].Path,
                    _ when scope.Level >= m.Level() => scope.PathAt(m.Level()),
                    _ => await PathOfAsync(m),
                };
                resolver[(m.DivisionId, m.ProjectId, m.AppId)] = path;
            }

            views.Add(new MemberView(m.Id, m.UserId, row.Email ?? "", row.DisplayName, path, m.Role, row.HasPasskey, m.GrantedAt, row.HasPasskey ? null : row.InvitationExpiresAt));
        }

        session.UseOrganisation(scope.OrganisationId);
        return views.OrderBy(v => v.Scope, StringComparer.Ordinal).ThenBy(v => v.Email, StringComparer.Ordinal).ToList();

        async Task<string> PathOfAsync(MembershipRecord m)
        {
            var org = scope.Nodes[0].Slug;
            var division = await db.Divisions.AsNoTracking().Where(d => d.Id == m.DivisionId).Select(d => d.Slug).SingleAsync(cancellationToken);
            var project = m.ProjectId is null ? null : await db.Projects.AsNoTracking().Where(p => p.Id == m.ProjectId).Select(p => p.Slug).SingleAsync(cancellationToken);
            var app = m.AppId is null ? null : await db.Apps.AsNoTracking().Where(a => a.Id == m.AppId).Select(a => a.Slug).SingleAsync(cancellationToken);
            return string.Join('/', new[] { org, division, project, app }.Where(s => s is not null));
        }
    }

    public async Task<(Guid OrganisationId, MembershipRecord Membership)> MembershipAsync(Guid membershipId, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var membership = await db.Memberships.AsNoTracking().SingleOrDefaultAsync(m => m.Id == membershipId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The membership");
        session.UseOrganisation(membership.OrganisationId);
        return (membership.OrganisationId, membership);
    }

    /// <summary>
    /// Revokes one role grant. When it was the person's last grant anywhere and they never made a passkey, their
    /// pending invitation code is cancelled too: a code is an invitation to a role, and with no role left it would
    /// only make a role-less account (D8). Someone who has signed in keeps their account.
    /// </summary>
    public async Task<RoleRevoked> RevokeAsync(MembershipRecord membership, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(membership);
        if (membership.Role == MemberRole.Owner.ToWire())
        {
            throw EndgameProblem.Forbidden("The Owner's role cannot be revoked.");
        }

        session.UseOrganisation(membership.OrganisationId);
        await db.Memberships.Where(m => m.OrganisationId == membership.OrganisationId && m.Id == membership.Id).ExecuteDeleteAsync(cancellationToken);
        session.UseSystem();
        var cancelled = !await db.Memberships.AsNoTracking().AnyAsync(m => m.UserId == membership.UserId, cancellationToken)
            && await db.Users.Where(u => u.Id == membership.UserId && u.InvitationCodeHash != null
                    && !db.Set<IdentityUserPasskey<Guid>>().Any(p => p.UserId == u.Id))
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.InvitationCodeHash, (string?)null).SetProperty(x => x.InvitationExpiresAt, (DateTimeOffset?)null), cancellationToken) > 0;
        session.UseOrganisation(membership.OrganisationId);
        // An access answer Edge reuses must not keep an app open to someone whose role just went.
        await edge.AccessEndedAsync(cancellationToken);
        return new RoleRevoked(membership.Id, cancelled);
    }
}

/// <summary>A revoked grant.</summary>
/// <param name="InvitationCancelled">True when it was the person's last grant and their unused invitation code was cancelled with it.</param>
public sealed record RoleRevoked(Guid Revoked, bool InvitationCancelled);
