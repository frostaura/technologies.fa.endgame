using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Sweeps;
using Endgame.Infrastructure.Tenancy;
using Endgame.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The control plane's half of R9-1, on a real PostgreSQL: a build starts from an idea, so the app it is placed in must be
/// new. A placement naming an app another piece of work made, changed or published — or one that holds data — is refused in
/// the append's own transaction, whatever the Runner's placement step said; only an earlier attempt of the same idea finds
/// its own app again. Every way an idea starts (the console, a division's or a project's conversation, a portfolio
/// suggestion) reaches the same build, at the division; and a build placed in a live app before this rule existed leaves
/// that app as it was when it stops: no status change, no hire proposals for it.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class PlacementGuardTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Division = "frostaura/community";
    private const string Project = "frostaura/community/dive-club-tools";
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        service = app.Internal();
        await owner.DivisionAsync("frostaura", "community", "Community");
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    /// <summary>An idea at <paramref name="scope"/>, researched to "build", and the build the owner decided: its run id.</summary>
    private async Task<string> BuildOfAsync(string text, string scope = Division)
    {
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { scope, text, constraints = Array.Empty<string>() }));
        return await DecideAsync(idea["id"]!.GetValue<string>());
    }

    private async Task<string> DecideAsync(string ideaId)
    {
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{ideaId}/verdict", VerdictSamples.Valid("build")));
        var decided = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "build" }));
        return decided["decision"]!["runId"]!.GetValue<string>();
    }

    private static object Placement(Guid appId, string path) => new
    {
        type = "message",
        payload = new { kind = "workflow.step", agent = "workflow", step = "placement", data = new { name = "Compressor Service Log", division = Division, projectPath = path[..path.LastIndexOf('/')], appPath = path, appId } },
    };

    private Task<HttpResponseMessage> PlaceAsync(string run, Guid appId, string path) =>
        service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { Placement(appId, path) } });

    private async Task FinishAsync(string run, string outcome) =>
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/events", new { events = new[] { new { type = "run.finished", payload = (object)new { outcome, summary = "You declined the plan, so nothing was built." } } } }));

    private async Task<JsonNode> RunAsync(string run) => await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run}"));

    private async Task<JsonNode> AppAsync(Guid id) => await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{id}"));

    /// <summary>Dive Seat Sheet: built from its own idea, published, and running.</summary>
    private async Task<(Guid App, string Build)> LiveAppAsync()
    {
        await owner.ProjectAsync(Division, "dive-club-tools", "Dive Seat Sheet");
        var live = await owner.AppAsync(Project, "web", "Dive Seat Sheet");
        var build = await BuildOfAsync("A sign-up sheet for the club's boat dives.");
        await ControlPlaneApp.Ok(PlaceAsync(build, live, $"{Project}/web"));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{live}/published", new { version = "c0ffee" }));
        await FinishAsync(build, "succeeded");
        return (live, build);
    }

    [Fact]
    public async Task A_build_of_another_idea_placed_in_a_live_app_is_refused_and_neither_the_run_nor_the_app_moves()
    {
        var (live, _) = await LiveAppAsync();
        var before = await AppAsync(live);
        var compressor = await BuildOfAsync("A compressor service log for the dive club.");

        var refused = await ControlPlaneApp.Expect(await PlaceAsync(compressor, live, $"{Project}/web"), HttpStatusCode.Conflict);
        Assert.Equal("placement_taken", refused["code"]!.GetValue<string>());
        Assert.Contains("Dive Seat Sheet already exists and is not this idea's", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);

        // The refused event was never written: the run stays where it started, and the live app is as it was.
        var run = await RunAsync(compressor);
        Assert.Equal(Division, run["scope"]!.GetValue<string>());
        Assert.DoesNotContain((await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{compressor}/events?after=0&limit=500"))).AsArray(),
            e => e!["payload"]?["step"]?.ToString() == "placement");
        var after = await AppAsync(live);
        Assert.Equal((before["status"]!.ToString(), before["version"]?.ToString(), before["publishedAt"]?.ToString()), (after["status"]!.ToString(), after["version"]?.ToString(), after["publishedAt"]?.ToString()));

        // A new app beside it is accepted, and the run moves there.
        var fresh = await owner.AppAsync(Project, "compressor-service-log", "Compressor Service Log");
        await ControlPlaneApp.Ok(PlaceAsync(compressor, fresh, $"{Project}/compressor-service-log"));
        Assert.Equal($"{Project}/compressor-service-log", (await RunAsync(compressor))["scope"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_app_that_was_published_or_changed_by_other_work_is_never_a_new_builds_even_with_no_build_behind_it()
    {
        // Published by hand, no build ever on it.
        await owner.ProjectAsync(Division, "kit", "Kit");
        var published = await owner.AppAsync("frostaura/community/kit", "web", "Kit");
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{published}/published", new { version = "v1" }));
        var build = await BuildOfAsync("A kit list.");
        Assert.Equal("placement_taken", (await ControlPlaneApp.Expect(await PlaceAsync(build, published, "frostaura/community/kit/web"), HttpStatusCode.Conflict))["code"]!.GetValue<string>());

        // An app a change was asked for (a task run on it) is the app's own work, not a new build's.
        var (live, _) = await LiveAppAsync();
        var change = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{live}/changes", new { request = "Add a depth field." }));
        Assert.Equal($"{Project}/web", change["scope"]!.GetValue<string>());
        var another = await BuildOfAsync("A dive log.");
        Assert.Equal("placement_taken", (await ControlPlaneApp.Expect(await PlaceAsync(another, live, $"{Project}/web"), HttpStatusCode.Conflict))["code"]!.GetValue<string>());

        // An empty app nothing has touched is still placeable: it holds nothing to lose.
        var empty = await owner.AppAsync("frostaura/community/kit", "admin", "Kit admin");
        await ControlPlaneApp.Ok(PlaceAsync(build, empty, "frostaura/community/kit/admin"));
    }

    [Fact]
    public async Task Try_again_finds_the_same_ideas_own_app_even_once_published_but_never_another_ideas()
    {
        await owner.ProjectAsync(Division, "service-log", "Compressor Service Log");
        var own = await owner.AppAsync("frostaura/community/service-log", "web", "Compressor Service Log");
        var first = await BuildOfAsync("A compressor service log.");
        await ControlPlaneApp.Ok(PlaceAsync(first, own, "frostaura/community/service-log/web"));
        // Published, then stopped before it finished (its recurring jobs failed, say).
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{own}/published", new { version = "v1" }));
        await FinishAsync(first, "failed");

        var again = await ControlPlaneApp.Created(owner.PostAsync($"/api/runs/{first}/retry", null));
        var retry = again["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(PlaceAsync(retry, own, "frostaura/community/service-log/web"));
        Assert.Equal("frostaura/community/service-log/web", (await RunAsync(retry))["scope"]!.GetValue<string>());

        // Another idea's build is refused there, now that the first idea's work is on it.
        var other = await BuildOfAsync("A tide table.");
        Assert.Equal("placement_taken", (await ControlPlaneApp.Expect(await PlaceAsync(other, own, "frostaura/community/service-log/web"), HttpStatusCode.Conflict))["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task Every_way_an_idea_starts_builds_from_the_division_and_is_held_to_a_new_app()
    {
        var (live, _) = await LiveAppAsync();
        var runs = new List<(string How, string Run)>();

        // The console's new idea, at the division.
        runs.Add(("console", await BuildOfAsync("A gear checklist.")));

        // A project's conversation (start_idea): proposed to the division the project is in.
        var fromProject = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/ideas", new { scope = Project, text = "A compressor service log.", constraints = Array.Empty<string>() }));
        Assert.Equal(Division, fromProject["idea"]!["scope"]!.GetValue<string>());
        runs.Add(("project conversation", await DecideAsync(fromProject["idea"]!["id"]!.GetValue<string>())));

        // An app's conversation, the same.
        var fromApp = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/ideas", new { scope = $"{Project}/web", text = "A dive buddy finder.", constraints = Array.Empty<string>() }));
        Assert.Equal(Division, fromApp["idea"]!["scope"]!.GetValue<string>());
        runs.Add(("app conversation", await DecideAsync(fromApp["idea"]!["id"]!.GetValue<string>())));

        // A portfolio suggestion asked for at the project, taken ("Take this idea").
        var suggesting = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas/suggestions", new { scope = Project }));
        var suggest = suggesting["run"]!["id"]!.GetValue<string>();
        Assert.Equal(Division, suggesting["run"]!["scope"]!.GetValue<string>());
        await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/runs/{suggest}/suggestions", new { suggestions = new[] { new { title = "Fill log", idea = "Members log each cylinder fill.", gap = "Fills are on paper.", whyUs = "The club already signs members in.", reuses = new[] { "Dive Seat Sheet's members" } } } }));
        var suggestion = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/suggestions?scope={Division}"))).AsArray().Single()!;
        var taken = await ControlPlaneApp.Created(owner.PostAsync($"/api/ideas/suggestions/{suggestion["id"]!.GetValue<string>()}/take", null));
        Assert.Equal(Division, (await RunAsync(taken["runId"]!.GetValue<string>()))["scope"]!.GetValue<string>());
        runs.Add(("suggestion", await DecideAsync(taken["id"]!.GetValue<string>())));

        foreach (var (how, run) in runs)
        {
            Assert.True((await RunAsync(run))["scope"]!.GetValue<string>() == Division, how);
            var refused = await ControlPlaneApp.Expect(await PlaceAsync(run, live, $"{Project}/web"), HttpStatusCode.Conflict);
            Assert.True(refused["code"]!.GetValue<string>() == "placement_taken", how);
        }
    }

    [Fact]
    public async Task A_build_wrongly_placed_in_a_live_app_before_the_rule_leaves_it_untouched_when_it_stops()
    {
        // The stranded run: a build of another idea moved into the live app (as run 9d446743 was), with hires raised for it.
        var (live, _) = await LiveAppAsync();
        var stranded = await BuildOfAsync("A compressor service log for the dive club.");
        var declined = await BuildOfAsync("A tank inspection log.");
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
            var place = await db.Apps.Where(a => a.Id == live).Select(a => new { a.ProjectId }).SingleAsync();
            var division = await db.Projects.Where(p => p.Id == place.ProjectId).Select(p => p.DivisionId).SingleAsync();
            foreach (var id in new[] { Guid.Parse(stranded), Guid.Parse(declined) })
            {
                await db.Runs.Where(r => r.Id == id).ExecuteUpdateAsync(s => s.SetProperty(r => r.DivisionId, division).SetProperty(r => r.ProjectId, place.ProjectId).SetProperty(r => r.AppId, live));
            }
        }

        var before = await AppAsync(live);
        object Hire(string run, string key, string name, string role) => new
        {
            scope = Project,
            trigger = "stage",
            needKey = key,
            reason = "Compressor Service Log is entering its build.",
            name,
            role,
            jobDescription = new { mandate = "Build it.", modelTier = "build" },
            expectedMonthlyCredits = 1500m,
            runId = run,
        };
        var theo = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire(stranded, $"stage:build:{Project}", "Theo", "Software engineer"))))["hire"]!["id"]!.GetValue<string>();
        var nadia = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/hires", Hire(declined, $"stage:evaluate:{Project}", "Nadia", "QA engineer"))))["hire"]!["id"]!.GetValue<string>();

        // The plan is declined: the run fails, and what it raised for the live app is withdrawn, as for any build that built nothing.
        await FinishAsync(stranded, "failed");
        var withdrawn = await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{theo}"));
        Assert.True(withdrawn["withdrawn"]!.GetValue<bool>());
        Assert.Contains("stopped before anything was built", withdrawn["decision"]!["note"]!.GetValue<string>(), StringComparison.Ordinal);

        // One ended behind the platform's back (rows from before the fix) is withdrawn by the sweep.
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
            await db.Runs.Where(r => r.Id == Guid.Parse(declined)).ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, "cancelled").SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow).SetProperty(r => r.LeaseHolder, (string?)null).SetProperty(r => r.LeaseExpiresAt, (DateTimeOffset?)null));
        }

        Assert.Equal(1, (await app.Services.GetRequiredService<LeaseSweep>().SweepOnceAsync(CancellationToken.None)).HiresWithdrawn);
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{nadia}")))["withdrawn"]!.GetValue<bool>());
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "hire");

        // The live app is as it was: its status, its version, its health; its project still reads live, never "not built".
        var after = await AppAsync(live);
        Assert.Equal((before["status"]!.ToString(), before["version"]?.ToString(), before["publishedAt"]?.ToString(), before["health"]?["summary"]?.ToString()),
            (after["status"]!.ToString(), after["version"]?.ToString(), after["publishedAt"]?.ToString(), after["health"]?["summary"]?.ToString()));
        Assert.Null(after["notBuilt"]);
        var project = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray().SelectMany(d => d!["projects"]!.AsArray()).Single(p => p!["slug"]!.GetValue<string>() == "dive-club-tools")!;
        Assert.Equal("live", project["stage"]!.GetValue<string>());
        Assert.Null(project["notBuilt"]);
    }
}
