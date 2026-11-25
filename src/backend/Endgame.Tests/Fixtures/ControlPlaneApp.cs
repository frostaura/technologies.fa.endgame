using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// The real control plane, in process, on its own freshly migrated database (on the throwaway
/// <see cref="PostgresServer"/>), with OpenRouter replaced by <see cref="FakeOpenRouter"/> when one is
/// given and pointed at a dead port otherwise. Nothing else is replaced.
/// </summary>
public sealed class ControlPlaneApp : IAsyncDisposable
{
    public const string ServiceToken = "test-service-token";
    public const string Operators = "owner@frostaura.net, dean@frostaura.net";

    /// <summary>A fixed 32-byte vault master key for tests only (base64).</summary>
    public const string VaultKey = "dGVzdC12YXVsdC1tYXN0ZXIta2V5LTMyLWJ5dGVzISE=";
    public static readonly Uri BaseAddress = new("https://localhost");

    private readonly WebApplicationFactory<Program> factory;

    private ControlPlaneApp(WebApplicationFactory<Program> factory, string connectionString)
    {
        this.factory = factory;
        ConnectionString = connectionString;
    }

    public string ConnectionString { get; }

    public IServiceProvider Services => factory.Services;

    public static async Task<ControlPlaneApp> StartAsync(
        PostgresServer postgres,
        FakeOpenRouter? openRouter = null,
        string environment = "Development",
        bool developmentSignIn = true,
        IReadOnlyDictionary<string, string?>? settings = null,
        Action<IServiceCollection>? services = null)
    {
        ArgumentNullException.ThrowIfNull(postgres);
        var connection = await postgres.CreateDatabaseAsync();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("ConnectionStrings:Endgame", connection);
            builder.UseSetting("Database:AutoMigrateOnStartup", "true");
            builder.UseSetting("Sweeps:Enabled", "false");
            builder.UseSetting("Runs:EventPollMilliseconds", "50");
            builder.UseSetting("ENDGAME_SERVICE_TOKEN", ServiceToken);
            builder.UseSetting("ENDGAME_DEV_LOGIN", developmentSignIn ? "true" : "false");
            builder.UseSetting("OPENROUTER_API_KEY", FakeOpenRouter.Key);
            builder.UseSetting("ModelGateway:BaseUrl", openRouter?.BaseUrl ?? "http://127.0.0.1:1");
            builder.UseSetting("ModelGateway:GenerationLookupSeconds", "3");
            // God mode comes from an explicit list only; these two are operators, dev@frostaura.net is not.
            builder.UseSetting("ENDGAME_OPERATORS", Operators);
            builder.UseSetting("ENDGAME_VAULT_MASTER_KEY", VaultKey);
            // No peer is reachable from a test: nothing is pushed to Edge, nothing is mailed, nothing is scheduled.
            builder.UseSetting("Services:EdgeControl", "");
            builder.UseSetting("Smtp:Host", "");
            builder.UseSetting("Scheduler:Enabled", "false");
            builder.UseSetting("Email:DispatchEnabled", "false");
            // No ops service in a test (reserved names use the built-in list) and no background notification sweep.
            builder.UseSetting("Services:Ops", "");
            builder.UseSetting("Notifications:Enabled", "false");
            foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
            {
                builder.UseSetting(key, value);
            }

            if (services is not null)
            {
                builder.ConfigureServices(services);
            }
        });
        var app = new ControlPlaneApp(factory, connection);
        _ = factory.Server; // start (and migrate) now
        await Task.CompletedTask;
        return app;
    }

    /// <summary>A browser-like client: keeps cookies and sends its Origin, as a browser does on every POST.</summary>
    public HttpClient Client()
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress, HandleCookies = true, AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Origin", "https://localhost");
        return client;
    }

    public HttpClient Internal()
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress, HandleCookies = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServiceToken);
        return client;
    }

    /// <summary>A client that presents a bearer token (an MCP client's personal access token) and no cookie.</summary>
    public HttpClient Bearer(string token)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = BaseAddress, HandleCookies = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>An MCP client (the SDK's own) on <paramref name="path"/>, authenticated by <paramref name="token"/>.</summary>
    public async Task<ModelContextProtocol.Client.McpClient> McpAsync(string token, string path = "/mcp") =>
        await ModelContextProtocol.Client.McpClient.CreateAsync(new ModelContextProtocol.Client.HttpClientTransport(
            new ModelContextProtocol.Client.HttpClientTransportOptions { Endpoint = new Uri(BaseAddress, path), TransportMode = ModelContextProtocol.Client.HttpTransportMode.StreamableHttp },
            Bearer(token), loggerFactory: null, ownsHttpClient: true));

    /// <summary>A personal access token made through the console's API by a signed-in person.</summary>
    public static async Task<string> TokenAsync(HttpClient person, string organisation, string? role = null) =>
        (await Created(person.PostAsJsonAsync("/api/tokens", new { name = "test client", organisation, role })))["token"]!.GetValue<string>();

    /// <summary>A client signed in through the development sign-in as <paramref name="email"/>.</summary>
    public async Task<HttpClient> SignInAsync(string email = "owner@frostaura.net", string? displayName = null)
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/api/auth/development", new { email, displayName });
        await Expect(response, HttpStatusCode.OK);
        return client;
    }

    /// <summary>First run: the owner signs in and names the organisation.</summary>
    public async Task<HttpClient> OwnerWithOrganisationAsync(string slug = "frostaura", string email = "owner@frostaura.net")
    {
        var owner = await SignInAsync(email, "The Owner");
        await Expect(await owner.PostAsJsonAsync("/api/organisations", new { name = "FrostAura", slug }), HttpStatusCode.Created);
        return owner;
    }

    public AsyncServiceScope Scope() => factory.Services.CreateAsyncScope();

    public async ValueTask DisposeAsync() => await factory.DisposeAsync();

    public static async Task<JsonNode> Expect(HttpResponseMessage response, HttpStatusCode status)
    {
        ArgumentNullException.ThrowIfNull(response);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"Expected {(int)status}, got {(int)response.StatusCode}: {text}");
        return string.IsNullOrEmpty(text) ? new JsonObject() : JsonNode.Parse(text)!;
    }

    public static async Task<JsonNode> Ok(Task<HttpResponseMessage> call) => await Expect(await call, HttpStatusCode.OK);

    public static async Task<JsonNode> Created(Task<HttpResponseMessage> call) => await Expect(await call, HttpStatusCode.Created);

    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}

