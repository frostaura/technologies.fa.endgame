using Endgame.Edge;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.XmlEncryption;

var builder = WebApplication.CreateBuilder(args);

// YARP pulls in ASP.NET data protection, but the edge protects nothing that must outlive the
// process (no session affinity, no cookies). Its key ring is therefore in memory by design,
// stated here, instead of an unpersisted directory that logs a warning on every start.
builder.Services.Configure<KeyManagementOptions>(options =>
{
    options.XmlRepository = new InMemoryXmlRepository();
    options.XmlEncryptor = new NullXmlEncryptor();
});

// The routing table is configuration (appsettings.json, ReverseProxy section): /api/* goes to the
// control plane, everything else to the console. Destinations are overridable per environment.
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";

// The edge's own liveness. A literal route outranks the proxy's catch-all, so /health is never proxied.
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "edge", revision }));
app.MapReverseProxy();

app.Run();
