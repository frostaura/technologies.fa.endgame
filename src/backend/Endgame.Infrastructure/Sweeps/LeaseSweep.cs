using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tenancy;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Sweeps;

public sealed class SweepOptions
{
    public const string SectionName = "Sweeps";

    public bool Enabled { get; set; } = true;

    public int IntervalSeconds { get; set; } = 30;

    /// <summary>How long past its lease a reservation, or a run, waits before the sweep acts on it.</summary>
    public int ReleaseGraceSeconds { get; set; } = 120;
}

/// <summary>What one sweep did.</summary>
/// <param name="EmployeesReleased">Idle employees released where autonomy is auto (an idle workforce is never paid for).</param>
/// <param name="ContractorsClosed">Contractors still open although the run that briefed them has ended (D73): closed.</param>
public sealed record SweepResult(int ReservationsReleased, int RunsRequeued, int TasksReleased, int TelemetryPruned, int EmployeesReleased = 0, int ContractorsClosed = 0);

/// <summary>
/// The platform's housekeeping, every <see cref="SweepOptions.IntervalSeconds"/> (ARCH-002: leaked
/// holds release themselves). It writes an explicit release for every credit reservation that lapsed
/// with its lease — the hold already stopped counting when it lapsed; this makes the ledger say so —
/// puts every running run whose lease lapsed back in the queue with no holder (the Runner claims it
/// again and replays its log), releases the tasks such a run held, prunes telemetry past its
/// retention, releases employees flagged idle where autonomy is auto (their memory archived, never
/// deleted), and closes contractors still open after the run that briefed them ended. A failed pass is retried on the next tick. It never charges anything: an overdraft
/// carries no interest and no fees (CLAUDE.md rule 3).
/// </summary>
public sealed class LeaseSweep(IServiceScopeFactory scopes, IOptions<SweepOptions> options, ILogger<LeaseSweep> logger, TimeProvider clock) : BackgroundService
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
                var result = await SweepOnceAsync(stoppingToken);
                if (result.ReservationsReleased + result.RunsRequeued + result.TasksReleased + result.EmployeesReleased + result.ContractorsClosed > 0)
                {
                    logger.LogInformation("Sweep: released {Reservations} lapsed reservation(s), requeued {Runs} run(s), released {Tasks} task(s) whose lease lapsed and {Employees} idle employee(s), closed {Contractors} contractor(s) of ended runs.",
                        result.ReservationsReleased, result.RunsRequeued, result.TasksReleased, result.EmployeesReleased, result.ContractorsClosed);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "The sweep failed; it runs again on the next tick.");
            }
        }
    }

    public async Task<SweepResult> SweepOnceAsync(CancellationToken cancellationToken)
    {
        var grace = TimeSpan.FromSeconds(options.Value.ReleaseGraceSeconds);
        await using var scope = scopes.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var released = await services.GetRequiredService<CreditLedger>().ReleaseLapsedAsync(grace, cancellationToken);
        var (runs, tasks) = await RequeueLapsedRunsAsync(services, grace, cancellationToken);
        var pruned = await services.GetRequiredService<TelemetryService>().PruneAsync(cancellationToken);
        var idle = await services.GetRequiredService<Work.EmployeeService>().ReleaseIdleAsync(cancellationToken);
        var contractors = await services.GetRequiredService<Runs.RunService>().CloseStrandedContractorsAsync(cancellationToken);
        return new SweepResult(released, runs, tasks, pruned, idle, contractors);
    }

    private async Task<(int Runs, int Tasks)> RequeueLapsedRunsAsync(IServiceProvider services, TimeSpan grace, CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<EndgameDbContext>();
        services.GetRequiredService<TenantSession>().UseSystem();
        var cutoff = clock.GetUtcNow() - grace;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await using var runs = await db.CommandAsync("""
            WITH lapsed AS (
                UPDATE runs SET status = 'queued', lease_holder = NULL, lease_expires_at = NULL
                WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < @cutoff
                RETURNING organisation_id, id
            ), freed AS (
                UPDATE tasks t SET status = 'todo', holder_run_id = NULL, holder_employee_id = NULL, claimed_at = NULL, updated_at = @now
                FROM lapsed WHERE t.organisation_id = lapsed.organisation_id AND t.holder_run_id = lapsed.id AND t.status = 'in_progress'
                RETURNING t.id
            )
            SELECT (SELECT COUNT(*) FROM lapsed), (SELECT COUNT(*) FROM freed)
            """, cancellationToken, P("cutoff", cutoff), P("now", clock.GetUtcNow()));
        int requeued, freedTasks;
        await using (var reader = await runs.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            requeued = (int)reader.GetInt64(0);
            freedTasks = (int)reader.GetInt64(1);
        }

        await transaction.CommitAsync(cancellationToken);
        return (requeued, freedTasks);
    }
}
