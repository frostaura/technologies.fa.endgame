using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Endgame.Edge.Pages;
using Endgame.Edge.Routing;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Access;

/// <summary>
/// <c>&lt;app address&gt;/_endgame/auth/{sign-in|sign-up|sign-out|handoff}</c>, answered by the edge
/// itself (PLATFORM-API §5.4) — the organisation's identity pages for one app.
/// <list type="bullet">
/// <item><b>sign-in</b> and <b>sign-up</b> are pages that drive the control plane's
/// <c>/api/app-auth/{appId}/…</c> (and, for members, the console's own passkey sign-in), with the
/// development sign-in when the control plane advertises it. They are served on the platform's own
/// host, where a member's console session lives; on an organisation subdomain they send the visitor
/// there with an absolute <c>returnTo</c>, and the session comes back through the hand-off.</item>
/// <item><b>handoff</b> redeems a one-time code (<c>POST /internal/access/handoff</c>), sets the
/// host-only app-session cookie it returns, and redirects.</item>
/// <item><b>sign-out</b> ends the visitor's session and comes straight back.</item>
/// </list>
/// A <c>returnTo</c> outside the app's own two addresses is replaced by the app's home, so these
/// pages can never send anyone elsewhere.
/// </summary>
public sealed class AuthPages(IHttpClientFactory http, IOptions<EdgeOptions> options, IConfiguration configuration, ILogger<AuthPages> logger)
{
    public const string SignIn = "sign-in";
    public const string SignUp = "sign-up";
    public const string SignOut = "sign-out";
    public const string Handoff = "handoff";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <param name="context">The request.</param>
    /// <param name="app">The app whose address it arrived at.</param>
    /// <param name="shape"><see cref="AppProxyConfig.PathShape"/> or <see cref="AppProxyConfig.HostShape"/>.</param>
    /// <param name="appAddress">The app's prefix on this host, no trailing slash (empty for an app given its whole subdomain).</param>
    /// <param name="page">What follows <c>_endgame/auth</c>.</param>
    public async Task HandleAsync(HttpContext context, EdgeApp app, string shape, string appAddress, string page)
    {
        var addresses = new AppAddresses(app, shape, PublicScheme(context.Request), context.Request.Host, PlatformOrigin(context.Request));
        var returnTo = addresses.Inside(context.Request.Query["returnTo"].ToString(), shape) ?? addresses.Home(shape);
        switch (page.Trim('/'))
        {
            case SignIn or SignUp when shape == AppProxyConfig.HostShape && addresses.PlatformOrigin is { } platform
                && !string.Equals(platform.Authority, CurrentAuthority(context.Request), StringComparison.OrdinalIgnoreCase):
                // A member's console session lives on the platform's host: sign in there, then hand off back here.
                context.Response.Redirect($"{addresses.PathHome}{HostingConventions.AuthPath.TrimStart('/')}/{page.Trim('/')}?returnTo={Uri.EscapeDataString(returnTo)}");
                return;
            case SignIn or SignUp:
                await WritePageAsync(context, app, page.Trim('/'), returnTo, addresses, shape);
                return;
            case Handoff:
                await RedeemAsync(context, app, addresses, shape);
                return;
            case SignOut:
                await SignOutAsync(context, app);
                context.Response.Redirect(returnTo);
                return;
            default:
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
        }
    }

    /// <summary>True when <paramref name="returnTo"/> is a path at or beneath the app's address on this host.</summary>
    public static bool IsInside(string appAddress, string? returnTo)
    {
        if (string.IsNullOrEmpty(returnTo) || !returnTo.StartsWith('/') || returnTo.StartsWith("//", StringComparison.Ordinal)
            || returnTo.Contains('\\', StringComparison.Ordinal) || returnTo.Contains("/../", StringComparison.Ordinal) || returnTo.EndsWith("/..", StringComparison.Ordinal)
            || returnTo.Contains("/./", StringComparison.Ordinal) || returnTo.Any(char.IsControl))
        {
            return false;
        }

        var path = returnTo.Split('?', '#')[0];
        return path == appAddress || path.StartsWith(appAddress + "/", StringComparison.Ordinal) || (appAddress.Length == 0 && path.StartsWith('/'));
    }

    private string PublicScheme(HttpRequest request) => options.Value.PublicScheme is { Length: > 0 } s ? s : request.Scheme;

    private string CurrentAuthority(HttpRequest request) => new Uri($"{PublicScheme(request)}://{request.Host}").Authority;

