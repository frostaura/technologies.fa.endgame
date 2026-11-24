using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Platform;

namespace Endgame.ControlPlane.Endpoints;

public sealed record AppSignUpOptionsRequest(string? Email, string? DisplayName, string? InvitationCode, string? ReturnTo);

public sealed record AppSignUpCompleteRequest(JsonNode? Credential, string? InvitationCode);

public sealed record AppSignInOptionsRequest(string? Email, string? ReturnTo);

public sealed record AppCredentialRequest(JsonNode? Credential);

public sealed record AppHandoffRequest(string? ReturnTo);

public sealed record AppDevelopmentSignInRequest(string? Email, string? DisplayName, string? ReturnTo);

/// <summary>
/// <c>/api/app-auth/{appId}/*</c> — what the organisation's identity pages call when Edge sends a
/// visitor to sign in or sign up at an app (PLATFORM-API §5.4). End users register with a passkey
/// (the same development-only sign-in gate as members), get a session cookie for that one app
/// (<c>endgame.app.&lt;app id, 32 hex&gt;</c>), and are sent back to a <c>returnTo</c> inside the app's
/// own address. Members sign in through the console's own sign-in; their session counts here too.
/// </summary>
internal static class AppAuthEndpoints
{
    public static void MapAppAuth(this RouteGroupBuilder api, IWebHostEnvironment environment, IConfiguration configuration)
    {
        var development = AuthEndpoints.DevelopmentSignInEnabled(environment, configuration);
        var auth = api.MapGroup("/app-auth/{appId:guid}").WithTags("App sign-in");

        auth.MapGet("", async (Guid appId, AppIdentityService identity, CancellationToken ct) =>
            Results.Ok(await identity.InfoAsync(appId, development, ct)))
            .WithName("GetAppAuth").WithSummary("What the identity pages show for an app: its name, organisation, access setting and whether it takes sign-ups (and with an invitation code).")
            .Produces<AppAuthInfo>();

        auth.MapPost("/sign-up/options", async (Guid appId, AppSignUpOptionsRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
            Results.Content($"{{\"publicKey\":{await identity.SignUpOptionsAsync(http, appId, request.Email, request.DisplayName, request.InvitationCode, request.ReturnTo, ct)}}}", "application/json"))
            .WithName("AppSignUpOptions").WithSummary("Starts registering an end user with a passkey. Private apps refuse; shared apps need the address they were shared with and its invitation code.");

        auth.MapPost("/sign-up/complete", async (Guid appId, AppSignUpCompleteRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
            Results.Ok(await identity.SignUpCompleteAsync(http, appId, Caller.CredentialJson(request.Credential), request.InvitationCode, ct)))
            .WithName("AppSignUpComplete").WithSummary("Finishes registering, signs the end user in to this app (cookie), and returns where to send them.")
            .Produces<AppSignedIn>();

        auth.MapPost("/sign-in/options", async (Guid appId, AppSignInOptionsRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
            Results.Content($"{{\"publicKey\":{await identity.SignInOptionsAsync(http, appId, request.Email, request.ReturnTo, ct)}}}", "application/json"))
            .WithName("AppSignInOptions").WithSummary("Starts an end user's passkey sign-in at this app.");

        auth.MapPost("/sign-in/complete", async (Guid appId, AppCredentialRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
            Results.Ok(await identity.SignInCompleteAsync(http, appId, Caller.CredentialJson(request.Credential), ct)))
            .WithName("AppSignInComplete").WithSummary("Finishes an end user's passkey sign-in; a passkey registered for another app never signs anyone in here.")
            .Produces<AppSignedIn>();

        auth.MapPost("/handoff", async (Guid appId, AppHandoffRequest request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
        {
            Guid? member = http.User.Identity?.IsAuthenticated == true && Guid.TryParse(http.User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier), out var id) ? id : null;
            return Results.Ok(new { url = await identity.HandoffAsync(http, appId, member, request.ReturnTo, ct) });
        })
        .WithName("AppHandoff").WithSummary("Carries the visitor's session (member or end user) to the app's organisation-subdomain address: a one-time link, valid for a minute, that Edge redeems there.");

        auth.MapPost("/sign-out", async (Guid appId, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
        {
            await identity.SignOutAsync(http, appId, ct);
            return Results.NoContent();
        })
        .WithName("AppSignOut").WithSummary("Ends the end user's session at this app.");

        if (development)
        {
            auth.MapPost("/development", async (Guid appId, AppDevelopmentSignInRequest? request, HttpContext http, AppIdentityService identity, CancellationToken ct) =>
                Results.Ok(await identity.DevelopmentSignInAsync(http, appId, request?.Email, request?.DisplayName, request?.ReturnTo, ct)))
                .WithName("AppDevelopmentSignIn").WithSummary("Development only: signs an end user in with no passkey, where the app's access admits them. Not mapped in any other configuration.")
                .Produces<AppSignedIn>();
        }
    }
}
