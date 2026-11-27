using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Platform;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// R5-1: the organisation's conversation said "We run 1 app, which is the Club Reading List" of an organisation whose home
/// read "1 division · 3 projects · 3 apps". Its tools had no read of what is in the tree — the overview's levels are only the
/// path down to the scope, and the 20 most recent runs were mostly chat turns about one app. <c>GET /internal/contents</c>
/// is that read, counted from the same tree document home counts, each app with its state.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ScopeContentsTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Division = "frostaura/community";
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid reading;
    private Guid dive;
    private Guid gear;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        service = app.Internal();
        await owner.DivisionAsync("frostaura", "community", "Community");
        await owner.ProjectAsync(Division, "book-club", "Book Club");
        await owner.ProjectAsync(Division, "dive-trips", "Dive Trips");
        await owner.ProjectAsync(Division, "gear-swap", "Gear Swap");
        reading = await owner.AppAsync($"{Division}/book-club", "web", "Club Reading List");
        dive = await owner.AppAsync($"{Division}/dive-trips", "web", "Dive Trip Ready");
        gear = await owner.AppAsync($"{Division}/gear-swap", "web", "Gear Swap");

        // Two published and live (one asleep, as an idle app is); the third's build was cancelled before anything was built.
        await LiveAsync(reading, "running");
        await LiveAsync(dive, "sleeping");
        var build = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = Division, kind = "build", title = "Build Gear Swap" })))["id"]!.GetValue<string>());
        var runner = new ControlPlaneClient(app.Internal());
        await runner.LeaseAsync(build, "runner-test", 120, CancellationToken.None);
        await runner.AppendAsync(build, null, [new("message", new JsonObject
        {
            ["kind"] = "workflow.step",
            ["step"] = "placement",
            ["data"] = new JsonObject { ["name"] = "Gear Swap", ["division"] = Division, ["projectPath"] = $"{Division}/gear-swap", ["appPath"] = $"{Division}/gear-swap/web", ["appId"] = gear.ToString() },
        })], CancellationToken.None);
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{build}/cancel", null));

        // One employee at the division and one contractor working: home counts the employee, never the contractor.
        var employee = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = Division, name = "Theo", role = "Software engineer", modelTier = "build" })))["id"]!.GetValue<string>());
        var work = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = $"{Division}/book-club/web", kind = "task", title = "Change it" })))["id"]!.GetValue<string>());
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope = $"{Division}/book-club/web", briefedBy = employee, role = "Tester", name = "Tester (contractor)", brief = "Check it.", runId = work }));
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private async Task LiveAsync(Guid id, string state)
    {
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{id}/published", new { version = "v1" }));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{id}/state", new { status = state }));
    }

    [Fact]
    public async Task At_the_organisation_it_counts_every_app_home_counts_each_with_its_state()
    {
        var home = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var contents = await ControlPlaneApp.Ok(service.GetAsync("/internal/contents?scope=frostaura"));

        Assert.Equal(home["organisation"]!["summary"]!.GetValue<string>(), contents["summary"]!.GetValue<string>());
        Assert.StartsWith("1 division · 3 projects · 3 apps · ", contents["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        // Home's employee count (the organisation's standing ones and Theo), never the contractor.
        var employees = int.Parse(contents["summary"]!.GetValue<string>().Split(" · ")[3].Split(' ')[0], System.Globalization.CultureInfo.InvariantCulture);
        var counts = contents["counts"]!;
        Assert.Equal((1, 3, 3, employees, 1), (counts["divisions"]!.GetValue<int>(), counts["projects"]!.GetValue<int>(), counts["apps"]!.GetValue<int>(),
            counts["employees"]!.GetValue<int>(), counts["contractorsWorking"]!.GetValue<int>()));
        var homeApps = home["divisions"]!.AsArray().SelectMany(d => d!["projects"]!.AsArray()).SelectMany(p => p!["apps"]!.AsArray()).Count();
        Assert.Equal(homeApps, counts["apps"]!.GetValue<int>());

        var byState = counts["appsByState"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<int>());
        Assert.Equal(new Dictionary<string, int> { ["live"] = 1, ["sleeping"] = 1, ["never built"] = 1 }, byState);
        var apps = Apps(contents);
        Assert.Equal("live", apps["Club Reading List"]["state"]!.GetValue<string>());
        Assert.Equal("sleeping", apps["Dive Trip Ready"]["state"]!.GetValue<string>());
        Assert.Equal("never built", apps["Gear Swap"]["state"]!.GetValue<string>());
        Assert.Equal("Not built — the build was cancelled.", apps["Gear Swap"]["note"]!.GetValue<string>());
        Assert.Equal("frostaura/community/dive-trips/web", apps["Dive Trip Ready"]["path"]!.GetValue<string>());
    }

    [Fact]
    public async Task Beneath_the_organisation_it_counts_only_what_is_there()
    {
        var division = await ControlPlaneApp.Ok(service.GetAsync($"/internal/contents?scope={Division}"));
        Assert.Null(division["summary"]);
        Assert.Equal((0, 3, 3, 1), (division["counts"]!["divisions"]!.GetValue<int>(), division["counts"]!["projects"]!.GetValue<int>(),
            division["counts"]!["apps"]!.GetValue<int>(), division["counts"]!["employees"]!.GetValue<int>()));

        var project = await ControlPlaneApp.Ok(service.GetAsync($"/internal/contents?scope={Division}/dive-trips"));
        Assert.Equal(["Dive Trip Ready"], Apps(project).Keys);
        Assert.Equal(0, project["counts"]!["employees"]!.GetValue<int>());

        var one = await ControlPlaneApp.Ok(service.GetAsync($"/internal/contents?scope={Division}/book-club/web"));
        Assert.Equal(["Club Reading List"], Apps(one).Keys);
        Assert.Equal((0, 1), (one["counts"]!["employees"]!.GetValue<int>(), one["counts"]!["contractorsWorking"]!.GetValue<int>()));
    }

    [Fact]
    public async Task An_archived_app_is_still_counted_and_says_so()
    {
        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/apps/{gear}", new { status = "archived" }));
        var contents = await ControlPlaneApp.Ok(service.GetAsync("/internal/contents?scope=frostaura"));
        Assert.Equal(3, contents["counts"]!["apps"]!.GetValue<int>());
        Assert.Equal("archived", Apps(contents)["Gear Swap"]["state"]!.GetValue<string>());
    }

    private static Dictionary<string, JsonNode> Apps(JsonNode contents) => contents["divisions"]!.AsArray()
        .SelectMany(d => d!["projects"]!.AsArray()).SelectMany(p => p!["apps"]!.AsArray())
        .ToDictionary(a => a!["name"]!.GetValue<string>(), a => a!);
}
