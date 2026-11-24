using Endgame.AppKit.DevPlatform;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.AppKit.Testing;

/// <summary>
/// Hosts the app in memory the way the platform runs it: its own throwaway PostgreSQL database
/// (see <see cref="TestDatabase"/>), the injected environment, and the dev platform fake answering
/// every platform call. One per test class:
/// <code>
/// public sealed class NotesApiTests(EndgameAppFactory&lt;Program&gt; app) : IClassFixture&lt;EndgameAppFactory&lt;Program&gt;&gt;
/// {
///     [Fact]
///     public async Task Lists_notes() { using var http = app.CreateClient(); … }
/// }
/// </code>
/// </summary>
public class EndgameAppFactory<TProgram> : WebApplicationFactory<TProgram> where TProgram : class
{
    private readonly Lazy<TestDatabase> _database = new(TestDatabase.Create);
    private readonly DevPlatformServer _platform;

    /// <summary>Creates the factory and starts the fake platform; the app starts with the first client.</summary>
    /// <remarks>
    /// The fake is started here, never lazily: WebApplicationFactory adopts the first host built on
    /// the app's start-up path, and a fake built there would be mistaken for the app.
    /// </remarks>
    public EndgameAppFactory() =>
        _platform = DevPlatformServer.Start(Platform, () => CreateClient());

    /// <summary>What the app told the platform, and the switches a test flips (secrets, budget).</summary>
    public DevPlatformState Platform { get; } = new();

    /// <summary>
    /// The address prefix requests arrive under, as Edge forwards it, e.g. <c>/acme/labs/demo</c>.
    /// Empty (the default) is the root of an organisation subdomain. Set it before the first client.
    /// </summary>
    public string PathBase { get; set; } = "";

    /// <summary>A client signed in as <paramref name="email"/>, through a real session on the fake.</summary>
    public HttpClient CreateClientFor(string email, EndgameUserKind kind = EndgameUserKind.Member)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(EndgameAuthentication.SessionHeader, Platform.CreateSession(email, kind));
        return client;
    }

    /// <summary>Runs a schedule exactly as the platform would: a signed call to the app. Returns the HTTP status.</summary>
    public Task<int> RunScheduleAsync(string name) => DevPlatformEndpoints.RunScheduleAsync(Platform, CreateClient(), name);

    /// <inheritdoc />
    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        if (PathBase.Length > 0)
        {
            client.DefaultRequestHeaders.Add("X-Forwarded-Prefix", PathBase);
        }
    }

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting(EndgameEnvironment.Database, _database.Value.ConnectionString);
        builder.UseSetting(EndgameEnvironment.PlatformUrl, "http://dev-platform/");
        builder.UseSetting(EndgameEnvironment.AppToken, Platform.AppToken);
        builder.UseSetting(EndgameEnvironment.AppId, "test-app");
        builder.ConfigureTestServices(services =>
        {
            services.AddHttpClient(EndgameApp.PlatformClientName).ConfigurePrimaryHttpMessageHandler(_platform.CreateHandler);
            services.AddHttpClient(EndgameApp.OtlpClientName).ConfigurePrimaryHttpMessageHandler(_platform.CreateHandler);
        });
    }

    /// <inheritdoc />
    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _platform.DisposeAsync();

        if (_database.IsValueCreated)
        {
            await _database.Value.DisposeAsync();
        }

        GC.SuppressFinalize(this);
    }
}
