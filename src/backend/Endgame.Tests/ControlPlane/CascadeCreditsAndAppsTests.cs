using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

[Collection(PostgresCollection.Name)]
public sealed class CascadeCreditsAndAppsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid appId;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies", "Technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash", "Squash");
        appId = await owner.AppAsync("frostaura/technologies/squash", "bookings", "Bookings");
        service = app.Internal();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task The_resolver_returns_the_effective_value_and_the_level_that_set_it()
    {
        await owner.SetAsync("frostaura", "context", "house-style", "Plain English.");
        await owner.SetAsync("frostaura", "rule_set", "build", new { signOff = true });
        await owner.SetAsync("frostaura/technologies/squash", "rule_set", "build", new { signOff = false });
        await owner.SetAsync("frostaura/technologies", "secret", "smtp-password", "hunter2");

        var rules = (await ControlPlaneApp.Ok(owner.GetAsync("/api/cascade?scope=frostaura/technologies/squash/bookings&kind=rule_set"))).AsArray();
        var build = Assert.Single(rules)!;
        Assert.Equal("project", build["setAtLevel"]!.GetValue<string>());
        Assert.Equal("frostaura/technologies/squash", build["setAtPath"]!.GetValue<string>());
        Assert.False(build["value"]!["signOff"]!.GetValue<bool>());
        Assert.Equal(["frostaura"], build["overrides"]!.AsArray().Select(o => o!.GetValue<string>()));

        var context = await ControlPlaneApp.Ok(service.GetAsync("/internal/context?scope=frostaura/technologies/squash/bookings"));
        Assert.Equal(4, context["levels"]!.AsArray().Count);
        Assert.Equal("organisation", context["context"]![0]!["setAtLevel"]!.GetValue<string>());
        var secret = Assert.Single(context["secrets"]!.AsArray())!;
        Assert.Equal("smtp-password", secret["key"]!.GetValue<string>());
        Assert.DoesNotContain("hunter2", context.ToJsonString(), StringComparison.Ordinal);
        Assert.Equal("owner", context["permissions"]![0]!["value"]!.GetValue<string>());

        // Removing the narrower value lets the inherited one apply again.
        await ControlPlaneApp.Expect(await owner.DeleteAsync("/api/cascade?scope=frostaura/technologies/squash&kind=rule_set&key=build"), HttpStatusCode.NoContent);
        var inherited = (await ControlPlaneApp.Ok(owner.GetAsync("/api/cascade?scope=frostaura/technologies/squash&kind=rule_set"))).AsArray().Single()!;
        Assert.Equal("organisation", inherited["setAtLevel"]!.GetValue<string>());
    }

    [Fact]
    public async Task Only_a_frostaura_operator_sets_the_organisations_overdraft_and_lower_levels_may_only_tighten_it()
    {
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/cascade", new { scope = "frostaura", kind = "setting", key = "overdraft_limit", value = 20 }));
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/cascade", new { scope = "frostaura/technologies", kind = "setting", key = "overdraft_limit", value = 30 }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/cascade", new { scope = "frostaura/technologies", kind = "setting", key = "overdraft_limit", value = 5 }));

        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura/technologies"));
        Assert.Equal(20m, credits["overdraft"]!["frostauraLimit"]!.GetValue<decimal>());
        Assert.Equal(5m, credits["overdraft"]!["ownLimit"]!.GetValue<decimal>());
        Assert.Equal(5m, credits["available"]!.GetValue<decimal>());
    }

    [Fact]
    public async Task Credits_show_balance_budgets_in_tree_order_and_top_ups()
    {
        await owner.TopUpAsync("frostaura", 25m);
        await owner.SetAsync("frostaura/technologies", "budget", "monthly_credits", 10);
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/technologies/squash", name = "Ada", role = "Builder", monthlyCreditLimit = 4 }));
        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        Assert.Equal("frostaura", credits["scope"]!.GetValue<string>());
        Assert.Equal(25m, credits["balance"]!.GetValue<decimal>());
        Assert.Equal(0m, credits["month"]!["spent"]!.GetValue<decimal>());
        Assert.Null(credits["monthsLeftAtPace"]);
        Assert.Null(credits["estimates"]);
        Assert.Equal(25m, credits["topUps"]![0]!["credits"]!.GetValue<decimal>());

        var budgets = credits["budgets"]!.AsArray();
        Assert.Equal(["organisation", "division", "project", "employee", "app"], budgets.Select(b => b!["level"]!.GetValue<string>()));
        Assert.Equal([0, 1, 2, 3, 3], budgets.Select(b => b!["depth"]!.GetValue<int>()));
        Assert.Equal(10m, budgets[1]!["capCredits"]!.GetValue<decimal>());
        Assert.Null(budgets[0]!["capCredits"]);
        Assert.Equal(4m, budgets[3]!["capCredits"]!.GetValue<decimal>());
        Assert.Equal(appId.ToString(), budgets[4]!["appId"]!.GetValue<string>());

        var viewer = await app.SignInAsync("viewer@example.com");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "viewer@example.com", role = "viewer" }));
        await ControlPlaneApp.Ok(viewer.GetAsync("/api/credits?scope=frostaura"));
        await ControlPlaneApp.Expect(await viewer.PostAsJsonAsync("/api/credits/top-ups", new { organisation = "frostaura", credits = 5 }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await viewer.PutAsJsonAsync("/api/cascade", new { scope = "frostaura", kind = "budget", key = "monthly_credits", value = 1 }), HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task An_app_reports_its_addresses_and_sleep_setting_and_dock_reports_feed_the_routes()
    {
        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}"));
        Assert.Equal("https://endgame.frostaura.net/frostaura/technologies/squash/bookings/", detail["addresses"]!["path"]!.GetValue<string>());
        Assert.Equal("https://frostaura.frostaura.net/technologies/squash/bookings/", detail["addresses"]!["subdomain"]!.GetValue<string>());
        Assert.Equal("sleep", detail["settings"]!["running"]!.GetValue<string>());
        Assert.Equal("private", detail["settings"]!["access"]!.GetValue<string>());
        Assert.Equal("starting", detail["running"]!.GetValue<string>());
        Assert.Null(detail["telemetry"]);

        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "abc123" }));
        var alwaysOn = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { running = "always-on" }));
        Assert.Equal("always-on", alwaysOn["running"]!.GetValue<string>());
        Assert.Equal("always-on", alwaysOn["settings"]!["running"]!.GetValue<string>());
        Assert.Equal("healthy", alwaysOn["health"]!["state"]!.GetValue<string>());
        var unavailable = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { access = "public" }), (HttpStatusCode)422);
        Assert.Equal("access_unavailable", unavailable["code"]!.GetValue<string>());

        var routes = await ControlPlaneApp.Ok(service.GetAsync("/internal/routes"));
        var route = Assert.Single(routes["routes"]!.AsArray())!;
        Assert.Equal("/frostaura/technologies/squash/bookings/", route["pathBase"]!.GetValue<string>());
        Assert.Equal("frostaura.frostaura.net", route["host"]!.GetValue<string>());
        Assert.Equal($"http://app-{appId:N}:8080", route["target"]!.GetValue<string>());
        Assert.Equal("always_on", route["sleep"]!["mode"]!.GetValue<string>());
        Assert.Equal("frostaura/technologies/squash/bookings", route["sleep"]!["modeSetAt"]!.GetValue<string>());
        Assert.Equal("abc123", route["version"]!.GetValue<string>());

        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/state", new { status = "sleeping" }));
        Assert.True((await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]![0]!["sleeping"]!.GetValue<bool>());
    }

    [Fact]
    public async Task The_tree_refuses_bad_slugs_duplicate_siblings_and_deleting_what_has_children()
    {
        var bad = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/divisions", new { parent = "frostaura", name = "X", slug = "X" }), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_request", bad["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/divisions", new { parent = "frostaura", name = "Again", slug = "technologies" }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/projects", new { parent = "frostaura", name = "Misplaced", slug = "misplaced" }), HttpStatusCode.BadRequest);

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var divisionId = tree["divisions"]![0]!["id"]!.GetValue<string>();
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/divisions/{divisionId}"), HttpStatusCode.Conflict);
        var archived = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/divisions/{divisionId}", new { status = "archived", name = "Tech" }));
        Assert.Equal("archived", archived["status"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PatchAsJsonAsync($"/api/divisions/{divisionId}", new { status = "sleeping" }), HttpStatusCode.BadRequest);

        var empty = await owner.DivisionAsync("frostaura", "empty");
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/divisions/{empty}"), HttpStatusCode.NoContent);
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/divisions/{empty}"), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_member_of_one_branch_sees_only_that_branch_and_its_path()
    {
        await owner.DivisionAsync("frostaura", "labs", "Labs");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "ann@example.com", role = "viewer" }));
        var ann = await app.SignInAsync("ann@example.com");
        var tree = await ControlPlaneApp.Ok(ann.GetAsync("/api/tree"));
        Assert.Equal(["labs"], tree["divisions"]!.AsArray().Select(d => d!["slug"]!.GetValue<string>()));
        Assert.Equal("viewer", tree["viewerRole"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await ann.GetAsync($"/api/apps/{appId}"), HttpStatusCode.NotFound);
        await ControlPlaneApp.Expect(await ann.PostAsJsonAsync("/api/projects", new { parent = "frostaura/labs", name = "P", slug = "pp" }), HttpStatusCode.Forbidden);
    }
}
