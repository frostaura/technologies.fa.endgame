using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Gateway;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Health;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Sweeps;
using Endgame.Infrastructure.Tree;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The debts recorded after the first lane merges (memory/watch.md), each paid and held by a test:
/// operators from an explicit list with every entry logged for the Owner, one margin factor, peer
/// addresses that do not follow the environment, the sweep, hosting metered as credits, and the
/// overdraft — paused at the limit, restored by a top-up, never charging interest or fees.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ControlPlaneDebtsTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid appId;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter, settings: new Dictionary<string, string?> { ["Sweeps:ReleaseGraceSeconds"] = "0" });
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        appId = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        service = app.Internal();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    [Fact]
    public async Task Operators_come_from_the_explicit_list_only_and_every_entry_is_logged_for_the_owner()
    {
        // A frostaura.net address that is not on the list is nobody special.
        var dev = await app.SignInAsync("dev@frostaura.net");
        Assert.False((await ControlPlaneApp.Ok(dev.GetAsync("/api/me")))["isOperator"]!.GetValue<bool>());
        await ControlPlaneApp.Expect(await dev.PostAsJsonAsync("/api/credits/top-ups", new { organisation = "frostaura", credits = 5 }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await dev.GetAsync("/api/operator/organisations"), HttpStatusCode.Forbidden);
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync("/api/me")))["isOperator"]!.GetValue<bool>());

        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var dean = await app.SignInAsync("dean@frostaura.net");
        Assert.Equal(["acme", "frostaura"], (await ControlPlaneApp.Ok(dean.GetAsync("/api/operator/organisations"))).AsArray().Select(o => o!["slug"]!.GetValue<string>()));
        var entered = await ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"));
        Assert.Equal("admin", entered["viewerRole"]!.GetValue<string>());
        await ControlPlaneApp.Ok(dean.GetAsync("/api/credits?scope=acme"));
        // Someone who is neither a member nor an operator is told the organisation does not exist.
        await ControlPlaneApp.Expect(await dev.GetAsync("/api/tree?organisation=acme"), HttpStatusCode.NotFound);

        var ceo = await app.SignInAsync("ceo@acme.example");
        var log = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray();
        var entries = log.Where(e => e!["action"]!.GetValue<string>() == "organisation.entered").ToList();
        var entry = Assert.Single(entries)!; // two reads in the window are one entry
        Assert.Equal("dean@frostaura.net", entry["operator"]!["email"]!.GetValue<string>());
        Assert.Equal("acme", entry["detail"]!["scope"]!.GetValue<string>());
        Assert.Contains(log, e => e!["action"]!.GetValue<string>() == "organisation.provisioned");

        // Only the Owner reads it: not an operator who entered as Admin, not an Admin of the organisation.
        await ControlPlaneApp.Expect(await dean.GetAsync("/api/audit/operator-access?organisation=acme"), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Ok(ceo.PostAsJsonAsync("/api/members", new { scope = "acme", email = "admin@acme.example", role = "viewer" }));
        var viewer = await app.SignInAsync("admin@acme.example");
        await ControlPlaneApp.Expect(await viewer.GetAsync("/api/audit/operator-access?organisation=acme"), HttpStatusCode.Forbidden);

        // An operator inside their own organisation is a member there, and nothing is logged.
        await ControlPlaneApp.Ok(owner.GetAsync("/api/tree?organisation=frostaura"));
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/audit/operator-access?organisation=frostaura"))).AsArray(),
            e => e!["action"]!.GetValue<string>() == "organisation.entered");
    }

    [Fact]
    public void The_margin_is_one_factor_applied_where_cost_becomes_credits()
    {
        var none = new CreditOptions();
        Assert.Equal(1m, none.Margin);
        Assert.Equal(100m, none.ToCredits(1m));
        var margin = new CreditOptions { Margin = 1.2m, CreditsPerUsd = 100m };
        Assert.Equal(120m, margin.ToCredits(1m));
        Assert.Equal(0.000120m, margin.ToCreditsCeiling(0.000001m));
        Assert.Contains(new CreditOptions { Margin = 0.9m }.Validate(), f => f.Contains("Margin", StringComparison.Ordinal));
        Assert.Empty(app.Services.GetRequiredService<PricingService>().Credits().Validate());

        // A margin below cost stops the host at start.
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("ConnectionStrings:Endgame", "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x");
            b.UseSetting("Credits:Margin", "0.5");
        });
        var refused = Assert.ThrowsAny<Exception>(() => factory.Server);
        Assert.Contains("Margin", refused.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Peer_addresses_are_explicit_settings_whose_defaults_do_not_follow_the_environment()
    {
        // This control plane runs as Development: its peers are still the compose names.
        var peers = app.Services.GetRequiredService<IOptions<ServiceAddresses>>().Value;
        Assert.Equal("http://runner:8080", peers.Runner);
        Assert.Equal("http://dock:8080", peers.Dock);
        Assert.Equal("http://console:8080", peers.Console);
        var probes = StatusOptions.Probes(new ServiceAddresses(), []);
        Assert.Equal(["control-plane", "edge", "runner", "dock", "console", "ops"], probes.Select(p => p.Key));
        Assert.Equal("http://edge:8080/health", probes.Single(p => p.Key == "edge").HealthUrl);
        Assert.Contains(StatusOptions.Probes(new ServiceAddresses { Collector = "http://collector:4318" }, []), p => p.Key == "collector");
        Assert.DoesNotContain(StatusOptions.Probes(new ServiceAddresses { Runner = "" }, []), p => p.Key == "runner");
    }

    [Fact]
    public async Task The_sweep_releases_lapsed_reservations_and_requeues_runs_whose_lease_lapsed()
    {
        await owner.TopUpAsync("frostaura", 10m);
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies", kind = "task", title = "Lapses" })))["id"]!.GetValue<Guid>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/runs/claim", new { holder = "runner-a", leaseSeconds = 1, kinds = new[] { "task" } }));
        var task = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies", runId = run, title = "Held" })))["id"]!.GetValue<Guid>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = task, runId = run, expectedStatus = "todo" }));
        await using (var scope = app.Scope())
        {
            var resolved = await scope.ServiceProvider.GetRequiredService<ScopeResolver>().RequireAsync("frostaura/technologies", CancellationToken.None);
            var admitted = await scope.ServiceProvider.GetRequiredService<CreditLedger>().AdmitAsync(new ReservationRequest(
                new Attribution(resolved.OrganisationId, resolved.DivisionId, null, null, null, run, "frostaura/technologies", null), "chat", "m", 0.5m, 0.005m, true, DateTimeOffset.UtcNow.AddSeconds(1), null), CancellationToken.None);
            Assert.IsType<Admitted>(admitted);
        }

        var sweep = app.Services.GetRequiredService<LeaseSweep>();
        Assert.Equal(new SweepResult(0, 0, 0, 0), await sweep.SweepOnceAsync(CancellationToken.None) with { TelemetryPruned = 0 });
        await Task.Delay(TimeSpan.FromSeconds(1.5));
        var swept = await sweep.SweepOnceAsync(CancellationToken.None);
        Assert.Equal(1, swept.ReservationsReleased);
        Assert.Equal(1, swept.RunsRequeued);
        Assert.Equal(1, swept.TasksReleased);
        Assert.Equal(new SweepResult(0, 0, 0, 0), await sweep.SweepOnceAsync(CancellationToken.None));

        var view = await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{run}"));
        Assert.Equal("queued", view["status"]!.GetValue<string>());
        Assert.Null(view["leaseHolder"]);
        await using var db = new NpgsqlConnection(app.ConnectionString);
        await db.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT (SELECT status FROM tasks), (SELECT note FROM credit_entries WHERE kind = 'release')", db);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("todo", reader.GetString(0));
        Assert.Equal("lapsed with its lease", reader.GetString(1));
        // It is claimable again.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/runs/claim", new { holder = "runner-b", leaseSeconds = 30, kinds = new[] { "task" } }));
    }

    private static object Sample(string id, Guid app, double hours, long memoryMb = 256, long storageMb = 1024, long requests = 1000) => new
    {
        sampleId = id,
        appId = app,
        from = DateTimeOffset.UtcNow.AddHours(-hours),
        to = DateTimeOffset.UtcNow,
        awakeSeconds = (long)(hours * 3600),
        memoryBytes = memoryMb * 1024 * 1024,
        storageBytes = storageMb * 1024 * 1024,
        requests,
    };

    [Fact]
    public async Task Hosting_is_metered_as_credits_once_per_sample_and_budgets_count_it()
    {
        await owner.TopUpAsync("frostaura", 100m);
        var recorded = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("dock-1", appId, 10) } }));
        // 10 h × (0.002 + 0.25 GB × 0.004) + 1 GB × 0.10 × 10/720 + 1000/1e6 × 0.20 = 0.03158889 US$ → 3.158889 credits.
        Assert.Equal(1, recorded["recorded"]!.GetValue<int>());
        Assert.Equal(3.158889m, recorded["credits"]!.GetValue<decimal>());
        var again = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("dock-1", appId, 10) } }));
        Assert.Equal(1, again["duplicates"]!.GetValue<int>());

        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        Assert.Equal(3.158889m, credits["month"]!["hosting"]!.GetValue<decimal>());
        Assert.Equal(0m, credits["month"]!["ai"]!.GetValue<decimal>());
        Assert.Equal(100m - 3.158889m, credits["balance"]!.GetValue<decimal>());
        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}"));
        Assert.Equal(3.158889m, detail["cost"]!["monthCredits"]!.GetValue<decimal>());
        // Ten measured hours are not enough to project a month from (FinalDefectsTests holds the figures).
        Assert.Equal("not-enough-history", detail["runningCost"]!["state"]!.GetValue<string>());

        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("bad", appId, 30) } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("ghost", Guid.NewGuid(), 1) } }), HttpStatusCode.NotFound);

        // A budget above the app counts hosting: spent, the app pauses and its model calls are refused.
        await owner.SetAsync("frostaura/technologies/squash", "budget", "monthly_credits", 3);
        var route = (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]![0]!;
        Assert.True(route["paused"]!.GetValue<bool>());
        Assert.Equal("budget_exhausted", route["pausedReason"]!.GetValue<string>());
        var call = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "hi" } } }), HttpStatusCode.PaymentRequired);
        Assert.Equal("budget_exhausted", call["code"]!.GetValue<string>());
        Assert.Equal("paused", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["running"]!.GetValue<string>());
    }

    [Fact]
    public async Task At_the_overdraft_limit_work_stops_and_apps_pause_a_top_up_restores_them_and_nothing_accrues()
    {
        // FrostAura allows 5; the organisation holds itself to 3. Never deeper than FrostAura's.
        await owner.SetAsync("frostaura", "setting", "overdraft_limit", 5);
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/cascade", new { scope = "frostaura", kind = "setting", key = "overdraft_own_limit", value = 6 }), HttpStatusCode.BadRequest);
        await owner.SetAsync("frostaura", "setting", "overdraft_own_limit", 3);
        await owner.TopUpAsync("frostaura", 1m);

        // Hosting takes the balance below zero; still inside the limit, so nothing stops.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("h-1", appId, 1, memoryMb: 4096, storageMb: 0, requests: 0) } }));
        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        var balance = credits["balance"]!.GetValue<decimal>();
        Assert.True(balance is < 0 and > -3, $"balance {balance}");
        Assert.Equal(5m, credits["overdraft"]!["frostauraLimit"]!.GetValue<decimal>());
        Assert.Equal(3m, credits["overdraft"]!["ownLimit"]!.GetValue<decimal>());
        Assert.False((await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]![0]!["paused"]!.GetValue<bool>());
        await ControlPlaneApp.Ok(Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "hi" } } }));

        // Past the limit: the routing table pauses the organisation's apps and model calls are refused, terminally.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Sample("h-2", appId, 2, memoryMb: 4096, storageMb: 0, requests: 0) } }));
        var route = (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]![0]!;
        Assert.True(route["paused"]!.GetValue<bool>());
        Assert.Equal("overdraft_limit", route["pausedReason"]!.GetValue<string>());
        var before = openRouter.Requests.Count;
        var refused = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "hi" } } }), HttpStatusCode.PaymentRequired);
        Assert.Equal("overdraft_limit", refused["code"]!.GetValue<string>());
        Assert.True(refused["terminal"]!.GetValue<bool>());
        Assert.Equal(before, openRouter.Requests.Count);
        var agent = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", new { taskType = "chat", scope = "frostaura/technologies", messages = new[] { new { role = "user", content = "hi" } } }), HttpStatusCode.PaymentRequired);
        Assert.Equal("overdraft_limit", agent["code"]!.GetValue<string>());

        // No interest, no fees: time passing and the sweep add nothing, and the debt is exactly what was spent.
        var ledgerBefore = await LedgerAsync();
        await Task.Delay(TimeSpan.FromSeconds(1));
        await app.Services.GetRequiredService<LeaseSweep>().SweepOnceAsync(CancellationToken.None);
        var ledgerAfter = await LedgerAsync();
        Assert.Equal(ledgerBefore.Count, ledgerAfter.Count);
        Assert.All(ledgerAfter, e => Assert.Contains(e.Kind, new[] { "top_up", "hosting", "reservation", "settlement", "release" }));
        var spent = ledgerAfter.Where(e => e.Kind is "hosting" or "settlement").Sum(e => e.Amount);
        Assert.Equal(1m - spent, (await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura")))["balance"]!.GetValue<decimal>());

        // A top-up settles the debt first and restores everything at once.
        await owner.TopUpAsync("frostaura", 20m);
        Assert.False((await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]![0]!["paused"]!.GetValue<bool>());
        await ControlPlaneApp.Ok(Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "back" } } }));
        Assert.NotEqual("paused", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["running"]!.GetValue<string>());

        // Only the Owner sets the organisation's own limit; only an operator FrostAura's.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "admin@example.com", role = "admin" }));
        var admin = await app.SignInAsync("admin@example.com");
        await ControlPlaneApp.Expect(await admin.PutAsJsonAsync("/api/cascade", new { scope = "frostaura", kind = "setting", key = "overdraft_own_limit", value = 1 }), HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_platform_roles_hold_connect_on_the_database_themselves()
    {
        await using var db = new NpgsqlConnection(app.ConnectionString);
        await db.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT has_database_privilege('endgame_app', current_database(), 'CONNECT'), has_database_privilege('endgame_system', current_database(), 'CONNECT'), (SELECT datacl::text FROM pg_database WHERE datname = current_database())", db);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.True(reader.GetBoolean(0));
        Assert.True(reader.GetBoolean(1));
        var acl = reader.GetString(2);
        Assert.Contains("endgame_app=c", acl, StringComparison.Ordinal);
        Assert.Contains("endgame_system=c", acl, StringComparison.Ordinal);
    }

    private HttpClient Kit()
    {
        var token = service.PostAsync($"/internal/apps/{appId}/token", null).GetAwaiter().GetResult().Content.ReadFromJsonAsync<JsonObject>().GetAwaiter().GetResult()!["token"]!.GetValue<string>();
        var client = app.Internal();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<List<(string Kind, decimal Amount)>> LedgerAsync()
    {
        await using var db = new NpgsqlConnection(app.ConnectionString);
        await db.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT kind, amount FROM credit_entries ORDER BY created_at", db);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<(string, decimal)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetDecimal(1)));
        }

        return rows;
    }
}
