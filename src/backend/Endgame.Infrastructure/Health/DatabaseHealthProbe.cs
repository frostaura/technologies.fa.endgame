using System.Diagnostics;
using Endgame.Application.Status;
using Endgame.Infrastructure.Persistence;

namespace Endgame.Infrastructure.Health;

/// <summary>Opens a real connection to the platform database and runs a trivial query.</summary>
public sealed class DatabaseHealthProbe(EndgameDbContext db, TimeSpan timeout) : IServiceHealthProbe
{
    public string Key => "database";

    public string Name => "Database";

    public int Order => 50;

    public async Task<ServiceHealth> ProbeAsync(CancellationToken cancellationToken)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        var watch = Stopwatch.StartNew();
        try
        {
            var reachable = await db.Database.CanConnectAsync(timeoutSource.Token);
            return new ServiceHealth(Key, Name, reachable ? HealthState.Healthy : HealthState.Unhealthy,
                watch.ElapsedMilliseconds, reachable ? null : "Could not connect.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new ServiceHealth(Key, Name, HealthState.Unhealthy, watch.ElapsedMilliseconds,
                $"No answer within {timeout.TotalMilliseconds:0} ms.");
        }
    }
}
