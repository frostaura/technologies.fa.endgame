using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Platform;

/// <summary>
/// The app end-user population, seen through ASP.NET Core Identity's store interfaces so that
/// Identity's own passkey handler verifies their WebAuthn ceremonies exactly as it does members'.
/// One instance serves one app of one organisation: every lookup is confined to it (and row-level
/// security confines the connection to the organisation), so a passkey registered for one app can
/// never sign anyone in to another.
/// </summary>
internal sealed class AppEndUserStore(EndgameDbContext db, Guid organisationId, Guid appId) : IUserPasskeyStore<AppEndUserRecord>
{
    public void Dispose()
    {
    }

    public Task<string> GetUserIdAsync(AppEndUserRecord user, CancellationToken cancellationToken) => Task.FromResult(user.Id.ToString());

    public Task<string?> GetUserNameAsync(AppEndUserRecord user, CancellationToken cancellationToken) => Task.FromResult<string?>(user.Email);

    public Task SetUserNameAsync(AppEndUserRecord user, string? userName, CancellationToken cancellationToken)
    {
        user.Email = userName ?? user.Email;
        return Task.CompletedTask;
    }

    public Task<string?> GetNormalizedUserNameAsync(AppEndUserRecord user, CancellationToken cancellationToken) => Task.FromResult<string?>(user.Email.ToUpperInvariant());

    public Task SetNormalizedUserNameAsync(AppEndUserRecord user, string? normalizedName, CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task<IdentityResult> CreateAsync(AppEndUserRecord user, CancellationToken cancellationToken)
    {
        db.AppEndUsers.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return IdentityResult.Success;
    }

    public async Task<IdentityResult> UpdateAsync(AppEndUserRecord user, CancellationToken cancellationToken)
    {
        await db.SaveChangesAsync(cancellationToken);
        return IdentityResult.Success;
    }

    public async Task<IdentityResult> DeleteAsync(AppEndUserRecord user, CancellationToken cancellationToken)
    {
        await db.AppEndUsers.Where(u => u.OrganisationId == organisationId && u.AppId == appId && u.Id == user.Id).ExecuteDeleteAsync(cancellationToken);
        return IdentityResult.Success;
    }

    public async Task<AppEndUserRecord?> FindByIdAsync(string userId, CancellationToken cancellationToken) =>
        Guid.TryParse(userId, out var id)
            ? await db.AppEndUsers.SingleOrDefaultAsync(u => u.OrganisationId == organisationId && u.AppId == appId && u.Id == id, cancellationToken)
            : null;

    public async Task<AppEndUserRecord?> FindByNameAsync(string normalizedUserName, CancellationToken cancellationToken)
    {
        var email = normalizedUserName.ToLowerInvariant();
        return await db.AppEndUsers.SingleOrDefaultAsync(u => u.OrganisationId == organisationId && u.AppId == appId && u.Email == email, cancellationToken);
    }

    public async Task AddOrUpdatePasskeyAsync(AppEndUserRecord user, UserPasskeyInfo passkey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        ArgumentNullException.ThrowIfNull(passkey);
        var row = await db.AppEndUserPasskeys.SingleOrDefaultAsync(p => p.OrganisationId == organisationId && p.CredentialId == passkey.CredentialId, cancellationToken);
        if (row is null)
        {
            row = new AppEndUserPasskeyRecord { OrganisationId = organisationId, CredentialId = passkey.CredentialId, AppId = appId, EndUserId = user.Id };
            db.AppEndUserPasskeys.Add(row);
        }
        else if (row.EndUserId != user.Id || row.AppId != appId)
        {
            throw new InvalidOperationException("That passkey belongs to someone else.");
        }

        row.PublicKey = passkey.PublicKey;
        row.Name = passkey.Name;
        row.CreatedAt = passkey.CreatedAt;
        row.SignCount = passkey.SignCount;
        row.Transports = passkey.Transports;
        row.IsUserVerified = passkey.IsUserVerified;
        row.IsBackupEligible = passkey.IsBackupEligible;
        row.IsBackedUp = passkey.IsBackedUp;
        row.AttestationObject = passkey.AttestationObject;
        row.ClientDataJson = passkey.ClientDataJson;
    }

    public async Task<IList<UserPasskeyInfo>> GetPasskeysAsync(AppEndUserRecord user, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        var rows = await db.AppEndUserPasskeys.AsNoTracking()
            .Where(p => p.OrganisationId == organisationId && p.AppId == appId && p.EndUserId == user.Id)
            .ToListAsync(cancellationToken);
        return rows.Select(Info).ToList();
    }

    public async Task<AppEndUserRecord?> FindByPasskeyIdAsync(byte[] credentialId, CancellationToken cancellationToken)
    {
        var owner = await db.AppEndUserPasskeys.AsNoTracking()
            .Where(p => p.OrganisationId == organisationId && p.AppId == appId && p.CredentialId == credentialId)
            .Select(p => (Guid?)p.EndUserId)
            .SingleOrDefaultAsync(cancellationToken);
        return owner is { } id ? await FindByIdAsync(id.ToString(), cancellationToken) : null;
    }

    public async Task<UserPasskeyInfo?> FindPasskeyAsync(AppEndUserRecord user, byte[] credentialId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        var row = await db.AppEndUserPasskeys.AsNoTracking()
            .SingleOrDefaultAsync(p => p.OrganisationId == organisationId && p.AppId == appId && p.EndUserId == user.Id && p.CredentialId == credentialId, cancellationToken);
        return row is null ? null : Info(row);
    }

    public async Task RemovePasskeyAsync(AppEndUserRecord user, byte[] credentialId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        await db.AppEndUserPasskeys
            .Where(p => p.OrganisationId == organisationId && p.AppId == appId && p.EndUserId == user.Id && p.CredentialId == credentialId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static UserPasskeyInfo Info(AppEndUserPasskeyRecord p) => new(
        p.CredentialId, p.PublicKey, p.CreatedAt, (uint)p.SignCount, p.Transports, p.IsUserVerified, p.IsBackupEligible, p.IsBackedUp, p.AttestationObject, p.ClientDataJson)
    {
        Name = p.Name,
    };
}
