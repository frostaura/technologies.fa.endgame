namespace Endgame.Runner;

/// <summary>Builds the Runner's web host: its health endpoint and the background service that claims runs.</summary>
public static class RunnerHost
{
    public static WebApplication Create(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var app = builder.Build();
        var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
        app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "runner", revision }));
        return app;
    }
}
