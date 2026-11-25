using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Trace;

namespace Endgame.AppKit.Tests;

public sealed class PlatformServiceTests
{
    private static async Task Eventually(Func<bool> condition, string what)
    {
        for (var i = 0; i < 100 && !condition(); i++)
        {
            await Task.Delay(50);
        }

        Assert.True(condition(), what);
    }

    [Fact]
    public async Task Models_answer_through_the_platform_and_a_spent_budget_is_terminal()
    {
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapPost("summaries", async (IEndgameModels models) => (await models.CompleteAsync(new ChatRequest([ChatMessage.User("hello")], "summarise"))).Content)
                .WithName("createSummary").WithDescription("Summarises."));
        var models = host.Services.GetRequiredService<IEndgameModels>();

        var reply = await models.CompleteAsync(new ChatRequest([ChatMessage.System("Be brief."), ChatMessage.User("Say hi")]));
        Assert.Equal("[dev platform] reply to: Say hi", reply.Content);
        Assert.Equal("dev/echo", reply.Model);
        Assert.True(reply.Credits > 0);
        Assert.Equal("chat", host.Platform.ModelCalls.Single()["taskType"]!.GetValue<string>());

        host.Platform.BudgetExhausted = true;
        await Assert.ThrowsAsync<EndgameBudgetExhaustedException>(() => models.CompleteAsync(new ChatRequest([ChatMessage.User("again")])));

