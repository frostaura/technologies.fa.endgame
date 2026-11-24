using System.Text;
using Docker.DotNet;
using Endgame.Dock;
using Endgame.Dock.Api;
using Endgame.Dock.Apps;
using Endgame.Dock.Egress;
using Endgame.Dock.Engine;
using Endgame.Dock.Platform;
using Endgame.Dock.Policy;
using Endgame.Dock.Repositories;
using Endgame.Dock.Workspaces;
using Endgame.Hosting.Contracts;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

var endpoint = new Uri(builder.Configuration["Docker:Endpoint"] is { Length: > 0 } configured
    ? configured
    : "unix:///var/run/docker.sock");
builder.Services.AddSingleton(_ => new DockerClientBuilder().WithEndpoint(endpoint).WithTimeout(Timeout.InfiniteTimeSpan).Build());
builder.Services.AddSingleton<DockerEngineCheck>();

builder.Services.Configure<DockOptions>(builder.Configuration.GetSection(DockOptions.Section));
builder.Services.Configure<JsonOptions>(o => o.SerializerOptions.PropertyNameCaseInsensitive = true);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<DockProblemHandler>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ServiceTokenFilter>();
builder.Services.AddHttpClient(PlatformReports.ClientName, c => c.Timeout = TimeSpan.FromSeconds(5));

builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<IOptions<DockOptions>>().Value;
    return new ResourceNames(o.ResourcePrefix, o.Instance);
});
builder.Services.AddSingleton(sp =>
{
    var key = sp.GetRequiredService<IOptions<DockOptions>>().Value.SecretKey;
    if (key.Length < 32)
    {
        throw new InvalidOperationException("Dock__SecretKey must be set to at least 32 characters.");
    }

    return new OpaqueNames(Encoding.UTF8.GetBytes(key));
});
builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<IOptions<DockOptions>>().Value;
    return new WakeGate(o.MaxConcurrentWakes, TimeSpan.FromMilliseconds(o.WakeSpacingMs), sp.GetRequiredService<TimeProvider>());
});
builder.Services.AddSingleton<ContainerExec>();
builder.Services.AddSingleton<ContainerFiles>();
builder.Services.AddSingleton<NetworkManager>();
builder.Services.AddSingleton<EgressManager>();
builder.Services.AddSingleton<DatabaseProvisioner>();
builder.Services.AddSingleton<RepositoryService>();
builder.Services.AddSingleton<WorkspaceImage>();
builder.Services.AddSingleton<WorkspaceService>();
builder.Services.AddSingleton<AppRuntimeRegistry>();
builder.Services.AddSingleton<AppService>();
builder.Services.AddSingleton<BuildService>();
builder.Services.AddSingleton<PlatformReports>();

builder.Services.AddHostedService(sp => sp.GetRequiredService<WorkspaceImage>());
builder.Services.AddHostedService<EgressReconciler>();
builder.Services.AddHostedService<PlatformDatabaseLockdown>();
builder.Services.AddHostedService<LeaseSweeper>();
builder.Services.AddHostedService<CrashWatcher>();
builder.Services.AddHostedService<MemorySampler>();

var app = builder.Build();

// Fail at start-up, not on the first call, when the key every app's credentials derive from is missing.
_ = app.Services.GetRequiredService<OpaqueNames>();
if (app.Configuration[HostingConventions.ServiceTokenVariable] is not { Length: >= 16 })
{
    app.Logger.LogError("{Variable} is not set (16+ characters): every internal call will be refused.", HostingConventions.ServiceTokenVariable);
}

app.UseExceptionHandler();

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";

// Dock exists to drive the Docker Engine, so an unreachable engine makes Dock unhealthy (503).
app.MapGet("/health", async (DockerEngineCheck check, WorkspaceImage workspaceImage, RepositoryService repositories, DatabaseProvisioner databases, CancellationToken cancellationToken) =>
{
    var engine = await check.CheckAsync(cancellationToken);
    var body = new
    {
        status = engine.Reachable ? "healthy" : "unhealthy",
        service = "dock",
        revision,
        detail = engine.Detail,
        engine,
        workspaceImage = workspaceImage.Status,
        template = repositories.TemplateAvailable ? "present" : "missing",
        appDatabases = databases.Configured ? "configured" : "not configured",
    };
    return engine.Reachable ? Results.Ok(body) : Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.MapDockApi();

app.Run();
