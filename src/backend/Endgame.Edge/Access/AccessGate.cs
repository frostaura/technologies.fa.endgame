using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Endgame.Edge.Routing;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Access;

/// <summary>Whether a request may reach an app, and the app-scoped session to give it.</summary>
public sealed record AccessDecision(string Decision, string? SessionToken, string? SignInUrl)
{
    public const string UnavailableDecision = "unavailable";

    public static readonly AccessDecision Unavailable = new(UnavailableDecision, null, null);

    public static readonly AccessDecision Anonymous = new(AccessDecisions.Allow, null, null);

    public bool Allowed => Decision == AccessDecisions.Allow;
}

/// <summary>
/// Enforces private, shared and public at the edge (spec, "Apps are private by default"). The
/// control plane owns sessions and decides, per app, through <c>POST /internal/access/check</c>;
/// the answer is reused briefly for the same cookie and app. Whenever a session ends — a console
/// sign-out, an app sign-out, an unshare — the control plane tells the edge to forget every answer it
/// holds (<c>POST /internal/access/forget</c>), so the very next request is asked again (D53, R2-10):
/// a reused answer must never outlive the session it was given for. When the control plane does not
/// answer — down, an error, or no such endpoint — a private or shared app is closed and a public one
/// opens with no session. Nothing at the edge ever decides access on its own.
/// </summary>
public sealed class AccessGate(IHttpClientFactory http, IOptions<EdgeOptions> options, IConfiguration configuration, TimeProvider time, ILogger<AccessGate> logger)
{
    public const string ClientName = "access";
    private readonly ConcurrentDictionary<string, (AccessDecision Decision, DateTimeOffset Until)> cache = new();

    /// <param name="app">The app.</param>
    /// <param name="context">The request.</param>
    /// <param name="pathInApp">The request's path below the app's address, with its query.</param>
    /// <param name="cancellationToken">Aborts with the request.</param>
    public async Task<AccessDecision> CheckAsync(EdgeApp app, HttpContext context, string pathInApp, CancellationToken cancellationToken)
    {
        var cookie = context.Request.Headers.Cookie.ToString();
        var isPublic = app.Access == AppAccess.Public;
        if (isPublic && cookie.Length == 0)
        {
            return AccessDecision.Anonymous;
        }

        var key = $"{app.AppId:N}:{app.Access}:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cookie)))}";
        var now = time.GetUtcNow();
        if (cache.TryGetValue(key, out var hit) && hit.Until > now)
        {
            return hit.Decision;
        }

        AccessDecision decision;
        try
        {
            decision = await AskAsync(new AccessCheckRequest(app.AppId, cookie.Length > 0 ? cookie : null, pathInApp), cancellationToken);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("The access check for app {AppId} failed: {Message}", app.AppId, e.Message);
            decision = AccessDecision.Unavailable;
        }

        if (isPublic)
        {
            // Anyone may open a public app; a session only tells the app who they are.
            return decision.Allowed ? Remember(key, decision, now) : AccessDecision.Anonymous;
        }

        return decision.Decision == AccessDecision.UnavailableDecision ? decision : Remember(key, decision, now);
    }

    /// <summary>Drops every reused answer: the next request for any app, on any host, is asked again.</summary>
    public void Forget() => cache.Clear();

    private AccessDecision Remember(string key, AccessDecision decision, DateTimeOffset now)
    {
        cache[key] = (decision, now.AddSeconds(Math.Max(0, options.Value.AccessCacheSeconds)));
        if (cache.Count > 10_000)
        {
            foreach (var stale in cache.Where(e => e.Value.Until <= now).Select(e => e.Key).ToList())
            {
                cache.TryRemove(stale, out _);
            }
        }

        return decision;
    }

    /// <summary>The control plane's decision; <see cref="AccessDecision.Unavailable"/> for anything but a valid answer.</summary>
    private async Task<AccessDecision> AskAsync(AccessCheckRequest body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/access/check")) { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
        using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("The access check for app {AppId} answered {Status}.", body.AppId, (int)response.StatusCode);
            return AccessDecision.Unavailable;
        }

        var result = await response.Content.ReadFromJsonAsync<AccessCheckResult>(cancellationToken);
        if (result?.Decision is AccessDecisions.Deny && result.Reason is { Length: > 0 } reason)
        {
            logger.LogDebug("App {AppId} refused a visitor: {Reason}", body.AppId, reason);
        }

        return result?.Decision is AccessDecisions.Allow or AccessDecisions.SignIn or AccessDecisions.Deny
            ? new AccessDecision(result.Decision, result.SessionToken, result.SignInUrl)
            : AccessDecision.Unavailable;
    }
}