        // Unhandled in an endpoint, it is a 402 problem the front end can recognise.
        var response = await host.Client().PostAsync("/api/summaries", null);
        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("budget_exhausted", problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task At_the_overdraft_limit_a_model_call_is_a_typed_terminal_refusal_in_the_platforms_words()
    {
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapPost("summaries", async (IEndgameModels models) => (await models.CompleteAsync(new ChatRequest([ChatMessage.User("hello")], "summarise"))).Content)
                .WithName("createSummary").WithDescription("Summarises."));
        var models = host.Services.GetRequiredService<IEndgameModels>();
        host.Platform.OverdraftLimitReached = true;

        var refused = await Assert.ThrowsAsync<EndgameOverdraftLimitException>(() => models.CompleteAsync(new ChatRequest([ChatMessage.User("again")])));
        Assert.Equal("overdraft_limit", refused.Code);
        Assert.Equal(HttpStatusCode.PaymentRequired, refused.Status);
        Assert.StartsWith("The overdraft limit is reached: ", refused.Message);
        Assert.Contains("Work stops until the organisation is topped up", refused.Message);
        Assert.Single(host.Platform.ModelCalls); // never retried

        // Unhandled in an endpoint, it is the same 402 a spent budget is, never a bad gateway.
        var response = await host.Client().PostAsync("/api/summaries", null);
        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("overdraft_limit", problem.GetProperty("code").GetString());
        Assert.Equal("The overdraft limit is reached", problem.GetProperty("title").GetString());
        Assert.Equal("This feature is paused until the organisation tops up its credits.", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task A_superseded_app_token_is_named_in_one_sentence()
    {
        await using var host = await KitHost.StartAsync();
        var models = host.Services.GetRequiredService<IEndgameModels>();
        host.Platform.AppToken = "superseded-by-a-restart";

        var refused = await Assert.ThrowsAsync<EndgamePlatformException>(() => models.CompleteAsync(new ChatRequest([ChatMessage.User("hello")])));
        Assert.Equal(HttpStatusCode.Unauthorized, refused.Status);
        Assert.Equal("app_token_invalid", refused.Code);
        Assert.Contains("The app token is missing or wrong. The token is injected when the app starts", refused.Message);
        Assert.DoesNotContain("..", refused.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Secrets_resolve_by_name_and_a_missing_one_says_where_it_looked()
    {
        await using var host = await KitHost.StartAsync();
        var secrets = host.Services.GetRequiredService<IEndgameSecrets>();
        host.Platform.Secrets["WEATHER_API_KEY"] = "sk-test-123";

        Assert.Equal("sk-test-123", await secrets.GetAsync("WEATHER_API_KEY"));
        var missing = await Assert.ThrowsAsync<EndgameSecretNotFoundException>(() => secrets.GetAsync("NOT_SET"));
        Assert.Equal("NOT_SET", missing.Name);
        Assert.Contains("organisation", missing.Message);
        await Assert.ThrowsAsync<ArgumentException>(() => secrets.GetAsync("lower-case"));
    }

    [Fact]
    public async Task Email_is_handed_to_the_platform()
    {
        await using var host = await KitHost.StartAsync();
        var email = host.Services.GetRequiredService<IEndgameEmail>();
        var id = await email.SendAsync(new EmailMessage(["ada@example.test"], "Welcome", "Hello Ada"));
        Assert.StartsWith("eml_", id);
        var sent = host.Platform.Emails.Single();
        Assert.Equal("Welcome", sent["subject"]!.GetValue<string>());
        await Assert.ThrowsAsync<ArgumentException>(() => email.SendAsync(new EmailMessage(["not-an-address"], "x", "y")));
    }

    [Fact]
    public async Task Custom_events_arrive_in_batches_without_blocking()
    {
        await using var host = await KitHost.StartAsync();
        var telemetry = host.Services.GetRequiredService<IEndgameTelemetry>();
        telemetry.Track("note.created", new Dictionary<string, object?> { ["length"] = 12 }, "usr_1");
        telemetry.Track("note.viewed");
        await Eventually(() => host.Platform.Events.Count == 2, "both events reached the platform");
        Assert.Equal("note.created", host.Platform.Events.First()["name"]!.GetValue<string>());
        Assert.Throws<ArgumentException>(() => telemetry.Track("Note Created"));
    }

    [Fact]
    public async Task A_preview_records_no_custom_events_and_exports_nothing()
    {
        // The factory evaluates on a preview of the app; its test members' "book.created" were counted as the app's own.
        await using var host = await KitHost.StartAsync(environment: e => e[EndgameEnvironment.Preview] = "true");
        var telemetry = host.Services.GetRequiredService<IEndgameTelemetry>();
        telemetry.Track("note.created");
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.Empty(host.Platform.Events);
        // OTLP export is off (this host swaps the exporter's handler for the dev platform's, so the setting is what is checked).
        Assert.False(host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<EndgameSettings>>().Value.TelemetryExport);
        Assert.Throws<ArgumentException>(() => telemetry.Track("Note Created"));
    }

    [Fact]
    public async Task Traces_metrics_and_logs_are_exported_to_the_platform_collector()
    {
        await using var host = await KitHost.StartAsync();
        await host.Client().GetAsync("/api/me");
        host.Services.GetRequiredService<TracerProvider>().ForceFlush();
        await Eventually(() => host.Platform.OtlpRequests.ContainsKey("traces"), "traces were exported");
    }

    [Fact]
    public async Task A_refused_app_token_explains_itself()
    {
        await using var host = await KitHost.StartAsync(environment: e => e[EndgameEnvironment.AppToken] = "wrong-token");
        var error = await Assert.ThrowsAsync<EndgamePlatformException>(() =>
            host.Services.GetRequiredService<IEndgameSecrets>().GetAsync("ANY_SECRET"));
        Assert.Equal(HttpStatusCode.Unauthorized, error.Status);
        Assert.Contains(EndgameEnvironment.AppToken, error.Message);
    }

    [Fact]
    public async Task Schedules_are_declared_at_start_and_only_signed_runs_execute()
    {
        var runs = 0;
        await using var host = await KitHost.StartAsync(map: app => app.MapSchedule("nightly-digest", "0 3 * * *", _ =>
        {
            Interlocked.Increment(ref runs);
            return Task.CompletedTask;
        }));

        await Eventually(() => host.Platform.Schedules is not null, "schedules were declared");
        var declared = host.Platform.Schedules!.AsArray().Single()!;
        Assert.Equal("nightly-digest", declared["name"]!.GetValue<string>());
        Assert.Equal("0 3 * * *", declared["cron"]!.GetValue<string>());
        Assert.Equal("_platform/schedules/nightly-digest", declared["path"]!.GetValue<string>());

        Assert.Equal(204, await DevPlatform.DevPlatformEndpoints.RunScheduleAsync(host.Platform, host.Client(), "nightly-digest"));
        Assert.Equal(401, await DevPlatform.DevPlatformEndpoints.RunScheduleAsync(host.Platform, host.Client(), "nightly-digest", signWith: "someone-else"));
        var unsigned = await host.Client().PostAsync("/_platform/schedules/nightly-digest", null);
        Assert.Equal(HttpStatusCode.Unauthorized, unsigned.StatusCode);
        Assert.Equal(1, runs);
    }

    [Theory]
    [InlineData("every night")]
    [InlineData("0 3 * *")]
    [InlineData("0 3 * * MON")]
    public void A_bad_cron_is_refused_where_it_is_written(string cron)
    {
        var app = WebApplication.CreateBuilder().Build();
        var error = Assert.Throws<ArgumentException>(() => app.MapSchedule("digest", cron, _ => Task.CompletedTask));
        Assert.Contains("five fields", error.Message);
    }

    [Fact]
    public async Task Webhooks_are_declared_and_only_verified_calls_reach_the_handler()
    {
        string? received = null;
        await using var host = await KitHost.StartAsync(map: app =>
        {
            app.MapWebhook("court-sensor", WebhookVerification.HmacSha256("X-Signature", "COURT_SENSOR_SECRET"), hook =>
            {
                received = hook.ReadJson<JsonElement>().GetProperty("court").GetString();
                return Task.FromResult(Results.Accepted());
            });
            app.MapWebhook("door", WebhookVerification.SharedToken("X-Token", "DOOR_TOKEN"), _ => Task.FromResult(Results.NoContent()));
        });
        host.Platform.Secrets["COURT_SENSOR_SECRET"] = "s3cret";
        host.Platform.Secrets["DOOR_TOKEN"] = "open-sesame";

        await Eventually(() => host.Platform.Webhooks is not null, "webhooks were declared");
        Assert.Equal(["hooks/court-sensor", "hooks/door"], host.Platform.Webhooks!.AsArray().Select(w => w!["path"]!.GetValue<string>()).Order());

        var body = """{"court":"3"}""";
        var mac = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes("s3cret"), Encoding.UTF8.GetBytes(body)));
        using var http = host.Client();

        using var bad = new StringContent(body, Encoding.UTF8, "application/json");
        bad.Headers.Add("X-Signature", "sha256=" + new string('0', 64));
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsync("/hooks/court-sensor", bad)).StatusCode);
        Assert.Null(received);

        using var good = new StringContent(body, Encoding.UTF8, "application/json");
        good.Headers.Add("X-Signature", "sha256=" + mac);
        Assert.Equal(HttpStatusCode.Accepted, (await http.PostAsync("/hooks/court-sensor", good)).StatusCode);
        Assert.Equal("3", received);

        using var door = new StringContent("");
        door.Headers.Add("X-Token", "open-sesame");
        Assert.Equal(HttpStatusCode.NoContent, (await http.PostAsync("/hooks/door", door)).StatusCode);
    }

    [Fact]
    public void Callback_signatures_verify_only_fresh_matching_bodies()
    {
        var body = Encoding.UTF8.GetBytes("{}");
        var now = DateTimeOffset.UtcNow;
        var header = CallbackSignature.Create("token", body, now);
        Assert.True(CallbackSignature.Verify("token", header, body, now));
        Assert.False(CallbackSignature.Verify("other", header, body, now));
        Assert.False(CallbackSignature.Verify("token", header, Encoding.UTF8.GetBytes("{ }"), now));
        Assert.False(CallbackSignature.Verify("token", header, body, now.AddMinutes(6)));
        Assert.False(CallbackSignature.Verify("token", "garbage", body, now));
    }

    [Fact]
    public void Platform_calls_go_out_through_the_egress_proxy_when_one_is_set()
    {
        var through = (SocketsHttpHandler)PlatformClient.CreateHandler(new EndgameSettings { EgressProxy = new Uri("http://egress:8080/") });
        Assert.True(through.UseProxy);
        Assert.Equal(new Uri("http://egress:8080/"), ((WebProxy)through.Proxy!).Address);

        var direct = (SocketsHttpHandler)PlatformClient.CreateHandler(new EndgameSettings());
        Assert.False(direct.UseProxy);
    }
}
