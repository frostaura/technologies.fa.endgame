using System.Net;
using System.Net.Http.Headers;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Edge.Runtime;

/// <summary>Dock's wake, stop and status calls, and the app's own health check.</summary>
public sealed class DockBackend(IHttpClientFactory http, IOptions<EdgeOptions> options, IConfiguration configuration, ILogger<DockBackend> logger) : IAppBackend
{
    public const string DockClient = "dock";
    public const string HealthClient = "app-health";

    public async Task<WakeStart> WakeAsync(Guid appId, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendAsync(HttpMethod.Post, $"/internal/apps/{appId:D}/wake", cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return WakeStart.Started;
            }

            var code = await ProblemCodeAsync(response, cancellationToken);
            logger.LogWarning("Dock refused to wake app {AppId}: {Status} {Code}.", appId, (int)response.StatusCode, code);
            return code switch
            {
                DockProblemCodes.NotPublished => WakeStart.NotPublished,
                DockProblemCodes.Capacity => WakeStart.NoCapacity,
                _ => WakeStart.Unreachable,
            };
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Dock did not answer a wake for app {AppId}: {Message}", appId, e.Message);
            return WakeStart.Unreachable;
        }
    }

    public async Task<bool> StopAsync(Guid appId, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendAsync(HttpMethod.Post, $"/internal/apps/{appId:D}/stop", cancellationToken);
            return response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Dock did not answer a stop for app {AppId}: {Message}", appId, e.Message);
            return false;
        }
    }

    public async Task<AppStatus?> StatusAsync(Guid appId, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendAsync(HttpMethod.Get, $"/internal/apps/{appId:D}", cancellationToken);
            return response.IsSuccessStatusCode ? await response.Content.ReadFromJsonAsync<AppStatus>(cancellationToken) : null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException && !cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    public async Task<bool> HealthyAsync(string target, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await http.CreateClient(HealthClient).GetAsync(new Uri(new Uri(target), HostingConventions.AppHealthPath), HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (Exception e) when (e is HttpRequestException || (e is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            return false;
        }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, new Uri(new Uri(options.Value.DockUrl), path));
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
        return await http.CreateClient(DockClient).SendAsync(request, cancellationToken);
    }

    private static async Task<string?> ProblemCodeAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var problem = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(cancellationToken);
            return problem.TryGetProperty("code", out var code) ? code.GetString() : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
