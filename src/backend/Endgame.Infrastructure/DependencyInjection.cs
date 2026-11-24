using Endgame.Application.Gateway;
using Endgame.Application.Status;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Gateway;
using Endgame.Infrastructure.Health;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Sweeps;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
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
        services.AddScoped<TenantSession>();
        services.AddScoped<TenantConnectionInterceptor>();
        services.AddScoped<TenantCommandInterceptor>();
        services.AddDbContext<EndgameDbContext>((sp, options) => options
            .UseNpgsql(connection)
            .AddInterceptors(sp.GetRequiredService<TenantConnectionInterceptor>(), sp.GetRequiredService<TenantCommandInterceptor>()));

        // The key ring lives in the platform database, so cookies and vault entries survive restarts.
        services.AddDataProtection().SetApplicationName("endgame-control-plane").PersistKeysToDbContext<EndgameDbContext>();

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

        services.Configure<OperatorOptions>(configuration.GetSection(OperatorOptions.SectionName));
        services.Configure<AddressOptions>(configuration.GetSection(AddressOptions.SectionName));
        services.Configure<SweepOptions>(configuration.GetSection(SweepOptions.SectionName));

        services.AddScoped<ScopeResolver>();
        services.AddScoped<AccessService>();
        services.AddScoped<CascadeService>();
        services.AddScoped<CreditLedger>();
        services.AddScoped<ICreditLedger>(sp => sp.GetRequiredService<CreditLedger>());
        services.AddScoped<TreeService>();
        services.AddScoped<ReadModels>();
        services.AddScoped<RunService>();
        services.AddScoped<TaskService>();
        services.AddScoped<ApprovalService>();
        services.AddScoped<IdeaService>();
        services.AddScoped<ConversationService>();
        services.AddScoped<EmployeeService>();
        services.AddScoped<AccountService>();
        services.AddScoped<IGatewayContext, GatewayContext>();
        services.AddHostedService<LeaseSweep>();

        services.AddModelGateway(configuration);
        return services;
    }

    /// <summary>The routing table, validated at start-up, and the one client that holds the OpenRouter key.</summary>
    public static IServiceCollection AddModelGateway(this IServiceCollection services, IConfiguration configuration)
    {
        var gateway = configuration.GetSection(ModelGatewayOptions.SectionName).Get<ModelGatewayOptions>() ?? new ModelGatewayOptions();
        var faults = gateway.Validate();
        if (faults.Count > 0)
        {
            throw new InvalidOperationException("The model routing table is invalid:" + Environment.NewLine + string.Join(Environment.NewLine, faults));
        }

        services.AddSingleton(gateway);
        services.AddSingleton(configuration.GetSection(CreditOptions.SectionName).Get<CreditOptions>() ?? new CreditOptions());
        services.AddHttpClient<IModelProvider, OpenRouterProvider>(OpenRouterProvider.ClientName, client =>
            client.Timeout = TimeSpan.FromSeconds(gateway.RequestTimeoutSeconds));
        services.AddScoped<ModelGateway>();
        services.AddSingleton(configuration.GetSection(EstimateOptions.SectionName).Get<EstimateOptions>() ?? new EstimateOptions());
        services.AddSingleton<ResearchEstimator>();
        return services;
    }

    /// <summary>Identity with passkeys (schema version 3) on the platform database. No passwords are ever set.</summary>
    public static IdentityBuilder AddEndgameIdentity(this IServiceCollection services) =>
        services
            .AddIdentityCore<EndgameUser>(options =>
            {
                IdentityStoreOptions.Apply(options);
                options.User.RequireUniqueEmail = true;
                options.User.AllowedUserNameCharacters += "+";
            })
            .AddSignInManager()
            .AddEntityFrameworkStores<EndgameDbContext>();

    /// <summary>
    /// Applies pending migrations. Called at startup only when <c>Database:AutoMigrateOnStartup</c> is
    /// true. Runs as the connecting role, with no tenant session: migrations own the schema, the roles
    /// and the policies that every other connection is then held to.
    /// </summary>
    public static async Task MigrateEndgameDatabaseAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DependencyInjection));
        var options = new DbContextOptionsBuilder<EndgameDbContext>()
            .UseNpgsql(configuration.GetConnectionString(ConnectionStringName))
            .UseApplicationServiceProvider(scope.ServiceProvider)
            .Options;
        await using var db = new EndgameDbContext(options);
        // Migrate first, then report: asking for pending migrations on an empty database queries a
        // history table that does not exist yet, and EF logs that as a failed command.
        await db.Database.MigrateAsync(cancellationToken);
        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();
        logger.LogInformation("Database schema at {Migration} ({Count} migration(s) applied).", applied.LastOrDefault(), applied.Count);
    }
}
