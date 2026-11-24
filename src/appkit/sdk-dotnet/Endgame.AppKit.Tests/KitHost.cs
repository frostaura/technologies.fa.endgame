using Endgame.AppKit.DevPlatform;
using Endgame.AppKit.Testing;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.AppKit.Tests;

/// <summary>An empty model: the SDK's tests need a reachable database, not a schema.</summary>
public sealed class KitDb(DbContextOptions<KitDb> options) : DbContext(options);

/// <summary>
/// A real app built on the kit, in memory, with its own database and the dev platform fake. Each
/// test maps the endpoints it needs, so a test can also map a broken one and watch start-up refuse.
/// </summary>
internal sealed class KitHost : IAsyncDisposable
{
    private readonly TestDatabase? _database;
    private readonly DevPlatformServer _platform;

    private KitHost(WebApplication app, TestDatabase? database, DevPlatformServer platform)
    {
        App = app;
        _database = database;
        _platform = platform;
    }

    public WebApplication App { get; }

    public DevPlatformState Platform => _platform.State;

    public IServiceProvider Services => App.Services;

    public static async Task<KitHost> StartAsync(
        Action<RouteGroupBuilder>? api = null,
        Action<WebApplication>? map = null,
        Action<Dictionary<string, string?>>? environment = null,
        string environmentName = "Testing",
        string? webRoot = null)
    {
        var state = new DevPlatformState();
        WebApplication? app = null;
        var platform = DevPlatformServer.Start(state, () => app!.GetTestClient());
        var database = TestDatabase.Create();
        try
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = environmentName,
                ContentRootPath = AppContext.BaseDirectory,
                WebRootPath = webRoot ?? Path.Combine(AppContext.BaseDirectory, "no-wwwroot"),
            });
            builder.WebHost.UseTestServer();
            var settings = new Dictionary<string, string?>
            {
                [EndgameEnvironment.Database] = database.ConnectionString,
                [EndgameEnvironment.PlatformUrl] = "http://dev-platform/",
                [EndgameEnvironment.AppToken] = state.AppToken,
                [EndgameEnvironment.AppId] = "kit-tests",
            };
            environment?.Invoke(settings);
            builder.Configuration.AddInMemoryCollection(settings);
            builder.AddEndgameApp<KitDb>();
            builder.Services.AddHttpClient(EndgameApp.PlatformClientName).ConfigurePrimaryHttpMessageHandler(platform.CreateHandler);
            builder.Services.AddHttpClient(EndgameApp.OtlpClientName).ConfigurePrimaryHttpMessageHandler(platform.CreateHandler);

            app = builder.Build();
            var group = app.UseEndgameApp();
            api?.Invoke(group);
            map?.Invoke(app);
            await app.StartAsync();
            return new KitHost(app, database, platform);
        }
        catch
        {
            if (app is not null)
            {
                await app.DisposeAsync();
            }

            await platform.DisposeAsync();
            await database.DisposeAsync();
            throw;
        }
    }

    /// <summary>A client; with <paramref name="prefix"/>, as Edge forwards a path-form address.</summary>
    public HttpClient Client(string? prefix = null, string? session = null)
    {
        var client = App.GetTestClient();
        if (prefix is not null)
        {
            client.DefaultRequestHeaders.Add("X-Forwarded-Prefix", prefix);
        }

        if (session is not null)
        {
            client.DefaultRequestHeaders.Add(EndgameAuthentication.SessionHeader, session);
        }

        return client;
    }

    public async ValueTask DisposeAsync()
    {
        await App.DisposeAsync();
        await _platform.DisposeAsync();
        if (_database is not null)
        {
            await _database.DisposeAsync();
        }
    }
}
