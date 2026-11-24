using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;

namespace Endgame.ControlPlane.Endpoints;

public sealed record RegisterOptionsRequest(string? Email, string? DisplayName, string? InvitationCode);

public sealed record CredentialRequest(JsonNode? Credential);

public sealed record LoginOptionsRequest(string? Email);

/// <summary>Optional: with no body the development user from <c>ENDGAME_DEV_USER_EMAIL</c> is signed in.</summary>
public sealed record DevLoginRequest(string? Email, string? DisplayName);

public sealed record UserRef(Guid Id, string DisplayName, string? Email);

public sealed record OrganisationRef(Guid Id, string Slug, string Name);

/// <summary>
/// <c>GET /api/me</c>. <c>organisation</c> is the organisation the console opens (the first one the
/// person belongs to), or null on first run, before any organisation exists.
/// </summary>
public sealed record MeView(UserRef User, OrganisationRef? Organisation, bool IsOperator, int Passkeys, IReadOnlyList<MembershipView> Memberships);

public sealed record AuthOptionsView(bool Passkey, bool DevelopmentSignIn);

/// <summary>
/// Sign-in (ARCH-004, <i>Session</i>): ASP.NET Core Identity's own passkey support, a cookie session,
/// and <c>GET /api/me</c>. Registration spans two requests; what it is for (the first organisation, an
/// invitation, or another passkey on a signed-in account) is kept between them in a cookie only the
/// server can read, and checked against the attestation's user before anything is stored.
/// </summary>
internal static class AuthEndpoints
{
    private const string RegistrationCookie = "endgame.registration";
    private const string RegistrationPurpose = "Endgame.PasskeyRegistration.v1";

    public const string DevelopmentRoute = "/auth/development";

    private sealed record Registration(Guid UserId, string Email, string DisplayName, string Kind);

    public static bool DevelopmentSignInEnabled(IWebHostEnvironment environment, IConfiguration configuration) =>
        environment.IsDevelopment() && string.Equals(configuration["ENDGAME_DEV_LOGIN"], "true", StringComparison.OrdinalIgnoreCase);

    public static void MapAuth(this RouteGroupBuilder api, IWebHostEnvironment environment, IConfiguration configuration)
    {
        var auth = api.MapGroup("/auth").WithTags("Session");
        var development = DevelopmentSignInEnabled(environment, configuration);
        auth.MapGet("/options", () => Results.Ok(new AuthOptionsView(true, development)))
            .WithName("GetAuthOptions").WithSummary("Which sign-in methods this deployment offers. Readable signed out.").Produces<AuthOptionsView>();

        auth.MapPost("/passkey/register/options", async (RegisterOptionsRequest request, HttpContext http, SignInManager<EndgameUser> signIn, UserManager<EndgameUser> users,
            AccountService accounts, IDataProtectionProvider protection, CancellationToken ct) =>
        {
            Registration registration;
            if (http.User.Identity?.IsAuthenticated == true && await users.GetUserAsync(http.User) is { } current)
            {
                registration = new(current.Id, current.Email!, current.DisplayName, "add");
            }
            else if (await accounts.IsFreshInstallAsync(ct))
            {
                var email = AccountService.NormaliseEmail(request.Email);
                registration = new(Guid.NewGuid(), email, AccountService.DisplayName(request.DisplayName, email), "first");
            }
            else if (request.InvitationCode is { Length: > 0 } code)
            {
                var email = AccountService.NormaliseEmail(request.Email);
                var invited = await accounts.FindInvitedAsync(email, code, ct)
                    ?? throw EndgameProblem.Forbidden("That invitation code is not valid for this e-mail address, or it has expired.");
                registration = new(invited.Id, email, invited.DisplayName, "invitation");
            }
            else
            {
                throw EndgameProblem.Forbidden("Endgame is invite-only. Sign in, or register with the invitation code you were sent.");
            }

            var options = await signIn.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity
            {
                Id = registration.UserId.ToString(),
                Name = registration.Email,
                DisplayName = registration.DisplayName,
            });
            http.Response.Cookies.Append(RegistrationCookie, protection.CreateProtector(RegistrationPurpose).Protect(JsonSerializer.Serialize(registration)), new CookieOptions
            {
                HttpOnly = true,
                Secure = http.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                MaxAge = TimeSpan.FromMinutes(5),
                Path = "/api/auth/passkey/register",
            });
            return Results.Content($"{{\"publicKey\":{options}}}", "application/json");
        })
        .WithName("PasskeyRegisterOptions")
        .WithSummary("Starts registering a passkey: for the first organisation's Owner, an invited person, or another passkey on the signed-in account.");