    private Uri? PlatformOrigin(HttpRequest request) =>
        Uri.TryCreate(options.Value.PlatformOrigin, UriKind.Absolute, out var origin) ? origin : null;

    /// <summary>
    /// <c>?code=…</c>: the control plane redeems the one-time code (unknown, used or older than a
    /// minute is 410) into this host's own app-session cookie. The visitor is sent where the
    /// control plane says — checked again to be inside this app's address on this host.
    /// </summary>
    private async Task RedeemAsync(HttpContext context, EdgeApp app, AppAddresses addresses, string shape)
    {
        var code = context.Request.Query["code"].ToString();
        HandoffRedeemed? redeemed = null;
        var failed = false;
        if (code.Length is > 0 and <= 200)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/access/handoff"))
                {
                    Content = JsonContent.Create(new HandoffRequest(app.AppId, code)),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
                using var response = await http.CreateClient(AccessGate.ClientName).SendAsync(request, context.RequestAborted);
                if (response.IsSuccessStatusCode)
                {
                    redeemed = await response.Content.ReadFromJsonAsync<HandoffRedeemed>(Json, context.RequestAborted);
                }
                else if (response.StatusCode != HttpStatusCode.Gone)
                {
                    logger.LogWarning("Redeeming a hand-off for app {AppId} answered {Status}.", app.AppId, (int)response.StatusCode);
                    failed = true;
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException && !context.RequestAborted.IsCancellationRequested)
            {
                logger.LogWarning("Redeeming a hand-off for app {AppId} failed: {Message}", app.AppId, e.Message);
                failed = true;
            }
        }

        if (redeemed is null || redeemed.CookieName != PlatformCookies.AppSession(app.AppId) || redeemed.CookieValue is not { Length: > 0 })
        {
            await AuthPage.WriteMessageAsync(context, failed ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status410Gone,
                failed ? "Sign-in is unavailable just now" : "This sign-in link has expired",
                failed ? "Endgame could not finish signing you in. Please try again in a moment." : "Sign-in links work once, for a minute. Sign in again to continue.",
                $"{addresses.Home(shape)}{HostingConventions.AuthPath.TrimStart('/')}/{SignIn}?returnTo={Uri.EscapeDataString(addresses.Home(shape))}", "Sign in again", MarkUrl(addresses));
            return;
        }

        // Host-only (no Domain): the cookie belongs to this organisation subdomain alone.
        context.Response.Cookies.Append(redeemed.CookieName, redeemed.CookieValue, new CookieOptions
        {
            HttpOnly = true,
            Secure = PublicScheme(context.Request) == Uri.UriSchemeHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = redeemed.ExpiresAt,
        });
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Redirect(addresses.Inside(redeemed.ReturnTo, shape) ?? addresses.Home(shape));
    }

    /// <summary>
    /// Ends the visitor's session at this app (<c>POST /api/app-auth/{appId}/sign-out</c>); when they
    /// also carry the console session (the platform's host), that ends too, with every app session
    /// the browser holds (<c>POST /api/auth/logout</c>). The cookies the control plane clears are
    /// passed back.
    /// </summary>
    private async Task SignOutAsync(HttpContext context, EdgeApp app)
    {
        var cookie = context.Request.Headers.Cookie.ToString();
        if (cookie.Length == 0)
        {
            return;
        }

        var member = cookie.Contains(PlatformCookies.MemberSession + "=", StringComparison.Ordinal);
        var path = member ? "/api/auth/logout" : $"/api/app-auth/{app.AppId:D}/sign-out";
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), path));
            request.Headers.TryAddWithoutValidation("Cookie", cookie);
            using var response = await http.CreateClient(AccessGate.ClientName).SendAsync(request, context.RequestAborted);
            if (response.Headers.TryGetValues("Set-Cookie", out var cleared))
            {
                foreach (var value in cleared)
                {
                    context.Response.Headers.Append("Set-Cookie", value);
                }
            }
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !context.RequestAborted.IsCancellationRequested)
        {
            logger.LogWarning("Signing out of app {AppId} failed: {Message}", app.AppId, e.Message);
        }

        // An app session on this host is cleared here too, whatever the control plane answered.
        context.Response.Cookies.Delete(PlatformCookies.AppSession(app.AppId), new CookieOptions { Path = "/" });
    }

    // The console serves the mark on the platform's host; on a subdomain that path is the app's.
    private static string MarkUrl(AppAddresses addresses) =>
        addresses.PlatformOrigin is { } origin ? new Uri(origin, UnavailablePage.MarkPath).AbsoluteUri : UnavailablePage.MarkPath;

    private static Task WritePageAsync(HttpContext context, EdgeApp app, string page, string returnTo, AppAddresses addresses, string shape)
    {
        var config = new
        {
            appId = app.AppId.ToString("D"),
            page,
            returnTo,
            // A return to the organisation subdomain cannot carry this host's cookie: hand the session off.
            handoff = addresses.IsOnSubdomain(returnTo),
            signInUrl = $"{addresses.Home(shape)}{HostingConventions.AuthPath.TrimStart('/')}/{SignIn}?returnTo={Uri.EscapeDataString(returnTo)}",
            signUpUrl = $"{addresses.Home(shape)}{HostingConventions.AuthPath.TrimStart('/')}/{SignUp}?returnTo={Uri.EscapeDataString(returnTo)}",
        };
        return AuthPage.WriteAsync(context, page, JsonSerializer.Serialize(config, Json), MarkUrl(addresses));
    }
}

