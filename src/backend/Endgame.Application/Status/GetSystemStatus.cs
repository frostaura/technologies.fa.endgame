namespace Endgame.Application.Status;

/// <summary>
/// Use case: the live health of every service. Probes run concurrently, so the report takes as long
/// as the slowest service rather than the sum of them. The whole is healthy only if every part is.
/// </summary>
public sealed class GetSystemStatus(IEnumerable<IServiceHealthProbe> probes, TimeProvider clock)
{
    public async Task<SystemStatus> HandleAsync(CancellationToken cancellationToken)
    {
        var ordered = probes.OrderBy(p => p.Order).ThenBy(p => p.Key, StringComparer.Ordinal).ToList();
        var results = await Task.WhenAll(ordered.Select(p => ProbeSafelyAsync(p, cancellationToken)));
        var overall = results.Length > 0 && results.All(r => r.State == HealthState.Healthy)
            ? HealthState.Healthy
            : HealthState.Unhealthy;
        return new SystemStatus(overall, clock.GetUtcNow(), results);
    }

    /// <summary>A probe that breaks its contract and throws still yields a row, marked unhealthy.</summary>
    private static async Task<ServiceHealth> ProbeSafelyAsync(IServiceHealthProbe probe, CancellationToken cancellationToken)
    {
        try
        {
            return await probe.ProbeAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            return new ServiceHealth(probe.Key, probe.Name, HealthState.Unhealthy, 0, ex.Message);
        }
    }
}
