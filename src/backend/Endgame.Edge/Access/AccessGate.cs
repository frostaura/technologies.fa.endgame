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
/// the answer is reused briefly for the same cookie and app. Until that endpoint exists (404) the
/// visitor's own session, <c>GET /api/me</c>, decides by role and scope. When neither answers, a
/// private or shared app is closed; a public one opens with no session.
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
            decision = await AskAsync(new AccessCheckRequest(app.AppId, cookie.Length > 0 ? cookie : null, pathInApp), cancellationToken)
                ?? await FromSessionAsync(app, cookie, cancellationToken);
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

    /// <summary>A role granted at <paramref name="grant"/> applies at <paramref name="scope"/> and everything beneath it.</summary>
    public static bool Covers(string? grant, string scope) =>
        grant is { Length: > 0 } && (scope == grant || scope.StartsWith(grant + "/", StringComparison.Ordinal));

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

    /// <summary>The per-app decision. Null when the control plane does not offer it (404).</summary>
    private async Task<AccessDecision?> AskAsync(AccessCheckRequest body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/access/check")) { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
        using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("The access check for app {AppId} answered {Status}.", body.AppId, (int)response.StatusCode);
            return AccessDecision.Unavailable;
        }

        var result = await response.Content.ReadFromJsonAsync<AccessCheckResult>(cancellationToken);
        return result?.Decision is AccessDecisions.Allow or AccessDecisions.SignIn or AccessDecisions.Deny
            ? new AccessDecision(result.Decision, result.SessionToken, result.SignInUrl)
            : AccessDecision.Unavailable;
    }

    /// <summary>
    /// The fallback: <c>GET /api/me</c> with the visitor's cookie. Signed out is a sign-in; signed
    /// in, they are admitted only when one of their roles is granted on the app's scope or above it.
    /// People an app was shared with are not known here, so are refused. No session token can be
    /// minted this way, so the app sees the visitor as anonymous.
    /// </summary>
    private async Task<AccessDecision> FromSessionAsync(EdgeApp app, string cookie, CancellationToken cancellationToken)
    {
        if (cookie.Length == 0)
        {
            return new AccessDecision(AccessDecisions.SignIn, null, null);
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(options.Value.ControlPlaneUrl), "/api/me"));
        request.Headers.TryAddWithoutValidation("Cookie", cookie);
        using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            return new AccessDecision(AccessDecisions.SignIn, null, null);
        }

        if (!response.IsSuccessStatusCode)
        {
            return AccessDecision.Unavailable;
        }

        var me = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
        var covered = me.TryGetProperty("memberships", out var list) && list.ValueKind == JsonValueKind.Array
            && list.EnumerateArray().Any(m => m.TryGetProperty("scope", out var scope) && Covers(scope.GetString(), app.Scope));
        return new AccessDecision(covered ? AccessDecisions.Allow : AccessDecisions.Deny, null, null);
    }
}
