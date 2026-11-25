using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Platform;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The rest of the platform breadth (TEST-101 and TEST-102): reserved organisation names from the ops
/// service, roles changed where they were set, runs by employee, the owner's notifications, top-up
/// requests and God mode's screens, the prices as a runtime document, and ideas from the portfolio.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class BreadthTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakePeer ops = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid appId;
    private Guid otherAppId;
    private JsonObject reserved = new() { ["complete"] = true, ["labels"] = new JsonArray("www", "mail", "shop") };
    private string cloudflare = "configured";

    public async Task InitializeAsync()
    {
        ops = await FakePeer.StartAsync(routes =>
        {
            routes.MapGet("/internal/ops/reserved-hosts", () => Results.Text(reserved.ToJsonString(), "application/json"));
            routes.MapGet("/health", () => Results.Json(new { status = "healthy", cloudflare = new { state = cloudflare } }));
        });
        app = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?>
        {
            ["Services:Ops"] = ops.BaseUrl,
            // A mail server is "configured", but nothing dispatches in a test: urgent mail waits in the outbox.
            ["Smtp:Host"] = "127.0.0.1",
            ["Smtp:From"] = "endgame@frostaura.net",
        });
        owner = await app.OwnerWithOrganisationAsync();
        service = app.Internal();
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        appId = await owner.AppAsync("frostaura/products/squash", "bookings");
        otherAppId = await owner.AppAsync("frostaura/products/squash", "ladder");
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await ops.DisposeAsync();
    }

    [Fact]
    public async Task Organisation_names_that_frostaura_uses_are_refused_and_an_incomplete_zone_pauses_new_names()
    {
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations", new { name = "Shop", slug = "shop", ownerEmail = "a@example.com", description = Provisioning.Description, screening = Provisioning.Manual }), HttpStatusCode.Conflict);
        Assert.Equal("reserved_name", refused["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations", new { name = "Console", slug = "console", ownerEmail = "a@example.com", description = Provisioning.Description, screening = Provisioning.Manual }), HttpStatusCode.BadRequest);
        var created = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = Provisioning.Description, screening = Provisioning.Manual }));
        Assert.Equal("cloudflare", created["nameCheck"]!["source"]!.GetValue<string>());
        // The hand-over: the code once to the operator, and e-mailed to the Owner because mail is configured.
        Assert.NotNull(created["ownerInvitationCode"]);
        Assert.True(created["invitationEmailed"]!.GetValue<bool>());
        Assert.Equal(1, await ScalarAsync("SELECT count(*) FROM email_messages WHERE app_id IS NULL AND 'ceo@acme.example' = ANY(recipients)"));

        // Cloudflare managed, zone not read: no new name at all.
        reserved = new JsonObject { ["complete"] = false, ["labels"] = new JsonArray("www"), ["reason"] = "Cloudflare did not answer." };
        var paused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations", new { name = "Beta", slug = "beta", ownerEmail = "b@example.com", description = Provisioning.Description, screening = Provisioning.Manual }), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("reserved_names_unavailable", paused["code"]!.GetValue<string>());

        // Cloudflare not managed here: the built-in list, said plainly.
        cloudflare = "idle";
        var local = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Beta", slug = "beta", ownerEmail = "b@example.com", description = Provisioning.Description, screening = Provisioning.Manual }));
        Assert.Equal("built-in", local["nameCheck"]!["source"]!.GetValue<string>());
        Assert.Contains("built-in list", local["nameCheck"]!["note"]!.GetValue<string>(), StringComparison.Ordinal);

        var status = await ControlPlaneApp.Ok(owner.GetAsync("/api/system/status"));
        Assert.Contains(status["services"]!.AsArray(), s => s!["key"]!.GetValue<string>() == "ops");
    }

    private async Task<long> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    [Fact]
    public async Task A_role_is_changed_where_it_was_set_and_admins_are_the_owners_to_make()
    {
        var granted = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/products", email = "maker@example.com", role = "viewer" }));
        var id = granted["member"]!["membershipId"]!.GetValue<string>();
        Assert.False(granted["emailed"]!.GetValue<bool>() && granted["invitationCode"] is null);
        var changed = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/members/{id}", new { role = "builder" }));
        Assert.Equal("builder", changed["member"]!["role"]!.GetValue<string>());
        Assert.Equal("frostaura/products", changed["member"]!["scope"]!.GetValue<string>());

        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "admin@example.com", role = "admin" }));
        var admin = await app.SignInAsync("admin@example.com");
        await ControlPlaneApp.Expect(await admin.PatchAsJsonAsync($"/api/members/{id}", new { role = "admin" }), HttpStatusCode.Forbidden);
        Assert.Equal("viewer", (await ControlPlaneApp.Ok(admin.PatchAsJsonAsync($"/api/members/{id}", new { role = "viewer" })))["member"]!["role"]!.GetValue<string>());
        var members = (await ControlPlaneApp.Ok(owner.GetAsync("/api/members?scope=frostaura"))).AsArray();
        Assert.Contains(members, m => m!["email"]!.GetValue<string>() == "maker@example.com" && m["scope"]!.GetValue<string>() == "frostaura/products");
    }

    [Fact]
    public async Task Runs_are_listed_by_employee_for_the_console()
    {
        var hired = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/products", name = "Ada", role = "Builder" }));
        var employee = hired["id"]!.GetValue<string>();
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/products/squash", kind = "build", title = "Ada's build", employeeId = employee }));
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/products/squash", kind = "build", title = "Someone else's" }));
        var mine = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs?employeeId={employee}&limit=5"))).AsArray();
        Assert.Equal("Ada's build", Assert.Single(mine)!["title"]!.GetValue<string>());
        Assert.Equal(2, (await ControlPlaneApp.Ok(owner.GetAsync("/api/runs?scope=frostaura"))).AsArray().Count);
    }

    private async Task HostingAsync(Guid app, double hours, string id) =>
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new
        {
            samples = new[] { new { sampleId = id, appId = app, from = DateTimeOffset.UtcNow.AddHours(-hours), to = DateTimeOffset.UtcNow, awakeSeconds = hours * 3600, memoryBytes = 0, storageBytes = 0, requests = 0 } },
        }));

    [Fact]
    public async Task The_owner_is_told_what_needs_them_once_per_episode_and_urgent_ones_are_emailed()
    {
        // Prices are a runtime document: a dear hour makes the thresholds easy to reach.
        var pricing = await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/operator/pricing", new
        {
            creditsPerUsd = 100,
            margin = 1.0,
            hosting = new { usdPerAwakeHour = 0.5, usdPerGbHourMemory = 0, usdPerGbMonthStorage = 0, usdPerMillionRequests = 0 },
            defaultAppModelMonthlyCredits = 500,
        }));
        Assert.Equal("stored", pricing["source"]!.GetValue<string>());
        await owner.TopUpAsync("frostaura", 50m);
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/operator/organisations/frostaura/overdraft", new { credits = 120 }));
        await owner.SetAsync("frostaura/products/squash/bookings", "budget", "monthly_credits", 100);

        var sweep = app.Services.GetRequiredService<NotificationSweep>();
        await HostingAsync(appId, 1.7, "dock:t:a:1"); // 85 of 100 at the app; balance -35
        await sweep.RunOnceAsync(CancellationToken.None);
        var feed = await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications"));
        var kinds = feed["notifications"]!.AsArray().Select(n => n!["kind"]!.GetValue<string>()).ToList();
        Assert.Contains("budget.80", kinds);
        Assert.Contains("credits.zero", kinds);
        Assert.DoesNotContain("budget.cap", kinds);

        await HostingAsync(appId, 0.6, "dock:t:a:2"); // 115 of 100; balance -65, past half of 120
        await sweep.RunOnceAsync(CancellationToken.None);
        await HostingAsync(otherAppId, 1.2, "dock:t:b:1"); // balance -125: at the limit
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/state", new { status = "failed" }));
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/products/squash/bookings", kind = "build", title = "Build bookings" })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{run}/events", new
        {
            events = new[] { new { type = "message", payload = (object)new { from = "security-reviewer", kind = "security.review", passed = false, findings = new[] { new { problem = "A secret is logged." } } } } },
        }));
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Publish bookings?", detail = "The plan is ready." }));
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
        {
            scope = "frostaura/products",
            name = "Grace",
            role = "Tester",
            reason = "Nobody tests.",
            expectedMonthlyCredits = 1000000,
            jobDescription = new { mandate = "Test everything." },
        }));
        var raised = await sweep.RunOnceAsync(CancellationToken.None);
        Assert.True(raised >= 4);
        Assert.Equal(0, await sweep.RunOnceAsync(CancellationToken.None)); // once per episode

        feed = await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications"));
        var all = feed["notifications"]!.AsArray();
        kinds = all.Select(n => n!["kind"]!.GetValue<string>()).ToList();
        foreach (var kind in new[] { "budget.80", "budget.cap", "credits.zero", "overdraft.half", "overdraft.limit", "app.crashed", "security.finding", "approval", "hire" })
        {
            Assert.Contains(kind, kinds);
        }

        Assert.Equal(all.Count, feed["unread"]!.GetValue<int>());
        var crash = all.First(n => n!["kind"]!.GetValue<string>() == "app.crashed")!;
        Assert.Equal("urgent", crash["severity"]!.GetValue<string>());
        Assert.NotNull(crash["emailedAt"]);
        Assert.Equal("frostaura/products/squash/bookings", crash["scope"]!.GetValue<string>());
        Assert.Null(all.First(n => n!["kind"]!.GetValue<string>() == "approval")!["emailedAt"]);
        Assert.True(await ScalarAsync("SELECT count(*) FROM email_messages WHERE app_id IS NULL AND 'owner@frostaura.net' = ANY(recipients)") >= 5);

        // Read state is the reader's own; a viewer sees no feed; an admin of another branch sees only theirs.
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/notifications/{crash["id"]!.GetValue<string>()}/read", null), HttpStatusCode.NoContent);
        Assert.Equal(all.Count - 1, (await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications")))["unread"]!.GetValue<int>());
        Assert.Equal(all.Count - 1, (await ControlPlaneApp.Ok(owner.PostAsync("/api/notifications/read-all", null)))["marked"]!.GetValue<int>());
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications?unread=true")))["notifications"]!.AsArray());

        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "viewer@example.com", role = "viewer" }));
        Assert.Empty((await ControlPlaneApp.Ok((await app.SignInAsync("viewer@example.com")).GetAsync("/api/notifications")))["notifications"]!.AsArray());
        await owner.DivisionAsync("frostaura", "labs");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "labs@example.com", role = "admin" }));
        var labs = await ControlPlaneApp.Ok((await app.SignInAsync("labs@example.com")).GetAsync("/api/notifications"));
        Assert.Empty(labs["notifications"]!.AsArray());
    }

    [Fact]
    public async Task An_owner_asks_for_a_top_up_operators_see_it_and_answer_it_and_god_mode_lists_every_organisation()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "admin@example.com", role = "admin" }));
        var admin = await app.SignInAsync("admin@example.com");
        await ControlPlaneApp.Expect(await admin.PostAsJsonAsync("/api/credits/top-up-requests", new { credits = 100, note = "please" }), HttpStatusCode.Forbidden);
        var asked = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/credits/top-up-requests", new { credits = 250, note = "For the launch." }));
        Assert.Equal("open", asked["status"]!.GetValue<string>());
        Assert.Single((await ControlPlaneApp.Ok(admin.GetAsync("/api/credits/top-up-requests"))).AsArray());

        var dev = await app.SignInAsync("dev@frostaura.net");
        await ControlPlaneApp.Expect(await dev.GetAsync("/api/operator/top-up-requests"), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await dev.GetAsync("/api/operator/pricing"), HttpStatusCode.Forbidden);
        var dean = await app.SignInAsync("dean@frostaura.net");
        var open = (await ControlPlaneApp.Ok(dean.GetAsync("/api/operator/top-up-requests?status=open"))).AsArray();
        Assert.Equal(250m, Assert.Single(open)!["credits"]!.GetValue<decimal>());
        var orgs = (await ControlPlaneApp.Ok(dean.GetAsync("/api/operator/organisations"))).AsArray();
        var frostaura = orgs.Single(o => o!["slug"]!.GetValue<string>() == "frostaura")!;
        Assert.Equal(1, frostaura["openTopUpRequests"]!.GetValue<int>());
        Assert.Equal(2, frostaura["apps"]!.GetValue<int>());
        Assert.Equal("in-credit", frostaura["standing"]!.GetValue<string>());

        // Fulfilled by a top-up that names it.
        await ControlPlaneApp.Ok(dean.PostAsJsonAsync("/api/credits/top-ups", new { organisation = "frostaura", credits = 250, note = "Launch", requestId = asked["id"]!.GetValue<string>() }));
        var closed = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/credits/top-up-requests"))).AsArray())!;
        Assert.Equal("fulfilled", closed["status"]!.GetValue<string>());
        Assert.NotNull(closed["topUpEntryId"]);
        var history = (await ControlPlaneApp.Ok(dean.GetAsync("/api/operator/top-ups?organisation=frostaura"))).AsArray();
        Assert.Equal("dean@frostaura.net", history[0]!["byEmail"]!.GetValue<string>());

        // A second request, declined.
        var second = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/credits/top-up-requests", new { credits = 10 }));
        Assert.Equal("declined", (await ControlPlaneApp.Ok(dean.PostAsJsonAsync($"/api/operator/top-up-requests/{second["id"]!.GetValue<string>()}/close", new { status = "declined", note = "Not yet." })))["status"]!.GetValue<string>());

        // Entering, and the deepest overdraft: both logged where the Owner reads them.
        await ControlPlaneApp.Ok(dean.PostAsync("/api/operator/organisations/frostaura/enter", null));
        var summary = await ControlPlaneApp.Ok(dean.PutAsJsonAsync("/api/operator/organisations/frostaura/overdraft", new { credits = 300 }));
        Assert.Equal(300m, summary["overdraft"]!["frostauraLimit"]!.GetValue<decimal>());
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura", credits = 400 }), HttpStatusCode.BadRequest);
        var tighter = await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura", credits = 100 }));
        Assert.Equal(100m, tighter["overdraft"]!["ownLimit"]!.GetValue<decimal>());
        await ControlPlaneApp.Expect(await admin.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura", credits = 50 }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Ok(admin.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura/products", credits = 50 }));
        await ControlPlaneApp.Expect(await admin.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura/products", credits = 150 }), HttpStatusCode.BadRequest);
        var log = (await ControlPlaneApp.Ok(owner.GetAsync("/api/audit/operator-access?organisation=frostaura"))).AsArray().Select(a => a!["action"]!.GetValue<string>()).ToList();
        Assert.Contains("organisation.entered", log);
        Assert.Contains("overdraft.set", log);
        Assert.Contains("topup_request.declined", log);
    }

    [Fact]
    public async Task Prices_change_at_runtime_for_the_next_charge_audited_and_never_below_cost()
    {
        var dean = await app.SignInAsync("dean@frostaura.net");
        var before = await ControlPlaneApp.Ok(dean.GetAsync("/api/operator/pricing"));
        Assert.Equal(1.0m, before["pricing"]!["margin"]!.GetValue<decimal>());
        await ControlPlaneApp.Expect(await dean.PutAsJsonAsync("/api/operator/pricing", new
        {
            creditsPerUsd = 100,
            margin = 0.9,
            hosting = new { usdPerAwakeHour = 0.002, usdPerGbHourMemory = 0.004, usdPerGbMonthStorage = 0.1, usdPerMillionRequests = 0.2 },
            defaultAppModelMonthlyCredits = 500,
        }), HttpStatusCode.BadRequest);
        var after = await ControlPlaneApp.Ok(dean.PutAsJsonAsync("/api/operator/pricing", new
        {
            creditsPerUsd = 100,
            margin = 1.25,
            hosting = new { usdPerAwakeHour = 1.0, usdPerGbHourMemory = 0, usdPerGbMonthStorage = 0, usdPerMillionRequests = 0 },
            defaultAppModelMonthlyCredits = 250,
        }));
        Assert.Equal(1.25m, after["pricing"]!["margin"]!.GetValue<decimal>());
        var change = after["history"]![0]!;
        Assert.Equal("dean@frostaura.net", change["byEmail"]!.GetValue<string>());
        Assert.Equal(1.0m, change["before"]!["margin"]!.GetValue<decimal>());

        // The next hosting charge uses the new rate and margin: one hour at US$1 × 100 × 1.25.
        var charged = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new
        {
            samples = new[] { new { sampleId = "dock:t:p:1", appId, from = DateTimeOffset.UtcNow.AddHours(-1), to = DateTimeOffset.UtcNow, awakeSeconds = 3600, memoryBytes = 0, storageBytes = 0, requests = 0 } },
        }));
        Assert.Equal(125m, charged["credits"]!.GetValue<decimal>());
        await ControlPlaneApp.Ok(dean.PutAsJsonAsync("/api/operator/pricing", before["pricing"]));
    }

    [Fact]
    public async Task Ideas_are_suggested_from_the_portfolio_with_an_estimate_and_one_becomes_an_idea()
    {
        var estimate = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/ideas/suggestions/estimate", new { scope = "frostaura" }));
        Assert.True(estimate["credits"]!.GetValue<decimal>() > 0);
        var started = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas/suggestions", new { scope = "frostaura" }));
        var run = started["run"]!;
        Assert.Equal("suggest", run["kind"]!.GetValue<string>());
        Assert.Equal(estimate["credits"]!.GetValue<decimal>(), run["estimateCredits"]!.GetValue<decimal>());
        var runId = run["id"]!.GetValue<string>();

        var context = await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{runId}/suggestion-context"));
        Assert.Contains(context["products"]!.AsArray(), p => p!["name"]!.GetValue<string>() == "bookings");
        Assert.Equal(5, context["maxSuggestions"]!.GetValue<int>());

        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{runId}/suggestions", new { suggestions = Enumerable.Range(0, 6).Select(i => Suggestion($"Idea {i}")) }), HttpStatusCode.BadRequest);
        var recorded = await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/runs/{runId}/suggestions", new { suggestions = new[] { Suggestion("Court ladder"), Suggestion("Coach booking") } }));
        Assert.Equal(2, recorded.AsArray().Count);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{runId}/suggestions", new { suggestions = new[] { Suggestion("Again") } }), HttpStatusCode.Conflict);

        var listed = (await ControlPlaneApp.Ok(owner.GetAsync("/api/ideas/suggestions?scope=frostaura"))).AsArray();
        Assert.Equal(2, listed.Count);
        var ladder = listed.Single(s => s!["title"]!.GetValue<string>() == "Court ladder")!;
        Assert.Equal(["the bookings app's members"], ladder["reuses"]!.AsArray().Select(r => r!.GetValue<string>()));

        var idea = await ControlPlaneApp.Created(owner.PostAsync($"/api/ideas/suggestions/{ladder["id"]!.GetValue<string>()}/take", null));
        Assert.Equal("researching", idea["status"]!.GetValue<string>());
        Assert.Contains("The gap it fills", idea["text"]!.GetValue<string>(), StringComparison.Ordinal);
        var taken = (await ControlPlaneApp.Ok(owner.GetAsync("/api/ideas/suggestions?scope=frostaura"))).AsArray().Single(s => s!["title"]!.GetValue<string>() == "Court ladder")!;
        Assert.Equal("taken", taken["status"]!.GetValue<string>());
        Assert.Equal(idea["id"]!.GetValue<string>(), taken["ideaId"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/ideas/suggestions/{ladder["id"]!.GetValue<string>()}/take", null), HttpStatusCode.Conflict);
        var coach = listed.Single(s => s!["title"]!.GetValue<string>() == "Coach booking")!["id"]!.GetValue<string>();
        Assert.Equal("dismissed", (await ControlPlaneApp.Ok(owner.PostAsync($"/api/ideas/suggestions/{coach}/dismiss", null)))["status"]!.GetValue<string>());
    }

    private static object Suggestion(string title) => new
    {
        title,
        idea = $"{title}: a feature for the club's members.",
        gap = "Members cannot find partners at their level.",
        whyUs = "We already run the club's bookings and know its members.",
        reuses = new[] { "the bookings app's members" },
    };
}
