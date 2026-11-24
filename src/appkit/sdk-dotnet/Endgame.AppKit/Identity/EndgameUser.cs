using System.Reflection;
using System.Security.Claims;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit;

/// <summary>Who is using the app. Members belong to the organisation; end users registered to use this app.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<EndgameUserKind>))]
public enum EndgameUserKind
{
    /// <summary>An organisation member, holding a role somewhere in the cascade.</summary>
    [JsonStringEnumMemberName("member")]
    Member,

    /// <summary>A person registered to use this app, with no role in the organisation.</summary>
    [JsonStringEnumMemberName("endUser")]
    EndUser,
}

/// <summary>
/// The signed-in person, as the platform validated them. Take it as an endpoint parameter:
/// <c>(EndgameUser user) =&gt; …</c> on an endpoint with <c>.RequireUser()</c>, or
/// <c>(EndgameUser? user) =&gt; …</c> where signing in is optional.
/// </summary>
/// <param name="Id">Stable, opaque id. Store this, never the email, as the owner of a row.</param>
/// <param name="Email">The address they signed in with.</param>
/// <param name="DisplayName">What to call them on screen.</param>
/// <param name="Kind">Member or end user.</param>
/// <param name="Role">For members, their effective role on this app: owner, admin, builder or viewer. Null for end users.</param>
public sealed record EndgameUser(string Id, string Email, string DisplayName, EndgameUserKind Kind, string? Role)
{
    internal const string ClaimEmail = "endgame:email";
    internal const string ClaimName = "endgame:name";
    internal const string ClaimKind = "endgame:kind";
    internal const string ClaimRole = "endgame:role";

    /// <summary>Minimal APIs call this to bind an <see cref="EndgameUser"/> parameter.</summary>
    public static ValueTask<EndgameUser?> BindAsync(HttpContext context, ParameterInfo parameter)
    {
        var user = FromPrincipal(context.User);
        if (user is null && !IsNullable(parameter) && context.GetEndpoint()?.Metadata.GetMetadata<RequireUserMetadata>() is null)
        {
            throw new InvalidOperationException(
                $"The endpoint '{context.GetEndpoint()?.DisplayName}' takes a non-nullable EndgameUser but is not marked .RequireUser(). " +
                "Add .RequireUser() to the endpoint or its group, or take EndgameUser? if signing in is optional.");
        }

        return ValueTask.FromResult(user);
    }

    internal static bool IsNullable(ParameterInfo parameter) =>
        new NullabilityInfoContext().Create(parameter).ReadState == NullabilityState.Nullable;

    internal static EndgameUser? FromPrincipal(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true || principal.Identity.AuthenticationType != EndgameAuthentication.Scheme)
        {
            return null;
        }

        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null)
        {
            return null;
        }

        return new EndgameUser(
            id,
            principal.FindFirstValue(ClaimEmail) ?? "",
            principal.FindFirstValue(ClaimName) ?? "",
            principal.FindFirstValue(ClaimKind) == "endUser" ? EndgameUserKind.EndUser : EndgameUserKind.Member,
            principal.FindFirstValue(ClaimRole));
    }

    internal ClaimsPrincipal ToPrincipal()
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Id),
            new(ClaimEmail, Email),
            new(ClaimName, DisplayName),
            new(ClaimKind, Kind == EndgameUserKind.EndUser ? "endUser" : "member"),
        };
        if (Role is not null)
        {
            claims.Add(new Claim(ClaimRole, Role));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, EndgameAuthentication.Scheme));
    }
}

/// <summary>Marks an endpoint as needing a signed-in user. Added by <c>.RequireUser()</c>.</summary>
public sealed class RequireUserMetadata;