/// <summary>Builds a tree through the public API.</summary>
public static class TreeBuilder
{
    public static async Task<Guid> DivisionAsync(this HttpClient client, string parent, string slug, string? name = null) =>
        Guid.Parse((await ControlPlaneApp.Created(client.PostAsJsonAsync("/api/divisions", new { parent, name = name ?? slug, slug })))["id"]!.GetValue<string>());

    public static async Task<Guid> ProjectAsync(this HttpClient client, string parent, string slug, string? name = null) =>
        Guid.Parse((await ControlPlaneApp.Created(client.PostAsJsonAsync("/api/projects", new { parent, name = name ?? slug, slug })))["id"]!.GetValue<string>());

    public static async Task<Guid> AppAsync(this HttpClient client, string parent, string slug, string? name = null) =>
        Guid.Parse((await ControlPlaneApp.Created(client.PostAsJsonAsync("/api/apps", new { parent, name = name ?? slug, slug })))["id"]!.GetValue<string>());

    public static async Task TopUpAsync(this HttpClient operatorClient, string organisation, decimal credits) =>
        await ControlPlaneApp.Ok(operatorClient.PostAsJsonAsync("/api/credits/top-ups", new { organisation, credits, note = "test top-up" }));

    public static async Task SetAsync(this HttpClient client, string scope, string kind, string key, object value) =>
        await ControlPlaneApp.Ok(client.PutAsJsonAsync("/api/cascade", new { scope, kind, key, value }));
}
