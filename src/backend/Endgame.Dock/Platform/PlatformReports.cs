using System.Net.Http.Headers;
using System.Net.Http.Json;
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

    public Task PublishedAsync(AppPublished report, CancellationToken cancellationToken) =>
        SendAsync(options.Value.ControlPlaneUrl, $"/internal/apps/{report.AppId:D}/published", report, cancellationToken);

    public Task StateChangedAsync(AppStateReport report, CancellationToken cancellationToken) =>
        Task.WhenAll(
            SendAsync(options.Value.EdgeControlUrl, $"/internal/apps/{report.AppId:D}/state", report, cancellationToken),
            SendAsync(options.Value.ControlPlaneUrl, $"/internal/apps/{report.AppId:D}/state", report, cancellationToken));

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
