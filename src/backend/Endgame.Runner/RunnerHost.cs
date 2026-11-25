using System.Net.Http.Headers;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Hosting.Contracts;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Platform;
using Endgame.Runner.Workflows;

namespace Endgame.Runner;

/// <summary>Builds the Runner's web host: its health endpoint and the background service that claims and works runs.</summary>
public static class RunnerHost
{
    public static WebApplication Create(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // The Runner's settings file is runner.json, not appsettings.json: the test project references the
        // Runner beside the control plane, and two appsettings.json files would overwrite each other in its
        // output. Inserted first, so the environment and the command line still override it.
        var defaults = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory).AddJsonFile("runner.json", optional: false).Build();
        builder.Configuration.Sources.Insert(0, new Microsoft.Extensions.Configuration.ChainedConfigurationSource { Configuration = defaults, ShouldDisposeConfiguration = true });
        AddRunner(builder.Services, builder.Configuration);
        var app = builder.Build();
        var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
        app.MapGet("/health", (RunnerService runner) => Results.Ok(new { status = "healthy", service = "runner", revision, holder = runner.Holder, activeRuns = runner.Active.Count }));
        return app;
    }

    public static void AddRunner(IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(RunnerOptions.SectionName).Get<RunnerOptions>() ?? new RunnerOptions();
        var token = configuration[HostingConventions.ServiceTokenVariable];
        services.AddSingleton(options);
        services.AddSingleton(TimeProvider.System);
        services.AddHttpClient("control-plane", c => Configure(c, options.ControlPlaneUrl, token, TimeSpan.FromMinutes(10)));
        services.AddHttpClient("dock", c => Configure(c, options.DockUrl, token, TimeSpan.FromMinutes(20)));
        services.AddHttpClient("edge-control", c => Configure(c, options.EdgeControlUrl, token, TimeSpan.FromMinutes(2)));
        services.AddSingleton(sp => new ControlPlaneClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("control-plane")));
        services.AddSingleton(sp => new DockClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("dock")));
        services.AddSingleton<IModelClient>(sp => new GatewayModelClient(sp.GetRequiredService<IHttpClientFactory>().CreateClient("control-plane")));
        services.AddSingleton<IWorkspaceProvider>(sp => new DockWorkspaceProvider(sp.GetRequiredService<DockClient>()));
        services.AddSingleton(new AgentFactory(options));
        services.AddSingleton(new Estimator(options));
        services.AddSingleton<IPreviewProbe>(sp => new EdgePreviewProbe(sp.GetRequiredService<IHttpClientFactory>().CreateClient("edge-control")));
        services.AddSingleton<IAppCaller>(sp => new EdgeAppCaller(sp.GetRequiredService<IHttpClientFactory>().CreateClient("edge-control"), sp.GetRequiredService<ControlPlaneClient>()));
        services.AddSingleton(sp => new BuildWorkflow(sp.GetRequiredService<Estimator>(), sp.GetRequiredService<IPreviewProbe>(), sp.GetRequiredService<IAppCaller>()));
        services.AddSingleton<IWorkflow>(sp => new TaskWorkflow(sp.GetRequiredService<BuildWorkflow>()));
        services.AddSingleton<IWorkflow, ResearchWorkflow>();
        services.AddSingleton<IWorkflow>(sp => sp.GetRequiredService<BuildWorkflow>());
        services.AddSingleton<IWorkflow, ConversationWorkflow>();
        services.AddSingleton<IWorkflow, ReviewWorkflow>();
        services.AddSingleton<IWorkflow, SuggestWorkflow>();
        services.AddSingleton(sp => new RunExecutor(
            sp.GetRequiredService<ControlPlaneClient>(),
            sp.GetRequiredService<IModelClient>(),
            sp.GetRequiredService<IWorkspaceProvider>(),
            sp.GetServices<IWorkflow>(),
            sp.GetRequiredService<AgentFactory>(),
            sp.GetRequiredService<Estimator>(),
            options,
            sp.GetRequiredService<ILogger<RunExecutor>>(),
            sp.GetRequiredService<DockClient>(),
            RunnerResources.Skills(),
            sp.GetRequiredService<TimeProvider>()));
        services.AddSingleton<RunnerService>();
        services.AddHostedService(sp => sp.GetRequiredService<RunnerService>());
    }

    private static void Configure(HttpClient client, string baseUrl, string? token, TimeSpan timeout)
    {
        client.BaseAddress = new Uri(baseUrl);
        client.Timeout = timeout;
        if (!string.IsNullOrEmpty(token))
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, token);
        }
    }
}
