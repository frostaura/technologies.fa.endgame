using Endgame.Application.Email;
using Endgame.Application.Gateway;
using Endgame.Application.Status;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Gateway;
using Endgame.Infrastructure.Health;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Sweeps;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Vault;
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
        var peers = configuration.GetSection(ServiceAddresses.SectionName).Get<ServiceAddresses>() ?? new ServiceAddresses();
        services.Configure<ServiceAddresses>(configuration.GetSection(ServiceAddresses.SectionName));
        services.AddHttpClient(HttpHealthProbe.ClientName);
        foreach (var endpoint in StatusOptions.Probes(peers, status.Services))
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
        services.AddScoped<MemoryService>();
        services.AddScoped<HireService>();
        services.AddScoped<OntologyService>();
        services.AddScoped<AccountService>();
        services.AddScoped<IGatewayContext, GatewayContext>();
        services.AddSingleton<LeaseSweep>();
        services.AddHostedService(sp => sp.GetRequiredService<LeaseSweep>());

        services.AddPlatformApi(configuration);

        services.AddModelGateway(configuration);
        return services;
    }

    /// <summary>The services apps reach through the platform API (PLATFORM-API.md), and the workers behind them.</summary>
    public static IServiceCollection AddPlatformApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<EnvelopeVault>();
        services.Configure<AppModelOptions>(configuration.GetSection(AppModelOptions.SectionName));
        services.Configure<AppSessionOptions>(configuration.GetSection(AppSessionOptions.SectionName));
        services.Configure<SchedulerOptions>(configuration.GetSection(SchedulerOptions.SectionName));
        services.Configure<TelemetryOptions>(configuration.GetSection(TelemetryOptions.SectionName));
        services.Configure<HostingOptions>(configuration.GetSection(HostingOptions.SectionName));
        services.Configure<SmtpOptions>(configuration.GetSection(SmtpOptions.SectionName));
        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.SectionName));

        services.AddScoped<AppTokenService>();
        services.AddScoped<AppIdentityService>();
        services.AddScoped<AppModelService>();
        services.AddScoped<AppSecretService>();
        services.AddScoped<AppEmailService>();
        services.AddScoped<AppDeclarationService>();
        services.AddScoped<TelemetryService>();
        services.AddScoped<HostingMeter>();
        services.AddSingleton<EdgeNotifier>();
        services.AddSingleton<AppCallbackClient>();
        services.AddHttpClient(EdgeNotifier.ClientName);
        services.AddHttpClient(AppCallbackClient.ClientName);

        services.AddSingleton<IEmailSender, SmtpEmailSender>();
        services.AddSingleton<EmailDispatcher>();
        services.AddHostedService(sp => sp.GetRequiredService<EmailDispatcher>());
        services.AddSingleton<Scheduler>();
        services.AddHostedService(sp => sp.GetRequiredService<Scheduler>());
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
        var credits = configuration.GetSection(CreditOptions.SectionName).Get<CreditOptions>() ?? new CreditOptions();
        if (credits.Validate() is { Count: > 0 } creditFaults)
        {
            throw new InvalidOperationException("The credit settings are invalid:" + Environment.NewLine + string.Join(Environment.NewLine, creditFaults));
        }

        services.AddSingleton(credits);
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
