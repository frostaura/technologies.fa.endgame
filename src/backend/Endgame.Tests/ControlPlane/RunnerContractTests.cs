using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Platform;
using Endgame.Harness.Tools;
using Endgame.Runner.Agents;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The Runner's own control-plane client (<see cref="ControlPlaneClient"/>, <see cref="GatewayModelClient"/>
/// and the conversation's tools), in process, against the real control plane on real PostgreSQL: every
/// endpoint the Runner needs to run the factory, called exactly as the Runner calls it.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RunnerContractTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private ControlPlaneClient runner = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
        runner = new ControlPlaneClient(app.Internal());
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<Guid> RunAsync(string scope = "frostaura/technologies/squash", string kind = "task", Guid? employeeId = null) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind, title = "Contract run", employeeId })))["id"]!.GetValue<string>());

    private async Task FinishAsync(Guid run, string outcome = "succeeded") =>
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "run.finished", payload = new { outcome, summary = "Done." } } } }));

    private static JsonArray Messages() => [new JsonObject { ["role"] = "user", ["content"] = "Build it." }];

    private static JsonArray Tools() => [new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = "edit_file", ["parameters"] = new JsonObject { ["type"] = "object" } } }];

    // ------------------------------------------------------------------ estimates

    [Fact]
    public async Task The_research_estimate_starts_at_a_measured_figure_then_tracks_the_median_of_past_actuals_under_its_ceiling()
    {
        async Task<JsonObject> EstimateOfNewIdeaAsync()
        {
            var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { scope = "frostaura/technologies", text = "A court booking app for a squash club.", constraints = Array.Empty<string>() }));
            var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{idea["runId"]}/events"))).AsArray();
            return events.Single(e => e!["type"]!.GetValue<string>() == "estimate.made")!["payload"]!.AsObject();
        }

        // No history yet: the measured starting figure, said as such, with the most it could cost beside it.
        var first = await EstimateOfNewIdeaAsync();
        Assert.Equal(12m, first["credits"]!.GetValue<decimal>());
        Assert.Contains("starting figure", first["reason"]!.GetValue<string>(), StringComparison.Ordinal);
        var ceiling = first["ceiling"]!.GetValue<decimal>();
        Assert.True(ceiling > first["credits"]!.GetValue<decimal>());

        // Three research runs actually cost 20, 30 and 45 credits: the estimate is now their median.
        var gateway = new GatewayModelClient(app.Internal(), stream: false);
        foreach (var usd in new[] { 0.20m, 0.45m, 0.30m })
        {
            var run = await RunAsync("frostaura/technologies", "research");
            openRouter.Chat = FakeOpenRouter.Completion(usd);
            await gateway.CompleteAsync(new ChatCall("research", "frostaura/technologies", run, null, Messages(), null, 2000, false, null, null), CancellationToken.None);
            await FinishAsync(run);
        }

        var calibrated = await EstimateOfNewIdeaAsync();
        Assert.Equal(30m, calibrated["credits"]!.GetValue<decimal>());
        Assert.Contains("median of the last 3 research runs", calibrated["reason"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(ceiling, calibrated["ceiling"]!.GetValue<decimal>());

        // The public estimate says the same, with its basis, for the organisation named.
        var shown = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/ideas/estimate", new { text = "A court booking app for a squash club.", scope = "frostaura" }));
        Assert.Equal(30m, shown["credits"]!.GetValue<decimal>());
        Assert.Contains("median", shown["basis"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------ A1, A2

    [Theory]
    [InlineData("build", "deepseek/deepseek-v4.1-flash", true)]
    [InlineData("build-t1", "qwen/qwen3.7-plus", false)]
    [InlineData("build-t2", "z-ai/glm-5.2", false)]
    [InlineData("build-t3", "anthropic/claude-sonnet-5.5", false)]
    public async Task Each_building_tier_routes_to_its_model_with_the_pinned_provider_and_only_supported_parameters(string taskType, string model, bool takesParallelToolCalls)
    {
        var run = await RunAsync();
        var gateway = new GatewayModelClient(app.Internal(), stream: false);
        var reply = await gateway.CompleteAsync(new ChatCall(taskType, "frostaura/technologies/squash", run, null, Messages(), Tools(), 4000, false, ["DeepInfra", "Fireworks"], null), CancellationToken.None);
        Assert.True(reply.SettledCredits > 0);

        var sent = openRouter.Requests.Last();
        Assert.Equal(model, sent["model"]!.GetValue<string>());
        Assert.Equal(["DeepInfra", "Fireworks"], sent["provider"]!["order"]!.AsArray().Select(p => p!.GetValue<string>()));
        Assert.True(sent["provider"]!["require_parameters"]!.GetValue<bool>());
        Assert.Equal(takesParallelToolCalls, sent.ContainsKey("parallel_tool_calls"));
        Assert.False(sent.ContainsKey("temperature"));
        Assert.Equal("low", sent["reasoning"]!["effort"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_research_call_carries_its_search_budget_and_the_searches_made_and_sources_cited_come_back()
    {
        var run = await RunAsync("frostaura/technologies", "research");
        openRouter.Chat = async (request, http) =>
        {
            var usage = FakeOpenRouter.Usage(0.0135m);
            usage["server_tool_use_details"] = new JsonObject { ["web_search_requests"] = 3 };
            await Microsoft.AspNetCore.Http.HttpResponseJsonExtensions.WriteAsJsonAsync(http.Response, new JsonObject
            {
                ["id"] = "gen-search",
                ["provider"] = "FakeProvider",
                ["model"] = request["model"]?.GetValue<string>(),
                ["choices"] = new JsonArray(new JsonObject
                {
                    ["index"] = 0,
                    ["finish_reason"] = "stop",
                    ["message"] = new JsonObject
                    {
                        ["role"] = "assistant",
                        ["content"] = "{\"findings\":[]}",
                        ["annotations"] = new JsonArray(
                            new JsonObject { ["type"] = "url_citation", ["url_citation"] = new JsonObject { ["url"] = "https://bookclubs.com", ["title"] = "Bookclubs" } },
                            new JsonObject { ["type"] = "url_citation", ["url_citation"] = new JsonObject { ["url"] = "https://bookclubs.com", ["title"] = "again" } }),
                    },
                }),
                ["usage"] = usage,
            });
        };
        var body = GatewayModelClient.Body(new ChatCall("research", "frostaura/technologies", run, null, Messages(), null, 2000, false, null, null), stream: false);
        body["limits"]!["maxSearches"] = 7;
        using var response = await app.Internal().PostAsync("/internal/model/chat", new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();
        Assert.Equal(7, openRouter.Requests.Last()["tools"]![0]!["parameters"]!["max_uses"]!.GetValue<int>());

        var gateway = new GatewayModelClient(app.Internal(), stream: false);
        var reply = await gateway.CompleteAsync(new ChatCall("research", "frostaura/technologies", run, null, Messages(), null, 2000, false, null, null), CancellationToken.None);
        Assert.Equal(3, reply.Searches);
        Assert.Equal(["https://bookclubs.com"], reply.Citations);
        Assert.Null(reply.Message["annotations"]);
        var replied = (await runner.ReadEventsAsync(run, 0, 50, CancellationToken.None)).Where(e => e.Type == "model.replied").ToList();
        Assert.All(replied, e => Assert.Equal(3, e.Payload["searches"]!.GetValue<int>()));
    }

    [Fact]
    public async Task Sonnet_never_receives_a_temperature_even_when_a_caller_sends_one()
    {
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/model/chat", new
        {
            taskType = "build-t3",
            scope = "frostaura/technologies/squash",
            temperature = 0.3,
            messages = new[] { new { role = "user", content = "Hi." } },
        }));
        Assert.False(openRouter.Requests.Last().ContainsKey("temperature"));

        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/model/chat", new
        {
            taskType = "build",
            scope = "frostaura/technologies/squash",
            temperature = 0.3,
            messages = new[] { new { role = "user", content = "Hi." } },
        }));
        Assert.Equal(0.3, openRouter.Requests.Last()["temperature"]!.GetValue<double>());
    }

    // ------------------------------------------------------------------ A3

    [Fact]
    public async Task Placement_creates_each_level_once_and_finds_it_again()
    {
        var division = await runner.EnsureNodeAsync("frostaura", "division", "Labs", "labs", CancellationToken.None);
        Assert.Equal("frostaura/labs", division.Path);
        var project = await runner.EnsureNodeAsync(division.Path, "project", "Court Finder", "court-finder", CancellationToken.None);
        var appNode = await runner.EnsureNodeAsync(project.Path, "app", "Court Finder", "web", CancellationToken.None);
        Assert.Equal("frostaura/labs/court-finder/web", appNode.Path);
        Assert.Equal("Court Finder", appNode.Name);

        // Placing again (a resumed build) finds the same nodes: 200, not a second app.
        var again = await service.PostAsJsonAsync("/internal/tree/nodes", new { parent = project.Path, level = "app", name = "Court Finder", slug = "web" });
        var body = await ControlPlaneApp.Expect(again, HttpStatusCode.OK);
        Assert.Equal(appNode.Id.ToString(), body["id"]!.GetValue<string>());
        Assert.Equal("app", body["level"]!.GetValue<string>());
        Assert.Equal(appNode.Id, (await runner.EnsureNodeAsync(project.Path, "app", "Court Finder", "web", CancellationToken.None)).Id);

        var created = await service.PostAsJsonAsync("/internal/tree/nodes", new { parent = project.Path, level = "app", name = "Admin", slug = "admin" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var wrongLevel = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/tree/nodes", new { parent = "frostaura", level = "app", name = "X", slug = "xx" }), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_request", wrongLevel["code"]!.GetValue<string>());
    }

    // ------------------------------------------------------------------ A4

    [Fact]
    public async Task Headroom_is_the_tightest_cap_on_the_path_or_the_overdraft()
    {
        Assert.Equal(100m, await runner.HeadroomAsync("frostaura/technologies/squash", CancellationToken.None));
        var unbound = await ControlPlaneApp.Ok(service.GetAsync("/internal/credits/headroom?scope=frostaura/technologies/squash"));
        Assert.Equal("organisation balance", unbound["bindingScope"]!.GetValue<string>());

        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", 7m);
        await owner.SetAsync("frostaura/technologies/squash", "budget", "monthly_credits", 20m);
        Assert.Equal(7m, await runner.HeadroomAsync("frostaura/technologies/squash", CancellationToken.None));
        var bound = await ControlPlaneApp.Ok(service.GetAsync("/internal/credits/headroom?scope=frostaura/technologies/squash"));
        Assert.Equal("frostaura/technologies", bound["bindingScope"]!.GetValue<string>());
        Assert.Equal("budget", bound["binding"]!.GetValue<string>());

        // An unknown scope is a 404, which the Runner's client reads as "not known".
        Assert.Null(await runner.HeadroomAsync("frostaura/nowhere", CancellationToken.None));
    }

    // ------------------------------------------------------------------ A5

    [Fact]
    public async Task Cost_history_is_the_billable_actuals_of_finished_runs_in_one_organisation_only()
    {
        openRouter.Chat = FakeOpenRouter.Completion(0.0003m);
        var gateway = new GatewayModelClient(app.Internal(), stream: false);
        var finished = await RunAsync();
        await gateway.CompleteAsync(new ChatCall("chat", "frostaura/technologies/squash", finished, null, Messages(), null, 100, false, null, null), CancellationToken.None);
        await gateway.CompleteAsync(new ChatCall("chat", "frostaura/technologies/squash", finished, null, Messages(), null, 100, true, null, null), CancellationToken.None);
        await FinishAsync(finished);
        var failed = await RunAsync();
        await gateway.CompleteAsync(new ChatCall("chat", "frostaura/technologies/squash", failed, null, Messages(), null, 100, false, null, null), CancellationToken.None);
        await FinishAsync(failed, "failed");

        // Another organisation's runs never inform this one's estimates.
        var other = await app.SignInAsync("dean@frostaura.net", "Dean");
        await ControlPlaneApp.Created(other.PostAsJsonAsync("/api/organisations", new { name = "Elsewhere", slug = "elsewhere", ownerEmail = "dean@frostaura.net", description = Provisioning.Description, screening = Provisioning.Manual }));
        await other.TopUpAsync("elsewhere", 10m);
        var theirs = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "elsewhere", kind = "task", title = "Theirs" })))["id"]!.GetValue<string>());
        await gateway.CompleteAsync(new ChatCall("chat", "elsewhere", theirs, null, Messages(), null, 100, false, null, null), CancellationToken.None);
        await FinishAsync(theirs);

        var history = (await ControlPlaneApp.Ok(service.GetAsync("/internal/estimates/history?taskType=task&scope=frostaura/technologies/squash&limit=50"))).AsArray();
        var row = Assert.Single(history)!;
        Assert.Equal(finished.ToString(), row["runId"]!.GetValue<string>());
        Assert.Equal(0.03m, row["credits"]!.GetValue<decimal>()); // the repair call is not billed, so not counted
        Assert.Equal(2, row["steps"]!.GetValue<int>());

        // The Runner's client sends the run's scope, so it reads its own organisation's history and nothing else.
        Assert.Equal([0.03m], await runner.CostHistoryAsync("task", "frostaura/technologies/squash", CancellationToken.None));
        Assert.Empty(await runner.CostHistoryAsync("research", "frostaura/technologies/squash", CancellationToken.None));
        var refused = await ControlPlaneApp.Expect(await service.GetAsync("/internal/estimates/history?taskType=task&limit=50"), HttpStatusCode.BadRequest);
        Assert.Equal("scope_required", refused["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task Estimate_accuracy_is_scored_from_the_runners_own_events_per_employee_and_per_organisation()
    {
        var ada = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/technologies", name = "Ada", role = "Builder" })))["id"]!.GetValue<string>());
        var close = await RunAsync(employeeId: ada);
        await runner.AppendAsync(close, null, [new("estimate.scored", new JsonObject { ["expectedCredits"] = 2m, ["actualCredits"] = 2.1m, ["nonBillableCredits"] = 0m, ["modelCalls"] = 3 })], CancellationToken.None);
        var wide = await RunAsync();
        await runner.AppendAsync(wide, null, [new("estimate.scored", new JsonObject { ["expectedCredits"] = 1m, ["actualCredits"] = 3m })], CancellationToken.None);

        var hers = await ControlPlaneApp.Ok(service.GetAsync($"/internal/estimates/accuracy?scope=frostaura&employeeId={ada}"));
        Assert.Equal(1, hers["estimates"]!["pieces"]!.GetValue<int>());
        Assert.Equal(100m, hers["estimates"]!["withinPercent"]!.GetValue<decimal>());

        var organisation = await ControlPlaneApp.Ok(service.GetAsync("/internal/estimates/accuracy?scope=frostaura"));
        Assert.Equal(2, organisation["estimates"]!["pieces"]!.GetValue<int>());
        Assert.Equal(1, organisation["estimates"]!["over"]!.GetValue<int>());

        // The console's credits page reads the same events (it used to look for other field names and saw none).
        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        Assert.Equal(2, credits["estimates"]!["pieces"]!.GetValue<int>());
    }

    // ------------------------------------------------------------------ A6

    [Theory]
    [InlineData("tasks")]
    [InlineData("runs")]
    [InlineData("credits")]
    [InlineData("workforce")]
    [InlineData("overview")]
    [InlineData("contents")]
    public async Task The_conversation_reads_the_organisation_through_its_own_tool(string what)
    {
        await owner.AppAsync("frostaura/technologies/squash", "web", "Squash web");
        var run = await RunAsync();
        await runner.CreateTaskAsync("frostaura/technologies/squash", run, "Wire the bookings page", null, 1m, null, CancellationToken.None);
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/technologies/squash", name = "Ada", role = "Builder" }));
        var tool = new ReadOrganisationTool(runner, "frostaura/technologies");
        var outcome = await tool.ExecuteAsync(new ToolCall("c1", tool.Name, new JsonObject { ["what"] = what }, null!), CancellationToken.None);
        Assert.False(outcome.IsError, outcome.Content);
        var read = JsonNode.Parse(outcome.Content)!;
        switch (what)
        {
            case "tasks":
                Assert.Equal("Wire the bookings page", read[0]!["title"]!.GetValue<string>());
                break;
            case "runs":
                Assert.Equal(run.ToString(), read[0]!["id"]!.GetValue<string>());
                break;
            case "credits":
                Assert.Equal(100m, read["balance"]!.GetValue<decimal>());
                break;
            case "workforce":
                Assert.Equal("Ada", Assert.Single(read.AsArray())!["name"]!.GetValue<string>());
                break;
            case "contents":
                // R5-1: what is beneath the scope, each app with its state, counted as home counts it.
                Assert.Equal(1, read["counts"]!["apps"]!.GetValue<int>());
                Assert.Equal("Squash web", read["divisions"]![0]!["projects"]![0]!["apps"]![0]!["name"]!.GetValue<string>());
                break;
            default:
                // The overview leads with the contents, then the cascade (its levels are only the path down to the scope).
                Assert.Equal("frostaura/technologies", read["cascade"]!["scope"]!.GetValue<string>());
                Assert.Equal(1, read["contents"]!["counts"]!["apps"]!.GetValue<int>());
                break;
        }
    }

    [Fact]
    public async Task The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may()
    {
        var start = new StartIdeaTool(runner, "frostaura/technologies/squash");
        var started = await start.ExecuteAsync(new ToolCall("c1", start.Name, new JsonObject { ["text"] = "A ladder for club players", ["constraints"] = new JsonArray("Members only") }, null!), CancellationToken.None);
        Assert.False(started.IsError, started.Content);
        var body = JsonNode.Parse(started.Content["Research started: ".Length..])!;
        Assert.Equal("frostaura/technologies", body["idea"]!["scope"]!.GetValue<string>()); // proposed to the division it sits in
        Assert.Equal("research", body["run"]!["kind"]!.GetValue<string>());
        Assert.True(body["estimate"]!["credits"]!.GetValue<decimal>() > 0);
        var research = await runner.ReadEventsAsync(Guid.Parse(body["run"]!["id"]!.GetValue<string>()), 0, 10, CancellationToken.None);
        Assert.Equal("owner", research[0].Payload["from"]!.GetValue<string>());
        Assert.Equal("conversation", research[0].Payload["via"]!.GetValue<string>());

        var adjust = new AdjustSettingTool(runner, "frostaura/technologies/squash");
        var changed = await adjust.ExecuteAsync(new ToolCall("c2", adjust.Name, new JsonObject { ["key"] = "autonomy", ["value"] = "\"checkpoints\"" }, null!), CancellationToken.None);
        Assert.False(changed.IsError, changed.Content);
        var context = await runner.ContextAsync("frostaura/technologies/squash", CancellationToken.None);
        Assert.Contains(context["settings"]!.AsArray(), s => s!["key"]!.GetValue<string>() == "autonomy" && s["value"]!.GetValue<string>() == "checkpoints");

        foreach (var (key, value) in new[] { ("access", "\"public\""), ("access", "\"private\""), ("overdraft_own_limit", "10"), ("monthly_credits", "1000") })
        {
            var refused = await adjust.ExecuteAsync(new ToolCall("c3", adjust.Name, new JsonObject { ["key"] = key, ["value"] = value }, null!), CancellationToken.None);
            Assert.True(refused.IsError);
            Assert.Contains("403", refused.Content, StringComparison.Ordinal);
        }

        var invalid = await adjust.ExecuteAsync(new ToolCall("c4", adjust.Name, new JsonObject { ["key"] = "autonomy", ["value"] = "\"sometimes\"" }, null!), CancellationToken.None);
        Assert.True(invalid.IsError);
        Assert.Contains("400", invalid.Content, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------ A7, A8

    private async Task<Guid> IdeaWithVerdictAsync(string outcome, string? redLine = null, string scope = "frostaura/technologies")
    {
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = $"An idea that gets {outcome}", constraints = Array.Empty<string>(), scope }));
        var id = Guid.Parse(idea["id"]!.GetValue<string>());
        await runner.RecordVerdictAsync(id, VerdictSamples.Valid(outcome, redLine), CancellationToken.None);
        return id;
    }

    [Fact]
    public async Task Auto_mode_builds_after_a_build_verdict_and_a_do_not_build_waits_for_the_owner()
    {
        var build = await IdeaWithVerdictAsync("build");
        var decided = await ControlPlaneApp.Ok(runner.Http.PostAsJsonAsync($"/internal/ideas/{build}/decision", new { decision = "build", by = "auto-mode" }));
        Assert.Equal("build", decided["run"]!["kind"]!.GetValue<string>());
        var idea = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{build}"));
        Assert.Equal("auto-mode", idea["decision"]!["via"]!.GetValue<string>());
        Assert.Equal("auto-mode", idea["decision"]!["by"]!.GetValue<string>());
        var first = (await runner.ReadEventsAsync(Guid.Parse(decided["run"]!["id"]!.GetValue<string>()), 0, 5, CancellationToken.None))[0];
        Assert.Equal("owner", first.Payload["from"]!.GetValue<string>());
        Assert.Equal("auto-mode", first.Payload["decidedBy"]!.GetValue<string>());

        var no = await IdeaWithVerdictAsync("do-not-build");
        var waits = await ControlPlaneApp.Expect(await runner.Http.PostAsJsonAsync($"/internal/ideas/{no}/decision", new { decision = "build", by = "auto-mode" }), HttpStatusCode.Conflict);
        Assert.Equal("owner_decision_required", waits["code"]!.GetValue<string>());
        var overrule = await ControlPlaneApp.Expect(await runner.Http.PostAsJsonAsync($"/internal/ideas/{no}/decision", new { decision = "overrule", by = "auto-mode" }), HttpStatusCode.Forbidden);
        Assert.Equal("owner_decision_required", overrule["code"]!.GetValue<string>());

        // Where checkpoints are on, even a build verdict waits for the owner.
        await owner.SetAsync("frostaura", "setting", "autonomy", "checkpoints");
        var change = await IdeaWithVerdictAsync("change");
        var held = await ControlPlaneApp.Expect(await runner.Http.PostAsJsonAsync($"/internal/ideas/{change}/decision", new { decision = "build", by = "auto-mode" }), HttpStatusCode.Conflict);
        Assert.Equal("owner_decision_required", held["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await runner.Http.PostAsJsonAsync($"/internal/ideas/{change}/decision", new { decision = "build", by = "someone" }), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_breached_red_line_cannot_be_overruled_by_anyone_a_person_included()
    {
        var crossed = await IdeaWithVerdictAsync("do-not-build", "surveillance");
        foreach (var choice in new[] { "overrule", "build" })
        {
            var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{crossed}/decision", new { choice }), HttpStatusCode.Forbidden);
            Assert.Equal("red_line", refused["code"]!.GetValue<string>());
            Assert.Equal("surveillance", refused["redLine"]!.GetValue<string>());
        }

        var idea = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{crossed}"));
        Assert.Equal("surveillance", idea["redLine"]!.GetValue<string>());
        Assert.Null(idea["decision"]);
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{crossed}/decision", new { choice = "drop" }));

        // A plain do-not-build is still the owner's to overrule.
        var plain = await IdeaWithVerdictAsync("do-not-build");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{plain}/decision", new { choice = "overrule" }));

        // A verdict cannot name a breached red line and still say build.
        var contradiction = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "Contradictory", constraints = Array.Empty<string>() }));
        var problem = await Assert.ThrowsAsync<VerdictRefusedException>(() => runner.RecordVerdictAsync(Guid.Parse(contradiction["id"]!.GetValue<string>()), VerdictSamples.Valid("build", "tobacco-gambling-finance"), CancellationToken.None));
        Assert.Contains("outcome: \"do-not-build\": a breached red line is never built", problem.Errors);
    }

    // ------------------------------------------------------------------ A9

    [Fact]
    public async Task Autonomy_and_stage_rule_sets_resolve_down_the_cascade_and_reach_the_runner()
    {
        var empty = await ControlPlaneApp.Ok(owner.GetAsync("/api/autonomy?scope=frostaura/technologies/squash"));
        Assert.Equal("auto", empty["autonomy"]!.GetValue<string>());
        Assert.Null(empty["autonomySetAtPath"]);
        Assert.False(empty["checkpoints"]!["plan"]!["on"]!.GetValue<bool>());

        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy", new { scope = "frostaura", autonomy = "checkpoints", checkpoints = new { start = true, plan = true } }));
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy", new { scope = "frostaura/technologies", checkpoints = new { start = false } }));
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura", stage = "all", deny = new[] { "run(git push*)" } }));
        var view = await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura/technologies", stage = "build", ask = new[] { "write_file(api/Migrations/**)" }, checkpoints = new[] { "commit" } }));
        Assert.Equal("checkpoints", view["autonomy"]!.GetValue<string>());
        Assert.Equal("frostaura", view["autonomySetAtPath"]!.GetValue<string>());
        Assert.False(view["checkpoints"]!["start"]!["on"]!.GetValue<bool>());
        Assert.Equal("frostaura/technologies", view["checkpoints"]!["start"]!["setAtPath"]!.GetValue<string>());
        Assert.True(view["checkpoints"]!["plan"]!["on"]!.GetValue<bool>());
        Assert.Equal(2, view["ruleSets"]!.AsArray().Count);

        // The Runner reads the same cascade, and the harness parses the rule sets it finds there.
        var context = await runner.ContextAsync("frostaura/technologies/squash", CancellationToken.None);
        var sets = context["ruleSets"]!.AsArray().OfType<JsonObject>()
            .Select(r => CascadeRuleSet.FromJson(r["key"]!.GetValue<string>(), r["setAtPath"]!.GetValue<string>(), r["value"]))
            .ToList();
        var build = Assert.Single(sets, s => s.Key == "build");
        Assert.True(build.AppliesTo("build"));
        Assert.Equal("write_file(api/Migrations/**)", Assert.Single(build.Ask).Text);
        Assert.Equal("commit", Assert.Single(build.Checkpoints).Text);
        Assert.Equal("run(git push*)", Assert.Single(Assert.Single(sets, s => s.Key == "all").Deny).Text);
        Assert.Contains(context["settings"]!.AsArray(), s => s!["key"]!.GetValue<string>() == "checkpoint.plan" && s["value"]!.GetValue<bool>());

        // Faults are refused before they reach an agent.
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura", stage = "deploy", deny = new[] { "commit" } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura", stage = "build", deny = new[] { "Not A Rule!" } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/autonomy", new { scope = "frostaura", autonomy = "sometimes" }), HttpStatusCode.BadRequest);

        // Admin and above set them; a Builder reads but cannot change them.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "builder@example.com", displayName = "Bea", role = "builder" }));
        var builder = await app.SignInAsync("builder@example.com", "Bea");
        await ControlPlaneApp.Ok(builder.GetAsync("/api/autonomy?scope=frostaura"));
        await ControlPlaneApp.Expect(await builder.PutAsJsonAsync("/api/autonomy", new { scope = "frostaura", autonomy = "auto" }), HttpStatusCode.Forbidden);

        // Removing the narrower value lets the inherited one apply again.
        var removed = await ControlPlaneApp.Ok(owner.DeleteAsync("/api/autonomy?scope=frostaura/technologies&key=checkpoint.start"));
        Assert.True(removed["checkpoints"]!["start"]!["on"]!.GetValue<bool>());
        var noBuild = await ControlPlaneApp.Ok(owner.DeleteAsync("/api/autonomy/rule-sets?scope=frostaura/technologies&stage=build"));
        Assert.Single(noBuild["ruleSets"]!.AsArray());
    }
}
