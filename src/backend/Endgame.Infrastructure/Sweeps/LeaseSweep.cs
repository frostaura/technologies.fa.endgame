using Endgame.Infrastructure.Credits;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Sweeps;

public sealed class SweepOptions
{
    public const string SectionName = "Sweeps";

    public bool Enabled { get; set; } = true;

    public int IntervalSeconds { get; set; } = 30;

    /// <summary>How long past its lease a reservation waits before a release is written for it.</summary>
    public int ReleaseGraceSeconds { get; set; } = 120;
}

/// <summary>
/// Writes an explicit release for every reservation that lapsed with its run's lease (ARCH-002: leaked
/// holds release themselves). The hold already stopped counting the moment the lease lapsed; this makes
/// the ledger say so. Deferred is never final: a failed pass is retried on the next tick.
/// </summary>
public sealed class LeaseSweep(IServiceScopeFactory scopes, IOptions<SweepOptions> options, ILogger<LeaseSweep> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.IntervalSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var ledger = scope.ServiceProvider.GetRequiredService<CreditLedger>();
                var released = await ledger.ReleaseLapsedAsync(TimeSpan.FromSeconds(options.Value.ReleaseGraceSeconds), stoppingToken);
                if (released > 0)
                {
                    logger.LogInformation("Released {Count} lapsed credit reservation(s).", released);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "The lease sweep failed; it runs again on the next tick.");
            }
        }
    }
}
