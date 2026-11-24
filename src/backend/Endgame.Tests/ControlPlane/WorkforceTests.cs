using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Infrastructure.Sweeps;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The workforce on the real control plane and PostgreSQL: the standing security reviewer, hire
/// proposals and auto-mode, track records derived from runs and the ledger, curated memory and its
/// review, movement and release, contractors and promotion, the idle flag, and the ontology.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class WorkforceTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Project = "frostaura/technologies/squash";
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private ControlPlaneClient runner = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        openRouter.Chat = FakeOpenRouter.Completion(0.0003m);
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.DivisionAsync("frostaura", "labs");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        await owner.ProjectAsync("frostaura/technologies", "ladder");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
        runner = new ControlPlaneClient(app.Internal());
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<Guid> HireAsync(string name, string scope = Project, decimal? limit = null, Guid? reportsTo = null) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new
        {
            scope,
            name,
            role = "Builder",
            mandate = "Builds features.",
            tools = new[] { "read_file", "edit_file" },
            services = new[] { "models" },
            monthlyCreditLimit = limit,
            modelTier = "build",
            reportsTo,
        })))["id"]!.GetValue<string>());

    private async Task<Guid> RunAsync(Guid? employeeId, string scope = Project, string kind = "build") =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind, title = "Build bookings", employeeId })))["id"]!.GetValue<string>());

    private async Task AppendAsync(Guid run, string type, JsonObject payload) =>
        await runner.AppendAsync(run, null, [new(type, payload)], CancellationToken.None);

    private Task<ModelReply> CallAsync(Guid? run, Guid? employee, bool repair = false, string scope = Project) =>
        new GatewayModelClient(app.Internal(), stream: false).CompleteAsync(
            new ChatCall("chat", scope, run, employee, [new JsonObject { ["role"] = "user", ["content"] = "Go." }], null, 100, repair, null, null), CancellationToken.None);

    private static object Hire(string needKey, decimal expected, string scope = Project, string trigger = "stage") => new
    {
        scope,
        trigger,
        needKey,
        reason = "The project entered building and has no builder.",
        name = "Grace",
        role = "Builder",
        jobDescription = new { mandate = "Build the bookings app.", tools = new[] { "read_file", "edit_file", "run" }, services = new[] { "models", "email" }, monthlyCreditLimit = 40m, modelTier = "build-t1" },
        expectedMonthlyCredits = expected,
    };

    [Fact]
    public async Task Every_organisation_has_its_standing_security_reviewer_and_it_is_never_released()
    {
        var workforce = (await ControlPlaneApp.Ok(owner.GetAsync("/api/employees?scope=frostaura"))).AsArray();
        var reviewer = Assert.Single(workforce)!;
        Assert.Equal("security-reviewer", reviewer["standing"]!.GetValue<string>());
        Assert.Equal("frostaura", reviewer["scope"]!.GetValue<string>());
        Assert.Equal("evaluate", reviewer["jobDescription"]!["modelTier"]!.GetValue<string>());
        Assert.False(reviewer["idle"]!["flagged"]!.GetValue<bool>());

        var refused = await ControlPlaneApp.Expect(await owner.PostAsync($"/api/employees/{reviewer["id"]}/release", null), HttpStatusCode.Conflict);
        Assert.Equal("standing_hire", refused["code"]!.GetValue<string>());

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var worker = Assert.Single(tree["organisation"]!["workers"]!.AsArray())!;
        Assert.Equal("Security reviewer", worker["name"]!.GetValue<string>());
        Assert.Equal("idle", worker["status"]!.GetValue<string>());
        Assert.Contains("1 employee", tree["organisation"]!["summary"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_need_within_budget_is_hired_at_once_in_auto_mode_and_the_same_need_is_one_proposal()
    {
        var raised = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire("stage:building:squash", 5m)));
        Assert.True(raised["created"]!.GetValue<bool>());
        var hire = raised["hire"]!;
        Assert.Equal("accepted", hire["status"]!.GetValue<string>());
        Assert.Equal("auto-mode", hire["decision"]!["via"]!.GetValue<string>());
        Assert.Equal("runner", hire["raisedBy"]!.GetValue<string>());
        var employeeId = hire["employeeId"]!.GetValue<string>();

        var employee = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{employeeId}"));
        var job = employee["employee"]!["jobDescription"]!;
        Assert.Equal("Build the bookings app.", job["mandate"]!.GetValue<string>());
        Assert.Equal(["read_file", "edit_file", "run"], job["tools"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal(40m, job["monthlyCreditLimit"]!.GetValue<decimal>());
        Assert.Equal("build-t1", job["modelTier"]!.GetValue<string>());
        Assert.Equal(Project, job["scope"]!.GetValue<string>());

        // Raising the same need again finds it.
        var again = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/hires", Hire("stage:building:squash", 5m)));
        Assert.False(again["created"]!.GetValue<bool>());
        Assert.Equal(hire["id"]!.GetValue<string>(), again["hire"]!["id"]!.GetValue<string>());

        // A job description the platform cannot honour is refused before anyone could accept it.
        var bad = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "stage",
            needKey = "x",
            reason = "r",
            name = "X",
            role = "Y",
            expectedMonthlyCredits = 1m,
            jobDescription = new { modelTier = "frontier-please" },
        }), HttpStatusCode.BadRequest);
        Assert.Contains("model tier", bad["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "stage",
            needKey = "y",
            reason = "r",
            name = "X",
            role = "Y",
            expectedMonthlyCredits = 1m,
            jobDescription = new { services = new[] { "docker" } },
        }), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Over_budget_or_at_a_hire_checkpoint_a_proposal_waits_for_the_owner_who_edits_accepts_or_declines()
    {
        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", 3m);
        var waiting = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire("stage:building:squash", 10m))))["hire"]!;
        Assert.Equal("proposed", waiting["status"]!.GetValue<string>());
        Assert.False(waiting["withinBudget"]!.GetValue<bool>());
        Assert.Equal(3m, waiting["headroomCredits"]!.GetValue<decimal>());
        var id = waiting["id"]!.GetValue<string>();

        var need = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "hire")!;
        Assert.Equal(id, need["hireId"]!.GetValue<string>());
        Assert.Equal(Project, need["scope"]!.GetValue<string>());
        Assert.Equal(10m, need["expectedMonthlyCredits"]!.GetValue<decimal>());

        var edited = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/hires/{id}", new { name = "Grace Hopper", expectedMonthlyCredits = 2m, jobDescription = new { monthlyCreditLimit = 2m } }));
        Assert.Equal("Grace Hopper", edited["name"]!.GetValue<string>());
        Assert.True(edited["withinBudget"]!.GetValue<bool>());
        Assert.Equal("Build the bookings app.", edited["jobDescription"]!["mandate"]!.GetValue<string>());

        var accepted = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/hires/{id}/accept", new { note = "Go." }));
        Assert.Equal("accepted", accepted["status"]!.GetValue<string>());
        Assert.Equal("person", accepted["decision"]!["via"]!.GetValue<string>());
        Assert.Equal("The Owner", accepted["decision"]!["by"]!.GetValue<string>());
        var hired = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{accepted["employeeId"]}"));
        Assert.Equal("Grace Hopper", hired["employee"]!["name"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/hires/{id}/accept", null), HttpStatusCode.Conflict);

        // With the hire checkpoint on, even a cheap proposal waits; a declined need may be raised again.
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy", new { scope = "frostaura", autonomy = "checkpoints", checkpoints = new { hire = true } }));
        var held = (await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", Hire("owner:qa", 0.5m, "frostaura/labs", "owner"))));
        Assert.Equal("proposed", held["status"]!.GetValue<string>());
        Assert.Equal("person", held["raisedBy"]!.GetValue<string>());
        var declined = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/hires/{held["id"]}/decline", new { note = "Not yet." }));
        Assert.Equal("declined", declined["status"]!.GetValue<string>());
        Assert.Equal("Not yet.", declined["decision"]!["note"]!.GetValue<string>());
        var raisedAgain = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", Hire("owner:qa", 0.5m, "frostaura/labs", "owner")));
        Assert.NotEqual(held["id"]!.GetValue<string>(), raisedAgain["id"]!.GetValue<string>());
        Assert.Equal(2, (await ControlPlaneApp.Ok(owner.GetAsync("/api/hires?scope=frostaura/labs"))).AsArray().Count);

        // A Builder may read proposals but not decide them.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "bea@example.com", displayName = "Bea", role = "builder" }));
        var builder = await app.SignInAsync("bea@example.com", "Bea");
        await ControlPlaneApp.Ok(builder.GetAsync($"/api/hires/{raisedAgain["id"]}"));
        await ControlPlaneApp.Expect(await builder.PostAsync($"/api/hires/{raisedAgain["id"]}/accept", null), HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_track_record_is_derived_from_runs_their_logs_and_the_ledger()
    {
        var ada = await HireAsync("Ada");
        var build = await RunAsync(ada);
        await runner.LeaseAsync(build, "runner-test", 60, CancellationToken.None);
        Assert.Equal("working", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}")))["employee"]!["status"]!.GetValue<string>());
        await CallAsync(build, null);
        await CallAsync(build, null, repair: true);
        await AppendAsync(build, "evaluation.failed", new JsonObject { ["item"] = "p1" });
        await AppendAsync(build, "evaluation.passed", new JsonObject { ["item"] = "p1" });
        await AppendAsync(build, "estimate.scored", new JsonObject { ["expectedCredits"] = 0.03m, ["actualCredits"] = 0.03m });
        await AppendAsync(build, "run.finished", new JsonObject { ["outcome"] = "succeeded", ["summary"] = "Built." });
        var chat = await RunAsync(ada, kind: "conversation");
        await AppendAsync(chat, "run.finished", new JsonObject { ["outcome"] = "succeeded" });
        var failed = await RunAsync(ada);
        await AppendAsync(failed, "run.finished", new JsonObject { ["outcome"] = "failed" });
        var helper = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope = Project, briefedBy = ada, role = "Researcher", brief = "Survey the rivals." })))["id"]!.GetValue<string>());
        await CallAsync(null, helper);

        var track = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/track-record"));
        Assert.Equal(2, track["work"]!["accepted"]!.GetValue<int>()); // one evaluation passed, one finished run never evaluated
        Assert.Equal(1, track["work"]!["sentBack"]!.GetValue<int>());
        Assert.Equal(66.7m, track["work"]!["acceptedPercent"]!.GetValue<decimal>());
        Assert.Equal(3, track["runs"]!["finished"]!.GetValue<int>());
        Assert.Equal(1, track["runs"]!["failed"]!.GetValue<int>());
        Assert.Equal(0.03m, track["repairsNotCharged"]!["credits"]!.GetValue<decimal>());
        Assert.Equal(1, track["repairsNotCharged"]!["calls"]!.GetValue<int>());
        Assert.Equal(0.03m, track["cost"]!["toDateCredits"]!.GetValue<decimal>());
        Assert.Equal(0.03m, track["cost"]!["monthCredits"]!.GetValue<decimal>());
        Assert.Equal(1, track["contractors"]!["engaged"]!.GetValue<int>());
        Assert.Equal(1, track["contractors"]!["working"]!.GetValue<int>());
        Assert.Equal(0.03m, track["contractors"]!["toDateCredits"]!.GetValue<decimal>());
        Assert.Equal(1, track["estimates"]!["pieces"]!.GetValue<int>());

        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}"));
        Assert.Equal("idle", detail["employee"]!["status"]!.GetValue<string>());
        Assert.Equal(failed.ToString(), detail["employee"]!["lastRunId"]!.GetValue<string>());
        Assert.Equal("Researcher", Assert.Single(detail["contractors"]!.AsArray())!["role"]!.GetValue<string>());

        // Every model call carries the employee in the run log too.
        var requested = (await runner.ReadEventsAsync(build, 0, 100, CancellationToken.None)).First(e => e.Type == "model.replied");
        Assert.Equal(ada.ToString(), requested.Payload["employeeId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Memory_is_written_after_a_task_read_for_a_run_reviewed_and_curated_by_the_owner()
    {
        var ada = await HireAsync("Ada");
        var run = await RunAsync(ada);
        var written = (await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/employees/{ada}/memory", new
        {
            runId = run,
            entries = new object[]
            {
                new { title = "Bookings are in minutes", body = "Courts are sold by playing minutes, never credits.", kind = "fact" },
                new { title = "Minutes, not credits", body = "Say minutes in every screen.", kind = "practice" },
                new { title = "Owner wants light screens", body = "Black on white, one accent.", kind = "preference", scope = "frostaura" },
                new { title = "Ladder uses Elo", body = "The ladder ranks by Elo.", kind = "fact", scope = "frostaura/technologies/ladder" },
            },
        }))).AsArray();
        Assert.Equal(Project, written[0]!["scope"]!.GetValue<string>());
        Assert.Equal(run.ToString(), written[0]!["sourceRunId"]!.GetValue<string>());

        // Read for a run on squash: what is about squash and above it, not the sibling project.
        var forRun = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/employees/{ada}/memory?scope={Project}"))).AsArray();
        Assert.Equal(3, forRun.Count);
        Assert.DoesNotContain(forRun, m => m!["title"]!.GetValue<string>() == "Ladder uses Elo");

        var ids = written.Select(w => Guid.Parse(w!["id"]!.GetValue<string>())).ToList();
        var review = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/employees/{ada}/memory/review", new
        {
            runId = run,
            merged = new[] { new { from = new[] { ids[0], ids[1] }, title = "Minutes, never credits", body = "Courts are sold by playing minutes; say minutes on every screen.", kind = "practice" } },
            removed = new[] { new { id = ids[3], why = "The ladder was dropped." } },
            corrected = new[] { new { id = ids[2], body = "Black on white, one accent, generous spacing.", why = "The owner added spacing." } },
        }));
        Assert.Single(review["merged"]!.AsArray());
        Assert.Equal(Project, review["merged"]![0]!["scope"]!.GetValue<string>());
        Assert.Equal(ids[3].ToString(), review["removed"]![0]!.GetValue<string>());
        Assert.Equal(0, review["kept"]!.GetValue<int>());

        var memory = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory"))).AsArray();
        Assert.Equal(2, memory.Count);
        Assert.All(memory, m => Assert.NotNull(m!["lastReviewedAt"]));

        // The owner adds, corrects and removes; the change log records all of it, with who and why.
        var added = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/employees/{ada}/memory", new { title = "Ship on Fridays", body = "Never.", kind = "lesson" }));
        var corrected = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}/memory/{added["id"]}", new { body = "Never on a Friday." }));
        Assert.Equal("Never on a Friday.", corrected["body"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/employees/{ada}/memory/{added["id"]}?why=Wrong"), HttpStatusCode.NoContent);
        var changes = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory/changes"))).AsArray();
        var actions = changes.Select(c => $"{c!["by"]}:{c["action"]}").ToList();
        foreach (var expected in new[] { "employee:added", "review:merged", "review:removed", "review:corrected", "review:reviewed", "person:added", "person:corrected", "person:removed" })
        {
            Assert.Contains(expected, actions);
        }

        Assert.Equal("The ladder was dropped.", changes.First(c => c!["action"]!.GetValue<string>() == "removed" && c["by"]!.GetValue<string>() == "review")!["detail"]!["why"]!.GetValue<string>());

        // The change log is append-only by grant and trigger.
        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var tamper = new NpgsqlCommand("DELETE FROM employee_memory_changes", connection);
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, (await Assert.ThrowsAsync<PostgresException>(() => tamper.ExecuteNonQueryAsync())).SqlState);

        // A review that names an entry twice, or one that is not this employee's, changes nothing.
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/employees/{ada}/memory/review", new { removed = new[] { new { id = ids[3] } } }), HttpStatusCode.BadRequest);

        // The owner queues a review run for the Runner.
        var reviewRun = await ControlPlaneApp.Created(owner.PostAsync($"/api/employees/{ada}/reviews", null));
        Assert.Equal("queued", reviewRun["status"]!.GetValue<string>());
        Assert.Equal(ada.ToString(), reviewRun["employeeId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Reassignment_carries_memory_release_archives_it_and_a_rehire_restores_it()
    {
        var lead = await HireAsync("Lin", "frostaura/technologies");
        var ada = await HireAsync("Ada", reportsTo: lead);
        var report = await HireAsync("Ben", reportsTo: ada);
        await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/employees/{ada}/memory", new { entries = new[] { new { title = "Club rules", body = "Members book a week ahead.", kind = "fact" } } }));

        // A loop on the chart is refused.
        await ControlPlaneApp.Expect(await owner.PatchAsJsonAsync($"/api/employees/{lead}", new { reportsTo = report }), HttpStatusCode.BadRequest);

        var moved = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/employees/{ada}/reassign", new { scope = "frostaura/labs", reportsTo = lead }));
        Assert.Equal("frostaura/labs", moved["scope"]!.GetValue<string>());
        Assert.Equal(1, moved["memoryEntries"]!.GetValue<int>());

        var changed = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}", new { jobDescription = new { monthlyCreditLimit = 12m, modelTier = "build-t2" } }));
        Assert.Equal(12m, changed["jobDescription"]!["monthlyCreditLimit"]!.GetValue<decimal>());
        Assert.Equal("build-t2", changed["jobDescription"]!["modelTier"]!.GetValue<string>());
        Assert.Equal("paused", (await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}", new { status = "paused" })))["status"]!.GetValue<string>());

        var released = await ControlPlaneApp.Ok(owner.PostAsync($"/api/employees/{ada}/release", null));
        Assert.Equal("released", released["status"]!.GetValue<string>());
        Assert.NotNull(released["releasedAt"]);
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory"))).AsArray());
        Assert.True(Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory?includeArchived=true"))).AsArray())!["archived"]!.GetValue<bool>());
        Assert.Equal(lead.ToString(), (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{report}")))["employee"]!["reportsTo"]!["id"]!.GetValue<string>());
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/employees?scope=frostaura"))).AsArray(), e => e!["id"]!.GetValue<string>() == ada.ToString());
        Assert.Contains((await ControlPlaneApp.Ok(owner.GetAsync("/api/employees?scope=frostaura&includeReleased=true"))).AsArray(), e => e!["id"]!.GetValue<string>() == ada.ToString());
        Assert.DoesNotContain(ada.ToString(), (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"))).ToJsonString(), StringComparison.Ordinal);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/employees/{ada}/memory", new { entries = new[] { new { title = "t", body = "b" } } }), HttpStatusCode.Conflict);

        var rehired = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/employees/{ada}/rehire", new { scope = Project }));
        Assert.Equal("idle", rehired["status"]!.GetValue<string>());
        Assert.Equal(Project, rehired["scope"]!.GetValue<string>());
        Assert.Equal("Club rules", Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory"))).AsArray())!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task Contractors_work_on_the_chart_hand_back_what_they_learned_and_a_recurring_role_is_proposed_as_a_hire()
    {
        var ada = await HireAsync("Ada", limit: 50m);
        var run = await RunAsync(ada);
        JsonNode? last = null;
        for (var i = 0; i < 3; i++)
        {
            var contractor = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope = Project, briefedBy = ada, role = "Competitor researcher", brief = $"Research rival {i}.", runId = run }));
            Assert.Equal("contractor", contractor["kind"]!.GetValue<string>());
            Assert.Equal("working", contractor["status"]!.GetValue<string>());
            Assert.Equal("Ada", contractor["briefedBy"]!["name"]!.GetValue<string>());
            var id = Guid.Parse(contractor["id"]!.GetValue<string>());

            var squash = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray().First(d => d!["slug"]!.GetValue<string>() == "technologies")!["projects"]!.AsArray()
                .First(p => p!["slug"]!.GetValue<string>() == "squash")!;
            var onChart = Assert.Single(squash["workers"]!.AsArray(), w => w!["kind"]!.GetValue<string>() == "contractor")!;
            Assert.Equal("Build bookings", onChart["activity"]!.GetValue<string>());
            Assert.Equal(ada.ToString(), onChart["briefedBy"]!.GetValue<string>());

            await CallAsync(run, id);
            last = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/contractors/{id}/finish", new
            {
                runId = run,
                learned = new[] { new { title = $"Rival {i}", body = $"Rival {i} charges per court hour.", kind = "fact" } },
            }));
            Assert.Equal("released", last["contractor"]!["status"]!.GetValue<string>());
            Assert.Equal(Project, last["learned"]![0]!["scope"]!.GetValue<string>());
        }

        // The third in thirty days makes the role a recurring one: proposed as a hire, and within budget hired.
        var promotion = last!["promotion"]!;
        Assert.Equal("promotion", promotion["trigger"]!.GetValue<string>());
        Assert.Equal("Competitor researcher", promotion["contractorRole"]!.GetValue<string>());
        Assert.Equal("accepted", promotion["status"]!.GetValue<string>());
        Assert.Equal(ada.ToString(), promotion["reportsTo"]!["id"]!.GetValue<string>());

        // What the contractors learned is the briefer's now, and they are off the chart.
        Assert.Equal(3, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory"))).AsArray().Count);
        var tree = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"))).ToJsonString();
        Assert.DoesNotContain("\"kind\":\"contractor\"", tree, StringComparison.Ordinal);

        // A contractor is held to its briefer's cap, which covers what the contractors spent.
        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}", new { jobDescription = new { monthlyCreditLimit = 0.05m } }));
        var capped = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope = Project, briefedBy = ada, role = "Tester", brief = "Test it." })))["id"]!.GetValue<string>());
        var refused = await Assert.ThrowsAsync<ModelCallException>(() => CallAsync(null, capped));
        Assert.Equal(ModelFailure.BudgetExhausted, refused.Failure);
        Assert.Contains("employee:Ada", refused.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_employee_with_no_work_is_flagged_idle_released_by_auto_mode_and_held_for_the_owner_under_checkpoints()
    {
        var quiet = await HireAsync("Quinn");
        var held = await HireAsync("Hal", "frostaura/labs");
        await owner.SetAsync("frostaura", "setting", "workforce.idle_days", 2);
        await owner.SetAsync("frostaura/labs", "setting", "autonomy", "checkpoints");
        await using (var connection = new NpgsqlConnection(app.ConnectionString))
        {
            await connection.OpenAsync();
            await using var age = new NpgsqlCommand("SET ROLE endgame_system; UPDATE employees SET last_active_at = now() - interval '3 days' WHERE id = ANY(@ids);", connection);
            age.Parameters.AddWithValue("ids", new[] { quiet, held });
            await age.ExecuteNonQueryAsync();
        }

        var flagged = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{quiet}")))["employee"]!["idle"]!;
        Assert.True(flagged["flagged"]!.GetValue<bool>());
        Assert.Equal(2, flagged["afterDays"]!.GetValue<int>());
        var needs = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray();
        Assert.Equal(2, needs.Count(n => n!["kind"]!.GetValue<string>() == "idle"));

        var sweep = await app.Services.GetRequiredService<LeaseSweep>().SweepOnceAsync(CancellationToken.None);
        Assert.Equal(1, sweep.EmployeesReleased);
        Assert.Equal("released", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{quiet}")))["employee"]!["status"]!.GetValue<string>());
        Assert.Equal("idle", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{held}")))["employee"]!["status"]!.GetValue<string>());
        Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "idle");
    }

    [Fact]
    public async Task The_ontology_is_derived_from_the_tree_the_workforce_the_vault_and_what_each_app_used()
    {
        var appId = await owner.AppAsync(Project, "bookings");
        var lead = await HireAsync("Lin", "frostaura/technologies");
        var ada = await HireAsync("Ada", reportsTo: lead);
        await owner.SetAsync("frostaura/technologies", "secret", "SMTP_PASSWORD", "hunter2");
        var token = (await ControlPlaneApp.Ok(service.PostAsync($"/internal/apps/{appId}/token", null)))["token"]!.GetValue<string>();
        var kit = app.Internal();
        kit.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await ControlPlaneApp.Ok(kit.PutAsJsonAsync("/platform/v1/webhooks", new { webhooks = new[] { new { name = "court-sensor", path = "hooks/court-sensor" } } }));
        await ControlPlaneApp.Expect(await kit.PostAsJsonAsync("/platform/v1/email", new { to = new[] { "member@example.com" }, subject = "Booked", text = "Court 2." }), HttpStatusCode.Accepted);
        await ControlPlaneApp.Expect(await kit.PostAsJsonAsync("/platform/v1/telemetry/events", new { events = new[] { new { name = "booking.created" } } }), HttpStatusCode.Accepted);

        var graph = await ControlPlaneApp.Ok(owner.GetAsync("/api/ontology?scope=frostaura"));
        var nodes = graph["nodes"]!.AsArray().ToDictionary(n => n!["id"]!.GetValue<string>(), n => n!);
        var edges = graph["edges"]!.AsArray().Select(e => (From: e!["from"]!.GetValue<string>(), To: e["to"]!.GetValue<string>(), Type: e["type"]!.GetValue<string>())).ToList();
        Assert.Equal("app", nodes[$"app:{appId}"]["type"]!.GetValue<string>());
        Assert.Contains(edges, e => e.Type == "owns" && e.To == $"app:{appId}");
        Assert.Contains(edges, e => e.Type == "works-on" && e.From == $"employee:{ada}");
        Assert.Contains(edges, e => e.Type == "reports-to" && e.From == $"employee:{ada}" && e.To == $"employee:{lead}");
        Assert.Contains(nodes.Values, n => n["type"]!.GetValue<string>() == "person");
        var secret = Assert.Single(nodes.Values, n => n["type"]!.GetValue<string>() == "secret");
        Assert.Equal("SMTP_PASSWORD", secret["name"]!.GetValue<string>());
        Assert.DoesNotContain("hunter2", graph.ToJsonString(), StringComparison.Ordinal);
        foreach (var used in new[] { "service:email", "service:telemetry", "service:webhooks" })
        {
            Assert.Contains(edges, e => e.Type == "depends-on" && e.From == $"app:{appId}" && e.To == used);
        }

        Assert.DoesNotContain(edges, e => e.To == "service:models");
        Assert.Contains(edges, e => e.Type == "data-flows-to" && e.To == $"app:{appId}" && e.From.StartsWith("webhook:", StringComparison.Ordinal));
        Assert.Contains(edges, e => e.Type == "data-flows-to" && e.From == $"app:{appId}" && e.To == "service:email");

        // The data-flow view keeps only its edges; a narrower scope only what is beneath it.
        var flow = await ControlPlaneApp.Ok(owner.GetAsync("/api/ontology?scope=frostaura&view=data-flow"));
        Assert.All(flow["edges"]!.AsArray(), e => Assert.Contains(e!["type"]!.GetValue<string>(), new[] { "depends-on", "data-flows-to" }));
        var labs = await ControlPlaneApp.Ok(owner.GetAsync("/api/ontology?scope=frostaura/labs"));
        Assert.DoesNotContain(labs["nodes"]!.AsArray(), n => n!["id"]!.GetValue<string>() == $"app:{appId}");
        Assert.Equal(["data-flow", "org-chart"], graph["views"]!.AsObject().Select(v => v.Key).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Every_organisation_scoped_table_forces_row_level_security()
    {
        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            WHERE c.relkind = 'r'
              AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organisation_id' AND NOT a.attisdropped)
              AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
            """, connection);
        var unprotected = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                unprotected.Add(reader.GetString(0));
            }
        }

        Assert.Empty(unprotected);
    }
}
