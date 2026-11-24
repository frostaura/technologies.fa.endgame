using Endgame.Edge.Routing;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Access;

/// <summary>
/// <c>&lt;app address&gt;/_endgame/auth/{sign-in|sign-up|sign-out}?returnTo=…</c>, answered by the
/// edge itself (PLATFORM-API §5.4). Sign-in and sign-up hand the visitor to the organisation's
/// identity pages on the platform with an absolute return address; sign-out ends the platform
/// session and comes straight back. A <c>returnTo</c> outside the app's own address is replaced by
/// the app's home, so these pages can never be used to send someone elsewhere.
/// </summary>
public sealed class AuthPages(IHttpClientFactory http, IOptions<EdgeOptions> options, ILogger<AuthPages> logger)
{
    public async Task HandleAsync(HttpContext context, EdgeApp app, string appAddress, string page)
    {
        var o = options.Value;
        var returnTo = context.Request.Query["returnTo"].ToString();
        if (!IsInside(appAddress, returnTo))
        {
            returnTo = appAddress + "/";
        }

        var request = context.Request;
        var scheme = o.PublicScheme is { Length: > 0 } s ? s : request.Scheme;
        var absolute = $"{scheme}://{request.Host}{returnTo}";
        var origin = o.PlatformOrigin.TrimEnd('/');
        switch (page.Trim('/'))
        {
            case "sign-in":
                context.Response.Redirect($"{origin}{o.SignInPath}?returnTo={Uri.EscapeDataString(absolute)}&app={app.AppId:D}");
                return;
            case "sign-up":
                context.Response.Redirect($"{origin}{o.SignUpPath}?returnTo={Uri.EscapeDataString(absolute)}&app={app.AppId:D}");
                return;
            case "sign-out":
                await SignOutAsync(context);
                context.Response.Redirect(returnTo);
                return;
            default:
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
        }
    }

    /// <summary>True when <paramref name="returnTo"/> is a path at or beneath the app's address.</summary>
    public static bool IsInside(string appAddress, string? returnTo)
    {
        if (string.IsNullOrEmpty(returnTo) || !returnTo.StartsWith('/') || returnTo.StartsWith("//", StringComparison.Ordinal)
            || returnTo.Contains('\\', StringComparison.Ordinal) || returnTo.Contains("/../", StringComparison.Ordinal) || returnTo.EndsWith("/..", StringComparison.Ordinal)
            || returnTo.Any(char.IsControl))
        {
            return false;
        }

        var path = returnTo.Split('?', '#')[0];
        return path == appAddress || path.StartsWith(appAddress + "/", StringComparison.Ordinal) || (appAddress.Length == 0 && path.StartsWith('/'));
    }

    private async Task SignOutAsync(HttpContext context)
    {
        var cookie = context.Request.Headers.Cookie.ToString();
        if (cookie.Length == 0)
        {
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/api/auth/logout"));
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
            logger.LogWarning("Signing out through the platform failed: {Message}", e.Message);
        }
    }
}
