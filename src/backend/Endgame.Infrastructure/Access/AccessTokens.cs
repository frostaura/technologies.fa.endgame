using System.Security.Cryptography;
using System.Text;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Access;

/// <summary>
/// The role ceiling of the current request when it came with a personal access token (an MCP
/// client). Set once by the token's authentication handler; <see cref="AccessService"/> holds every
/// check to it: the token's organisation only, its role at most, and never God mode.
/// </summary>
public sealed class CallerCeiling
{
    public Guid? TokenId { get; private set; }

    public Guid? OrganisationId { get; private set; }

    public MemberRole? Role { get; private set; }

    public bool Active => TokenId is not null;

    public void Set(Guid tokenId, Guid organisationId, MemberRole role)
    {
        if (Active)
        {
            throw new InvalidOperationException("A request carries one access token.");
        }

        TokenId = tokenId;
        OrganisationId = organisationId;
        Role = role;
    }

    /// <summary>The lower of a role and the ceiling.</summary>
    public MemberRole Cap(MemberRole role) => Role is { } ceiling && ceiling < role ? ceiling : role;
}

/// <param name="Organisation">The organisation's slug.</param>
/// <param name="Prefix">The token's first characters, to tell tokens apart; never enough to use one.</param>
/// <param name="Active">Not revoked and not expired.</param>
public sealed record AccessTokenView(Guid Id, string Name, string Organisation, string Role, string Prefix, DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt, bool Active);

/// <param name="Token">The token itself. Shown this once and stored only as a hash.</param>
public sealed record AccessTokenCreated(string Token, AccessTokenView AccessToken);

public sealed record AuthenticatedToken(Guid TokenId, Guid UserId, Guid OrganisationId, MemberRole Role);

/// <summary>
/// Personal access tokens for MCP clients (spec: MCP on by default). A person makes one in the
/// console for one organisation, at a role no higher than their own there and never Owner; it is
/// stored as a SHA-256 hash, can be revoked at any time, and shows when it was last used.
/// </summary>
public sealed class AccessTokenService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, AccessService access, TimeProvider clock)
{
    public const string Prefix = "egp_";
    public const int MaxPerPerson = 50;
    public const int MaxLifetimeDays = 366;
    private static readonly TimeSpan LastUsedResolution = TimeSpan.FromMinutes(1);

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public async Task<AccessTokenCreated> CreateAsync(Guid userId, string? organisation, string? name, string? role, int? expiresInDays, CancellationToken cancellationToken)
    {
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length is 0 or > 100)
        {
            throw EndgameProblem.Invalid("Give the token a name of 1 to 100 characters, so you know which client holds it.");
        }

        if (expiresInDays is { } days && days is < 1 or > MaxLifetimeDays)
        {
            throw EndgameProblem.Invalid($"expiresInDays is 1 to {MaxLifetimeDays}, or left out for a token that lasts until it is revoked.");
        }

        var scope = await scopes.RequireAsync(organisation, cancellationToken);
        if (scope.Level != NodeLevel.Organisation)
        {
            throw EndgameProblem.Invalid("A token is for one organisation: pass its slug.");
        }

        var grants = await access.GrantsInOrganisationAsync(userId, scope.OrganisationId, cancellationToken);
        var highest = grants.Count == 0 ? (MemberRole?)null : grants.Max(g => g.Role);
        if (highest is null)
        {
            throw EndgameProblem.NotFound($"The scope '{scope.Path}'");
        }

        var ceiling = highest == MemberRole.Owner ? MemberRole.Admin : highest.Value;
        MemberRole wanted;
        try
        {
            wanted = role is null ? ceiling : MemberRoles.FromWire(role);
        }
        catch (Domain.DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }

        if (wanted == MemberRole.Owner)
        {
            throw EndgameProblem.Invalid("A token never acts as the Owner: what only the Owner may do stays with the person. Use admin at most.");
        }

        if (wanted > highest)
        {
            throw EndgameProblem.Forbidden($"A token's role is no higher than yours: you hold {highest.Value.ToWire()} at most in '{scope.Path}'.");
        }

        session.UseOrganisation(scope.OrganisationId);
        if (await db.AccessTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null, cancellationToken) >= MaxPerPerson)
        {
            throw EndgameProblem.Conflict($"You hold {MaxPerPerson} live tokens here; revoke one first.");
        }

        var token = Prefix + Base64Url(RandomNumberGenerator.GetBytes(32));
        var now = clock.GetUtcNow();
        var record = new AccessTokenRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            UserId = userId,
            Name = trimmed,
            Role = wanted.ToWire(),
            Prefix = token[..12],
            TokenHash = Hash(token),
            CreatedAt = now,
            ExpiresAt = expiresInDays is { } d ? now.AddDays(d) : null,
        };
        db.AccessTokens.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return new AccessTokenCreated(token, View(record, scope.Nodes[0].Slug, now));
    }

    /// <summary>Every token the person made, in every organisation, newest first.</summary>
    public async Task<IReadOnlyList<AccessTokenView>> ListAsync(Guid userId, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var rows = await (from t in db.AccessTokens.AsNoTracking()
                          join o in db.Organisations.AsNoTracking() on t.OrganisationId equals o.Id
                          where t.UserId == userId
                          orderby t.CreatedAt descending
                          select new { Token = t, o.Slug }).ToListAsync(cancellationToken);
        session.Clear();
        var now = clock.GetUtcNow();
        return rows.Select(r => View(r.Token, r.Slug, now)).ToList();
    }

    /// <summary>Revokes one of the person's own tokens. Its next call is refused.</summary>
    public async Task<AccessTokenView> RevokeAsync(Guid userId, Guid tokenId, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var row = await db.AccessTokens.SingleOrDefaultAsync(t => t.Id == tokenId && t.UserId == userId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The token");
        var slug = await db.Organisations.AsNoTracking().Where(o => o.Id == row.OrganisationId).Select(o => o.Slug).SingleAsync(cancellationToken);
        row.RevokedAt ??= clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        session.Clear();
        return View(row, slug, clock.GetUtcNow());
    }

    /// <summary>The token's holder, organisation and role, or null when it is unknown, revoked or expired. Records its use.</summary>
    public async Task<AuthenticatedToken?> AuthenticateAsync(string? token, CancellationToken cancellationToken)
    {
        if (token is null || !token.StartsWith(Prefix, StringComparison.Ordinal) || token.Length > 100)
        {
            return null;
        }

        var hash = Hash(token);
        var now = clock.GetUtcNow();
        session.UseSystem();
        var row = await db.AccessTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
        if (row is null || row.RevokedAt is not null || (row.ExpiresAt is { } expires && expires <= now)
            || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row.TokenHash), Encoding.ASCII.GetBytes(hash)))
        {
            session.Clear();
            return null;
        }

        if (row.LastUsedAt is null || now - row.LastUsedAt > LastUsedResolution)
        {
            row.LastUsedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        db.ChangeTracker.Clear();
        session.Clear();
        return new AuthenticatedToken(row.Id, row.UserId, row.OrganisationId, MemberRoles.FromWire(row.Role));
    }

    private static AccessTokenView View(AccessTokenRecord t, string organisation, DateTimeOffset now) =>
        new(t.Id, t.Name, organisation, t.Role, t.Prefix, t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt,
            t.RevokedAt is null && (t.ExpiresAt is null || t.ExpiresAt > now));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
