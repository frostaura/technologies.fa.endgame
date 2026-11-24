using Docker.DotNet;
using Endgame.Dock;

var builder = WebApplication.CreateBuilder(args);

var endpoint = new Uri(builder.Configuration["Docker:Endpoint"] is { Length: > 0 } configured
    ? configured
    : "unix:///var/run/docker.sock");
builder.Services.AddSingleton(_ => new DockerClientBuilder().WithEndpoint(endpoint).Build());
builder.Services.AddSingleton<DockerEngineCheck>();

var app = builder.Build();

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";

// Dock exists to drive the Docker Engine, so an unreachable engine makes Dock unhealthy (503).
app.MapGet("/health", async (DockerEngineCheck check, CancellationToken cancellationToken) =>
{
    var engine = await check.CheckAsync(cancellationToken);
    var body = new { status = engine.Reachable ? "healthy" : "unhealthy", service = "dock", revision, detail = engine.Detail, engine };
    return engine.Reachable ? Results.Ok(body) : Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.Run();
