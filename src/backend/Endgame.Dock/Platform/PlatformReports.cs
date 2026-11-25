using System.Net.Http.Headers;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Platform;

/// <summary>
/// What Dock tells the rest of the platform, unasked: a new version published (control plane),
/// and an app's state changing on its own — a crash above all (control plane and Edge, so a
/// visitor gets the unavailable page at once instead of waiting out a timeout).
/// </summary>
public sealed class PlatformReports(IHttpClientFactory http, IOptions<DockOptions> options, IConfiguration configuration, ILogger<PlatformReports> logger)
{
    public const string ClientName = "platform";

    /// <summary>
    /// The app's platform token from the control plane (<c>POST /internal/apps/{id}/token</c>), or
    /// null when it could not be had — the caller then keeps the token the container already holds.
    /// </summary>
    public async Task<string?> AppTokenAsync(Guid appId, CancellationToken cancellationToken, bool preview = false)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ControlPlaneUrl), $"/internal/apps/{appId:D}/token{(preview ? "?preview=true" : "")}"));
            request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
            using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("The control plane answered {Status} for app {AppId}'s token.", (int)response.StatusCode, appId);
                return null;
            }

            return (await response.Content.ReadFromJsonAsync<AppTokenResult>(cancellationToken))?.Token is { Length: > 0 } token ? token : null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Could not get app {AppId}'s token: {Message}", appId, e.Message);
            return null;
        }
    }

    /// <summary>A new version is running: the commit its image was built from.</summary>
    public Task PublishedAsync(Guid appId, string commit, CancellationToken cancellationToken) =>
        SendAsync(options.Value.ControlPlaneUrl, $"/internal/apps/{appId:D}/published", new PublishedReport(commit), cancellationToken);

    /// <summary>The control plane's view of the app moved: running, sleeping, stopped or failed.</summary>
    public Task StatusAsync(Guid appId, string status, CancellationToken cancellationToken) =>
        SendAsync(options.Value.ControlPlaneUrl, $"/internal/apps/{appId:D}/state", new ControlPlaneAppState(status), cancellationToken);

    /// <summary>The app crashed: Edge first, so visitors get the page at once, then the control plane.</summary>
    public Task CrashedAsync(AppStateReport report, CancellationToken cancellationToken) =>
        Task.WhenAll(
            SendAsync(options.Value.EdgeControlUrl, $"/internal/apps/{report.AppId:D}/state", report, cancellationToken),
            StatusAsync(report.AppId, ControlPlaneAppState.Failed, cancellationToken));

    private async Task SendAsync<T>(string baseUrl, string path, T body, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            return;
        }

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), path)) { Content = JsonContent.Create(body) };
                request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, configuration[HostingConventions.ServiceTokenVariable]);
                using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    return;
                }

                logger.LogWarning("{Url}{Path} answered {Status}.", baseUrl, path, (int)response.StatusCode);
                if ((int)response.StatusCode is >= 400 and < 500)
                {
                    return; // the receiver understood and refused; retrying will not change that
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning("Could not report to {Url}{Path} (attempt {Attempt}): {Message}", baseUrl, path, attempt, e.Message);
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200 * attempt), cancellationToken);
        }
    }
}