        auth.MapPost("/passkey/register/complete", async (CredentialRequest request, HttpContext http, SignInManager<EndgameUser> signIn, UserManager<EndgameUser> users,
            AccountService accounts, AccessService access, IDataProtectionProvider protection, CancellationToken ct) =>
        {
            if (!http.Request.Cookies.TryGetValue(RegistrationCookie, out var sealedState))
            {
                throw EndgameProblem.Invalid("No passkey registration is under way; ask for registration options first.");
            }

            http.Response.Cookies.Delete(RegistrationCookie, new CookieOptions { Path = "/api/auth/passkey/register" });
            Registration registration;
            try
            {
                registration = JsonSerializer.Deserialize<Registration>(protection.CreateProtector(RegistrationPurpose).Unprotect(sealedState))!;
            }
            catch (System.Security.Cryptography.CryptographicException)
            {
                throw EndgameProblem.Invalid("The registration state is not valid; start again.");
            }

            var attestation = await signIn.PerformPasskeyAttestationAsync(Caller.CredentialJson(request.Credential));
            if (!attestation.Succeeded)
            {
                throw new EndgameProblem(400, "passkey_rejected", "The passkey was not accepted", attestation.Failure.Message);
            }

            if (!string.Equals(attestation.UserEntity.Id, registration.UserId.ToString(), StringComparison.Ordinal))
            {
                throw EndgameProblem.Forbidden("The passkey was not created for this registration.");
            }

            var user = registration.Kind switch
            {
                "first" => await accounts.CreateFirstUserAsync(registration.UserId, registration.Email, registration.DisplayName, ct),
                _ => await users.FindByIdAsync(registration.UserId.ToString()) ?? throw EndgameProblem.NotFound("The account"),
            };
            var stored = await users.AddOrUpdatePasskeyAsync(user, attestation.Passkey);
            if (!stored.Succeeded)
            {
                throw EndgameProblem.Conflict(string.Join(" ", stored.Errors.Select(e => e.Description)));
            }

            if (registration.Kind == "invitation")
            {
                await accounts.ClearInvitationAsync(user);
            }

            await signIn.SignInAsync(user, isPersistent: true);
            return Results.Ok(await MeAsync(user, users, access, ct));
        })
        .WithName("PasskeyRegisterComplete")
        .WithSummary("Finishes registering a passkey and signs in.")
        .Produces<MeView>();

        auth.MapPost("/passkey/login/options", async (LoginOptionsRequest request, SignInManager<EndgameUser> signIn, UserManager<EndgameUser> users) =>
        {
            // An unknown e-mail gets the same answer as none at all, so accounts cannot be probed.
            var user = string.IsNullOrWhiteSpace(request.Email) ? null : await users.FindByEmailAsync(request.Email.Trim().ToLowerInvariant());
            return Results.Content($"{{\"publicKey\":{await signIn.MakePasskeyRequestOptionsAsync(user)}}}", "application/json");
        })
        .WithName("PasskeyLoginOptions")
        .WithSummary("Starts signing in with a passkey.");

        auth.MapPost("/passkey/login/complete", async (CredentialRequest request, SignInManager<EndgameUser> signIn, UserManager<EndgameUser> users, AccessService access, CancellationToken ct) =>
        {
            var credential = Caller.CredentialJson(request.Credential);
            var assertion = await signIn.PerformPasskeyAssertionAsync(credential);
            if (!assertion.Succeeded)
            {
                throw new EndgameProblem(401, "passkey_rejected", "Sign-in failed", "That passkey could not be verified.");
            }

            await users.AddOrUpdatePasskeyAsync(assertion.User, assertion.Passkey);
            await signIn.SignInAsync(assertion.User, isPersistent: true);
            return Results.Ok(await MeAsync(assertion.User, users, access, ct));
        })
        .WithName("PasskeyLoginComplete")
        .WithSummary("Finishes signing in with a passkey.")
        .Produces<MeView>();

        auth.MapPost("/logout", async (SignInManager<EndgameUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        })
        .WithName("Logout")
        .WithSummary("Ends the session.");

        api.MapGet("/me", async (HttpContext http, UserManager<EndgameUser> users, AccessService access, CancellationToken ct) =>
            await users.GetUserAsync(http.User) is { } user
                ? Results.Ok(await MeAsync(user, users, access, ct))
                : Problems.From(EndgameProblem.Unauthenticated()))
        .RequireAuthorization()
        .WithTags("Session")
        .WithName("GetMe")
        .WithSummary("Who is signed in, and every role they hold and where.")
        .Produces<MeView>();
    }

    /// <summary>
    /// Development-only sign-in for unattended end-to-end tests and browser walks, which cannot approve
    /// a passkey. Mapped only when the environment is Development AND <c>ENDGAME_DEV_LOGIN=true</c>;
    /// in any other configuration the route does not exist at all.
    /// </summary>
    public static bool MapDevLoginIfEnabled(this RouteGroupBuilder api, IWebHostEnvironment environment, IConfiguration configuration)
    {
        if (!DevelopmentSignInEnabled(environment, configuration))
        {
            return false;
        }

        api.MapPost(DevelopmentRoute, async (DevLoginRequest? request, SignInManager<EndgameUser> signIn, UserManager<EndgameUser> users,
            AccountService accounts, AccessService access, CancellationToken ct) =>
        {
            var email = AccountService.NormaliseEmail(request?.Email ?? configuration["ENDGAME_DEV_USER_EMAIL"] ?? "dev@frostaura.net");
            var user = await users.FindByEmailAsync(email)
                ?? (await accounts.IsFreshInstallAsync(ct)
                    ? await accounts.CreateFirstUserAsync(Guid.NewGuid(), email, AccountService.DisplayName(request?.DisplayName ?? "Development owner", email), ct)
                    : await accounts.FindOrCreateAsync(email, request?.DisplayName, ct));
            await signIn.SignInAsync(user, isPersistent: false);
            return Results.Ok(await MeAsync(user, users, access, ct));
        })
        .WithTags("Session")
        .WithName("DevelopmentSignIn")
        .WithSummary("Development only: signs in a named user without a passkey. Not mapped in any other configuration.")
        .Produces<MeView>();
        return true;
    }

    public static async Task<MeView> MeAsync(EndgameUser user, UserManager<EndgameUser> users, AccessService access, CancellationToken ct)
    {
        var memberships = await access.MembershipsOfAsync(user.Id, ct);
        var first = memberships.OrderBy(m => m.Level == "organisation" ? 0 : 1).FirstOrDefault();
        return new MeView(
            new UserRef(user.Id, user.DisplayName, user.Email),
            first is null ? null : new OrganisationRef(first.OrganisationId, first.OrganisationSlug, first.OrganisationName),
            access.IsOperator(user),
            (await users.GetPasskeysAsync(user)).Count,
            memberships);
    }
}
