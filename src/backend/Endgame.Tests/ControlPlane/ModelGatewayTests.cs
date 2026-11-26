using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Gateway;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// <c>POST /internal/model/chat</c> end to end: the real control plane and ledger on real Postgres,
/// with OpenRouter replaced by an in-test server that answers in OpenRouter's shapes.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ModelGatewayTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private static object Chat(string? runId = null, bool stream = false, int? maxTokens = null, bool repair = false, string taskType = "chat", string scope = "frostaura/technologies") => new
    {
        taskType,
        scope,
        runId,
        stream,
        repair,
        limits = new { maxTokens },
        messages = new[] { new { role = "user", content = "Say hello." } },
    };

    private async Task<string> RunAsync() =>
        (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies", kind = "task", title = "Gateway test" })))["id"]!.GetValue<string>();

    private async Task<JsonNode> CreditsAsync() => await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));

    private decimal ReservationFor(object chat)
    {
        var options = app.Services.GetRequiredService<ModelGatewayOptions>();
        var credits = app.Services.GetRequiredService<Endgame.Infrastructure.Credits.PricingService>().Credits();
        var request = JsonSerializer.Deserialize<ChatRequest>(JsonSerializer.Serialize(chat, ControlPlaneApp.Web), ControlPlaneApp.Web)!;
        return ModelGateway.Prepare(options, credits, request, options.Routes[request.TaskType], request.Stream).ReservedCredits;
    }

    [Fact]
    public void A_caller_that_reads_json_gets_a_json_response_format_where_the_models_take_one_and_never_alongside_tools()
    {
        // R2-6: the harness's JSON-answering agents ask for a JSON object outright, not only in words.
        var options = app.Services.GetRequiredService<ModelGatewayOptions>();
        var credits = app.Services.GetRequiredService<Endgame.Infrastructure.Credits.PricingService>().Credits();
        JsonObject Body(bool preferJson, JsonArray? tools) => ModelGateway.Prepare(options, credits, new ChatRequest
        {
            TaskType = "summarise",
            Messages = [new JsonObject { ["role"] = "user", ["content"] = "Review it." }],
            Tools = tools,
            PreferJson = preferJson,
        }, options.Routes["summarise"], stream: false).Body;
        Assert.Equal("json_object", Body(true, null)["response_format"]!["type"]!.GetValue<string>());
        Assert.Null(Body(false, null)["response_format"]);
        Assert.Null(Body(true, [new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = "notes", ["parameters"] = new JsonObject { ["type"] = "object" } } }])["response_format"]);
    }

    [Fact]
    public async Task Routes_reserves_sends_the_ceiling_and_settles_from_the_replys_own_cost()
    {
        openRouter.Chat = FakeOpenRouter.Completion(0.00042m, toolCallId: "call_Ab3:xyz/opaque-ID");
        var runId = await RunAsync();
        var response = await service.PostAsJsonAsync("/internal/model/chat", Chat(runId, maxTokens: 10_000_000));
        var body = await ControlPlaneApp.Expect(response, HttpStatusCode.OK);

        // Passed through untouched: the tool-call id is echoed exactly (rule 8).
        Assert.Equal("call_Ab3:xyz/opaque-ID", body["choices"]![0]!["message"]!["tool_calls"]![0]!["id"]!.GetValue<string>());
        Assert.Equal("0.042", response.Headers.GetValues("Endgame-Settled-Credits").Single());

        var sent = Assert.Single(openRouter.Requests);
        Assert.Equal($"Bearer {FakeOpenRouter.Key}", openRouter.Authorizations.Single());
        Assert.Equal("qwen/qwen3.7-flash", sent["model"]!.GetValue<string>());
        Assert.Equal(["qwen/qwen3.7-flash", "openai/gpt-oss-20b"], sent["models"]!.AsArray().Select(m => m!.GetValue<string>()));
        Assert.Equal(4000, sent["max_tokens"]!.GetValue<int>()); // ten million asked for, clamped (rule 4)
        Assert.Equal("low", sent["reasoning"]!["effort"]!.GetValue<string>()); // explicit (rule 5)
        Assert.Equal(0.2m, sent["provider"]!["max_price"]!["prompt"]!.GetValue<decimal>()); // ceiling sent (rule 1)
        Assert.Equal(0.8m, sent["provider"]!["max_price"]!["completion"]!.GetValue<decimal>());
        Assert.True(sent["provider"]!["require_parameters"]!.GetValue<bool>());
        Assert.Equal("price", sent["provider"]!["sort"]!.GetValue<string>());
        Assert.True(sent["usage"]!["include"]!.GetValue<bool>());

        var credits = await CreditsAsync();
        Assert.Equal(100m - 0.042m, credits["balance"]!.GetValue<decimal>());
        Assert.Equal(0.042m, credits["month"]!["spent"]!.GetValue<decimal>());
        Assert.Equal(0m, credits["heldCredits"]!.GetValue<decimal>());

        var events = await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{runId}/events"));
        var requested = events.AsArray().Single(e => e!["type"]!.GetValue<string>() == "model.requested")!;
        var replied = events.AsArray().Single(e => e!["type"]!.GetValue<string>() == "model.replied")!;
        Assert.Equal(requested["payload"]!["callId"]!.GetValue<string>(), replied["payload"]!["callId"]!.GetValue<string>());
        Assert.True(requested["payload"]!["reservedCredits"]!.GetValue<decimal>() >= replied["payload"]!["settledCredits"]!.GetValue<decimal>());
        Assert.Equal(12, replied["payload"]!["tokens"]!["input"]!.GetValue<int>());
    }

    [Fact]
    public async Task Streams_through_and_writes_the_settlement_before_the_closing_done()
    {
        openRouter.Chat = FakeOpenRouter.Stream(0.0003m, "Hel", "lo");
        var response = await service.PostAsJsonAsync("/internal/model/chat", Chat(stream: true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType!.MediaType);
        var lines = (await response.Content.ReadAsStringAsync()).Split('\n');
        Assert.Contains(": OPENROUTER PROCESSING", lines);
        Assert.Contains(lines, l => l.Contains("\"content\":\"Hel\"", StringComparison.Ordinal));
        var settlementAt = Array.IndexOf(lines, "event: endgame.settlement");
        var doneAt = Array.IndexOf(lines, "data: [DONE]");
        Assert.True(settlementAt > 0 && doneAt > settlementAt, "The settlement event comes before [DONE].");
        Assert.Equal(1, lines.Count(l => l == "data: [DONE]"));
        var settlement = JsonNode.Parse(lines[settlementAt + 1]["data: ".Length..])!;
        Assert.Equal(0.03m, settlement["settledCredits"]!.GetValue<decimal>());
        Assert.Equal(100m - 0.03m, (await CreditsAsync())["balance"]!.GetValue<decimal>());
    }

    [Fact]
    public async Task A_mid_stream_error_is_reported_and_the_call_is_settled_from_the_generation_record()
    {
        openRouter.Generations["gen-fake-stream"] = 0.00007m;
        openRouter.Chat = FakeOpenRouter.StreamWithMidStreamError();
        var response = await service.PostAsJsonAsync("/internal/model/chat", Chat(stream: true));
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("Upstream stopped mid-answer", text, StringComparison.Ordinal);
        var lines = text.Split('\n');
        var settlement = JsonNode.Parse(lines[Array.IndexOf(lines, "event: endgame.settlement") + 1]["data: ".Length..])!;
        Assert.Equal("Upstream stopped mid-answer", settlement["error"]!["message"]!.GetValue<string>());
        Assert.Equal(0.007m, settlement["settledCredits"]!.GetValue<decimal>());
        Assert.DoesNotContain("data: [DONE]", lines);
    }

    [Fact]
    public async Task An_error_inside_a_200_is_detected_and_still_settled()
    {
        openRouter.Chat = FakeOpenRouter.ErrorInside200(0.0001m);
        var problem = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat()), HttpStatusCode.BadGateway);
        Assert.Equal("upstream_error", problem["code"]!.GetValue<string>());
        Assert.Equal(0.01m, problem["settledCredits"]!.GetValue<decimal>());
        Assert.Equal(0.01m, (await CreditsAsync())["month"]!["spent"]!.GetValue<decimal>());
    }

    [Fact]
    public async Task No_provider_under_the_ceiling_is_ceiling_unreachable_and_releases_the_reservation()
    {
        openRouter.Chat = FakeOpenRouter.Refuse(404, "No endpoints found that can handle the requested parameters within max_price.");
        var problem = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat()), (HttpStatusCode)422);
        Assert.Equal("ceiling_unreachable", problem["code"]!.GetValue<string>());
        Assert.False(problem["terminal"]!.GetValue<bool>());
        var credits = await CreditsAsync();
        Assert.Equal(100m, credits["balance"]!.GetValue<decimal>());
        Assert.Equal(0m, credits["heldCredits"]!.GetValue<decimal>());
    }

    [Fact]
    public async Task A_reply_without_a_cost_is_settled_from_the_generation_record()
    {
        openRouter.Generations["gen-nocost"] = 0.0002m;
        openRouter.Chat = FakeOpenRouter.Completion(null, id: "gen-nocost");
        var response = await service.PostAsJsonAsync("/internal/model/chat", Chat());
        await ControlPlaneApp.Expect(response, HttpStatusCode.OK);
        Assert.Equal("0.02", response.Headers.GetValues("Endgame-Settled-Credits").Single());
    }

    [Fact]
    public async Task Budget_exhaustion_is_terminal_for_the_run_and_never_reaches_the_provider_again()
    {
        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", 0.001m);
        var runId = await RunAsync();
        var problem = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat(runId)), HttpStatusCode.PaymentRequired);
        Assert.Equal("budget_exhausted", problem["code"]!.GetValue<string>());
        Assert.True(problem["terminal"]!.GetValue<bool>());
        Assert.Equal("frostaura/technologies", problem["bindingScope"]!.GetValue<string>());

        // Raising the budget does not revive the run: exhaustion is terminal, never retried.
        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", 50m);
        var again = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat(runId)), HttpStatusCode.PaymentRequired);
        Assert.Equal("budget_exhausted", again["code"]!.GetValue<string>());
        Assert.Empty(openRouter.Requests);
        var run = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{runId}"));
        Assert.True(run["budgetExhausted"]!.GetValue<bool>());

        // New work in the same scope can go ahead.
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat()), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Repair_work_is_recorded_but_not_charged()
    {
        openRouter.Chat = FakeOpenRouter.Completion(0.0005m);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat(repair: true)), HttpStatusCode.OK);
        var credits = await CreditsAsync();
        Assert.Equal(100m, credits["balance"]!.GetValue<decimal>());
        Assert.Equal(0m, credits["month"]!["spent"]!.GetValue<decimal>());
        Assert.Equal(0.05m, credits["notCharged"]!["credits"]!.GetValue<decimal>());
        Assert.Equal(1, credits["notCharged"]!["repairs"]!.GetValue<int>());
    }

    [Fact]
    public async Task Unknown_task_types_and_calls_without_the_service_token_are_refused()
    {
        var unknown = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Chat(taskType: "nope")), HttpStatusCode.BadRequest);
        Assert.Equal("unknown_task_type", unknown["code"]!.GetValue<string>());
        var anonymous = await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/internal/model/chat", Chat()), HttpStatusCode.Unauthorized);
        Assert.Equal("invalid_service_token", anonymous["code"]!.GetValue<string>());
        Assert.Empty(openRouter.Requests);
    }

    [Fact]
    public async Task Concurrent_calls_against_a_budget_that_fits_k_admit_exactly_k()
    {
        const int calls = 12;
        const int fits = 5;
        var reservation = ReservationFor(Chat());
        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", (reservation * fits) + (reservation / 2));
        openRouter.Gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        openRouter.Chat = FakeOpenRouter.Completion(0.00001m);

        // Every admitted call is held in flight at the provider, so its reservation is still open
        // while the others are decided.
        var all = Enumerable.Range(0, calls).Select(_ => service.PostAsJsonAsync("/internal/model/chat", Chat())).ToList();
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (all.Count(t => t.IsCompleted) < calls - fits && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50);
        }

        await Task.Delay(300);
        Assert.Equal(fits, openRouter.Requests.Count);
        openRouter.Gate.SetResult();
        var responses = await Task.WhenAll(all);
        Assert.Equal(fits, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(calls - fits, responses.Count(r => r.StatusCode == HttpStatusCode.PaymentRequired));
    }
}
