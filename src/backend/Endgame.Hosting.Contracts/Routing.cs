namespace Endgame.Hosting.Contracts;

/// <summary>
/// <c>GET /internal/routes</c> on the control plane: everything Edge needs to route, admit, wake
/// and sleep every app. The control plane answers with an <c>ETag</c> equal to
/// <see cref="Version"/> and honours <c>If-None-Match</c> with <c>304</c>.
/// </summary>
/// <param name="Version">Changes whenever any route in the table changes.</param>
/// <param name="Apps">Every app that has an address. An app absent here is not routed at all.</param>
public sealed record RoutingTable(string Version, IReadOnlyList<AppRoute> Apps);

/// <summary>One app's addresses, target, access and sleep policy.</summary>
/// <param name="AppId">The app's id.</param>
/// <param name="OrganisationId">Its organisation.</param>
/// <param name="Organisation">Organisation slug: the first segment of the path form.</param>
/// <param name="Division">Division slug: the second segment.</param>
/// <param name="Project">Project slug: the third segment. The path form is <c>/org/division/project/</c>.</param>
/// <param name="Hosts">
/// Hosts that serve this app at their root — the organisation-subdomain form, e.g.
/// <c>acme.frostaura.net</c>. The control plane decides which app an organisation's subdomain shows.
/// </param>
/// <param name="Target">Where the app listens, e.g. <c>http://app-&lt;id&gt;:8080</c>.</param>
/// <param name="Access">One of <see cref="AppAccess"/>.</param>
/// <param name="Sleep">When the app may be put to sleep.</param>
/// <param name="Availability">One of <see cref="AppAvailability"/>.</param>
public sealed record AppRoute(
    Guid AppId,
    Guid OrganisationId,
    string Organisation,
    string Division,
    string Project,
    IReadOnlyList<string> Hosts,
    string Target,
    string Access,
    SleepPolicy Sleep,
    string Availability);

/// <summary>The app's sleep setting, resolved down the cascade.</summary>
/// <param name="AlwaysOn">Pinned awake: never put to sleep.</param>
/// <param name="IdleSeconds">How long with no request before the app sleeps.</param>
public sealed record SleepPolicy(bool AlwaysOn, int IdleSeconds);

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

/// <summary>Whether an app may be served at all, independent of whether it is awake.</summary>
public static class AppAvailability
{
    /// <summary>Served, waking it if it sleeps.</summary>
    public const string Available = "available";

    /// <summary>Its organisation reached its overdraft limit: a holding page, nothing deleted.</summary>
    public const string Paused = "paused";

    /// <summary>Has an address but no running version yet.</summary>
    public const string Unpublished = "unpublished";
}

/// <summary>
/// <c>POST /internal/access/check</c> on the control plane: may this visitor open this app?
/// Edge sends it for every private or shared app it has no fresh decision for.
/// </summary>
/// <param name="AppId">The app being opened.</param>
/// <param name="Host">The request's host, so subdomain-form sessions can be told apart.</param>
/// <param name="Path">The full original path and query, for the return address after sign-in.</param>
/// <param name="Cookie">The request's whole <c>Cookie</c> header, or null when it had none.</param>
public sealed record AccessCheckRequest(Guid AppId, string Host, string Path, string? Cookie);

/// <summary>The control plane's answer to an <see cref="AccessCheckRequest"/>.</summary>
/// <param name="Outcome">One of <see cref="AccessOutcome"/>.</param>
/// <param name="UserId">The admitted person, when allowed.</param>
/// <param name="SignInUrl">Where to send a visitor who must sign in first.</param>
public sealed record AccessCheckResult(string Outcome, Guid? UserId, string? SignInUrl);

/// <summary>The three answers an access check can give.</summary>
public static class AccessOutcome
{
    /// <summary>Let the request through.</summary>
    public const string Allowed = "allowed";

    /// <summary>No session, or one that has expired.</summary>
    public const string SignInRequired = "sign_in_required";

    /// <summary>Signed in, but with no right to this app.</summary>
    public const string Forbidden = "forbidden";
}
