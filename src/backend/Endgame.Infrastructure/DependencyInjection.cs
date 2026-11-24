using Endgame.Application.Status;
using Endgame.Infrastructure.Health;
using Endgame.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Endgame.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "Endgame";

    public static IServiceCollection AddEndgameInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connection = configuration.GetConnectionString(ConnectionStringName)
            ?? throw new InvalidOperationException($"ConnectionStrings:{ConnectionStringName} is required.");
        services.AddDbContext<EndgameDbContext>(options => options.UseNpgsql(connection));

        var status = configuration.GetSection(StatusOptions.SectionName).Get<StatusOptions>() ?? new StatusOptions();
        var timeout = TimeSpan.FromMilliseconds(status.ProbeTimeoutMs);
        services.AddHttpClient(HttpHealthProbe.ClientName);
        foreach (var endpoint in status.Services)
        {
            services.AddScoped<IServiceHealthProbe>(sp =>
                new HttpHealthProbe(endpoint, sp.GetRequiredService<IHttpClientFactory>(), timeout));
        }

        services.AddScoped<IServiceHealthProbe>(sp =>
            new DatabaseHealthProbe(sp.GetRequiredService<EndgameDbContext>(), timeout));
        return services;
    }

    /// <summary>Applies pending migrations. Called at startup only when <c>Database:AutoMigrateOnStartup</c> is true.</summary>
    public static async Task MigrateEndgameDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DependencyInjection));
        // Migrate first, then report: asking for pending migrations on an empty database queries a
        // history table that does not exist yet, and EF logs that as a failed command.
        await db.Database.MigrateAsync(cancellationToken);
        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();
        logger.LogInformation("Database schema at {Migration} ({Count} migration(s) applied).", applied.LastOrDefault(), applied.Count);
    }
}
