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
        IReadOnlyDictionary<string, string?>? settings = null)
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
            foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
            {
                builder.UseSetting(key, value);
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
