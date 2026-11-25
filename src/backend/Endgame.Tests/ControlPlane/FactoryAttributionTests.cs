using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Factory work is the work of the people who did it, on the real control plane and PostgreSQL: a build run that
/// belongs to nobody (it sits where the idea was proposed), whose plan items are tasks the engineer claimed, whose
/// evaluations judge the engineer's work and name the QA engineer as judge, and whose security review is the standing
/// reviewer's task. Every reader shows it — the track record, the employee's recent work, the org chart's live
/// activity and the runs an employee worked in — within one organisation and what the caller may see.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class FactoryAttributionTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Division = "frostaura/technologies";
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
        await owner.ProjectAsync(Division, "squash");
        await owner.ProjectAsync(Division, "ladder");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
        runner = new ControlPlaneClient(app.Internal());
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<Guid> HireAsync(string name, string role) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = Project, name, role, modelTier = "build" })))["id"]!.GetValue<string>());

    private async Task<Guid> RunAsync(string scope, string kind, string title) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind, title })))["id"]!.GetValue<string>());

    private Task AppendAsync(Guid run, string type, JsonObject payload) => runner.AppendAsync(run, null, [new(type, payload)], CancellationToken.None);

    private Task<ModelReply> CallAsync(Guid run, Guid employee, bool repair = false) =>
        new GatewayModelClient(app.Internal(), stream: false).CompleteAsync(
            new ChatCall("chat", Project, run, employee, [new JsonObject { ["role"] = "user", ["content"] = "Go." }], null, 100, repair, null, null), CancellationToken.None);

    /// <summary>A task of the build, claimed by who does it, as the Runner's BuildWorkflow makes it.</summary>
    private async Task<Guid> ClaimedAsync(Guid run, string title, Guid employee)
    {
        var task = await runner.CreateTaskAsync(Project, run, title, "detail", null, null, CancellationToken.None);
        await runner.CheckoutTaskAsync(task.Id, run, employee, "todo", null, CancellationToken.None);
        return task.Id;
    }

    private Task DoneAsync(Guid task, string summary) => runner.PatchTaskAsync(task, new { status = "done", summary }, CancellationToken.None);

    private static JsonObject Judgement(string item, Guid task, Guid engineer, Guid qa, Guid check, int round, bool? repairCharged = null) => new()
    {
        ["item"] = item,
        ["text"] = "Members book a court.",
        ["summary"] = "Checked.",
        ["round"] = round,
        ["tier"] = "build",
        ["taskId"] = task.ToString(),
        ["employeeId"] = engineer.ToString(),
        ["judgedBy"] = qa.ToString(),
        ["checkTaskId"] = check.ToString(),
        ["repairCharged"] = repairCharged,
    };

    [Fact]
    public async Task A_factory_builds_work_is_the_engineers_its_judgements_the_qa_engineers_and_its_review_the_reviewers()
    {
        var theo = await HireAsync("Theo", "Software engineer");
        var nadia = await HireAsync("Nadia", "QA engineer");
        var reviewer = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync("/api/employees?scope=frostaura"))).AsArray()
            .Single(e => e!["standing"]?.GetValue<string>() == "security-reviewer")!["id"]!.GetValue<string>());

        // The build sits at the division, where the idea was proposed, and belongs to nobody.
        var build = await RunAsync(Division, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await AppendAsync(build, "estimate.made", new JsonObject { ["credits"] = 90m, ["basis"] = "plan", ["stage"] = "plan" });

        // Item one: claimed by the engineer, sent back once by the QA engineer (the repair not charged), then accepted.
        var bookings = await ClaimedAsync(build, "Members book a court.", theo);
        var check0 = await ClaimedAsync(build, "Check: Members book a court.", nadia);
        await CallAsync(build, theo);
        await CallAsync(build, nadia);
        await AppendAsync(build, "evaluation.failed", Judgement("bookings", bookings, theo, nadia, check0, 0, repairCharged: false));
        await DoneAsync(check0, "Sent back for repair, at no charge.");
        await CallAsync(build, theo, repair: true);
        var check1 = await ClaimedAsync(build, "Check again: Members book a court.", nadia);
        await AppendAsync(build, "evaluation.passed", Judgement("bookings", bookings, theo, nadia, check1, 1));
        await DoneAsync(check1, "Checked and working.");
        await DoneAsync(bookings, "Checked and working: Members book a court.");

        // Item two: accepted first time. Still in progress when the org chart is read.
        var minutes = await ClaimedAsync(build, "Members hold playing minutes.", theo);
        await CallAsync(build, theo);

        // The org chart shows who works in the build while it runs, though none of them owns it.
        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var squash = tree["divisions"]!.AsArray().SelectMany(d => d!["projects"]!.AsArray()).Single(p => p!["slug"]!.GetValue<string>() == "squash")!;
        foreach (var who in new[] { theo, nadia })
        {
            var worker = squash["workers"]!.AsArray().Single(w => w!["id"]!.GetValue<string>() == who.ToString())!;
            Assert.Equal(("Build Squash", "working"), (worker["activity"]!.GetValue<string>(), worker["status"]!.GetValue<string>()));
        }

        var detailWhileWorking = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{theo}"));
        Assert.Equal(build.ToString(), detailWhileWorking["employee"]!["currentRun"]!["id"]!.GetValue<string>());
        // Claiming work is activity: its last piece of work is the build, though it owns no run.
        Assert.Equal(build.ToString(), detailWhileWorking["employee"]!["lastRunId"]!.GetValue<string>());

        var check2 = await ClaimedAsync(build, "Check: Members hold playing minutes.", nadia);
        await AppendAsync(build, "evaluation.passed", Judgement("minutes", minutes, theo, nadia, check2, 0));
        await DoneAsync(check2, "Checked and working.");
        await DoneAsync(minutes, "Checked and working: Members hold playing minutes.");

        // The security review is the standing reviewer's own task.
        var review = await ClaimedAsync(build, "Review the app's security before it is published", reviewer);
        await AppendAsync(build, "message", new JsonObject { ["from"] = "security-reviewer", ["kind"] = "security.review", ["passed"] = true, ["findings"] = new JsonArray(), ["employeeId"] = reviewer.ToString(), ["taskId"] = review.ToString() });
        var reviewerTree = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["organisation"]!["workers"]!.AsArray().Single(w => w!["id"]!.GetValue<string>() == reviewer.ToString())!;
        Assert.Equal("Build Squash", reviewerTree["activity"]!.GetValue<string>());
        await DoneAsync(review, "Nothing found that blocks publishing.");
        await AppendAsync(build, "estimate.scored", new JsonObject { ["expectedCredits"] = 90m, ["actualCredits"] = 14.56m });
        await AppendAsync(build, "run.finished", new JsonObject { ["outcome"] = "succeeded", ["summary"] = "Squash is built and running privately." });

        // The reviewer also made a model call in a run of its own kind that it neither owns nor holds a task in.
        var other = await RunAsync(Project, "task", "Look over the ladder");
        await CallAsync(other, reviewer);
        await AppendAsync(other, "run.finished", new JsonObject { ["outcome"] = "succeeded" });

        // The run log names who did each task.
        var log = await runner.ReadEventsAsync(build, 0, 500, CancellationToken.None);
        Assert.All(log.Where(e => e.Type is "task.claimed" or "task.done"), e => Assert.NotNull(e.Payload["employeeId"]));
        Assert.Equal(theo.ToString(), log.Single(e => e.Type == "task.done" && e.Payload["taskId"]!.GetValue<string>() == bookings.ToString()).Payload["employeeId"]!.GetValue<string>());

        // The engineer: two pieces accepted, one sent back, the repair not charged; one finished run; the build's estimate is theirs.
        var theoTrack = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{theo}/track-record"));
        Assert.Equal((2, 1, 0), (theoTrack["work"]!["accepted"]!.GetValue<int>(), theoTrack["work"]!["sentBack"]!.GetValue<int>(), theoTrack["work"]!["judged"]!.GetValue<int>()));
        Assert.Equal(66.7m, theoTrack["work"]!["acceptedPercent"]!.GetValue<decimal>());
        Assert.Equal((1, 1), (theoTrack["runs"]!["finished"]!.GetValue<int>(), theoTrack["runs"]!["succeeded"]!.GetValue<int>()));
        Assert.Equal(1, theoTrack["repairsNotCharged"]!["calls"]!.GetValue<int>());
        Assert.Equal(0.06m, theoTrack["cost"]!["toDateCredits"]!.GetValue<decimal>());
        Assert.Equal(1, theoTrack["estimates"]!["pieces"]!.GetValue<int>());
        Assert.Equal(-83.8m, theoTrack["estimates"]!["typicalGapPercent"]!.GetValue<decimal>());
        Assert.Equal("under", theoTrack["estimates"]!["typically"]!.GetValue<string>());

        // The QA engineer: three judgements made, its three checks its own accepted work, nothing of its own sent back.
        var nadiaTrack = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{nadia}/track-record"));
        Assert.Equal((3, 0, 3), (nadiaTrack["work"]!["accepted"]!.GetValue<int>(), nadiaTrack["work"]!["sentBack"]!.GetValue<int>(), nadiaTrack["work"]!["judged"]!.GetValue<int>()));
        Assert.Equal(1, nadiaTrack["runs"]!["finished"]!.GetValue<int>());
        Assert.Null(nadiaTrack["estimates"]);

        // The reviewer: its review accepted; two runs worked in (one by a task, one by a model call charged to it).
        var reviewerTrack = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{reviewer}/track-record"));
        Assert.Equal((1, 0), (reviewerTrack["work"]!["accepted"]!.GetValue<int>(), reviewerTrack["work"]!["sentBack"]!.GetValue<int>()));
        Assert.Equal(2, reviewerTrack["runs"]!["finished"]!.GetValue<int>());

        // Recent work: the tasks each one claimed, kept once they are done.
        var theoTasks = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/tasks?scope={Project}&employeeId={theo}"))).AsArray();
        Assert.Equal(["Members book a court.", "Members hold playing minutes."], theoTasks.Select(t => t!["title"]!.GetValue<string>()).Order());
        Assert.All(theoTasks, t => Assert.Equal(("done", theo.ToString(), null), (t!["status"]!.GetValue<string>(), t["employeeId"]!.GetValue<string>(), t["holderEmployeeId"]?.GetValue<string>())));
        Assert.Equal(3, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/tasks?scope={Project}&employeeId={nadia}"))).AsArray().Count);
        Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/tasks?scope=frostaura&employeeId={reviewer}"))).AsArray());

        // The runs each one worked in, wherever in the organisation they sit.
        static IEnumerable<string> Ids(JsonNode list) => list.AsArray().Select(r => r!["id"]!.GetValue<string>());
        Assert.Equal([build.ToString()], Ids(await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs?employeeId={theo}"))));
        Assert.Equal([build.ToString()], Ids(await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs?employeeId={nadia}"))));
        Assert.Equal(new[] { build.ToString(), other.ToString() }.Order(), Ids(await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs?employeeId={reviewer}"))).Order());
        Assert.Equal([build.ToString()], Ids(await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs?scope={Division}&employeeId={theo}"))));

        // After the run, nobody is shown working in it.
        var after = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray().SelectMany(d => d!["projects"]!.AsArray()).Single(p => p!["slug"]!.GetValue<string>() == "squash")!;
        Assert.All(after["workers"]!.AsArray(), w => Assert.Equal("idle", w!["status"]!.GetValue<string>()));

        // Accuracy on the credits page: the build came in far under its estimate, and says so.
        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        Assert.Equal(("under", -83.8m), (credits["estimates"]!["typically"]!.GetValue<string>(), credits["estimates"]!["typicalGapPercent"]!.GetValue<decimal>()));

        // A viewer of the project alone sees the engineer's tasks but not the division's run, which is above what they may see.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = Project, email = "pia@example.com", displayName = "Pia", role = "viewer" }));
        var pia = await app.SignInAsync("pia@example.com", "Pia");
        Assert.Equal(2, (await ControlPlaneApp.Ok(pia.GetAsync($"/api/tasks?scope={Project}&employeeId={theo}"))).AsArray().Count);
        Assert.Empty((await ControlPlaneApp.Ok(pia.GetAsync($"/api/runs?employeeId={theo}"))).AsArray());
        await ControlPlaneApp.Expect(await pia.GetAsync($"/api/runs?employeeId={reviewer}"), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Another_organisations_employee_and_work_are_not_found()
    {
        var theo = await HireAsync("Theo", "Software engineer");
        var build = await RunAsync(Division, "build", "Build Squash");
        var task = await ClaimedAsync(build, "Members book a court.", theo);
        await DoneAsync(task, "Done.");

        // Another organisation, provisioned by FrostAura's operator for its own owner.
        var stranger = await app.SignInAsync("stranger@example.com", "Stranger");
        var operatorClient = await app.SignInAsync("dean@frostaura.net");
        await ControlPlaneApp.Created(operatorClient.PostAsJsonAsync("/api/organisations", new { name = "Harbour", slug = "harbour", ownerEmail = "stranger@example.com" }));
        await ControlPlaneApp.Expect(await stranger.GetAsync($"/api/employees/{theo}/track-record"), HttpStatusCode.NotFound);
        await ControlPlaneApp.Expect(await stranger.GetAsync($"/api/runs?employeeId={theo}"), HttpStatusCode.NotFound);
        Assert.Empty((await ControlPlaneApp.Ok(stranger.GetAsync($"/api/tasks?scope=harbour&employeeId={theo}"))).AsArray());
    }
}
