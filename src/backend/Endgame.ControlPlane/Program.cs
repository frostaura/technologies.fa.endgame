using System.Text.Json;
using System.Text.Json.Serialization;
using Endgame.Application;
using Endgame.Application.Status;
using Endgame.ControlPlane.Endpoints;
using Endgame.Infrastructure;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndgameApplication();
builder.Services.AddEndgameInfrastructure(builder.Configuration);
builder.Services.AddEndgameIdentity();
builder.Services.Configure<IdentityPasskeyOptions>(options =>
{
    // The relying party: the address people sign in at. Unset, it is taken from the (validated) host.
    if (builder.Configuration["Passkeys:ServerDomain"] is { Length: > 0 } domain)
    {
        options.ServerDomain = domain;
    }

    // Identity's default accepts the origin the browser reports when it matches the request's Origin
    // header. Where the public addresses are known, hold them to exactly those as well.
    var allowed = builder.Configuration.GetSection("Passkeys:AllowedOrigins").Get<string[]>() ?? [];
    if (allowed.Length > 0)
    {
        options.ValidateOrigin = context => ValueTask.FromResult(
            !context.CrossOrigin
            && allowed.Contains(context.Origin, StringComparer.OrdinalIgnoreCase)
            && context.HttpContext.Request.Headers.Origin is [var sent] && string.Equals(sent, context.Origin, StringComparison.OrdinalIgnoreCase));
    }
});
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddIdentityCookies(cookies => cookies.ApplicationCookie?.Configure(options =>
    {
        options.Cookie.Name = "endgame.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromDays(14);
        // An API answers 401 and 403; it never redirects to a login page.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    }));
builder.Services.AddAuthorization();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.Configure<RunStreamOptions>(builder.Configuration.GetSection(RunStreamOptions.SectionName));
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // Only the edge reaches the control plane, inside the compose network; it sets these headers.
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
});

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:AutoMigrateOnStartup"))
{
    await app.Services.MigrateEndgameDatabaseAsync();
}

app.UseForwardedHeaders();
app.UseEndgameProblems();
app.UseAuthentication();
app.UseAuthorization();

// Under /api so the edge routes it here like every other control-plane call.
app.MapOpenApi("/api/openapi/{documentName}.json");

var revision = app.Configuration["BUILD_SHA"] is { Length: > 0 } sha ? sha : "unknown";
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "control-plane", revision }))
    .ExcludeFromDescription();

var api = app.MapGroup("/api");
api.MapGet("/system/status", async (GetSystemStatus query, CancellationToken cancellationToken) =>
        Results.Ok(await query.HandleAsync(cancellationToken)))
    .WithTags("System")
    .WithName("GetSystemStatus")
    .WithSummary("The live health of every Endgame service, measured by asking each one.")
    .Produces<SystemStatus>();

api.MapAuth(app.Environment, app.Configuration);
api.MapDevLoginIfEnabled(app.Environment, app.Configuration);

api.MapAppAuth(app.Environment, app.Configuration);

var members = api.MapGroup("").RequireAuthorization();
members.MapTree();
members.MapWork();
members.MapPlatformConsole();

// The platform API for apps (src/appkit/PLATFORM-API.md): the app token, never a member's cookie.
app.MapGroup("/platform/v1")
    .AddEndpointFilter<AppTokenFilter>()
    .WithTags("Platform")
    .MapPlatformApi();

app.MapGroup("/internal")
    .AddEndpointFilter<ServiceTokenFilter>()
    .WithTags("Internal")
    .MapInternal();

app.Run();

/// <summary>Visible to WebApplicationFactory in the tests.</summary>
public partial class Program;
