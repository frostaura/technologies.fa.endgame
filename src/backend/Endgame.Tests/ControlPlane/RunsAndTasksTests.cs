using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

[Collection(PostgresCollection.Name)]
public sealed class RunsAndTasksTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "endgame");
        service = app.Internal();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private async Task<string> RunAsync(string? employeeId = null, string scope = "frostaura/technologies/endgame") =>
        (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind = "build", title = "Build it", employeeId })))["id"]!.GetValue<string>();

    private async Task<JsonNode> AppendAsync(string runId, string type, object? payload = null, string? holder = null) =>
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{runId}/events", new { leaseHolder = holder, events = new[] { new { type, payload } } }));

    [Fact]
    public async Task Sequence_numbers_are_gapless_under_concurrent_appends()
    {
        var run = await RunAsync();
        var writers = Enumerable.Range(0, 25).Select(i => service.PostAsJsonAsync($"/internal/runs/{run}/events", new
        {
            events = new[] { new { type = "message", payload = new { text = $"a{i}" } }, new { type = "message", payload = new { text = $"b{i}" } } },
        }));
        foreach (var response in await Task.WhenAll(writers))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray();
        Assert.Equal(Enumerable.Range(1, 50).Select(i => (long)i), events.Select(e => e!["seq"]!.GetValue<long>()));
        Assert.Equal(50, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run}")))["lastSeq"]!.GetValue<long>());
    }

    [Fact]
    public async Task A_lease_is_exclusive_until_it_lapses_and_appending_needs_the_live_lease()
    {
        var run = await RunAsync();
        var leased = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner-a", seconds = 60 }));
        Assert.Equal("running", leased["status"]!.GetValue<string>());
        var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray();
        Assert.Equal("run.started", events[0]!["type"]!.GetValue<string>());

        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner-b", seconds = 60 }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{run}/events", new { leaseHolder = "runner-b", events = new[] { new { type = "message", payload = new { text = "x" } } } }), HttpStatusCode.Conflict);
        await AppendAsync(run, "message", new { text = "from a" }, "runner-a");

        // The holder lets it lapse; then another may take it.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner-a", seconds = 1 }));
        await Task.Delay(1200);
        var taken = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner-b", seconds = 60 }));
        Assert.Equal("runner-b", taken["leaseHolder"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_runner_claims_queued_runs_one_at_a_time()
    {
        var first = await RunAsync();
        var second = await RunAsync();
        var claims = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => service.PostAsJsonAsync("/internal/runs/claim", new { holder = $"runner-{i}", leaseSeconds = 60, kinds = new[] { "build" } })));
        var claimed = new List<string>();
        foreach (var response in claims)
        {
            if (response.StatusCode == HttpStatusCode.OK)
            {
                claimed.Add((await response.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>());
            }
            else
            {
                Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            }
        }

        Assert.Equal(new[] { first, second }.Order(), claimed.Order());
    }

    [Fact]
    public async Task Pause_resume_and_cancel_move_the_run_and_cancel_releases_what_it_held()
    {
        var run = await RunAsync();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner", seconds = 60 }));
        Assert.Equal("paused", (await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{run}/pause", null)))["status"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/runs/{run}/pause", null), HttpStatusCode.Conflict);
        Assert.Equal("queued", (await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{run}/resume", null)))["status"]!.GetValue<string>());
        var cancelled = await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{run}/cancel", null));
        Assert.Equal("cancelled", cancelled["status"]!.GetValue<string>());
        Assert.NotNull(cancelled["finishedAt"]);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "message", payload = new { text = "late" } } } }), HttpStatusCode.Conflict);
        var types = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray().Select(e => e!["type"]!.GetValue<string>());
        Assert.Equal(["run.started", "run.paused", "run.resumed", "run.finished"], types);
    }

    [Fact]
    public async Task Finishing_a_run_updates_its_employee_in_the_same_append()
    {
        var hired = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/technologies", name = "Ada", role = "Builder", monthlyCreditLimit = 50 }));
        var employeeId = hired["id"]!.GetValue<string>();
        var run = await RunAsync(employeeId);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner", seconds = 60 }));
        var working = (await ControlPlaneApp.Ok(service.GetAsync("/internal/employees?scope=frostaura"))).AsArray().Single()!;
        Assert.Equal("working", working["status"]!.GetValue<string>());
        Assert.Equal(run, working["currentRunId"]!.GetValue<string>());

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var worker = tree["divisions"]![0]!["workers"]![0]!;
        Assert.Equal("Ada", worker["name"]!.GetValue<string>());
        Assert.Equal("employee", worker["kind"]!.GetValue<string>());
        Assert.Equal("Build it", worker["activity"]!.GetValue<string>());

        await AppendAsync(run, "run.finished", new { outcome = "succeeded", summary = "Done", totals = new { credits = 0 } }, "runner");
        var idle = (await ControlPlaneApp.Ok(service.GetAsync("/internal/employees?scope=frostaura"))).AsArray().Single()!;
        Assert.Equal("idle", idle["status"]!.GetValue<string>());
        Assert.Equal(1, idle["runsFinished"]!.GetValue<int>());
        Assert.Equal(1, idle["runsSucceeded"]!.GetValue<int>());
        Assert.Equal(run, idle["lastRunId"]!.GetValue<string>());
        var finished = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run}"));
        Assert.Equal("finished", finished["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Two_concurrent_claimers_of_one_task_exactly_one_wins()
    {
        var a = await RunAsync();
        var b = await RunAsync();
        var task = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies/endgame", runId = a, title = "Write the endpoint" }));
        var taskId = task["id"]!.GetValue<string>();
        for (var round = 0; round < 5; round++)
        {
            var id = round == 0 ? taskId : (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies/endgame", title = $"Task {round}" })))["id"]!.GetValue<string>();
            var results = await Task.WhenAll(
                service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = id, runId = a, expectedStatus = "todo" }),
                service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = id, runId = b, expectedStatus = "todo" }));
            Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
            var loser = Assert.Single(results, r => r.StatusCode == HttpStatusCode.Conflict);
            var problem = (await loser.Content.ReadFromJsonAsync<JsonNode>())!;
            Assert.Equal("in_progress", problem["task"]!["status"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task A_lock_is_taken_over_only_from_a_dead_holder_and_dependencies_gate_the_claim()
    {
        var holder = await RunAsync();
        var other = await RunAsync();
        var first = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies/endgame", title = "First" })))["id"]!.GetValue<string>();
        var second = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies/endgame", title = "Second", dependsOn = new[] { first } })))["id"]!.GetValue<string>();

        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = second, runId = other, expectedStatus = "todo" }), HttpStatusCode.Conflict);

        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{holder}/lease", new { holder = "runner", seconds = 60 }));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = first, runId = holder, expectedStatus = "todo" }));
        // A live holder keeps its lock.
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = first, runId = other, expectedStatus = "in_progress", expectedHolderRunId = holder }), HttpStatusCode.Conflict);
        // Once the holder has provably finished, the lock can be taken over.
        await AppendAsync(holder, "run.finished", new { outcome = "failed", summary = "crashed" }, "runner");
        var taken = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = first, runId = other, expectedStatus = "in_progress", expectedHolderRunId = holder }));
        Assert.Equal(other, taken["holderRunId"]!.GetValue<string>());

        await ControlPlaneApp.Ok(service.PatchAsJsonAsync($"/internal/tasks/{first}", new { status = "done", summary = "Written" }));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = second, runId = other, expectedStatus = "todo" }));
        var list = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tasks?scope=frostaura/technologies"))).AsArray();
        Assert.Equal(2, list.Count);
    }

    [Fact]
    public async Task A_run_waits_on_an_approval_and_the_answer_puts_it_back_in_the_queue()
    {
        var run = await RunAsync();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/lease", new { holder = "runner", seconds = 1 }));
        var approval = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Publish privately?", detail = "The app passed its checks." }));
        var approvalId = approval["id"]!.GetValue<string>();
        Assert.Equal("waiting", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run}")))["status"]!.GetValue<string>());

        var needs = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray();
        var need = Assert.Single(needs)!;
        Assert.Equal("approval", need["kind"]!.GetValue<string>());
        Assert.Equal(approvalId, need["approvalId"]!.GetValue<string>());

        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/runs/{run}/approvals/{approvalId}", new { decision = "maybe" }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/runs/{run}/approvals/{approvalId}", new { decision = "approve" }), HttpStatusCode.NoContent);
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/runs/{run}/approvals/{approvalId}", new { decision = "reject" }), HttpStatusCode.Conflict);
        await Task.Delay(1100);
        var types = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray().Select(e => e!["type"]!.GetValue<string>()).ToList();
        Assert.Equal(["run.started", "approval.requested", "approval.answered"], types);
        var requested = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}/events"))).AsArray()[1]!;
        Assert.Equal("Publish privately?", requested["payload"]!["question"]!.GetValue<string>());
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray());
    }

    [Fact]
    public async Task The_event_stream_is_server_sent_events_resumable_by_sequence_number()
    {
        var run = await RunAsync();
        for (var i = 1; i <= 3; i++)
        {
            await AppendAsync(run, "message", new { text = $"m{i}", from = "employee" });
        }

        await AppendAsync(run, "run.finished", new { outcome = "succeeded", summary = "ok" });
        var response = await owner.GetAsync($"/api/runs/{run}/events?after=2");
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType!.MediaType);
        var text = await response.Content.ReadAsStringAsync();
        var blocks = text.Split("\n\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("id: 3\nevent: message\ndata: ", blocks[0], StringComparison.Ordinal);
        var data = JsonNode.Parse(blocks[0].Split('\n')[2]["data: ".Length..])!;
        Assert.Equal(3, data["seq"]!.GetValue<long>());
        Assert.Equal("m3", data["payload"]!["text"]!.GetValue<string>());
        Assert.NotNull(data["at"]);
        Assert.StartsWith("id: 4\nevent: run.finished", blocks[1], StringComparison.Ordinal);
        Assert.StartsWith("event: end", blocks[2], StringComparison.Ordinal);

        var resumed = await owner.SendAsync(new HttpRequestMessage(HttpMethod.Get, $"/api/runs/{run}/events") { Headers = { { "Last-Event-ID", "3" } } });
        Assert.StartsWith("id: 4\n", await resumed.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unknown_event_types_and_oversized_payloads_are_refused_as_problems()
    {
        var run = await RunAsync();
        var unknown = await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "run.exploded", payload = new { } } } }), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_request", unknown["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "message", payload = new { text = new string('x', 70_000) } } } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await owner.GetAsync($"/api/runs/{Guid.NewGuid()}"), HttpStatusCode.NotFound);
    }
}
