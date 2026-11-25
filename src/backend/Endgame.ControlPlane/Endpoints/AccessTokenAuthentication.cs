using System.Security.Claims;
using System.Text.Encodings.Web;
using Endgame.Infrastructure.Access;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Endgame.ControlPlane.Endpoints;

/// <summary>
/// Authenticates an MCP client by a personal access token sent as <c>Authorization: Bearer egp_…</c>.
/// Used only by the <c>/mcp</c> endpoints' policy, never by <c>/api</c>, so a token cannot stand in
/// for a person at the console. On success the request's <see cref="CallerCeiling"/> is set, and
/// every access check in the request is held to the token's organisation and role.
/// </summary>
internal sealed class AccessTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AccessTokenService tokens,
    CallerCeiling ceiling)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "EndgameAccessToken";
    public const string Policy = "mcp";
    public const string TokenClaim = "endgame:token";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            return AuthenticateResult.NoResult();
        }

        var token = header["Bearer ".Length..].Trim();
        var found = await tokens.AuthenticateAsync(token, Context.RequestAborted);
        if (found is null)
        {
            return AuthenticateResult.Fail("The access token is unknown, revoked or expired.");
        }

        if (!ceiling.Active)
        {
            ceiling.Set(found.TokenId, found.OrganisationId, found.Role);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, found.UserId.ToString()),
            new Claim(TokenClaim, found.TokenId.ToString()),
        ], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer realm=\"endgame-mcp\", error=\"invalid_token\"";
        return Task.CompletedTask;
    }
}
