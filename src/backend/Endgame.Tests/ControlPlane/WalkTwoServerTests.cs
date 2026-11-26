using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Access;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Sweeps;
using Endgame.Infrastructure.Tree;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The second real walk's server-side findings (BE-3), each held on the real control plane and a real PostgreSQL:
/// contractors close with their run, a build belongs to the app it was placed in, a build that built nothing withdraws
/// its hires and reads "not built", paused apps read paused, budget changes reach Edge within the request, the chain
/// covers a hire, an employee's cost counts its contractors, and an app token keeps an access token's role.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class WalkTwoServerTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Division = "frostaura/technologies";
    private const string Project = "frostaura/technologies/squash";
    private const string AppPath = "frostaura/technologies/squash/web";
    private readonly EdgeRecorder edge = new();
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private ControlPlaneClient runner = null!;
    private Guid appId;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        openRouter.Chat = FakeOpenRouter.Completion(0.0003m);
        app = await ControlPlaneApp.StartAsync(postgres, openRouter,
            settings: new Dictionary<string, string?> { ["Services:EdgeControl"] = EdgeRecorder.Address },
            services: s => s.AddHttpClient(EdgeNotifier.ClientName).ConfigurePrimaryHttpMessageHandler(() => edge));
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync(Division, "squash", "Squash");
        appId = await owner.AppAsync(Project, "web", "Squash web");
        service = app.Internal();
        runner = new ControlPlaneClient(app.Internal());
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<Guid> HireAsync(string scope, string name, string role, decimal? limit = null) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope, name, role, modelTier = "build", monthlyCreditLimit = limit })))["id"]!.GetValue<string>());

    private async Task<Guid> RunAsync(string scope, string kind, string title) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind, title })))["id"]!.GetValue<string>());

    private async Task<Guid> ContractorAsync(string scope, Guid briefedBy, Guid run, string role = "Demand researcher") =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope, briefedBy, role, name = $"{role} (contractor)", brief = "Look for evidence people pay.", runId = run })))["id"]!.GetValue<string>());

    private Task AppendAsync(Guid run, string type, JsonObject payload) => runner.AppendAsync(run, null, [new(type, payload)], CancellationToken.None);

    private Task<ModelReply> CallAsync(string scope, Guid run, Guid? employee) =>
        new GatewayModelClient(app.Internal(), stream: false).CompleteAsync(
            new ChatCall("chat", scope, run, employee, [new JsonObject { ["role"] = "user", ["content"] = "Go." }], null, 100, false, null, null), CancellationToken.None);

    private static JsonObject Placement(Guid app) => new()
    {
        ["kind"] = "workflow.step",
        ["step"] = "placement",
        ["data"] = new JsonObject { ["name"] = "Squash", ["division"] = Division, ["projectPath"] = Project, ["appPath"] = AppPath, ["appId"] = app.ToString() },
    };

    private static JsonObject Sample(string id, Guid app, double hours) => new()
    {
        ["sampleId"] = id,
        ["appId"] = app.ToString(),
        ["from"] = DateTimeOffset.UtcNow.AddHours(-hours),
        ["to"] = DateTimeOffset.UtcNow,
        ["awakeSeconds"] = (long)(hours * 3600),
        ["memoryBytes"] = 256L * 1024 * 1024,
        ["storageBytes"] = 1024L * 1024 * 1024,
        ["requests"] = 1000,
    };

    private async Task<JsonNode> SquashAsync() =>
        (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray().SelectMany(d => d!["projects"]!.AsArray()).Single(p => p!["slug"]!.GetValue<string>() == "squash")!;

    // ---------------------------------------------------------------- D73

    [Fact]
    public async Task Cancelling_a_run_closes_every_contractor_it_briefed_and_the_sweep_closes_ones_left_open()
    {
        var iris = await HireAsync("frostaura", "Iris", "Market researcher");
        var research = await RunAsync("frostaura", "research", "Research: a gear log");
        await runner.LeaseAsync(research, "runner-test", 120, CancellationToken.None);
        var demand = await ContractorAsync("frostaura", iris, research);
        var rivals = await ContractorAsync("frostaura", iris, research, "Competitor researcher");
        Assert.Equal(2, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{iris}")))["trackRecord"]!["contractors"]!["working"]!.GetValue<int>());

        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{research}/cancel", null));

        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{iris}"));
        Assert.Empty(detail["contractors"]!.AsArray());
        Assert.Equal(0, detail["trackRecord"]!["contractors"]!["working"]!.GetValue<int>());
        foreach (var c in new[] { demand, rivals })
        {
            var row = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{c}"));
            Assert.Equal("released", row["employee"]!["status"]!.GetValue<string>());
            Assert.Null(row["employee"]!["currentRun"]);
        }

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        Assert.DoesNotContain(tree["organisation"]!["workers"]!.AsArray(), w => w!["kind"]!.GetValue<string>() == "contractor");

        // A contractor left open by a run that already ended (rows from before the fix) is closed by the next sweep.
        var stranded = await ContractorAsync("frostaura", iris, research);
        Assert.Equal("working", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{stranded}")))["employee"]!["status"]!.GetValue<string>());
        var swept = await app.Services.GetRequiredService<LeaseSweep>().SweepOnceAsync(CancellationToken.None);
        Assert.Equal(1, swept.ContractorsClosed);
        Assert.Equal("released", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{stranded}")))["employee"]!["status"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- D80

    [Fact]
    public async Task A_placed_build_is_the_work_of_its_project_and_its_spend_lands_there()
    {
        await owner.TopUpAsync("frostaura", 100m);
        var build = await RunAsync(Division, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await AppendAsync(build, "estimate.made", new JsonObject { ["credits"] = 30m, ["basis"] = "plan" });
        await AppendAsync(build, "message", Placement(appId));

        // The Runner still names the scope it started at; the call is charged where the run now is.
        await CallAsync(Division, build, null);

        var squash = await SquashAsync();
        Assert.Equal("building", squash["stage"]!.GetValue<string>());
        Assert.Equal(build.ToString(), squash["progress"]!["runId"]!.GetValue<string>());
        Assert.True(squash["progress"]!["spentCredits"]!.GetValue<decimal>() > 0);
        Assert.True(squash["spend"]!["monthCredits"]!.GetValue<decimal>() > 0);
        Assert.Equal(AppPath, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{build}")))["scope"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- D81

    [Fact]
    public async Task A_build_cancelled_before_anything_was_built_withdraws_its_hires_and_reads_not_built_and_try_again_raises_them_again()
    {
        var build = await RunAsync(Division, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await AppendAsync(build, "message", Placement(appId));
        var raised = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "stage",
            needKey = $"stage:build:{Project}",
            reason = "Squash is entering its build.",
            name = "Theo",
            role = "Software engineer",
            jobDescription = new { mandate = "Build it.", tools = new[] { "read_file" }, services = Array.Empty<string>(), monthlyCreditLimit = 1500m, modelTier = "build" },
            expectedMonthlyCredits = 1500m,
            runId = build,
        }));
        var hire = raised["hire"]!["id"]!.GetValue<string>();
        Assert.Equal("proposed", raised["hire"]!["status"]!.GetValue<string>());

        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{build}/cancel", null));

        var withdrawn = await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{hire}"));
        Assert.Equal("declined", withdrawn["status"]!.GetValue<string>());
        Assert.True(withdrawn["withdrawn"]!.GetValue<bool>());
        Assert.Contains("was cancelled before anything was built", withdrawn["decision"]!["note"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "hire");

        var squash = await SquashAsync();
        Assert.Equal("not-built", squash["stage"]!.GetValue<string>());
        Assert.Equal("Not built — the build was cancelled.", squash["note"]!.GetValue<string>());
        Assert.Equal("cancelled", squash["notBuilt"]!["reason"]!.GetValue<string>());
        var row = squash["apps"]!.AsArray().Single()!;
        Assert.Equal(build.ToString(), row["notBuilt"]!["runId"]!.GetValue<string>());
        Assert.Equal("draft", row["status"]!.GetValue<string>());
        Assert.Equal("Not built — the build was cancelled.", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["health"]!["summary"]!.GetValue<string>());

        // Trying the build again raises the same need again, as a new proposal.
        var again = await RunAsync(Division, "build", "Build Squash");
        var reraised = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "stage",
            needKey = $"stage:build:{Project}",
            reason = "Squash is entering its build.",
            name = "Theo",
            role = "Software engineer",
            jobDescription = new { mandate = "Build it.", monthlyCreditLimit = 1500m, modelTier = "build" },
            expectedMonthlyCredits = 1500m,
            runId = again,
        }));
        Assert.NotEqual(hire, reraised["hire"]!["id"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- R2-3

    [Fact]
    public async Task The_sweep_withdraws_open_hires_from_before_the_tidy_rules_covered_or_raised_by_a_build_that_ended_unbuilt()
    {
        // Rows as they were left before the live rules: a proposal for a need Iris now covers from the organisation, and two
        // a build raised that ended without the rule ever running (its run marked cancelled behind the platform's back).
        object Hire(string scope, string key, string name, string role, Guid? run) => new
        {
            scope,
            trigger = "stage",
            needKey = key,
            reason = "The work reached this level.",
            name,
            role,
            jobDescription = new { mandate = "Do it.", modelTier = "build" },
            expectedMonthlyCredits = 400m,
            runId = run,
        };
        var research = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire(Division, $"stage:research:{Division}", "Iris", "Market researcher", null))))["hire"]!["id"]!.GetValue<string>();
        var build = await RunAsync(Division, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await AppendAsync(build, "message", Placement(appId));
        var theo = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire(Project, $"stage:build:{Project}", "Theo", "Software engineer", build))))["hire"]!["id"]!.GetValue<string>();
        var nadia = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire(Project, $"stage:evaluate:{Project}", "Nadia", "QA engineer", build))))["hire"]!["id"]!.GetValue<string>();
        await HireAsync("frostaura", "Iris", "Market researcher");
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Tenancy.TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Persistence.EndgameDbContext>();
            await db.Runs.Where(r => r.Id == build).ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, "cancelled").SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow).SetProperty(r => r.LeaseHolder, (string?)null).SetProperty(r => r.LeaseExpiresAt, (DateTimeOffset?)null));
        }

        var sweep = app.Services.GetRequiredService<LeaseSweep>();
        Assert.Equal(3, (await sweep.SweepOnceAsync(CancellationToken.None)).HiresWithdrawn);
        Assert.Equal(0, (await sweep.SweepOnceAsync(CancellationToken.None)).HiresWithdrawn);
        var covered = await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{research}"));
        Assert.True(covered["withdrawn"]!.GetValue<bool>());
        Assert.Equal("Withdrawn: Iris already does this work here.", covered["decision"]!["note"]!.GetValue<string>());
        foreach (var hire in new[] { theo, nadia })
        {
            var row = await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{hire}"));
            Assert.True(row["withdrawn"]!.GetValue<bool>());
            Assert.Contains("was cancelled before anything was built", row["decision"]!["note"]!.GetValue<string>(), StringComparison.Ordinal);
        }

        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "hire");
    }

    // ---------------------------------------------------------------- R2-8

    [Fact]
    public async Task A_run_keeps_the_estimate_shown_before_the_work_and_the_re_estimate_from_the_plan_apart()
    {
        var build = await RunAsync(Division, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        var before = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{build}"));
        Assert.Null(before["firstEstimateCredits"]);
        await AppendAsync(build, "estimate.made", new JsonObject { ["credits"] = 10m, ["basis"] = "start", ["stage"] = "start" });
        var started = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{build}"));
        Assert.Equal(10m, started["firstEstimateCredits"]!.GetValue<decimal>());
        Assert.Null(started["planEstimateCredits"]);

        await AppendAsync(build, "estimate.made", new JsonObject { ["credits"] = 4.8m, ["basis"] = "the plan", ["stage"] = "plan" });
        var planned = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{build}"));
        Assert.Equal((10m, 4.8m, 4.8m), (planned["firstEstimateCredits"]!.GetValue<decimal>(), planned["planEstimateCredits"]!.GetValue<decimal>(), planned["estimateCredits"]!.GetValue<decimal>()));
    }

    // ---------------------------------------------------------------- R2-5

    [Fact]
    public async Task An_approval_raised_before_the_plain_detail_fix_reads_plainly_with_its_tool_line_kept_for_technical_mode()
    {
        var run = await RunAsync(Division, "conversation", "Talk");
        await runner.LeaseAsync(run, "runner-test", 120, CancellationToken.None);
        const string raw = "adjust_setting: checkpoint.hire=false. No rule allows adjust_setting here. Checkpoint: adjust_setting.";
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Change a setting here?", detail = raw }));
        var need = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray().Single(n => n!["kind"]!.GetValue<string>() == "approval")!;
        Assert.StartsWith("Turn off the “Before anyone is hired” checkpoint in ", need["title"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(Endgame.Domain.Access.ApprovalWords.ByDefault, need["detail"]!.GetValue<string>());
        Assert.Equal(raw, need["technical"]!.GetValue<string>());
        // The run's own log reads the same way, so its page says it plainly too.
        var asked = (await runner.ReadEventsAsync(run, 0, 500, CancellationToken.None)).Single(e => e.Type == "approval.requested").Payload;
        Assert.Equal((need["title"]!.GetValue<string>(), Endgame.Domain.Access.ApprovalWords.ByDefault, raw), (asked["title"]!.GetValue<string>(), asked["detail"]!.GetValue<string>(), asked["technical"]!.GetValue<string>()));
    }

    [Theory]
    [InlineData("Change a setting here?", "adjust_setting: hire_checkpoint=false. No rule allows adjust_setting here. Checkpoint: adjust_setting.", "Change a setting here?")]
    [InlineData("Try again: Research: a lift board?", "try_again: 075ba848-baef-4980-ae4e-84e68a640987. No rule allows try_again here. Checkpoint: try_again.", "Try again: Research: a lift board?")]
    [InlineData("Change a setting here?", "adjust_setting: sleep.idle_minutes=25. No rule allows adjust_setting here. Checkpoint: adjust_setting.", "Let the apps here sleep after 25 idle minutes?")]
    public void An_older_tool_line_becomes_technical_detail_and_the_plain_sentence_takes_its_place(string title, string detail, string plainTitle)
    {
        var (t, d, technical) = Endgame.Infrastructure.Runs.OlderApprovals.Plain(title, detail, null, null);
        Assert.Equal((plainTitle, Endgame.Domain.Access.ApprovalWords.ByDefault, detail), (t, d, technical));
        // A row that already has its technical detail, or a plain detail, is left as it is.
        Assert.Equal(("T?", "Plain words.", (string?)null), Endgame.Infrastructure.Runs.OlderApprovals.Plain("T?", "Plain words.", null, null));
    }

    // ---------------------------------------------------------------- D66

    [Fact]
    public async Task An_app_paused_by_a_spent_budget_reads_paused_with_its_reason_on_the_chart_and_its_page()
    {
        await owner.TopUpAsync("frostaura", 100m);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("dock-1", appId, 10) } }));
        await owner.SetAsync(Project, "budget", "monthly_credits", 1);

        var row = (await SquashAsync())["apps"]!.AsArray().Single()!;
        Assert.Equal("paused", row["health"]!.GetValue<string>());
        Assert.Equal("budget_exhausted", row["paused"]!["reason"]!.GetValue<string>());
        var page = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}"));
        Assert.Equal("paused", page["health"]!["state"]!.GetValue<string>());
        Assert.Equal("Paused: a monthly budget above it is spent. Raising the budget or the new month restores it.", page["health"]!["summary"]!.GetValue<string>());
        Assert.Equal("budget_exhausted", page["paused"]!["reason"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- D67, D68

    [Fact]
    public async Task Setting_or_removing_a_budget_has_Edge_read_the_new_table_before_the_request_returns()
    {
        await owner.TopUpAsync("frostaura", 100m);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("dock-1", appId, 10) } }));
        var before = edge.Refreshes;
        await owner.SetAsync(AppPath, "budget", "monthly_credits", 1);
        Assert.Equal(before + 1, edge.Refreshes);
        Assert.True((await RouteAsync())["paused"]!.GetValue<bool>());

        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/cascade?scope={AppPath}&kind=budget&key=monthly_credits"), HttpStatusCode.NoContent);
        Assert.Equal(before + 2, edge.Refreshes);
        Assert.False((await RouteAsync())["paused"]!.GetValue<bool>());
    }

    [Fact]
    public async Task A_new_app_is_in_the_routing_table_unpublished_and_Edge_is_told_at_once()
    {
        var before = edge.Refreshes;
        var draft = await owner.AppAsync(Project, "admin", "Squash admin");
        Assert.Equal(before + 1, edge.Refreshes);
        var route = (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<string>() == draft.ToString())!;
        Assert.Equal("draft", route["status"]!.GetValue<string>());
        Assert.Null(route["version"]);
        Assert.False(route["paused"]!.GetValue<bool>());
    }

    private async Task<JsonNode> RouteAsync() =>
        (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<string>() == appId.ToString())!;

    // ---------------------------------------------------------------- D22, D70

    [Fact]
    public async Task A_need_someone_above_already_covers_proposes_nobody_and_a_siblings_employee_does_not_cover_it()
    {
        var iris = await HireAsync("frostaura", "Iris", "Market researcher");
        var covered = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Division,
            trigger = "stage",
            needKey = $"stage:research:{Division}",
            reason = "Research reached this division.",
            name = "Iris",
            role = "Market researcher",
            jobDescription = new { mandate = "Research.", modelTier = "build" },
            expectedMonthlyCredits = 400m,
        }));
        Assert.False(covered["created"]!.GetValue<bool>());
        Assert.Equal("covered", covered["hire"]!["status"]!.GetValue<string>());
        Assert.Equal(iris.ToString(), covered["hire"]!["employeeId"]!.GetValue<string>());
        Assert.Equal(iris.ToString(), covered["coveredBy"]!["id"]!.GetValue<string>());
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires?scope={Division}"))).AsArray());

        // Theo works on another project: his "everything beneath it" does not reach this one, so a proposal is raised.
        await owner.ProjectAsync(Division, "ladder");
        await HireAsync("frostaura/technologies/ladder", "Theo", "Software engineer");
        var proposed = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "stage",
            needKey = $"stage:build:{Project}",
            reason = "Squash is entering its build.",
            name = "Theo",
            role = "Software engineer",
            jobDescription = new { mandate = "Build it.", modelTier = "build" },
            expectedMonthlyCredits = 1500m,
        }));
        Assert.Equal("proposed", proposed["hire"]!["status"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- hire cost

    [Fact]
    public async Task A_proposals_expected_monthly_cost_is_held_to_its_own_budget()
    {
        var raised = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
        {
            scope = Project,
            trigger = "promotion",
            contractorRole = "Demand researcher",
            reason = "It keeps recurring.",
            name = "Demand researcher",
            role = "Demand researcher",
            jobDescription = new { mandate = "Research demand.", monthlyCreditLimit = 100m, modelTier = "build" },
            expectedMonthlyCredits = 500m,
        }));
        Assert.Equal(100m, raised["expectedMonthlyCredits"]!.GetValue<decimal>());
        var edited = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/hires/{raised["id"]!.GetValue<string>()}", new { expectedMonthlyCredits = 900m }));
        Assert.Equal(100m, edited["expectedMonthlyCredits"]!.GetValue<decimal>());
    }

    // ---------------------------------------------------------------- D74, D75

    [Fact]
    public async Task A_researchers_cost_budget_used_recent_work_and_estimates_count_the_contractors_it_briefs()
    {
        await owner.TopUpAsync("frostaura", 100m);
        var iris = await HireAsync("frostaura", "Iris", "Market researcher", limit: 400m);
        var research = await RunAsync("frostaura", "research", "Research: a gear log");
        await runner.LeaseAsync(research, "runner-test", 120, CancellationToken.None);
        var demand = await ContractorAsync("frostaura", iris, research);
        await CallAsync("frostaura", research, demand);
        await CallAsync("frostaura", research, demand);
        await AppendAsync(research, "estimate.scored", new JsonObject { ["expectedCredits"] = 1m, ["actualCredits"] = 1.05m });

        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{iris}"));
        var record = detail["trackRecord"]!;
        var contractors = record["contractors"]!["monthCredits"]!.GetValue<decimal>();
        Assert.True(contractors > 0);
        Assert.Equal(contractors, record["cost"]!["monthCredits"]!.GetValue<decimal>());
        Assert.Equal(contractors, record["cost"]!["toDateCredits"]!.GetValue<decimal>());
        Assert.Equal(0m, record["cost"]!["ownMonthCredits"]!.GetValue<decimal>());
        Assert.Equal(1, record["estimates"]!["pieces"]!.GetValue<int>());
        Assert.Equal(research.ToString(), Assert.Single(detail["recentRuns"]!.AsArray())!["id"]!.GetValue<string>());
    }

    // ---------------------------------------------------------------- D61

    [Fact]
    public async Task An_app_token_minted_for_a_capped_caller_is_seen_at_that_role_never_above_the_persons_own()
    {
        await using var scope = app.Scope();
        var services = scope.ServiceProvider;
        var person = await services.GetRequiredService<UserManager<EndgameUser>>().FindByEmailAsync("owner@frostaura.net");
        var at = await services.GetRequiredService<ScopeResolver>().RequireAsync(AppPath, CancellationToken.None);
        var identity = services.GetRequiredService<AppIdentityService>();
        var caller = new AppCaller(at, Guid.NewGuid());

        var capped = await identity.MemberTokenAsync(at, person!.Id, CancellationToken.None, MemberRole.Admin);
        Assert.Equal("admin", (await identity.ResolveAsync(caller, capped, CancellationToken.None))!.User.Role);
        var plain = await identity.MemberTokenAsync(at, person.Id, CancellationToken.None);
        Assert.Equal("owner", (await identity.ResolveAsync(caller, plain, CancellationToken.None))!.User.Role);
    }

    // ---------------------------------------------------------------- D63

    [Fact]
    public async Task A_new_organisation_says_it_has_no_credits_until_it_is_topped_up()
    {
        var created = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = Provisioning.Description, screening = Provisioning.Manual }));
        Assert.Equal(0m, created["balance"]!.GetValue<decimal>());
        Assert.Equal("Acme has no credits until you top it up: its first piece of work waits for budget until then.", created["creditsNote"]!.GetValue<string>());
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura")))["neverToppedUp"]!.GetValue<bool>());
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["organisation"]!["neverToppedUp"]!.GetValue<bool>());

        await owner.TopUpAsync("frostaura", 10m);
        Assert.False((await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura")))["neverToppedUp"]!.GetValue<bool>());
        Assert.False((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["organisation"]!["neverToppedUp"]!.GetValue<bool>());
    }

    // ---------------------------------------------------------------- memory review

    [Fact]
    public async Task A_review_that_gives_no_reason_stores_none()
    {
        var iris = await HireAsync("frostaura", "Iris", "Market researcher");
        var written = await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/employees/{iris}/memory", new { entries = new[] { new { title = "Courts", body = "Six courts.", kind = "fact" } } }));
        var entry = written.AsArray().Single()!["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/employees/{iris}/memory/review", new { removed = new[] { new { id = entry, why = (string?)null } } }));

        var removal = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{iris}/memory/changes"))).AsArray().Single(c => c!["action"]!.GetValue<string>() == "removed")!;
        Assert.Null(removal["detail"]!["why"]);
    }

    // ---------------------------------------------------------------- coordinator additions

    [Fact]
    public async Task A_claimed_task_names_who_took_it_on_and_what_it_is()
    {
        var theo = await HireAsync(Project, "Theo", "Software engineer");
        var build = await RunAsync(Project, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        var task = await runner.CreateTaskAsync(Project, build, "Members book a court.", "detail", null, null, CancellationToken.None);
        await runner.CheckoutTaskAsync(task.Id, build, theo, "todo", null, CancellationToken.None);

        var claimed = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{build}/events"))).AsArray().Single(e => e!["type"]!.GetValue<string>() == "task.claimed")!["payload"]!;
        Assert.Equal(("Theo", "Members book a court."), (claimed["holder"]!.GetValue<string>(), claimed["summary"]!.GetValue<string>()));
    }

    [Fact]
    public async Task An_approval_keeps_its_technical_detail_beside_the_plain_one()
    {
        var build = await RunAsync(Project, "build", "Build Squash");
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = build, title = "Search the web?", detail = "Iris wants to look up rival apps.", technical = "web_search {\"q\":\"gear log\"} — rule: ask for web search" }));

        var need = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray().Single(n => n!["kind"]!.GetValue<string>() == "approval")!;
        Assert.Equal("Iris wants to look up rival apps.", need["detail"]!.GetValue<string>());
        Assert.Equal("web_search {\"q\":\"gear log\"} — rule: ask for web search", need["technical"]!.GetValue<string>());
        var requested = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{build}/events"))).AsArray().Single(e => e!["type"]!.GetValue<string>() == "approval.requested")!["payload"]!;
        Assert.StartsWith("web_search", requested["technical"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_finished_runs_technical_detail_and_reason_are_on_its_read_model_and_a_declined_start_is_said_on_the_idea()
    {
        await owner.TopUpAsync("frostaura", 100m);
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A gear log" }));
        var research = Guid.Parse(idea["runId"]!.GetValue<string>());
        await AppendAsync(research, "run.finished", new JsonObject { ["outcome"] = "cancelled", ["reason"] = ReadModels.DeclinedAtStart, ["detail"] = "approval rejected: checkpoint.start" });

        var run = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{research}"));
        Assert.Equal((ReadModels.DeclinedAtStart, "approval rejected: checkpoint.start"), (run["reason"]!.GetValue<string>(), run["detail"]!.GetValue<string>()));
        var read = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{idea["id"]!.GetValue<string>()}"));
        Assert.Equal("start-declined", read["tryAgain"]!["why"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_published_app_has_a_data_edge_and_the_chart_carries_its_status()
    {
        Assert.Equal("draft", (await SquashAsync())["apps"]!.AsArray().Single()!["status"]!.GetValue<string>());
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "abc123" }));
        Assert.Equal("running", (await SquashAsync())["apps"]!.AsArray().Single()!["status"]!.GetValue<string>());

        var graph = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ontology?scope={Project}&view=data-flow"));
        Assert.Contains(graph["edges"]!.AsArray(), e => e!["from"]!.GetValue<string>() == $"app:{appId}" && e["to"]!.GetValue<string>() == "service:data" && e["type"]!.GetValue<string>() == "depends-on");
    }

    /// <summary>Stands in for Edge's control listener: counts the routing refreshes it is asked for.</summary>
    private sealed class EdgeRecorder : HttpMessageHandler
    {
        public const string Address = "http://edge-control.test:9001";
        private readonly ConcurrentQueue<string> calls = new();

        public int Refreshes => calls.Count(c => c == "/internal/routes/refresh");

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            calls.Enqueue(request.RequestUri!.AbsolutePath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
        }
    }
}
