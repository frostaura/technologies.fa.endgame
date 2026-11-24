using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <summary><c>POST /internal/access/check</c>: Edge's question and the control plane's answer (PLATFORM-API §5).</summary>
public sealed record AccessCheckRequest(Guid AppId, string? Cookie, string? Path);

/// <param name="Decision"><c>allow</c>, <c>sign-in</c> or <c>deny</c>.</param>
/// <param name="SessionToken">The app-scoped token Edge sets as <c>X-Endgame-Session</c>; null for an anonymous visitor.</param>
/// <param name="SignInUrl">Null: Edge sends the visitor to the app's own <c>_endgame/auth/sign-in</c>.</param>
public sealed record AccessCheckResult(string Decision, string? SessionToken, string? SignInUrl, string? Reason = null);

/// <summary>The user an app sees (PLATFORM-API §3.1). Ids are opaque: <c>usr_</c> and 32 hex characters.</summary>
public sealed record AppUserView(string Id, string Email, string DisplayName, string Kind, string? Role);

public sealed record ResolvedAppSession(AppUserView User, DateTimeOffset ExpiresAt);

public sealed record AppShareView(string Email, DateTimeOffset InvitedAt, bool Registered);

public sealed record AppShareCreated(string Email, string InvitationCode, DateTimeOffset ExpiresAt);

/// <summary>What the platform's identity pages show for an app before anyone signs in.</summary>
public sealed record AppAuthInfo(Guid AppId, string AppName, string OrganisationName, string Access, bool SignUp, bool InvitationRequired, bool Passkey, bool DevelopmentSignIn, string Address);

public sealed record AppSignedIn(AppUserView User, string ReturnTo);

