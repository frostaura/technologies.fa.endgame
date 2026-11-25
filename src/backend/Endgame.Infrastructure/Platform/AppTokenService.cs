using System.Security.Cryptography;
using System.Text;
using Endgame.Application.Common;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Vault;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <summary>The app a platform call came from: its id and its whole cascade path.</summary>
/// <param name="Preview">The call came from the app's preview (an unpublished build under check), not the app itself.</param>
public sealed record AppCaller(ResolvedScope Scope, Guid TokenId, bool Preview = false)
{
    public const string ItemKey = "endgame.app-caller";

    public Guid OrganisationId => Scope.OrganisationId;

    public Guid AppId => Scope.AppId!.Value;

    public string Path => Scope.Path.ToString();
}

/// <summary>
/// App tokens (PLATFORM-API §1): one bearer per running app, minted when Dock starts it. Stored as a
/// SHA-256 hash for lookup and a random salt; the token itself is HMAC(vault-derived key, salt and
/// app id), so the control plane can recompute it to sign callbacks (§4) while the database alone
/// cannot. Issuing a new token supersedes the previous one after a short grace period.
/// </summary>
public sealed class AppTokenService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, EnvelopeVault vault, IOptions<AppSessionOptions> options, TimeProvider clock)
{
    public const string Prefix = "egt_";

    /// <param name="preview">A token for the app's preview: it supersedes only an earlier preview's, never the app's own, and
    /// what is sent with it is held rather than delivered.</param>
    public async Task<string> IssueAsync(ResolvedScope app, CancellationToken cancellationToken, bool preview = false)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (app.AppId is not { } appId)
        {
            throw EndgameProblem.Invalid("Tokens are issued to apps.");
        }

        var key = vault.DeriveKey("app-token");
        var salt = RandomNumberGenerator.GetBytes(32);
        var token = Derive(key, salt, appId);
        var now = clock.GetUtcNow();
        session.UseOrganisation(app.OrganisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        await db.AppTokens
            .Where(t => t.OrganisationId == app.OrganisationId && t.AppId == appId && t.Preview == preview && (t.ValidUntil == null || t.ValidUntil > now.AddSeconds(options.Value.TokenGraceSeconds)))
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ValidUntil, now.AddSeconds(options.Value.TokenGraceSeconds)), cancellationToken);
        db.AppTokens.Add(new AppTokenRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = app.OrganisationId,
            AppId = appId,
            Salt = salt,
            TokenHash = Hash(token),
            CreatedAt = now,
            Preview = preview,
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return token;
    }

    /// <summary>The app a bearer token belongs to, or null when it is unknown, superseded past its grace, or its app is archived.</summary>
    public async Task<AppCaller?> AuthenticateAsync(string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(token) || !token.StartsWith(Prefix, StringComparison.Ordinal) || token.Length > 200)
        {
            return null;
        }

        var hash = Hash(token);
        var now = clock.GetUtcNow();
        session.UseSystem();
        var row = await db.AppTokens.AsNoTracking()
            .Where(t => t.TokenHash == hash && (t.ValidUntil == null || t.ValidUntil > now))
            .Select(t => new { t.Id, t.OrganisationId, t.AppId, t.Preview })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            session.Clear();
            return null;
        }

        var scope = await scopes.FindNodeAsync(NodeLevel.App, row.AppId, cancellationToken);
        if (scope is null || scope.OrganisationId != row.OrganisationId || scope.Node.Status == NodeStatuses.Archived)
        {
            session.Clear();
            return null;
        }

        return new AppCaller(scope, row.Id, row.Preview);
    }

    /// <summary>The app's current token, recomputed — the HMAC key for platform-to-app callbacks. Null if none was issued.</summary>
    public async Task<string?> CurrentTokenAsync(Guid organisationId, Guid appId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var salt = await db.AppTokens.AsNoTracking()
            .Where(t => t.OrganisationId == organisationId && t.AppId == appId && !t.Preview && t.ValidUntil == null)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => t.Salt)
            .FirstOrDefaultAsync(cancellationToken);
        return salt is null ? null : Derive(vault.DeriveKey("app-token"), salt, appId);
    }

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Derive(byte[] key, byte[] salt, Guid appId)
    {
        var mac = HMACSHA256.HashData(key, (byte[])[.. salt, .. appId.ToByteArray()]);
        return Prefix + Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
