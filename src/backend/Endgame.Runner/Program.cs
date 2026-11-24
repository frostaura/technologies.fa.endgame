var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "runner", revision }));

app.Run();