/// <summary>
/// The app's two addresses as absolute URLs, and the rule for what counts as inside them: a path
/// beneath the address on this host, or an absolute URL beneath either address (same scheme and
/// port as the request, no credentials).
/// </summary>
public sealed class AppAddresses
{
    private readonly EdgeApp app;
    private readonly string scheme;
    private readonly HostString current;

    /// <param name="app">The app.</param>
    /// <param name="shape">Which of its addresses the request arrived at.</param>
    /// <param name="scheme">The scheme visitors use.</param>
    /// <param name="current">The host (and port) the request arrived at.</param>
    /// <param name="platformOrigin">The platform's own origin, when configured.</param>
    public AppAddresses(EdgeApp app, string shape, string scheme, HostString current, Uri? platformOrigin)
    {
        this.app = app;
        this.scheme = scheme;
        this.current = current;
        PlatformOrigin = platformOrigin;
        var port = current.Port is { } p && !IsDefault(scheme, p) ? $":{p}" : "";
        // On the path form the request is on the platform's host already; from a subdomain it is named.
        PathHome = shape == AppProxyConfig.PathShape || platformOrigin is null
            ? $"{scheme}://{current.Value}{app.PathPrefix}/"
            : $"{platformOrigin.Scheme}://{platformOrigin.Authority}{app.PathPrefix}/";
        SubdomainHome = $"{scheme}://{app.Host}{port}{app.HostPrefix}/";
    }

    public Uri? PlatformOrigin { get; }

    /// <summary>The path form's home, on the platform's host.</summary>
    public string PathHome { get; }

    /// <summary>The organisation subdomain's home.</summary>
    public string SubdomainHome { get; }

    public string Home(string shape) => shape == AppProxyConfig.HostShape ? SubdomainHome : PathHome;

    public bool IsOnSubdomain(string absolute) =>
        Uri.TryCreate(absolute, UriKind.Absolute, out var uri) && string.Equals(uri.Host, app.Host, StringComparison.OrdinalIgnoreCase);

    /// <summary><paramref name="returnTo"/> as an absolute URL inside the app, or null when it is not.</summary>
    public string? Inside(string? returnTo, string shape)
    {
        if (string.IsNullOrEmpty(returnTo) || returnTo.Length > 2000)
        {
            return null;
        }

        if (returnTo.StartsWith('/'))
        {
            var prefix = shape == AppProxyConfig.HostShape ? app.HostPrefix : app.PathPrefix;
            return AuthPages.IsInside(prefix, returnTo) ? $"{scheme}://{current.Value}{returnTo}" : null;
        }

        if (!Uri.TryCreate(returnTo, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 || returnTo.Any(char.IsControl) || returnTo.Contains('\\', StringComparison.Ordinal))
        {
            return null;
        }

        foreach (var home in new[] { PathHome, SubdomainHome })
        {
            var root = new Uri(home);
            if (uri.Scheme == root.Scheme && uri.Port == root.Port && string.Equals(uri.Host, root.Host, StringComparison.OrdinalIgnoreCase)
                && AuthPages.IsInside(root.AbsolutePath.TrimEnd('/'), uri.PathAndQuery))
            {
                return uri.AbsoluteUri;
            }
        }

        return null;
    }

    private static bool IsDefault(string scheme, int port) => (scheme == Uri.UriSchemeHttps && port == 443) || (scheme == Uri.UriSchemeHttp && port == 80);
}