/// <summary>
/// The app identity service: who may open an app, the app-scoped sessions Edge hands to it, and the
/// app end-user population — people who register to use one app, hold no role in the organisation,
/// and can never reach the console or another app (spec, <i>Identity</i>).
/// </summary>
public sealed class AppIdentityService(
    EndgameDbContext db,
    TenantSession session,
    ScopeResolver scopes,
    AccessService access,
    CascadeService cascade,
    IDataProtectionProvider protection,
    IOptionsMonitor<CookieAuthenticationOptions> cookies,
    IOptions<IdentityPasskeyOptions> passkeys,
    IOptions<AppSessionOptions> options,
    TreeService tree,
    IServiceProvider services,
    TimeProvider clock)
{
    public const string AppCookiePrefix = "endgame.app.";
    public const string MemberCookie = "endgame.session";
    public const string CeremonyCookie = "endgame.app_auth";
    public const string CeremonyCookiePath = "/api/app-auth";
    private const string TokenPurpose = "Endgame.AppSessionToken.v1";
    private const string CeremonyPurpose = "Endgame.AppAuthCeremony.v1";
    private const string TokenPrefix = "egs_";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string AppCookieName(Guid appId) => AppCookiePrefix + appId.ToString("N");

    // ------------------------------------------------------------------ the access setting

    /// <summary>The app's access setting, resolved down the cascade: private unless some level says otherwise.</summary>
    public async Task<string> AccessOfAsync(ResolvedScope app, CancellationToken cancellationToken)
    {
        var settings = await cascade.ChainEntriesAsync(app, CascadeKind.Setting, cancellationToken);
        var entry = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.Access, settings);
        return entry is not null && JsonNode.Parse(entry.Entry.ValueJson) is JsonValue v && v.GetValueKind() == JsonValueKind.String && AppAccess.All.Contains(v.GetValue<string>())
            ? v.GetValue<string>()
            : AppAccess.Private;
    }

    // ------------------------------------------------------------------ Edge's access check

    public async Task<AccessCheckResult> CheckAsync(AccessCheckRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var app = await scopes.FindNodeAsync(NodeLevel.App, request.AppId, cancellationToken);
        if (app is null || app.Node.Status == NodeStatuses.Archived)
        {
            return new AccessCheckResult(AccessDecisions.Deny, null, null, "no such app");
        }

        if (IsPlatformPath(request.Path))
        {
            return new AccessCheckResult(AccessDecisions.Deny, null, null, "platform callbacks are never public");
        }

        var mode = await AccessOfAsync(app, cancellationToken);
        var cookieJar = ParseCookies(request.Cookie);
        var endUser = await EndUserFromCookieAsync(app, cookieJar, cancellationToken);
        var memberId = MemberFromCookie(request.Cookie);
        RoleGrant? role = null;
        if (memberId is { } member)
        {
            role = await access.EffectiveRoleAsync(member, app, cancellationToken) ?? await access.OperatorEntryAsync(member, app, cancellationToken);
        }

        var now = clock.GetUtcNow();
        var tokenUntil = now.AddMinutes(options.Value.TokenMinutes);
        if (role is not null)
        {
            return new AccessCheckResult(AccessDecisions.Allow, IssueToken(app.AppId!.Value, "member", memberId!.Value, null, tokenUntil), null);
        }

        if (endUser is { } signedIn && mode != AppAccess.Private && (mode == AppAccess.Public || await IsSharedWithAsync(app, signedIn.User.Email, cancellationToken)))
        {
            var until = signedIn.Session.ExpiresAt < tokenUntil ? signedIn.Session.ExpiresAt : tokenUntil;
            return new AccessCheckResult(AccessDecisions.Allow, IssueToken(app.AppId!.Value, "endUser", signedIn.User.Id, signedIn.Session.Id, until), null);
        }

        if (mode == AppAccess.Public)
        {
            return new AccessCheckResult(AccessDecisions.Allow, null, null);
        }

        // Someone signed in who may not open it is refused; someone not signed in is asked to.
        return memberId is not null || endUser is not null
            ? new AccessCheckResult(AccessDecisions.Deny, null, null, mode == AppAccess.Private ? "the app is private" : "the app is not shared with this person")
            : new AccessCheckResult(AccessDecisions.SignIn, null, null);
    }

    private static bool IsPlatformPath(string? path)
    {
        var p = (path ?? "").TrimStart('/');
        return p.Equals("_platform", StringComparison.OrdinalIgnoreCase) || p.StartsWith("_platform/", StringComparison.OrdinalIgnoreCase) || p.StartsWith("_platform?", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The member a console session cookie belongs to, if the cookie is valid and unexpired.</summary>
    private Guid? MemberFromCookie(string? cookieHeader)
    {
        if (string.IsNullOrEmpty(cookieHeader))
        {
            return null;
        }

        var scheme = cookies.Get(IdentityConstants.ApplicationScheme);
        var context = new DefaultHttpContext();
        context.Request.Headers.Cookie = cookieHeader;
        var value = scheme.CookieManager.GetRequestCookie(context, scheme.Cookie.Name ?? MemberCookie);
        if (string.IsNullOrEmpty(value) || scheme.TicketDataFormat.Unprotect(value) is not { } ticket)
        {
            return null;
        }

        if (ticket.Properties.ExpiresUtc is { } expires && expires < clock.GetUtcNow())
        {
            return null;
        }

        return Guid.TryParse(ticket.Principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
    }

    private sealed record SignedInEndUser(AppEndUserRecord User, AppSessionRecord Session);

    private async Task<SignedInEndUser?> EndUserFromCookieAsync(ResolvedScope app, IReadOnlyDictionary<string, string> jar, CancellationToken cancellationToken)
    {
        if (!jar.TryGetValue(AppCookieName(app.AppId!.Value), out var token) || token.Length is 0 or > 200)
        {
            return null;
        }

        var hash = AppTokenService.Hash(token);
        var now = clock.GetUtcNow();
        session.UseOrganisation(app.OrganisationId);
        var found = await (from s in db.AppSessions.AsNoTracking()
                           join u in db.AppEndUsers.AsNoTracking() on new { s.OrganisationId, Id = s.EndUserId } equals new { u.OrganisationId, u.Id }
                           where s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && s.TokenHash == hash && s.RevokedAt == null && s.ExpiresAt > now
                           select new { Session = s, User = u }).SingleOrDefaultAsync(cancellationToken);
        return found is null ? null : new SignedInEndUser(found.User, found.Session);
    }

    private async Task<bool> IsSharedWithAsync(ResolvedScope app, string email, CancellationToken cancellationToken) =>
        await db.AppShares.AsNoTracking().AnyAsync(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && s.Email == email, cancellationToken);

    public static IReadOnlyDictionary<string, string> ParseCookies(string? header)
    {
        var jar = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in (header ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var eq = part.IndexOf('=', StringComparison.Ordinal);
            if (eq > 0)
            {
                jar.TryAdd(part[..eq].Trim(), part[(eq + 1)..].Trim().Trim('"'));
            }
        }

        return jar;
    }

    // ------------------------------------------------------------------ app-scoped session tokens

    private sealed record TokenPayload(Guid A, string K, Guid U, Guid? S);

    /// <summary>An app-scoped token: sealed, time-limited, naming one app — never a browser cookie, so an app cannot replay it against the console.</summary>
    private string IssueToken(Guid appId, string kind, Guid subject, Guid? sessionId, DateTimeOffset until)
    {
        var payload = JsonSerializer.Serialize(new TokenPayload(appId, kind, subject, sessionId), Json);
        return TokenPrefix + protection.CreateProtector(TokenPurpose).ToTimeLimitedDataProtector().Protect(payload, until);
    }

    /// <summary><c>identity/resolve</c>: who an app-scoped token stands for, now. Null when it is invalid, expired, for another app, or no longer admitted.</summary>
    public async Task<ResolvedAppSession?> ResolveAsync(AppCaller caller, string? token, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        if (token is null || !token.StartsWith(TokenPrefix, StringComparison.Ordinal) || token.Length > 4096)
        {
            return null;
        }

        TokenPayload? payload;
        DateTimeOffset expires;
        try
        {
            var text = protection.CreateProtector(TokenPurpose).ToTimeLimitedDataProtector().Unprotect(token[TokenPrefix.Length..], out expires);
            payload = JsonSerializer.Deserialize<TokenPayload>(text, Json);
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or FormatException)
        {
            return null;
        }

        if (payload is null || payload.A != caller.AppId)
        {
            return null;
        }

        var app = caller.Scope;
        session.UseOrganisation(app.OrganisationId);
        if (payload.K == "member")
        {
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == payload.U, cancellationToken);
            var role = user is null ? null : await access.EffectiveRoleAsync(user.Id, app, cancellationToken)
                ?? (await access.IsOperatorAsync(user.Id, cancellationToken) ? new RoleGrant(user.Id, MemberRole.Admin, NodeLevel.Organisation, app.OrganisationId, app.Nodes[0].Path) : null);
            return user is null || role is null
                ? null
                : new ResolvedAppSession(new AppUserView(UserId(user.Id), user.Email ?? "", user.DisplayName, "member", role.Role.ToWire()), expires);
        }

        if (payload.K != "endUser")
        {
            return null;
        }

        var endUser = await db.AppEndUsers.AsNoTracking().SingleOrDefaultAsync(u => u.OrganisationId == app.OrganisationId && u.AppId == caller.AppId && u.Id == payload.U, cancellationToken);
        if (endUser is null)
        {
            return null;
        }

        var now = clock.GetUtcNow();
        if (payload.S is { } sid && !await db.AppSessions.AsNoTracking().AnyAsync(s => s.OrganisationId == app.OrganisationId && s.Id == sid && s.RevokedAt == null && s.ExpiresAt > now, cancellationToken))
        {
            return null;
        }

        var mode = await AccessOfAsync(app, cancellationToken);
        if (mode == AppAccess.Private || (mode == AppAccess.Shared && !await IsSharedWithAsync(app, endUser.Email, cancellationToken)))
        {
            return null;
        }

        return new ResolvedAppSession(new AppUserView(UserId(endUser.Id), endUser.Email, endUser.DisplayName, "endUser", null), expires);
    }

    public static string UserId(Guid id) => "usr_" + id.ToString("N");

    // ------------------------------------------------------------------ sharing

    public async Task<IReadOnlyList<AppShareView>> SharesAsync(ResolvedScope app, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var shares = await db.AppShares.AsNoTracking().Where(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId).OrderBy(s => s.Email).ToListAsync(cancellationToken);
        var registered = await db.AppEndUsers.AsNoTracking().Where(u => u.OrganisationId == app.OrganisationId && u.AppId == app.AppId).Select(u => u.Email).ToListAsync(cancellationToken);
        return shares.Select(s => new AppShareView(s.Email, s.InvitedAt, registered.Contains(s.Email))).ToList();
    }

    public async Task<int> ShareCountAsync(Guid organisationId, Guid appId, CancellationToken cancellationToken) =>
        await db.AppShares.AsNoTracking().CountAsync(s => s.OrganisationId == organisationId && s.AppId == appId, cancellationToken);

    /// <summary>Shares the app with an address and returns a one-time code the person registers with (stored only as a hash).</summary>
    public async Task<AppShareCreated> ShareAsync(ResolvedScope app, string email, Guid by, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var address = AccountService.NormaliseEmail(email);
        var code = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var expires = clock.GetUtcNow().AddDays(options.Value.InvitationDays);
        var row = await db.AppShares.SingleOrDefaultAsync(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && s.Email == address, cancellationToken);
        if (row is null)
        {
            row = new AppShareRecord { Id = Guid.NewGuid(), OrganisationId = app.OrganisationId, AppId = app.AppId!.Value, Email = address };
            db.AppShares.Add(row);
        }

        row.InvitationCodeHash = AppTokenService.Hash(code);
        row.InvitationExpiresAt = expires;
        row.InvitedBy = by;
        row.InvitedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return new AppShareCreated(address, code, expires);
    }

    /// <summary>Stops sharing: the person's sessions end and the app no longer admits them.</summary>
    public async Task<bool> UnshareAsync(ResolvedScope app, string email, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var address = (email ?? "").Trim().ToLowerInvariant();
        var removed = await db.AppShares.Where(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && s.Email == address).ExecuteDeleteAsync(cancellationToken);
        var now = clock.GetUtcNow();
        var users = db.AppEndUsers.Where(u => u.OrganisationId == app.OrganisationId && u.AppId == app.AppId && u.Email == address).Select(u => u.Id);
        await db.AppSessions.Where(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && users.Contains(s.EndUserId) && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), cancellationToken);
        return removed > 0;
    }

    // ------------------------------------------------------------------ the identity pages' API

    public async Task<(ResolvedScope App, string Access)> AppForSignInAsync(Guid appId, CancellationToken cancellationToken)
    {
        var app = await scopes.FindNodeAsync(NodeLevel.App, appId, cancellationToken);
        if (app is null || app.Node.Status == NodeStatuses.Archived)
        {
            throw EndgameProblem.NotFound("The app");
        }

        return (app, await AccessOfAsync(app, cancellationToken));
    }

    public async Task<AppAuthInfo> InfoAsync(Guid appId, bool developmentSignIn, CancellationToken cancellationToken)
    {
        var (app, mode) = await AppForSignInAsync(appId, cancellationToken);
        return new AppAuthInfo(app.AppId!.Value, app.Node.Name, app.Nodes[0].Name, mode, mode != AppAccess.Private, mode == AppAccess.Shared, true, developmentSignIn, tree.Addresses(app.Path).Path);
    }

    private sealed record Ceremony(Guid AppId, string Kind, Guid? EndUserId, string? Email, string? DisplayName, string State, string? ReturnTo);

    /// <summary>Starts registering a new end user with a passkey. Private apps take no end users; shared ones only invited addresses, with their code.</summary>
    public async Task<string> SignUpOptionsAsync(HttpContext http, Guid appId, string? email, string? displayName, string? invitationCode, string? returnTo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var (app, mode) = await AppForSignInAsync(appId, cancellationToken);
        var address = AccountService.NormaliseEmail(email);
        await RequireMaySignUpAsync(app, mode, address, invitationCode, consumeCode: false, cancellationToken);
        if (await db.AppEndUsers.AsNoTracking().AnyAsync(u => u.OrganisationId == app.OrganisationId && u.AppId == appId && u.Email == address, cancellationToken))
        {
            throw EndgameProblem.Conflict("That address is already registered with this app; sign in instead.");
        }

        var name = AccountService.DisplayName(displayName, address);
        var userId = Guid.NewGuid();
        var options = await Handler(app).MakeCreationOptionsAsync(new PasskeyUserEntity { Id = userId.ToString(), Name = address, DisplayName = name }, http);
        WriteCeremony(http, new Ceremony(appId, "sign-up", userId, address, name, Stateful(options.AttestationState), returnTo));
        return options.CreationOptionsJson;
    }

    public async Task<AppSignedIn> SignUpCompleteAsync(HttpContext http, Guid appId, string credentialJson, string? invitationCode, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var ceremony = ReadCeremony(http, appId, "sign-up");
        var (app, mode) = await AppForSignInAsync(appId, cancellationToken);
        var attestation = await Handler(app).PerformAttestationAsync(new PasskeyAttestationContext
        {
            CredentialJson = credentialJson,
            AttestationState = ceremony.State,
            HttpContext = http,
        });
        if (!attestation.Succeeded)
        {
            throw new EndgameProblem(400, "passkey_rejected", "The passkey was not accepted", attestation.Failure.Message);
        }

        if (!string.Equals(attestation.UserEntity.Id, ceremony.EndUserId?.ToString(), StringComparison.Ordinal))
        {
            throw EndgameProblem.Forbidden("The passkey was not created for this registration.");
        }

        await RequireMaySignUpAsync(app, mode, ceremony.Email!, invitationCode, consumeCode: true, cancellationToken);
        var user = new AppEndUserRecord
        {
            Id = ceremony.EndUserId!.Value,
            OrganisationId = app.OrganisationId,
            AppId = appId,
            Email = ceremony.Email!,
            DisplayName = ceremony.DisplayName!,
            CreatedAt = clock.GetUtcNow(),
        };
        db.AppEndUsers.Add(user);
        await new AppEndUserStore(db, app.OrganisationId, appId).AddOrUpdatePasskeyAsync(user, attestation.Passkey, cancellationToken);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            throw EndgameProblem.Conflict("That address is already registered with this app; sign in instead.");
        }

        db.ChangeTracker.Clear();
        return await StartSessionAsync(http, app, user, ceremony.ReturnTo, cancellationToken);
    }

    /// <summary>Starts signing an end user in with a passkey; with no address, any passkey registered for this app may answer.</summary>
    public async Task<string> SignInOptionsAsync(HttpContext http, Guid appId, string? email, string? returnTo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var (app, _) = await AppForSignInAsync(appId, cancellationToken);
        var address = email?.Trim().ToLowerInvariant();
        var user = string.IsNullOrEmpty(address) ? null : await db.AppEndUsers.AsNoTracking().SingleOrDefaultAsync(u => u.OrganisationId == app.OrganisationId && u.AppId == appId && u.Email == address, cancellationToken);
        var options = await Handler(app).MakeRequestOptionsAsync(user, http);
        WriteCeremony(http, new Ceremony(appId, "sign-in", null, null, null, Stateful(options.AssertionState), returnTo));
        return options.RequestOptionsJson;
    }

    public async Task<AppSignedIn> SignInCompleteAsync(HttpContext http, Guid appId, string credentialJson, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var ceremony = ReadCeremony(http, appId, "sign-in");
        var (app, mode) = await AppForSignInAsync(appId, cancellationToken);
        var assertion = await Handler(app).PerformAssertionAsync(new PasskeyAssertionContext
        {
            CredentialJson = credentialJson,
            AssertionState = ceremony.State,
            HttpContext = http,
        });
        if (!assertion.Succeeded)
        {
            throw new EndgameProblem(401, "passkey_rejected", "Sign-in failed", "That passkey could not be verified for this app.");
        }

        var user = assertion.User;
        await new AppEndUserStore(db, app.OrganisationId, appId).AddOrUpdatePasskeyAsync(user, assertion.Passkey, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await RequireMayOpenAsync(app, mode, user.Email, cancellationToken);
        return await StartSessionAsync(http, app, user, ceremony.ReturnTo, cancellationToken);
    }

    /// <summary>
    /// Development only (the same gate as members' development sign-in): signs an end user in with
    /// no passkey, creating them if new — still only where the app's access setting admits them.
    /// </summary>
    public async Task<AppSignedIn> DevelopmentSignInAsync(HttpContext http, Guid appId, string? email, string? displayName, string? returnTo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var (app, mode) = await AppForSignInAsync(appId, cancellationToken);
        var address = AccountService.NormaliseEmail(email);
        await RequireMayOpenAsync(app, mode, address, cancellationToken);
        var user = await db.AppEndUsers.SingleOrDefaultAsync(u => u.OrganisationId == app.OrganisationId && u.AppId == appId && u.Email == address, cancellationToken);
        if (user is null)
        {
            user = new AppEndUserRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = app.OrganisationId,
                AppId = appId,
                Email = address,
                DisplayName = AccountService.DisplayName(displayName, address),
                CreatedAt = clock.GetUtcNow(),
            };
            db.AppEndUsers.Add(user);
            await db.SaveChangesAsync(cancellationToken);
        }

        db.ChangeTracker.Clear();
        return await StartSessionAsync(http, app, user, returnTo, cancellationToken);
    }

    /// <summary>Ends the end user's session at this app and clears its cookie.</summary>
    public async Task SignOutAsync(HttpContext http, Guid appId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        var name = AppCookieName(appId);
        if (http.Request.Cookies.TryGetValue(name, out var token) && token.Length is > 0 and <= 200
            && await scopes.FindNodeAsync(NodeLevel.App, appId, cancellationToken) is { } app)
        {
            var hash = AppTokenService.Hash(token);
            var now = clock.GetUtcNow();
            await db.AppSessions.Where(s => s.OrganisationId == app.OrganisationId && s.AppId == appId && s.TokenHash == hash && s.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), cancellationToken);
        }

        http.Response.Cookies.Delete(name, CookieOptions(http, null));
    }

    /// <summary>Every app session cookie the request carries, revoked and cleared (the console's sign-out calls this too).</summary>
    public async Task SignOutEverywhereAsync(HttpContext http, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);
        foreach (var name in http.Request.Cookies.Keys.Where(k => k.StartsWith(AppCookiePrefix, StringComparison.Ordinal)).ToList())
        {
            if (Guid.TryParseExact(name[AppCookiePrefix.Length..], "N", out var appId))
            {
                await SignOutAsync(http, appId, cancellationToken);
            }
        }
    }

    private async Task RequireMaySignUpAsync(ResolvedScope app, string mode, string email, string? invitationCode, bool consumeCode, CancellationToken cancellationToken)
    {
        if (mode == AppAccess.Private)
        {
            throw EndgameProblem.Forbidden("This app is private: only members of the organisation with rights over it can open it.");
        }

        if (mode != AppAccess.Shared)
        {
            return;
        }

        var share = await db.AppShares.SingleOrDefaultAsync(s => s.OrganisationId == app.OrganisationId && s.AppId == app.AppId && s.Email == email, cancellationToken);
        var valid = share?.InvitationCodeHash is { } hash && share.InvitationExpiresAt > clock.GetUtcNow() && !string.IsNullOrWhiteSpace(invitationCode)
            && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(hash), SHA256.HashData(Encoding.UTF8.GetBytes(invitationCode.Trim())));
        if (!valid)
        {
            db.ChangeTracker.Clear();
            throw EndgameProblem.Forbidden("This app is shared with chosen people: register with the address it was shared with and the invitation code you were given.");
        }

        if (consumeCode)
        {
            share!.InvitationCodeHash = null;
            share.InvitationExpiresAt = null;
        }
    }

    private async Task RequireMayOpenAsync(ResolvedScope app, string mode, string email, CancellationToken cancellationToken)
    {
        if (mode == AppAccess.Private)
        {
            throw EndgameProblem.Forbidden("This app is private: only members of the organisation with rights over it can open it.");
        }

        if (mode == AppAccess.Shared && !await IsSharedWithAsync(app, email, cancellationToken))
        {
            throw EndgameProblem.Forbidden("This app is not shared with that address.");
        }
    }

    private async Task<AppSignedIn> StartSessionAsync(HttpContext http, ResolvedScope app, AppEndUserRecord user, string? returnTo, CancellationToken cancellationToken)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var now = clock.GetUtcNow();
        var expires = now.AddDays(options.Value.SessionDays);
        session.UseOrganisation(app.OrganisationId);
        db.AppSessions.Add(new AppSessionRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = app.OrganisationId,
            AppId = app.AppId!.Value,
            EndUserId = user.Id,
            TokenHash = AppTokenService.Hash(token),
            CreatedAt = now,
            ExpiresAt = expires,
        });
        await db.AppEndUsers.Where(u => u.OrganisationId == app.OrganisationId && u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.LastSignInAt, now), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        http.Response.Cookies.Append(AppCookieName(app.AppId.Value), token, CookieOptions(http, expires));
        return new AppSignedIn(new AppUserView(UserId(user.Id), user.Email, user.DisplayName, "endUser", null), SafeReturnTo(app, returnTo));
    }

    private CookieOptions CookieOptions(HttpContext http, DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = http.Request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        Expires = expires,
        Domain = string.IsNullOrWhiteSpace(options.Value.CookieDomain) ? null : options.Value.CookieDomain,
    };

    /// <summary>Only an address inside this app (either address shape) is a place to return to; anything else returns to the app's home.</summary>
    public string SafeReturnTo(ResolvedScope app, string? returnTo)
    {
        ArgumentNullException.ThrowIfNull(app);
        var addresses = tree.Addresses(app.Path);
        if (string.IsNullOrWhiteSpace(returnTo) || returnTo.Any(char.IsControl) || returnTo.Contains('\\', StringComparison.Ordinal) || returnTo.Contains("/../", StringComparison.Ordinal))
        {
            return addresses.Path;
        }

        if (Uri.TryCreate(returnTo, UriKind.Absolute, out var absolute) && absolute.Scheme is "https" or "http")
        {
            foreach (var home in new[] { addresses.Path, addresses.Subdomain })
            {
                var root = new Uri(home);
                if (string.Equals(absolute.Host, root.Host, StringComparison.OrdinalIgnoreCase) && absolute.AbsolutePath.StartsWith(root.AbsolutePath, StringComparison.Ordinal))
                {
                    return absolute.ToString();
                }
            }

            return addresses.Path;
        }

        var pathBase = new Uri(addresses.Path).AbsolutePath;
        return returnTo.StartsWith(pathBase, StringComparison.Ordinal) && !returnTo.StartsWith("//", StringComparison.Ordinal) ? returnTo : addresses.Path;
    }

    private void WriteCeremony(HttpContext http, Ceremony ceremony) =>
        http.Response.Cookies.Append(CeremonyCookie, protection.CreateProtector(CeremonyPurpose).ToTimeLimitedDataProtector().Protect(JsonSerializer.Serialize(ceremony, Json), TimeSpan.FromMinutes(5)), new CookieOptions
        {
            HttpOnly = true,
            Secure = http.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            MaxAge = TimeSpan.FromMinutes(5),
            Path = CeremonyCookiePath,
        });

    private Ceremony ReadCeremony(HttpContext http, Guid appId, string kind)
    {
        if (!http.Request.Cookies.TryGetValue(CeremonyCookie, out var sealedState))
        {
            throw EndgameProblem.Invalid("No passkey ceremony is under way for this app; ask for options first.");
        }

        http.Response.Cookies.Delete(CeremonyCookie, new CookieOptions { Path = CeremonyCookiePath });
        Ceremony? ceremony;
        try
        {
            ceremony = JsonSerializer.Deserialize<Ceremony>(protection.CreateProtector(CeremonyPurpose).ToTimeLimitedDataProtector().Unprotect(sealedState), Json);
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            throw EndgameProblem.Invalid("The passkey ceremony has expired or is not valid; start again.");
        }

        return ceremony is not null && ceremony.AppId == appId && ceremony.Kind == kind
            ? ceremony
            : throw EndgameProblem.Invalid("The passkey ceremony under way is for something else; start again.");
    }

    private static string Stateful(string? state) => state ?? throw new InvalidOperationException("The passkey handler returned no ceremony state.");

    /// <summary>Identity's own passkey handler, over a store confined to this app.</summary>
    private PasskeyHandler<AppEndUserRecord> Handler(ResolvedScope app)
    {
        var store = new AppEndUserStore(db, app.OrganisationId, app.AppId!.Value);
        var manager = new UserManager<AppEndUserRecord>(
            store,
            Options.Create(new IdentityOptions()),
            new PasswordHasher<AppEndUserRecord>(),
            [],
            [],
            new UpperInvariantLookupNormalizer(),
            new IdentityErrorDescriber(),
            services,
            services.GetRequiredService<Microsoft.Extensions.Logging.ILogger<UserManager<AppEndUserRecord>>>());
        return new PasskeyHandler<AppEndUserRecord>(manager, passkeys);
    }
}

/// <summary>The three answers an access check gives (PLATFORM-API §5; Edge's <c>AccessDecisions</c>).</summary>
public static class AccessDecisions
{
    public const string Allow = "allow";
    public const string SignIn = "sign-in";
    public const string Deny = "deny";
}
