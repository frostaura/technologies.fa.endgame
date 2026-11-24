using Microsoft.AspNetCore.Identity;

namespace Endgame.Infrastructure.Identity;

/// <summary>
/// A person who can sign in. People are not tenant rows: one person can be a member of several
/// organisations, so the user table is global and organisation membership lives in
/// <c>memberships</c>, which is. Sign-in is by passkey only; no password is ever set.
/// </summary>
public sealed class EndgameUser : IdentityUser<Guid>
{
    public const int MaxDisplayNameLength = 200;

    public string DisplayName { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>SHA-256 of the one-time invitation code, while the invitation is open. Null once used.</summary>
    public string? InvitationCodeHash { get; set; }

    public DateTimeOffset? InvitationExpiresAt { get; set; }
}
