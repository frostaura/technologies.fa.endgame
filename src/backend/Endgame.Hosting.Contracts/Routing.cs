namespace Endgame.Hosting.Contracts;

/// <summary>
/// <c>GET /internal/routes</c> on the control plane — the shape it serves, field for field: every
/// app's addresses, container target and sleep state. Edge detects a change by hashing
/// <see cref="Routes"/>; <see cref="GeneratedAt"/> differs on every read.
/// </summary>
public sealed record RoutingTable(DateTimeOffset GeneratedAt, IReadOnlyList<RouteView> Routes);

/// <summary>One app's route.</summary>
/// <param name="AppId">The app's id.</param>
/// <param name="OrganisationId">Its organisation.</param>
/// <param name="Scope">Its cascade path, <c>org/division/project/app</c>.</param>
/// <param name="PathBase">The path form's prefix, <c>/org/division/project/app/</c>, on the platform's host.</param>
/// <param name="Host">The organisation subdomain, e.g. <c>acme.frostaura.net</c>.</param>
/// <param name="HostPathBase">The prefix on that subdomain, <c>/division/project/app/</c>.</param>
/// <param name="Target">Where the app listens: <c>http://app-&lt;id, 32 hex&gt;:8080</c>.</param>
/// <param name="Status">The app's node status: draft, building, running, sleeping, stopped or failed.</param>
/// <param name="Sleeping">The control plane's last word on whether it sleeps.</param>
/// <param name="Sleep">The sleep setting, resolved down the cascade.</param>
/// <param name="Version">The running version; null until the first publish.</param>
/// <param name="Access">
/// Extension: <c>private</c>, <c>shared</c> or <c>public</c>. Not yet sent by the control plane;
/// absent means private — the edge never opens an app it was not told it may.
/// </param>
/// <param name="Paused">Extension: the organisation reached its overdraft limit. Not yet sent; absent means false.</param>
public sealed record RouteView(
    Guid AppId,
    Guid OrganisationId,
    string Scope,
    string PathBase,
    string Host,
    string HostPathBase,
    string Target,
    string Status,
    bool Sleeping,
    SleepSetting Sleep,
    string? Version,
    string? Access = null,
    bool Paused = false);

/// <summary>The app's sleep setting: <c>auto</c> (sleep after <see cref="IdleMinutes"/>) or <c>always_on</c>.</summary>
public sealed record SleepSetting(string Mode, int IdleMinutes, string ModeSetAt, string IdleSetAt)
{
    public const string Auto = "auto";
    public const string AlwaysOn = "always_on";
}

/// <summary>Who may open an app (spec, "Apps are private by default").</summary>
public static class AppAccess
{
    /// <summary>Organisation members with rights over the app.</summary>
    public const string Private = "private";

    /// <summary>Members, plus registered people it was shared with.</summary>
    public const string Shared = "shared";

    /// <summary>Anyone, with no sign-in. Only a person can set this.</summary>
    public const string Public = "public";
}

/// <summary>Whether an app may be served at all, independent of whether it is awake (derived by Edge).</summary>
public static class AppAvailability
{
    /// <summary>Served, waking it if it sleeps.</summary>
    public const string Available = "available";

    /// <summary>Its organisation reached its overdraft limit: a holding page, nothing deleted.</summary>
    public const string Paused = "paused";

    /// <summary>Has an address but no published version yet.</summary>
    public const string Unpublished = "unpublished";
}

/// <summary>
/// <c>POST /internal/access/check</c> on the control plane: may this visitor open this app, and as
/// whom? Edge sends it for every request into a private or shared app it has no fresh decision for,
/// and for a public app whenever the visitor carries a cookie (so the app learns who they are).
/// </summary>
/// <param name="AppId">The app being opened.</param>
/// <param name="Cookie">The request's whole <c>Cookie</c> header, or null when it had none.</param>
/// <param name="Path">The request's path within the app (prefix stripped), with its query.</param>
public sealed record AccessCheckRequest(Guid AppId, string? Cookie, string Path);

/// <summary>The control plane's answer to an <see cref="AccessCheckRequest"/>.</summary>
/// <param name="Decision">One of <see cref="AccessDecisions"/>.</param>
/// <param name="SessionToken">An app-scoped token for <c>X-Endgame-Session</c>; never the browser's cookie.</param>
/// <param name="SignInUrl">Where to send a visitor who must sign in first; the app's own sign-in page when null.</param>
public sealed record AccessCheckResult(string Decision, string? SessionToken, string? SignInUrl);

/// <summary>The three answers an access check can give.</summary>
public static class AccessDecisions
{
    public const string Allow = "allow";
    public const string SignIn = "sign-in";
    public const string Deny = "deny";
}

/// <summary><c>POST /internal/apps/{id}/token</c> on the control plane: the app's platform token, which Dock injects.</summary>
public sealed record AppTokenResult(string Token);
