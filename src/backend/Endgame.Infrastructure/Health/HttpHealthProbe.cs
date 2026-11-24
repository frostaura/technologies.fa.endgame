using System.Diagnostics;
using System.Text.Json;
using Endgame.Application.Status;

namespace Endgame.Infrastructure.Health;

/// <summary>Calls a service's <c>/health</c>. A 2xx is healthy; anything else, or no answer in time, is not.</summary>
public sealed class HttpHealthProbe(ServiceEndpoint endpoint, IHttpClientFactory clients, TimeSpan timeout) : IServiceHealthProbe
{
    public const string ClientName = "health-probe";

    public string Key => endpoint.Key;

    public string Name => endpoint.Name;

    public int Order => endpoint.Order;

    public async Task<ServiceHealth> ProbeAsync(CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(endpoint.HealthUrl, UriKind.Absolute, out var url))
        {
            return Result(HealthState.Unhealthy, 0, "No health address is configured for this service.");
        }

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        var watch = Stopwatch.StartNew();
        try
        {
            using var response = await clients.CreateClient(ClientName).GetAsync(url, timeoutSource.Token);
            var body = await response.Content.ReadAsStringAsync(timeoutSource.Token);
            var detail = DetailFrom(body);
            return response.IsSuccessStatusCode
                ? Result(HealthState.Healthy, watch.ElapsedMilliseconds, detail)
                : Result(HealthState.Unhealthy, watch.ElapsedMilliseconds, detail ?? $"Answered {(int)response.StatusCode}.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Result(HealthState.Unhealthy, watch.ElapsedMilliseconds, $"No answer within {timeout.TotalMilliseconds:0} ms.");
        }
        catch (HttpRequestException ex)
        {
            return Result(HealthState.Unhealthy, watch.ElapsedMilliseconds, $"Unreachable: {ex.Message}");
        }
    }

    private ServiceHealth Result(HealthState state, long latencyMs, string? detail) =>
        new(endpoint.Key, endpoint.Name, state, latencyMs, detail);

    /// <summary>A service may say something about itself in a <c>detail</c> field; it is passed through.</summary>
    private static string? DetailFrom(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("detail", out var detail)
                && detail.ValueKind == JsonValueKind.String
                    ? detail.GetString()
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
