using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Endgame.Infrastructure.Health;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.Status;

/// <summary>
/// The real control plane, in process. Only the network is replaced: health calls go to a fake
/// handler that answers per host, and the database points at a port nothing listens on — so the
/// database row is a genuine failed connection, not a stub.
/// </summary>
public sealed class SystemStatusEndpointTests
{
    private const string UnreachableDatabase = "Host=127.0.0.1;Port=1;Database=endgame;Username=endgame;Password=unused;Timeout=1";

    private static WebApplicationFactory<Program> Factory(Func<HttpRequestMessage, HttpResponseMessage> answer) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:Endgame", UnreachableDatabase);
            builder.UseSetting("Database:AutoMigrateOnStartup", "false");
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services =>
                services.AddHttpClient(HttpHealthProbe.ClientName)
                    .ConfigurePrimaryHttpMessageHandler(() => new FakeHandler(answer)));
        });

    private static HttpResponseMessage Healthy(HttpRequestMessage _) =>
        new(HttpStatusCode.OK) { Content = JsonContent.Create(new { status = "healthy" }) };

    private static async Task<JsonElement> GetStatus(WebApplicationFactory<Program> factory)
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/system/status");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static JsonElement Service(JsonElement status, string key) =>
        status.GetProperty("services").EnumerateArray().Single(s => s.GetProperty("key").GetString() == key);

    [Fact]
    public async Task Reports_every_service_in_a_stable_order()
    {
        await using var factory = Factory(Healthy);
        var status = await GetStatus(factory);

        var keys = status.GetProperty("services").EnumerateArray().Select(s => s.GetProperty("key").GetString()).ToList();
        Assert.Equal(["control-plane", "edge", "runner", "dock", "database", "console"], keys);
        Assert.True(status.TryGetProperty("checkedAt", out _));
    }

    [Fact]
    public async Task Services_that_answer_2xx_are_healthy_and_an_unreachable_database_is_not()
    {
        await using var factory = Factory(Healthy);
        var status = await GetStatus(factory);

        Assert.Equal("healthy", Service(status, "edge").GetProperty("state").GetString());
        Assert.Equal("healthy", Service(status, "runner").GetProperty("state").GetString());
        var database = Service(status, "database");
        Assert.Equal("unhealthy", database.GetProperty("state").GetString());
        Assert.Equal("unhealthy", status.GetProperty("overall").GetString());
    }

    [Fact]
    public async Task A_service_answering_503_is_unhealthy_and_its_own_detail_is_passed_through()
    {
        await using var factory = Factory(request => request.RequestUri!.Host == "dock"
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            {
                Content = JsonContent.Create(new { status = "unhealthy", detail = "Engine unreachable: refused" }),
            }
            : Healthy(request));
        var status = await GetStatus(factory);

        var dock = Service(status, "dock");
        Assert.Equal("unhealthy", dock.GetProperty("state").GetString());
        Assert.Equal("Engine unreachable: refused", dock.GetProperty("detail").GetString());
        Assert.Equal("healthy", Service(status, "edge").GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_service_that_cannot_be_reached_is_unhealthy_with_the_reason()
    {
        await using var factory = Factory(request => request.RequestUri!.Host == "runner"
            ? throw new HttpRequestException("Connection refused")
            : Healthy(request));
        var status = await GetStatus(factory);

        var runner = Service(status, "runner");
        Assert.Equal("unhealthy", runner.GetProperty("state").GetString());
        Assert.Contains("Connection refused", runner.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Publishes_an_openapi_document_under_api()
    {
        await using var factory = Factory(Healthy);
        using var client = factory.CreateClient();
        var document = await client.GetFromJsonAsync<JsonElement>("/api/openapi/v1.json");
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/system/status", out _));
    }

    [Fact]
    public async Task Its_own_health_endpoint_answers()
    {
        await using var factory = Factory(Healthy);
        using var client = factory.CreateClient();
        var health = await client.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("healthy", health.GetProperty("status").GetString());
    }

    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(answer(request));
    }
}
