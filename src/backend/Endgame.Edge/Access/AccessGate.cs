using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Access;

/// <summary>Whether a request may reach a private or shared app.</summary>
public sealed record AccessDecision(string Outcome, Guid? UserId, string? SignInUrl)
{
    public static readonly AccessDecision Unavailable = new("unavailable", null, null);

    public bool Allowed => Outcome == AccessOutcome.Allowed;
}

/// <summary>
/// Enforces private, shared and public at the edge, from the routing table. Public passes; the
/// other two ask the control plane, which owns sessions, and the answer is reused briefly for
/// the same session and app. When the control plane cannot answer, access is refused.
/// </summary>
public sealed class AccessGate(IHttpClientFactory http, IOptions<EdgeOptions> options, IConfiguration configuration, TimeProvider time, ILogger<AccessGate> logger)
{
    public const string ClientName = "access";
    private readonly ConcurrentDictionary<string, (AccessDecision Decision, DateTimeOffset Until)> cache = new();

    public async Task<AccessDecision> CheckAsync(AppRoute app, HttpContext context, CancellationToken cancellationToken)
    {
        if (app.Access == AppAccess.Public)
        {
            return new AccessDecision(AccessOutcome.Allowed, null, null);
        }

        var cookie = context.Request.Headers.Cookie.ToString();
        var key = $"{app.AppId:N}:{app.Access}:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cookie)))}";
        var now = time.GetUtcNow();
        if (cache.TryGetValue(key, out var hit) && hit.Until > now)
        {
            return hit.Decision;
        }

        var path = context.Request.PathBase + context.Request.Path + context.Request.QueryString;
        var body = new AccessCheckRequest(app.AppId, context.Request.Host.Value ?? "", path, cookie.Length > 0 ? cookie : null);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), "/internal/access/check")) { Content = JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
            using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("The access check for app {AppId} answered {Status}.", app.AppId, (int)response.StatusCode);
                return AccessDecision.Unavailable;
            }

            var result = await response.Content.ReadFromJsonAsync<AccessCheckResult>(cancellationToken);
            if (result?.Outcome is not (AccessOutcome.Allowed or AccessOutcome.SignInRequired or AccessOutcome.Forbidden))
            {
                return AccessDecision.Unavailable;
            }

            var decision = new AccessDecision(result.Outcome, result.UserId, result.SignInUrl);
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
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("The access check for app {AppId} failed: {Message}", app.AppId, e.Message);
            return AccessDecision.Unavailable;
        }
    }

}
