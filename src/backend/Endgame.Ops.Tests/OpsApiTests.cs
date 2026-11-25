using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Endgame.Ops.Tests;

/// <summary>The service's HTTP surface, in process, with Cloudflare replaced by <see cref="FakeCloudflare"/>.</summary>
public sealed class OpsApiTests : IAsyncLifetime
{
    private const string ServiceToken = "ops-tests-service-token-0001";
    private readonly string backups = Path.Combine(Path.GetTempPath(), $"endgame-ops-tests-{Guid.NewGuid():N}");
    private FakeCloudflare fake = null!;

    public async Task InitializeAsync() => fake = await FakeCloudflare.StartAsync();

    public async Task DisposeAsync()
    {
        await fake.DisposeAsync();
        if (Directory.Exists(backups))
        {
            Directory.Delete(backups, recursive: true);
        }
    }

    private WebApplicationFactory<Program> Ops(bool cloudflare, bool backupKey = true) => new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
    {
        b.UseSetting("ENDGAME_SERVICE_TOKEN", ServiceToken);
        b.UseSetting("Ops:Backup:Key", backupKey ? Convert.ToHexString(new byte[32]) : "");
        b.UseSetting("Ops:Backup:Postgres", "Host=127.0.0.1;Port=1;Username=nobody;Password=none");
        b.UseSetting("Ops:Backup:LocalDirectory", backups);
        b.UseSetting("Ops:Backup:ScheduleEnabled", "false");
        b.UseSetting("Ops:Cloudflare:BaseUrl", fake.BaseUrl);
        if (cloudflare)
        {
            b.UseSetting("Ops:Cloudflare:ApiToken", FakeCloudflare.Token);
            b.UseSetting("Ops:Cloudflare:AccountId", FakeCloudflare.AccountId);
            b.UseSetting("Ops:Cloudflare:ZoneId", FakeCloudflare.ZoneId);
            b.UseSetting("Ops:Cloudflare:TunnelId", FakeCloudflare.TunnelId);
            b.UseSetting("Ops:Cloudflare:Zone", "example.test");
            b.UseSetting("Ops:Cloudflare:ConsoleHost", "endgame.example.test");
        }
    });

    private static HttpClient Client(WebApplicationFactory<Program> app, bool token = true)
    {
        var client = app.CreateClient();
        if (token)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ServiceToken);
        }

        return client;
    }

    [Fact]
    public async Task With_no_token_health_says_cloudflare_is_idle_and_backups_are_local()
    {
        await using var app = Ops(cloudflare: false);
        var health = await Client(app, token: false).GetFromJsonAsync<JsonObject>("/health");
        Assert.Equal("healthy", (string)health!["status"]!);
        Assert.Equal("idle", (string)health["cloudflare"]!["state"]!);
        Assert.Contains("No Cloudflare API token", (string)health["cloudflare"]!["message"]!);
        Assert.Equal("local", (string)health["backups"]!["state"]!);
        Assert.Contains("not offsite", (string)health["backups"]!["message"]!);
        Assert.Empty(fake.Requests);
    }

    [Fact]
    public async Task Without_a_backup_key_health_is_unhealthy_and_says_why()
    {
        await using var app = Ops(cloudflare: false, backupKey: false);
        var response = await Client(app, token: false).GetAsync("/health");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var health = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("refused", (string)health!["backups"]!["state"]!);
        Assert.Contains("ENDGAME_BACKUP_KEY is not set", (string)health["backups"]!["message"]!);
    }

    [Fact]
    public async Task Internal_endpoints_need_the_service_token()
    {
        await using var app = Ops(cloudflare: true);
        foreach (var path in new[] { "/internal/ops/reserved-hosts", "/internal/ops/cloudflare/plan", "/internal/ops/backups" })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Client(app, token: false).GetAsync(path)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await Client(app, token: false).PostAsync("/internal/ops/cloudflare/apply?confirm=true", null)).StatusCode);
        Assert.Empty(fake.Requests);
    }

    [Fact]
    public async Task Apply_refuses_without_explicit_confirmation_and_plan_then_apply_converges()
    {
        await using var app = Ops(cloudflare: true);
        var client = Client(app);

        var unconfirmed = await client.PostAsync("/internal/ops/cloudflare/apply", null);
        Assert.Equal(HttpStatusCode.BadRequest, unconfirmed.StatusCode);
        Assert.Equal("confirmation_required", (string)(await unconfirmed.Content.ReadFromJsonAsync<JsonObject>())!["code"]!);
        Assert.Empty(fake.Requests);

        var plan = await client.GetFromJsonAsync<JsonObject>("/internal/ops/cloudflare/plan");
        Assert.False((bool)plan!["inSync"]!);
        Assert.Empty(fake.Mutations);

        var applied = await client.PostAsync("/internal/ops/cloudflare/apply?confirm=true", null);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.True((bool)(await applied.Content.ReadFromJsonAsync<JsonObject>())!["after"]!["inSync"]!);

        var again = await client.GetFromJsonAsync<JsonObject>("/internal/ops/cloudflare/plan");
        Assert.True((bool)again!["inSync"]!);

        var reserved = await client.GetFromJsonAsync<JsonObject>("/internal/ops/reserved-hosts");
        Assert.True((bool)reserved!["complete"]!);
        Assert.Contains("endgame", reserved["labels"]!.AsArray().Select(l => (string)l!));

        var health = await client.GetFromJsonAsync<JsonObject>("/health");
        Assert.Equal("configured", (string)health!["cloudflare"]!["state"]!);
    }

    [Fact]
    public async Task A_conflicting_plan_is_refused_by_apply_with_the_plan_attached()
    {
        fake.AddRecord("CNAME", "endgame.example.test", "elsewhere.example.net");
        await using var app = Ops(cloudflare: true);
        var response = await Client(app).PostAsync("/internal/ops/cloudflare/apply?confirm=true", null);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("plan_has_conflicts", (string)problem!["code"]!);
        Assert.NotNull(problem["plan"]);
        Assert.Empty(fake.Mutations);
    }

    [Fact]
    public async Task Plan_without_cloudflare_configured_is_a_clear_conflict_not_a_call()
    {
        await using var app = Ops(cloudflare: false);
        var response = await Client(app).GetAsync("/internal/ops/cloudflare/plan");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("cloudflare_unconfigured", (string)(await response.Content.ReadFromJsonAsync<JsonObject>())!["code"]!);
        Assert.Empty(fake.Requests);
    }

    [Fact]
    public async Task Backups_list_reports_the_local_destination_and_usage()
    {
        await using var app = Ops(cloudflare: false);
        var list = await Client(app).GetFromJsonAsync<JsonObject>("/internal/ops/backups");
        Assert.Equal("local", (string)list!["destination"]!);
        Assert.Empty(list["backups"]!.AsArray());
        Assert.Equal("local", (string)list["usage"]!["state"]!);
    }
}
