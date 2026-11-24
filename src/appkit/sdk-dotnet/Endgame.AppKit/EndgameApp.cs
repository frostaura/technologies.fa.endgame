using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenTelemetry.Exporter;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Endgame.AppKit;

/// <summary>
/// The pair every Endgame app calls:
/// <code>
/// var builder = WebApplication.CreateBuilder(args);
/// builder.AddEndgameApp&lt;AppDb&gt;();
/// var app = builder.Build();
/// var api = app.UseEndgameApp();
/// api.MapNotes();          // your endpoints, under api/
/// app.Run();
/// </code>
/// </summary>
public static class EndgameApp
{
    /// <summary>The fixed address of the app's OpenAPI document, relative to its base.</summary>
    public const string OpenApiPath = "openapi/v1.json";

    /// <summary>The fixed address of the health probe, relative to its base.</summary>
    public const string HealthPath = "health";

    /// <summary>Name of the HttpClient that carries every platform call (tests swap its handler).</summary>
    public const string PlatformClientName = PlatformClient.HttpClientName;

    /// <summary>Name of the HttpClient the OpenTelemetry exporter sends through (tests swap its handler).</summary>
    public const string OtlpClientName = "Endgame.Otlp";

    /// <summary>
    /// Wires everything an app gets from the platform: the injected environment, its database
    /// (<typeparamref name="TDb"/>, migrated on start), identity, typed platform clients, OpenAPI,
    /// health, problem-details errors, structured logs and OpenTelemetry export.
    /// </summary>
    public static WebApplicationBuilder AddEndgameApp<TDb>(this WebApplicationBuilder builder) where TDb : DbContext
    {
        var services = builder.Services;

        services.AddSingleton<IConfigureOptions<EndgameSettings>, EndgameSettingsSetup>();
        services.AddSingleton<IValidateOptions<EndgameSettings>, EndgameSettingsValidation>();
        services.AddOptions<EndgameSettings>().ValidateOnStart();
        services.TryAddSingleton(TimeProvider.System);

        // Addresses: Edge strips the prefix and says what it was (ARCH-005). The app's only peer is Edge.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
                | ForwardedHeaders.XForwardedHost | ForwardedHeaders.XForwardedPrefix;
            o.KnownIPNetworks.Clear();
            o.KnownProxies.Clear();
        });

        // Data.
        services.AddDbContext<TDb>((sp, o) =>
        {
            var connection = sp.GetRequiredService<IOptions<EndgameSettings>>().Value.Database;
            if (connection is null)
            {
                o.UseNpgsql();
            }
            else
            {
                o.UseNpgsql(connection);
            }
        });
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck<TDb>>("database");

        // Errors and validation.
        services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
            c.ProblemDetails.Extensions.TryAdd("traceId", System.Diagnostics.Activity.Current?.TraceId.ToString() ?? c.HttpContext.TraceIdentifier));
        services.AddExceptionHandler<EndgameExceptionHandler>();
        services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

        // OpenAPI: the platform derives the app's MCP tools from this document.
        services.AddOpenApi("v1", o => o.AddDocumentTransformer((doc, context, _) =>
        {
            doc.Info.Title = context.ApplicationServices.GetRequiredService<IOptions<EndgameSettings>>().Value.AppId;
            return Task.CompletedTask;
        }));

        // Platform clients, all through one HttpClient that carries the app token and the egress proxy.
        services.AddMemoryCache();
        services.AddHttpContextAccessor();
        services.AddHttpClient(PlatformClient.HttpClientName)
            .ConfigureHttpClient((sp, c) => PlatformClient.Configure(c, sp.GetRequiredService<IOptions<EndgameSettings>>().Value))
            .ConfigurePrimaryHttpMessageHandler(sp => PlatformClient.CreateHandler(sp.GetRequiredService<IOptions<EndgameSettings>>().Value));
        services.TryAddSingleton<PlatformClient>();
        services.TryAddSingleton<IEndgameIdentity, EndgameIdentity>();
        services.TryAddSingleton<IEndgameModels, EndgameModels>();
        services.TryAddSingleton<IEndgameSecrets, EndgameSecrets>();
        services.TryAddSingleton<IEndgameEmail, EndgameEmail>();
        services.TryAddSingleton<IEndgameSchedules, EndgameSchedules>();
        services.TryAddSingleton<IEndgameWebhooks, EndgameWebhooks>();
        services.AddSingleton<EndgameTelemetry>();
        services.AddSingleton<IEndgameTelemetry>(sp => sp.GetRequiredService<EndgameTelemetry>());
        services.AddHostedService(sp => sp.GetRequiredService<EndgameTelemetry>());

        // Identity: Edge forwards an app-scoped session; the platform says who it belongs to.
        services.AddAuthentication(EndgameAuthentication.Scheme)
            .AddScheme<AuthenticationSchemeOptions, EndgameAuthenticationHandler>(EndgameAuthentication.Scheme, null);
        services.AddAuthorizationBuilder()
            .AddPolicy(EndgameAuthentication.Policy, p => p.AddAuthenticationSchemes(EndgameAuthentication.Scheme).RequireAuthenticatedUser());

        // Start-up checks: API contract, front end, schema.
        services.AddSingleton<SpaHost>();
        services.AddSingleton<EndgameEndpoints>();
        services.AddHostedService<EndgameStartup<TDb>>();

        AddTelemetry(builder);
        return builder;
    }

    /// <summary>
    /// The request pipeline: forwarded headers and path base, errors, static files, identity, and
    /// the kit's own endpoints — <c>health</c>, <c>openapi/v1.json</c>, <c>api/me</c> and the
    /// front end, served with its base rewritten. Returns the <c>api/</c> group: map every endpoint
    /// of the app on it, so its input is validated and the platform can describe it.
    /// </summary>
    public static RouteGroupBuilder UseEndgameApp(this WebApplication app)
    {
        var spa = app.Services.GetRequiredService<SpaHost>();
        app.Services.GetRequiredService<EndgameEndpoints>().Sources = ((IEndpointRouteBuilder)app).DataSources;

        app.UseForwardedHeaders();
        app.Use((context, next) =>
        {
            // "/acme/labs/demo/" and "/acme/labs/demo" are the same base.
            if (context.Request.PathBase.HasValue && context.Request.PathBase.Value!.EndsWith('/'))
            {
                context.Request.PathBase = new PathString(context.Request.PathBase.Value.TrimEnd('/'));
            }

            return next(context);
        });
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.UseStaticFiles(spa.StaticFiles());
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();

        app.MapHealthChecks("/" + HealthPath, new HealthCheckOptions { ResponseWriter = DatabaseHealthCheck.WriteAsync }).ExcludeFromDescription();
        app.MapOpenApi("/openapi/{documentName}.json");
        app.MapSpa(spa);

        var api = app.MapGroup("api");
        api.WithMetadata(new EndgameApiMetadata());
        api.AddEndpointFilterFactory(InputValidation.Factory);
        api.MapGet("me", (EndgameUser? user) => new CurrentUser(user))
            .WithName("getCurrentUser")
            .WithSummary("Who is signed in")
            .WithDescription("The person using the app: their id, email, display name and kind (member or endUser), or user = null when nobody is signed in.");
        return api;
    }

    private static void AddTelemetry(WebApplicationBuilder builder)
    {
        var services = builder.Services;
        // The kit's own HttpClients log every request at Information; their failures surface as exceptions.
        builder.Logging.AddFilter("System.Net.Http.HttpClient.Endgame", LogLevel.Warning);
        if (!builder.Environment.IsDevelopment())
        {
            builder.Logging.AddJsonConsole(o =>
            {
                o.IncludeScopes = true;
                o.UseUtcTimestamp = true;
                o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
            });
        }

        services.AddHttpClient(OtlpClientName)
            .ConfigureHttpClient((sp, c) =>
            {
                var s = sp.GetRequiredService<IOptions<EndgameSettings>>().Value;
                if (s.AppToken is not null)
                {
                    c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.AppToken);
                }
            })
            .ConfigurePrimaryHttpMessageHandler(sp =>
            {
                var s = sp.GetRequiredService<IOptions<EndgameSettings>>().Value;
                return s.TelemetryExport && s.PlatformUrl is not null ? PlatformClient.CreateHandler(s) : new DiscardingHandler();
            });

        foreach (var signal in new[] { "traces", "metrics", "logs" })
        {
            services.AddOptions<OtlpExporterOptions>("endgame-" + signal)
                .Configure<IOptions<EndgameSettings>, IHttpClientFactory>((o, settings, factory) =>
                {
                    o.Protocol = OtlpExportProtocol.HttpProtobuf;
                    if (settings.Value.PlatformUrl is { } platform)
                    {
                        o.Endpoint = new Uri(platform, $"platform/v1/otlp/v1/{signal}");
                    }

                    o.HttpClientFactory = () => factory.CreateClient(OtlpClientName);
                });
        }

        services.Configure<MetricReaderOptions>("endgame-metrics", o => o.PeriodicExportingMetricReaderOptions.ExportIntervalMilliseconds = 15_000);

        services.AddOpenTelemetry()
            .ConfigureResource(r => r.AddDetector(sp => new AppResource(sp.GetRequiredService<IOptions<EndgameSettings>>().Value)))
            .WithTracing(t => t
                .AddAspNetCoreInstrumentation(o => o.Filter = c => !c.Request.Path.StartsWithSegments("/" + HealthPath))
                .AddHttpClientInstrumentation()
                .AddSource("Npgsql")
                .AddOtlpExporter("endgame-traces", configure: null))
            .WithMetrics(m => m
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddMeter("Npgsql")
                .AddOtlpExporter("endgame-metrics", configure: (Action<OtlpExporterOptions>?)null))
            .WithLogging(l => l.AddOtlpExporter("endgame-logs", (Action<OtlpExporterOptions, LogRecordExportProcessorOptions>?)null), o =>
            {
                o.IncludeFormattedMessage = true;
                o.IncludeScopes = true;
            });
    }

    private sealed class AppResource(EndgameSettings settings) : IResourceDetector
    {
        public Resource Detect() => new([
            new KeyValuePair<string, object>("service.name", settings.AppId),
            new KeyValuePair<string, object>("service.version", typeof(EndgameApp).Assembly.GetName().Version?.ToString(3) ?? "0"),
            new KeyValuePair<string, object>("endgame.app.id", settings.AppId),
        ]);
    }

    /// <summary>Used when export is off: telemetry is recorded and dropped, never sent.</summary>
    private sealed class DiscardingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { RequestMessage = request });
    }
}

/// <summary>Response of <c>GET api/me</c>.</summary>
/// <param name="User">The signed-in person, or null.</param>
public sealed record CurrentUser(EndgameUser? User);

internal sealed class DatabaseHealthCheck<TDb>(TDb db) : IHealthCheck where TDb : DbContext
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
        await db.Database.CanConnectAsync(cancellationToken)
            ? HealthCheckResult.Healthy("reachable")
            : HealthCheckResult.Unhealthy("unreachable");
}

internal static class DatabaseHealthCheck
{
    internal static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsJsonAsync(new
        {
            status = report.Status == HealthStatus.Healthy ? "healthy" : "unhealthy",
            database = report.Entries.TryGetValue("database", out var db) ? db.Description ?? db.Status.ToString() : "unknown",
        });
    }
}
