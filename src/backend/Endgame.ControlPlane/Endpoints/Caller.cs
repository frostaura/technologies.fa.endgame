using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;

namespace Endgame.ControlPlane.Endpoints;

internal static class Caller
{
    /// <summary>The signed-in person's id. Endpoints that call this require authorisation, so it is always there.</summary>
    public static Guid Id(this ClaimsPrincipal user)
    {
        ArgumentNullException.ThrowIfNull(user);
        return Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : throw EndgameProblem.Unauthenticated();
    }

    /// <summary>A WebAuthn credential may arrive as a JSON object or as the string the browser serialised.</summary>
    public static string CredentialJson(JsonNode? credential) => credential switch
    {
        JsonValue v when v.GetValueKind() == JsonValueKind.String => v.GetValue<string>(),
        JsonObject o => o.ToJsonString(),
        _ => throw EndgameProblem.Invalid("Send the credential the authenticator returned, as 'credential'."),
    };
}
