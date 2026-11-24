using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Endgame.AppKit;

/// <summary>The signed-in person, and where to send someone to sign in, sign up or sign out.</summary>
public interface IEndgameIdentity
{
    /// <summary>The person making the current request, or null when nobody is signed in.</summary>
    EndgameUser? CurrentUser { get; }

    /// <summary>Path (including the app's address prefix) of the platform's sign-in page, returning to <paramref name="returnTo"/>.</summary>
    string SignInUrl(string? returnTo = null);

    /// <summary>As <see cref="SignInUrl"/>, for registering a new end user of this app.</summary>
    string SignUpUrl(string? returnTo = null);

    /// <summary>Path that signs the person out and returns them to the app's home.</summary>
    string SignOutUrl();
}

/// <summary>The scheme name and the header Edge forwards the app-scoped session in.</summary>
public static class EndgameAuthentication
{
    /// <summary>Authentication scheme name.</summary>
    public const string Scheme = "Endgame";

    /// <summary>The request header carrying the app-scoped session token. Only Edge sets it.</summary>
    public const string SessionHeader = "X-Endgame-Session";

    /// <summary>Authorization policy behind <c>.RequireUser()</c>.</summary>
    public const string Policy = "EndgameUser";

    /// <summary>Where Edge serves the platform's sign-in pages under every app address.</summary>
    public const string AuthPathPrefix = "_endgame/auth";
}

internal sealed class EndgameIdentity(IHttpContextAccessor accessor) : IEndgameIdentity
{
    public EndgameUser? CurrentUser => accessor.HttpContext is { } c ? EndgameUser.FromPrincipal(c.User) : null;

    public string SignInUrl(string? returnTo = null) => AuthUrl("sign-in", returnTo);

    public string SignUpUrl(string? returnTo = null) => AuthUrl("sign-up", returnTo);

    public string SignOutUrl() => $"{PathBase()}/{EndgameAuthentication.AuthPathPrefix}/sign-out";

    private string AuthUrl(string page, string? returnTo)
    {
        var target = returnTo ?? CurrentPathAndQuery();
        if (!IsLocal(target))
        {
            throw new ArgumentException($"returnTo must be a path inside this app (starting with '/'), not '{target}'.", nameof(returnTo));
        }

        return $"{PathBase()}/{EndgameAuthentication.AuthPathPrefix}/{page}?returnTo={Uri.EscapeDataString(target)}";
    }

    private string PathBase() => accessor.HttpContext?.Request.PathBase.Value?.TrimEnd('/') ?? "";

    private string CurrentPathAndQuery()
    {
        var r = accessor.HttpContext?.Request;
        return r is null ? "/" : $"{r.PathBase}{r.Path}{r.QueryString}";
    }

    internal static bool IsLocal(string url) =>
        url.StartsWith('/') && !url.StartsWith("//", StringComparison.Ordinal) && !url.StartsWith("/\\", StringComparison.Ordinal);
}

/// <summary>
/// Resolves <see cref="EndgameAuthentication.SessionHeader"/> to a user through the platform, with a
/// short cache so a page of API calls costs one round trip.
/// </summary>
internal sealed class EndgameAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PlatformClient platform,
    IMemoryCache cache,
    IEndgameIdentity identity)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(30);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = Request.Headers[EndgameAuthentication.SessionHeader].ToString();
        if (string.IsNullOrWhiteSpace(token))
        {
            return AuthenticateResult.NoResult();
        }

        var key = "endgame-session:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        if (!cache.TryGetValue(key, out ResolvedSession? session) || session is null)
        {
            try
            {
                session = await platform.SendAsync<ResolvedSession>(HttpMethod.Post, "platform/v1/identity/resolve", new { session = token }, Context.RequestAborted);
            }
            catch (EndgamePlatformException e) when (e.Code == "session_invalid")
            {
                return AuthenticateResult.NoResult();
            }

            var ttl = session.ExpiresAt is { } expires ? TimeSpan.FromTicks(Math.Min(CacheFor.Ticks, Math.Max(0, (expires - DateTimeOffset.UtcNow).Ticks))) : CacheFor;
            cache.Set(key, session, ttl);
        }

        return AuthenticateResult.Success(new AuthenticationTicket(session.User.ToPrincipal(), Scheme.Name));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var signIn = identity.SignInUrl(WantsHtml(Request) ? null : $"{Request.PathBase}/");
        if (WantsHtml(Request))
        {
            Response.Redirect(signIn);
            return;
        }

        Response.StatusCode = StatusCodes.Status401Unauthorized;
        await Results.Problem(
            statusCode: 401,
            title: "Sign in required",
            detail: "This needs a signed-in user. Send the person to signInUrl.",
            type: "https://endgame.frostaura.net/problems/sign-in-required",
            extensions: new Dictionary<string, object?> { ["signInUrl"] = signIn }).ExecuteAsync(Context);
    }

    protected override async Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        await Results.Problem(statusCode: 403, title: "Not allowed", detail: "The signed-in user may not do this.").ExecuteAsync(Context);
    }

    private static bool WantsHtml(HttpRequest request) =>
        HttpMethods.IsGet(request.Method) && request.Headers.Accept.ToString().Contains("text/html", StringComparison.OrdinalIgnoreCase);

    private sealed record ResolvedSession(EndgameUser User, DateTimeOffset? ExpiresAt);
}

/// <summary><c>.RequireUser()</c> for endpoints and groups.</summary>
public static class RequireUserExtensions
{
    /// <summary>
    /// Only signed-in users reach this endpoint. Browsers navigating to it are redirected to sign in;
    /// API calls get a 401 problem with a <c>signInUrl</c>.
    /// </summary>
    public static TBuilder RequireUser<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        builder.WithMetadata(new RequireUserMetadata());
        builder.RequireAuthorization(EndgameAuthentication.Policy);
        return builder;
    }
}
