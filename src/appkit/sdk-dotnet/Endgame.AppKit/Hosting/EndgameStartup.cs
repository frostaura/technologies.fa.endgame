using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.AppKit;

/// <summary>
/// Everything that must be true before the app takes its first request, checked in one place:
/// the API contract, the built front end, and the database schema. Each failure stops the app with
/// a message that names the fix.
/// </summary>
/// <summary>
/// The app's endpoints, captured by <c>UseEndgameApp</c>. The routing system only publishes them
/// once the server has started, which is too late for the start-up checks.
/// </summary>
internal sealed class EndgameEndpoints
{
    internal ICollection<EndpointDataSource>? Sources { get; set; }

    internal IReadOnlyList<Microsoft.AspNetCore.Http.Endpoint> All =>
        Sources?.SelectMany(s => s.Endpoints).ToList()
        ?? throw new InvalidOperationException(
            "Endgame app kit: app.UseEndgameApp() was not called. Call it right after builder.Build(), before mapping your endpoints.");
}

internal sealed partial class EndgameStartup<TDb>(
    IServiceProvider services,
    EndgameEndpoints endpoints,
    SpaHost spa,
    IOptions<EndgameSettings> settings,
    ILogger<EndgameStartup<TDb>> logger,
    IHostApplicationLifetime lifetime) : IHostedLifecycleService where TDb : DbContext
{
    private static readonly TimeSpan DatabaseWait = TimeSpan.FromSeconds(30);

    public async Task StartingAsync(CancellationToken cancellationToken)
    {
        var problems = ApiContract.Problems(endpoints.All);
        if (problems.Count > 0)
        {
            throw new InvalidOperationException(ApiContract.Report(problems));
        }

        spa.Load();

        if (settings.Value.EgressProxy is { } egress)
        {
            // The app's own HttpClients go out the same way the kit's do.
            HttpClient.DefaultProxy = new WebProxy(egress);
        }

        await MigrateAsync(cancellationToken);
    }

    public Task StartedAsync(CancellationToken cancellationToken)
    {
        _ = Task.Run(() => DeclareAsync(lifetime.ApplicationStopping), CancellationToken.None);
        return Task.CompletedTask;
    }

    private async Task MigrateAsync(CancellationToken ct)
    {
        var clock = Stopwatch.StartNew();
        var delay = TimeSpan.FromMilliseconds(250);
        while (true)
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TDb>();
            try
            {
                await db.Database.MigrateAsync(ct);
                LogMigrated(logger, typeof(TDb).Name, clock.ElapsedMilliseconds);
                return;
            }
            catch (NpgsqlException e) when (e.IsTransient && clock.Elapsed < DatabaseWait)
            {
                await Task.Delay(delay, ct);
                delay = TimeSpan.FromMilliseconds(Math.Min(delay.TotalMilliseconds * 2, 2000));
            }
            catch (NpgsqlException e)
            {
                throw new InvalidOperationException(
                    $"Endgame app kit: could not migrate the database at {settings.Value.DatabaseForLogs()} ({EndgameEnvironment.Database}): {e.Message}", e);
            }
        }
    }

    private async Task DeclareAsync(CancellationToken ct)
    {
        var all = endpoints.All;
        var schedules = all.Select(e => e.Metadata.GetMetadata<ScheduleMetadata>()?.Declaration).OfType<ScheduleDeclaration>().ToList();
        var webhooks = all.Select(e => e.Metadata.GetMetadata<WebhookMetadata>()?.Declaration).OfType<WebhookDeclaration>().ToList();

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var scope = services.CreateScope();
                await scope.ServiceProvider.GetRequiredService<IEndgameSchedules>().DeclareAsync(schedules, ct);
                await scope.ServiceProvider.GetRequiredService<IEndgameWebhooks>().DeclareAsync(webhooks, ct);
                LogDeclared(logger, schedules.Count, webhooks.Count);
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (EndgamePlatformException e) when (attempt < 6)
            {
                LogDeclareRetry(logger, attempt, e.Message);
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            }
            catch (EndgamePlatformException e)
            {
                LogDeclareFailed(logger, schedules.Count, webhooks.Count, e.Message);
                return;
            }
        }
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StoppingAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [LoggerMessage(Level = LogLevel.Information, Message = "Database for {Context} is migrated ({ElapsedMs} ms).")]
    private static partial void LogMigrated(ILogger logger, string context, long elapsedMs);

    [LoggerMessage(Level = LogLevel.Information, Message = "Declared {Schedules} schedule(s) and {Webhooks} webhook(s) to the platform.")]
    private static partial void LogDeclared(ILogger logger, int schedules, int webhooks);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Declaring schedules and webhooks failed (attempt {Attempt}); retrying: {Reason}")]
    private static partial void LogDeclareRetry(ILogger logger, int attempt, string reason);

    [LoggerMessage(Level = LogLevel.Error, Message = "Endgame app kit: the platform never accepted this app's {Schedules} schedule(s) and {Webhooks} webhook(s); they will not run until the app restarts: {Reason}")]
    private static partial void LogDeclareFailed(ILogger logger, int schedules, int webhooks, string reason);
}
