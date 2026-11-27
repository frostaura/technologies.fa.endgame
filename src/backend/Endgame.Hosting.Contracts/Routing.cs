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
/// <param name="Access"><c>private</c>, <c>shared</c> or <c>public</c>, resolved down the cascade. Absent is read as private.</param>
/// <param name="Paused">True when the app must not be served: the edge shows the holding page. Nothing is deleted.</param>
/// <param name="PausedReason">One of <see cref="PausedReasons"/> when paused; null otherwise.</param>
/// <param name="Hooks">The app's declared webhook names: the edge admits <c>POST hooks/&lt;name&gt;</c> for these alone, even on a private app. Absent is none.</param>
/// <param name="Name">
/// The app's name in the organisation tree — the one name a person sees for it: in the console, on the
/// identity pages, in e-mails, and (sent as <see cref="HostingConventions.AppNameHeader"/>) in the app's own
/// header and tab title. A person can rename it. Absent from an older control plane, when the app is told nothing.
/// </param>
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
    string? Access,
    bool Paused,
    string? PausedReason,
    IReadOnlyList<string>? Hooks,
    string? Name = null);

/// <summary>Why the routing table pauses an app.</summary>
public static class PausedReasons
{
    /// <summary>The organisation's settled balance is past its overdraft limit.</summary>
    public const string OverdraftLimit = "overdraft_limit";

    /// <summary>A monthly budget on the app's chain is spent.</summary>
    public const string BudgetExhausted = "budget_exhausted";
}

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
/// The control plane alone decides; when it cannot answer, a private or shared app stays closed.
/// </summary>
/// <param name="AppId">The app being opened.</param>
/// <param name="Cookie">The request's whole <c>Cookie</c> header, or null when it had none.</param>
/// <param name="Path">The request's path within the app (prefix stripped), with its query.</param>
public sealed record AccessCheckRequest(Guid AppId, string? Cookie, string Path);

/// <summary>The control plane's answer to an <see cref="AccessCheckRequest"/>.</summary>
/// <param name="Decision">One of <see cref="AccessDecisions"/>.</param>
/// <param name="SessionToken">An app-scoped token for <c>X-Endgame-Session</c>; never the browser's cookie.</param>
/// <param name="SignInUrl">Where to send a visitor who must sign in first; the app's own sign-in page when null.</param>
/// <param name="Reason">Why, for the logs; never shown to the visitor.</param>
public sealed record AccessCheckResult(string Decision, string? SessionToken, string? SignInUrl, string? Reason = null);

/// <summary>The three answers an access check can give.</summary>
public static class AccessDecisions
{
    public const string Allow = "allow";
    public const string SignIn = "sign-in";
    public const string Deny = "deny";
}

/// <summary><c>POST /internal/apps/{id}/token</c> on the control plane: the app's platform token, which Dock injects.</summary>
public sealed record AppTokenResult(string Token);

/// <summary><c>POST /internal/access/handoff</c> on the control plane: a one-time code from the identity pages, redeemed on the organisation subdomain.</summary>
public sealed record HandoffRequest(Guid AppId, string Code);

/// <summary>The cookie Edge sets on the subdomain host (host-only), and where the visitor goes next.</summary>
public sealed record HandoffRedeemed(string CookieName, string CookieValue, DateTimeOffset ExpiresAt, string ReturnTo);

/// <summary>Cookie names the platform owns. None of them is ever forwarded to an app.</summary>
public static class PlatformCookies
{
    /// <summary>A member's console session.</summary>
    public const string MemberSession = "endgame.session";

    /// <summary>An app session: <c>endgame.app.&lt;app id, 32 hex&gt;</c>, one per app and host.</summary>
    public const string AppSessionPrefix = "endgame.app.";

    /// <summary>Every platform cookie starts with this (sessions, passkey ceremonies, registrations).</summary>
    public const string Prefix = "endgame.";

    public static string AppSession(Guid appId) => AppSessionPrefix + appId.ToString("N");
}

/// <summary><c>POST /internal/usage/hosting</c> on the control plane: what an app used over a period. A sample id is charged once.</summary>
/// <param name="SampleId">Stable for the period, so reporting it again charges nothing.</param>
/// <param name="AwakeSeconds">Seconds the app was running inside the period.</param>
/// <param name="MemoryBytes">Mean memory in use while awake.</param>
/// <param name="StorageBytes">What the app stores (its database), at the end of the period.</param>
/// <param name="Requests">Requests the edge forwarded to it.</param>
public sealed record HostingSample(string SampleId, Guid AppId, DateTimeOffset From, DateTimeOffset To, long AwakeSeconds, long MemoryBytes, long StorageBytes, long Requests);

public sealed record HostingUsageReport(IReadOnlyList<HostingSample> Samples);

/// <summary>The control plane's answer to a <see cref="HostingUsageReport"/>.</summary>
public sealed record HostingUsageRecorded(int Recorded, int Duplicates, decimal Credits);

/// <summary>Platform-to-app callbacks (PLATFORM-API §4).</summary>
public static class Callbacks
{
    /// <summary><c>t=&lt;unix&gt;,v1=&lt;hex HMAC-SHA256(app token, "&lt;t&gt;." + body)&gt;</c>, forwarded by the edge unchanged.</summary>
    public const string SignatureHeader = "X-Endgame-Signature";
}
