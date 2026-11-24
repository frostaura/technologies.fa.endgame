using Endgame.Application;
using Endgame.Application.Status;
using Endgame.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndgameApplication();
builder.Services.AddEndgameInfrastructure(builder.Configuration);
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase)));

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:AutoMigrateOnStartup"))
{
    await app.Services.MigrateEndgameDatabaseAsync();
}

// Under /api so the edge routes it here like every other control-plane call.
app.MapOpenApi("/api/openapi/{documentName}.json");

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "control-plane", revision }))
    .ExcludeFromDescription();

app.MapGet("/api/system/status", async (GetSystemStatus query, CancellationToken cancellationToken) =>
        Results.Ok(await query.HandleAsync(cancellationToken)))
    .WithName("GetSystemStatus")
    .WithSummary("The live health of every Endgame service, measured by asking each one.")
    .Produces<SystemStatus>();

app.Run();

/// <summary>Visible to WebApplicationFactory in the tests.</summary>
public partial class Program;
