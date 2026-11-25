using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Harness.Workspaces;
using Endgame.Runner;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Platform;
using Endgame.Runner.Workflows;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace Endgame.Tests.Harness;

/// <summary>
/// The Runner against the real control plane on real PostgreSQL, with OpenRouter replaced by an
/// in-test server: model calls go through the real gateway (reserved, streamed, settled), the run
/// log is the real one, and leases are real. Only the workspace is in memory.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RunnerIntegrationTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Scope = "frostaura/technologies/endgame/notes";

    private readonly TaskCompletionSource hold = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private FakeOpenRouter openRouter = null!;
    private int calls;
    private int holdAt = int.MaxValue;
    private ControlPlaneApp app = null!;
    private HttpClient service = null!;

    public static readonly Dictionary<string, string?> BuildRoute = new()
    {
        ["ModelGateway:Routes:build:Models:0"] = "deepseek/deepseek-v4.1-flash",
        ["ModelGateway:Routes:build:MaxPromptPerMillionUsd"] = "0.3",
        ["ModelGateway:Routes:build:MaxCompletionPerMillionUsd"] = "1.0",
        ["ModelGateway:Routes:build:Sort"] = "price",
        ["ModelGateway:Routes:build:Reasoning"] = "low",
        ["ModelGateway:Routes:build:MaxTokens"] = "16000",
        ["ModelGateway:Routes:build:ParallelToolCalls"] = "false",
        ["ModelGateway:Routes:build:MaxCallUsd"] = "0.5",
    };

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        openRouter.Chat = Conversational;
        app = await ControlPlaneApp.StartAsync(postgres, openRouter, settings: BuildRoute);
        var owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "endgame");
        await owner.AppAsync("frostaura/technologies/endgame", "notes");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    [Fact]
    public async Task The_gateway_client_streams_a_tool_call_and_reads_the_settlement()
    {
        var run = await CreateRunAsync();
        var client = new GatewayModelClient(service);
        var reply = await client.CompleteAsync(new ChatCall("build", Scope, Guid.Parse(run), null,
            [new JsonObject { ["role"] = "system", ["content"] = "s" }, new JsonObject { ["role"] = "user", ["content"] = "Change it." }],
            null, 1000, false, ["DeepInfra"], "k1"), CancellationToken.None);
        var call = reply.Message["tool_calls"]![0]!;
        Assert.Equal("call_0_read_file", call["id"]!.GetValue<string>());
        Assert.Equal("{\"path\":\"a.txt\"}", call["function"]!["arguments"]!.GetValue<string>());
        Assert.Equal("Looking first.", reply.Message["reasoning"]!.GetValue<string>());
        Assert.Equal("FakeProvider", reply.Provider);
        Assert.Equal(0.02m, reply.SettledCredits);
        Assert.True(reply.ReservedCredits >= reply.SettledCredits);
        var upstream = openRouter.Requests.Last();
        Assert.True(upstream["stream"]!.GetValue<bool>());
        var types = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray().Select(e => e!["type"]!.GetValue<string>());
        Assert.Equal(["message", "model.requested", "model.replied"], types);
    }

    [Fact]
    public async Task A_refused_budget_reaches_the_harness_as_terminal()
    {
        var owner = await app.SignInAsync();
        await owner.SetAsync("frostaura/technologies/endgame", "budget", "monthly_credits", 0.001m);
        var run = await CreateRunAsync();
        var failure = await Assert.ThrowsAsync<ModelCallException>(() => new GatewayModelClient(service).CompleteAsync(
            new ChatCall("build", Scope, Guid.Parse(run), null, [new JsonObject { ["role"] = "user", ["content"] = "hi" }], null, 16000, false, null, null), CancellationToken.None));
        Assert.Equal(ModelFailure.BudgetExhausted, failure.Failure);
        Assert.True(failure.Terminal);
        Assert.False(failure.Retryable);
    }

    [Fact]
    public async Task A_runner_killed_mid_run_is_resumed_by_another_from_the_log_and_the_run_finishes()
    {
        var run = await CreateRunAsync();
        var workspace = new FakeWorkspace().With("a.txt", "one\n");
        var provider = new SharedWorkspace(workspace);

        // The third model call (after two tool results) is held in flight, and the process killed under it.
        holdAt = 3;
        var first = Runner(provider);
        await first.StartAsync(CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(Volatile.Read(ref calls) >= 3), "the third model call to be in flight");
        await first.KillAsync();
        hold.SetResult();
        var killedAt = (await EventsAsync(run)).Count;
        Assert.Equal("running", (await RunAsync(run))["status"]!.GetValue<string>());

        // A new Runner process: it claims the run once the dead one's lease lapses, replays, and finishes.
        var second = Runner(provider);
        await second.StartAsync(CancellationToken.None);
        await WaitForAsync(async () => (await RunAsync(run))["status"]!.GetValue<string>() is "succeeded" or "failed", "the second Runner to finish the run", seconds: 60);
        await second.StopAsync(CancellationToken.None);

        var finished = await RunAsync(run);
        Assert.Equal("succeeded", finished["status"]!.GetValue<string>());
        Assert.Equal("two\n", workspace.Text("a.txt"));
        Assert.NotEqual(first.Holder, second.Holder);
        var events = await EventsAsync(run);
        Assert.True(events.Count > killedAt);
        Assert.Equal(Enumerable.Range(1, events.Count).Select(i => (long)i), events.Select(e => e["seq"]!.GetValue<long>()));
        Assert.Equal("run.finished", events[^1]["type"]!.GetValue<string>());
        var requested = events.Where(e => e["type"]!.GetValue<string>() == "tool.requested").Select(e => e["payload"]!["callId"]!.GetValue<string>()).ToList();
        var results = events.Where(e => e["type"]!.GetValue<string>() == "tool.result").Select(e => e["payload"]!["callId"]!.GetValue<string>()).ToList();
        Assert.Equal(requested.Order(), results.Order());
        Assert.Contains(events, e => e["type"]!.GetValue<string>() == "estimate.made");
        var scored = events.Single(e => e["type"]!.GetValue<string>() == "estimate.scored")["payload"]!;
        Assert.True(scored["actualCredits"]!.GetValue<decimal>() > 0);
        Assert.Single(events, e => e["type"]!.GetValue<string>() == "run.started");
    }

    [Fact]
    public async Task Pause_stops_the_run_between_steps_and_resume_picks_it_up_from_the_log()
    {
        var run = await CreateRunAsync();
        var workspace = new FakeWorkspace().With("a.txt", "one\n");
        // Pause while the first model call is in flight; the run stops at the next step boundary, after
        // the lease keeper has learned of the pause from a renewal.
        var gate = new TaskCompletionSource();
        openRouter.Gate = gate;
        var runner = Runner(new SharedWorkspace(workspace));
        await runner.StartAsync(CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(!openRouter.Requests.IsEmpty), "a model call to be in flight");
        var owner = await app.SignInAsync();
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{run}/pause", null));
        await Task.Delay(1500);
        openRouter.Gate = null;
        gate.SetResult();
        await WaitForAsync(() => Task.FromResult(runner.Active.Count == 0), "the Runner to let the paused run go");
        Assert.Equal("paused", (await RunAsync(run))["status"]!.GetValue<string>());
        Assert.Single(await EventsAsync(run), e => e["type"]!.GetValue<string>() == "tool.result");
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{run}/resume", null));
        await WaitForAsync(async () => (await RunAsync(run))["status"]!.GetValue<string>() == "succeeded", "the resumed run to finish", seconds: 60);
        await runner.StopAsync(CancellationToken.None);
        Assert.Equal("two\n", workspace.Text("a.txt"));
    }

    [Fact]
    public async Task A_graceful_shutdown_suspends_the_run_at_a_step_boundary_and_releases_its_lease_at_once()
    {
        var run = await CreateRunAsync();
        var workspace = new FakeWorkspace().With("a.txt", "one\n");
        var provider = new SharedWorkspace(workspace);
        // The second model call is held in flight, so the stop always lands mid-run: a gate set after the
        // first step raced the run to its end (it failed once in a full run).
        holdAt = 2;
        var first = Runner(provider);
        await first.StartAsync(CancellationToken.None);
        await WaitForAsync(() => Task.FromResult(Volatile.Read(ref calls) >= 2), "the second model call to be in flight");
        Assert.Contains(await EventsAsync(run), e => e["type"]!.GetValue<string>() == "tool.result");
        var stopping = first.StopAsync(CancellationToken.None);
        hold.SetResult();
        await stopping;
        var held = await RunAsync(run);
        Assert.Equal("running", held["status"]!.GetValue<string>());
        Assert.True(held["leaseExpiresAt"]!.GetValue<DateTimeOffset>() <= DateTimeOffset.UtcNow.AddSeconds(1.5));
        Assert.DoesNotContain(await EventsAsync(run), e => e["type"]!.GetValue<string>() == "run.finished");

        var second = Runner(provider);
        await second.StartAsync(CancellationToken.None);
        await WaitForAsync(async () => (await RunAsync(run))["status"]!.GetValue<string>() == "succeeded", "the second Runner to finish the run", seconds: 60);
        await second.StopAsync(CancellationToken.None);
        Assert.Equal("two\n", workspace.Text("a.txt"));
    }

    [Fact]
    public async Task A_suggest_run_queued_by_the_owner_is_claimed_reads_the_portfolio_and_its_ideas_are_listed()
    {
        var owner = await app.SignInAsync();
        var started = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas/suggestions", new { scope = "frostaura" }));
        var run = started["run"]!["id"]!.GetValue<string>();
        var suggestions = new JsonObject
        {
            ["suggestions"] = JsonNode.Parse("""[{"title":"Release notes from history","idea":"Every app gets plain release notes written from its version history.","gap":"Owners never tell their users what changed.","whyUs":"Endgame already keeps every app's history.","reuses":["Endgame","Notes"]}]"""),
        };
        openRouter.Chat = async (request, http) =>
        {
            if (request["stream"]?.GetValue<bool>() != true)
            {
                await FakeOpenRouter.Completion(0.0003m, suggestions.ToJsonString())(request, http);
                return;
            }

            var id = $"gen-{Guid.NewGuid():N}";
            http.Response.ContentType = "text/event-stream";
            await Data(http, Chunk(id, new JsonObject { ["role"] = "assistant", ["content"] = suggestions.ToJsonString() }, null, null));
            await Data(http, Chunk(id, new JsonObject(), "stop", FakeOpenRouter.Usage(0.0003m, 900, 120)));
            await http.Response.WriteAsync("data: [DONE]\n\n");
        };

        var runner = Runner(new SharedWorkspace(new FakeWorkspace()), new SuggestWorkflow());
        await runner.StartAsync(CancellationToken.None);
        await WaitForAsync(async () => (await RunAsync(run))["status"]!.GetValue<string>() is "succeeded" or "failed", "the suggest run to finish", seconds: 60);
        await runner.StopAsync(CancellationToken.None);

        var finished = await RunAsync(run);
        Assert.True(finished["status"]!.GetValue<string>() == "succeeded", finished.ToJsonString());
        var listed = (await ControlPlaneApp.Ok(owner.GetAsync("/api/ideas/suggestions?scope=frostaura"))).AsArray();
        var suggestion = Assert.Single(listed)!;
        Assert.Equal(("Release notes from history", "open"), (suggestion["title"]!.GetValue<string>(), suggestion["status"]!.GetValue<string>()));
        Assert.Equal(run, suggestion["runId"]!.GetValue<string>());

        // Its estimate came first, its model call went through the gateway on the research route, and the log closed once.
        var events = await EventsAsync(run);
        Assert.Equal("estimate.made", events.First(e => e["type"]!.GetValue<string>() is not ("run.started" or "message"))["type"]!.GetValue<string>());
        var request = events.Single(e => e["type"]!.GetValue<string>() == "model.requested")["payload"]!;
        Assert.Equal("research", request["taskType"]?.GetValue<string>() ?? request["route"]?.GetValue<string>());
        Assert.Single(events, e => e["type"]!.GetValue<string>() == "run.finished");

        // Taken, it becomes an idea researched like any other.
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/ideas/suggestions/{suggestion["id"]}/take", new { }));
        Assert.Contains("plain release notes", idea.ToJsonString(), StringComparison.Ordinal);
    }

    private RunnerService Runner(IWorkspaceProvider workspaces, IWorkflow? workflow = null)
    {
        var options = new RunnerOptions { Concurrency = 1, LeaseSeconds = 2, PollSeconds = 0.2, ShutdownGraceSeconds = 10 };
        var controlPlane = new ControlPlaneClient(app.Internal());
        var executor = new RunExecutor(controlPlane, new GatewayModelClient(app.Internal()), workspaces, [workflow ?? new TaskWorkflow()], new AgentFactory(options), new Estimator(options), options,
            NullLogger<RunExecutor>.Instance, null, RunnerResources.Skills());
        return new RunnerService(controlPlane, executor, options, NullLogger<RunnerService>.Instance);
    }

    private async Task<string> CreateRunAsync()
    {
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = Scope, kind = "task", title = "Change one to two" })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "message", payload = new { from = "owner", text = "In a.txt, change one to two, then test it." } } } }));
        return run;
    }

    private async Task<JsonNode> RunAsync(string run) => await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}"));

    private async Task<List<JsonNode>> EventsAsync(string run) =>
        (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events?limit=500"))).AsArray().OfType<JsonNode>().ToList();

    private static async Task WaitForAsync(Func<Task<bool>> condition, string what, int seconds = 30)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(50);
        }

        Assert.Fail($"Timed out waiting for {what}.");
    }

    /// <summary>
    /// Answers like a model that reads the conversation: the next step follows from how many results it
    /// has had, and a call answered "interrupted" is made again. Streamed in OpenRouter's chunk shapes.
    /// </summary>
    private async Task Conversational(JsonObject request, HttpContext http)
    {
        if (Interlocked.Increment(ref calls) == holdAt)
        {
            await hold.Task;
        }

        (string Name, string Args)[] steps =
        [
            ("read_file", "{\"path\":\"a.txt\"}"),
            ("edit_file", "{\"path\":\"a.txt\",\"old_string\":\"one\",\"new_string\":\"two\"}"),
            ("run", "{\"command\":\"make test\"}"),
        ];
        var messages = request["messages"]!.AsArray();
        var step = messages.Count(m => m!["role"]!.GetValue<string>() == "tool"
            && !(m["content"]?.ToString() ?? "").Contains("This call was interrupted", StringComparison.Ordinal));
        var id = $"gen-{Guid.NewGuid():N}";
        if (request["stream"]?.GetValue<bool>() != true)
        {
            await FakeOpenRouter.Completion(0.0002m, id: id)(request, http);
            return;
        }

        http.Response.ContentType = "text/event-stream";
        await Data(http, Chunk(id, new JsonObject { ["role"] = "assistant", ["reasoning"] = "Looking first." }, null, null));
        if (step < steps.Length)
        {
            var callId = $"call_{step}_{steps[step].Name}";
            await Data(http, Chunk(id, new JsonObject { ["tool_calls"] = new JsonArray(new JsonObject { ["index"] = 0, ["id"] = callId, ["type"] = "function", ["function"] = new JsonObject { ["name"] = steps[step].Name, ["arguments"] = "" } }) }, null, null));
            var args = steps[step].Args;
            foreach (var piece in new[] { args[..(args.Length / 2)], args[(args.Length / 2)..] })
            {
                await Data(http, Chunk(id, new JsonObject { ["tool_calls"] = new JsonArray(new JsonObject { ["index"] = 0, ["function"] = new JsonObject { ["arguments"] = piece } }) }, null, null));
            }

            await Data(http, Chunk(id, new JsonObject(), "tool_calls", FakeOpenRouter.Usage(0.0002m, 400, 30)));
        }
        else
        {
            await Data(http, Chunk(id, new JsonObject { ["content"] = "Changed one to two; the tests pass." }, null, null));
            await Data(http, Chunk(id, new JsonObject(), "stop", FakeOpenRouter.Usage(0.0002m, 400, 30)));
        }

        await http.Response.WriteAsync("data: [DONE]\n\n");
    }

    private static JsonObject Chunk(string id, JsonObject delta, string? finish, JsonObject? usage)
    {
        var chunk = new JsonObject
        {
            ["id"] = id,
            ["provider"] = "FakeProvider",
            ["model"] = "deepseek/deepseek-v4.1-flash",
            ["object"] = "chat.completion.chunk",
            ["choices"] = new JsonArray(new JsonObject { ["index"] = 0, ["delta"] = delta, ["finish_reason"] = finish }),
        };
        if (usage is not null)
        {
            chunk["usage"] = usage;
        }

        return chunk;
    }

    private static async Task Data(HttpContext http, JsonObject chunk)
    {
        await http.Response.WriteAsync($"data: {chunk.ToJsonString()}\n\n");
        await http.Response.Body.FlushAsync();
    }

    /// <summary>One workspace that outlives a Runner process, as Dock's does.</summary>
    private sealed class SharedWorkspace(IWorkspace workspace) : IWorkspaceProvider
    {
        public Task<(IWorkspace Workspace, bool Recreated)> EnsureAsync(Guid runId, Guid appId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken) =>
            Task.FromResult((workspace, false));

        public Task RenewAsync(Guid runId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task ReleaseAsync(Guid runId, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
