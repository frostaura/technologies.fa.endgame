using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Endgame.AppKit;

/// <summary>
/// The one HTTP path to the platform. Every typed client goes through here, so the app token, the
/// egress proxy and error translation are written once.
/// </summary>
internal sealed class PlatformClient(IHttpClientFactory factory)
{
    internal const string HttpClientName = "Endgame.Platform";

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var response = await SendRawAsync(method, path, body, ct);
        var result = await response.Content.ReadFromJsonAsync<T>(Json, ct);
        return result ?? throw new EndgamePlatformException($"The platform answered {method} {path} with an empty body.", response.StatusCode);
    }

    public async Task SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var response = await SendRawAsync(method, path, body, ct);
    }

    private async Task<HttpResponseMessage> SendRawAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        if (path.StartsWith('/'))
        {
            throw new ArgumentException("Platform paths are relative to ENDGAME_PLATFORM_URL; drop the leading slash.", nameof(path));
        }

        var client = factory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType(), options: Json);
        }

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw new EndgamePlatformUnavailableException(
                $"The platform at {client.BaseAddress} could not be reached for {method} {path}: {e.Message}. " +
                $"Check {EndgameEnvironment.PlatformUrl} and {EndgameEnvironment.EgressProxy}.", e);
        }
        catch (TaskCanceledException e) when (!ct.IsCancellationRequested)
        {
            throw new EndgamePlatformUnavailableException($"The platform did not answer {method} {path} within {client.Timeout.TotalSeconds:0}s.", e);
        }

        if (response.IsSuccessStatusCode)
        {
            return response;
        }

        using (response)
        {
            throw await ToException(method, path, response, ct);
        }
    }

    private static async Task<EndgamePlatformException> ToException(HttpMethod method, string path, HttpResponseMessage response, CancellationToken ct)
    {
        PlatformProblem? problem = null;
        try
        {
            problem = await response.Content.ReadFromJsonAsync<PlatformProblem>(Json, ct);
        }
        catch (JsonException)
        {
            // Not a problem document; the status alone has to explain it.
        }

        var detail = problem?.Detail ?? problem?.Title ?? response.ReasonPhrase ?? "no detail";
        var code = problem?.Code;
        return (response.StatusCode, code) switch
        {
            (HttpStatusCode.Unauthorized, _) => new EndgamePlatformException(
                $"The platform refused this app's token ({EndgameEnvironment.AppToken}) on {method} {path}: {Sentence(detail)} " +
                "The token is injected when the app starts; a restarted app gets a fresh one.", response.StatusCode, code ?? "app_token_invalid"),
            (_, "budget_exhausted") => new EndgameBudgetExhaustedException($"The credit budget for this app is spent: {detail}"),
            (_, "overdraft_limit") => new EndgameOverdraftLimitException($"{problem?.Title ?? OverdraftTitle}: {detail}"),
            (_, "secret_not_found") => new EndgameSecretNotFoundException(path.Split('/')[^1], detail),
            _ => new EndgamePlatformException($"The platform answered {method} {path} with {(int)response.StatusCode}: {detail}", response.StatusCode, code),
        };
    }

    /// <summary>The platform's own title for an <c>overdraft_limit</c> refusal (the model gateway's words).</summary>
    internal const string OverdraftTitle = "The overdraft limit is reached";

    /// <summary>The text as one sentence: exactly one full stop at the end, however the platform ended it.</summary>
    private static string Sentence(string text) => text.TrimEnd().TrimEnd('.') + ".";

    internal static void Configure(HttpClient client, EndgameSettings settings)
    {
        client.BaseAddress = settings.RequiredPlatformUrl;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.RequiredAppToken);
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Endgame.AppKit", typeof(PlatformClient).Assembly.GetName().Version?.ToString(3)));
        client.Timeout = TimeSpan.FromSeconds(120);
    }

    internal static HttpMessageHandler CreateHandler(EndgameSettings settings) => new SocketsHttpHandler
    {
        Proxy = settings.EgressProxy is null ? null : new WebProxy(settings.EgressProxy) { BypassProxyOnLocal = false },
        UseProxy = settings.EgressProxy is not null,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    };

    private sealed record PlatformProblem(string? Type, string? Title, string? Detail, int? Status, string? Code);
}
