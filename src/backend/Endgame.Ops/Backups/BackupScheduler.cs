namespace Endgame.Ops.Backups;

/// <summary>The latest attempt, as <c>/health</c> and <c>GET /internal/ops/backups</c> show it. In memory: the store is the durable record.</summary>
public sealed class BackupStatus
{
    private readonly Lock gate = new();

    public BackupAttempt? Last { get; private set; }

    public BackupAttempt? Running { get; private set; }

    public void Started(DateTimeOffset at, string trigger)
    {
        lock (gate)
        {
            Running = new BackupAttempt(trigger, at, null, "running", null, null, null);
        }
    }

    public void Succeeded(DateTimeOffset at, BackupResult result)
    {
        lock (gate)
        {
            Last = (Running ?? new BackupAttempt("unknown", at, null, "running", null, null, null)) with
            {
                FinishedAt = at,
                Outcome = "succeeded",
                Id = result.Id,
                ArchiveBytes = result.ArchiveBytes,
            };
            Running = null;
        }
    }

    public void Failed(DateTimeOffset at, string error)
    {
        lock (gate)
        {
            Last = (Running ?? new BackupAttempt("unknown", at, null, "running", null, null, null)) with
            {
                FinishedAt = at,
                Outcome = "failed",
                Error = error,
            };
            Running = null;
        }
    }
}

public sealed record BackupAttempt(
    string Trigger,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    string Outcome,
    string? Id,
    long? ArchiveBytes,
    string? Error);

/// <summary>
/// The nightly backup: a timer inside the service, not cron in CI. Every few minutes it asks the
/// store whether today's archive exists; once the configured hour has passed and it does not, it
/// runs one under the PostgreSQL lease, so a second Ops instance or a <c>make backup</c> at the
/// same moment waits its turn instead of running twice. A failure is retried at the next check.
/// </summary>
public sealed class BackupScheduler(
    BackupOptions options,
    BackupService backups,
    TimeProvider clock,
    ILogger<BackupScheduler> logger) : BackgroundService
{
    /// <summary>When the scheduler next looks, for <c>/health</c>.</summary>
    public DateTimeOffset? NextCheckAt { get; private set; }

    /// <summary>Whether a backup is due now, given what the store holds.</summary>
    public static bool IsDue(DateTimeOffset now, IReadOnlyList<StoredBackup> stored, int hourUtc)
    {
        if (stored.Count == 0)
        {
            return true;
        }

        var newest = stored.Max(b => b.CreatedAt).UtcDateTime;
        var today = now.UtcDateTime.Date;
        return newest < today && now.UtcDateTime.Hour >= hourUtc;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.ScheduleEnabled)
        {
            logger.LogInformation("The nightly backup schedule is switched off (Ops__Backup__ScheduleEnabled=false).");
            return;
        }

        if (options.WhyRefused() is { } why)
        {
            logger.LogWarning("No nightly backup will run: {Why}", why);
            return;
        }

        var interval = TimeSpan.FromMinutes(Math.Max(1, options.CheckMinutes));
        // A short pause first, so a restarting stack's database is answering before the first check.
        NextCheckAt = clock.GetUtcNow().AddSeconds(30);
        await Task.Delay(TimeSpan.FromSeconds(30), clock, stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var stored = await backups.ListAsync(stoppingToken);
                if (IsDue(clock.GetUtcNow(), stored, options.HourUtc))
                {
                    if (await backups.HasDataAsync(stoppingToken))
                    {
                        await backups.BackupAsync("nightly", stoppingToken);
                    }
                    else
                    {
                        logger.LogInformation("The nightly backup is due but every database is empty (a stack waiting for a restore?); skipped.");
                    }
                }
            }
            catch (BackupBusyException)
            {
                logger.LogInformation("The nightly backup found another backup or restore running; it will look again.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "The nightly backup failed; it will try again at the next check: {Message}", ex.Message);
            }

            NextCheckAt = clock.GetUtcNow().Add(interval);
            await Task.Delay(interval, clock, stoppingToken);
        }
    }
}
