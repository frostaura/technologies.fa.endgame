using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The final defects lane's control-plane fixes, each held on the real control plane and a real
/// PostgreSQL: God mode logs one entry per visit, not per read.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class FinalDefectsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task Entering_an_organisation_and_then_reading_it_is_one_logged_entry()
    {
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var dean = await app.SignInAsync("dean@frostaura.net");

        // The console enters, then opens the org chart, whose page fires several reads at once.
        await ControlPlaneApp.Ok(dean.PostAsync("/api/operator/organisations/acme/enter", null));
        await ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"));
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme")))
            .Append(ControlPlaneApp.Ok(dean.GetAsync("/api/credits?scope=acme"))));

        var ceo = await app.SignInAsync("ceo@acme.example");
        var entries = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray()
            .Where(e => e!["action"]!.GetValue<string>() == "organisation.entered").ToList();
        Assert.Single(entries);
    }

    [Fact]
    public async Task Reads_with_no_entry_before_them_log_one_entry_even_when_they_arrive_at_once()
    {
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var dean = await app.SignInAsync("dean@frostaura.net");

        // A bookmarked org chart: no explicit entry, a burst of reads. Operator access is never silent, and never doubled.
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"))));

        var ceo = await app.SignInAsync("ceo@acme.example");
        var entries = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray()
            .Where(e => e!["action"]!.GetValue<string>() == "organisation.entered").ToList();
        Assert.Single(entries);
    }

    [Fact]
    public async Task Operator_top_ups_name_the_organisation_by_its_display_name_and_keep_its_address_name()
    {
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme Holdings", slug = "acme", ownerEmail = "ceo@acme.example" }));
        await owner.TopUpAsync("acme", 40m);
        var row = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/operator/top-ups?organisation=acme"))).AsArray())!;
        Assert.Equal("acme", row["organisation"]!.GetValue<string>());
        Assert.Equal("Acme Holdings", row["organisationName"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_app_people_sign_in_to_depends_on_identity_in_the_data_flow_even_with_no_end_users()
    {
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        var members = await owner.AppAsync("frostaura/technologies/squash", "members");
        var invites = await owner.AppAsync("frostaura/technologies/squash", "invites");
        var quiet = await owner.AppAsync("frostaura/technologies/squash", "quiet");

        // A member signs in to a private app: an app session, and no end user anywhere.
        var link = new Uri((await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/app-auth/{members}/handoff", new { })))["url"]!.GetValue<string>());
        await ControlPlaneApp.Ok(app.Internal().PostAsJsonAsync("/internal/access/handoff", new { appId = members, code = System.Web.HttpUtility.ParseQueryString(link.Query)["code"]! }));
        // Another is shared with an address: whoever opens it signs in first.
        await owner.SetAsync("frostaura/technologies/squash/invites", "setting", "access", "shared");
        await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{invites}/shares", new { email = "friend@example.com" }));

        var flow = await ControlPlaneApp.Ok(owner.GetAsync("/api/ontology?scope=frostaura&view=data-flow"));
        bool Uses(Guid appId) => flow["edges"]!.AsArray().Any(e => e!["from"]!.GetValue<string>() == $"app:{appId}" && e["to"]!.GetValue<string>() == "service:identity" && e["type"]!.GetValue<string>() == "depends-on");
        Assert.True(Uses(members));
        Assert.True(Uses(invites));
        Assert.False(Uses(quiet));
        Assert.Contains(flow["edges"]!.AsArray(), e => e!["from"]!.GetValue<string>() == "service:identity" && e["to"]!.GetValue<string>() == $"app:{members}" && e["type"]!.GetValue<string>() == "data-flows-to");
        Assert.Contains(flow["nodes"]!.AsArray(), n => n!["id"]!.GetValue<string>() == "service:identity" && n["type"]!.GetValue<string>() == "service");
    }

    [Fact]
    public async Task An_app_counts_its_registered_end_users_and_not_the_members_who_open_it()
    {
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        var bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        var ladder = await owner.AppAsync("frostaura/technologies/squash", "ladder");
        Assert.Equal(0, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["endUsers"]!.GetValue<int>());

        await owner.SetAsync("frostaura/technologies/squash/bookings", "setting", "access", "public");
        await owner.SetAsync("frostaura/technologies/squash/ladder", "setting", "access", "public");
        foreach (var (appId, slug, email) in new[] { (bookings, "bookings", "one@example.com"), (bookings, "bookings", "two@example.com"), (bookings, "bookings", "one@example.com"), (ladder, "ladder", "three@example.com") })
        {
            await ControlPlaneApp.Ok(app.Client().PostAsJsonAsync($"/api/app-auth/{appId}/development", new { email, returnTo = $"/frostaura/technologies/squash/{slug}/" }));
        }

        // A member opening it is not one of its end users.
        var link = new Uri((await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/app-auth/{bookings}/handoff", new { })))["url"]!.GetValue<string>());
        await ControlPlaneApp.Ok(app.Internal().PostAsJsonAsync("/internal/access/handoff", new { appId = bookings, code = System.Web.HttpUtility.ParseQueryString(link.Query)["code"]! }));

        Assert.Equal(2, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["endUsers"]!.GetValue<int>());
        Assert.Equal(1, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{ladder}")))["endUsers"]!.GetValue<int>());
    }

    private static object Hosting(string id, Guid appId, DateTimeOffset from, DateTimeOffset to, double awakeHours, long memoryMb, long storageMb, long requests) => new
    {
        sampleId = id,
        appId,
        from,
        to,
        awakeSeconds = (long)(awakeHours * 3600),
        memoryBytes = memoryMb * 1024 * 1024,
        storageBytes = storageMb * 1024 * 1024,
        requests,
    };

    [Fact]
    public async Task The_running_cost_of_each_choice_comes_from_the_apps_own_measured_use_and_the_current_prices()
    {
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        var bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        await owner.TopUpAsync("frostaura", 100m);
        var service = app.Internal();

        // Nothing measured: no figures, and it says why.
        var none = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["runningCost"]!;
        Assert.Equal("not-enough-history", none["state"]!.GetValue<string>());
        Assert.Equal(0m, none["measuredHours"]!.GetValue<decimal>());
        Assert.Null(none["sleep"]);
        Assert.Null(none["alwaysOn"]);
        Assert.Contains("24 hours", none["basis"]!.GetValue<string>());

        // Ten hours measured is less than the 24 an estimate needs.
        var now = DateTimeOffset.UtcNow;
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Hosting("dock:a:early", bookings, now.AddHours(-58), now.AddHours(-48), 1, 512, 1024, 0) } }));
        // ... outside the 14-day window, which counts for nothing:
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new { samples = new[] { Hosting("dock:a:old", bookings, now.AddDays(-20), now.AddDays(-20).AddHours(24), 24, 4096, 1024, 0) } }));
        var short_ = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["runningCost"]!;
        Assert.Equal("not-enough-history", short_["state"]!.GetValue<string>());
        Assert.Equal(10m, short_["measuredHours"]!.GetValue<decimal>());
        Assert.Null(short_["sleep"]);

        // Two more days from Dock and Edge: 48 hours measured from the first sample to the last.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/usage/hosting", new
        {
            samples = new[]
            {
                Hosting("dock:a:1", bookings, now.AddHours(-48), now.AddHours(-24), 5, 512, 1024, 0),
                Hosting("dock:a:2", bookings, now.AddHours(-24), now, 2, 256, 2048, 0),
                Hosting("edge:a:2", bookings, now.AddHours(-24), now, 0, 0, 0, 4800),
            },
        }));

        // By hand, over 58 hours (now-58h .. now): awake 1 + 5 + 2 = 8 h; mean memory while awake
        // (1×512 + 5×512 + 2×256) / 8 = 448 MB = 0.4375 GB; storage now 2048 MB = 2 GB; 4800 requests.
        // Sleeps when unused: 8/58 of 720 = 99.3103 awake hours a month.
        //   99.3103 × (0.002 + 0.4375 × 0.004) + 2 × 0.10 + (4800 / 58 × 720) / 1e6 × 0.20
        //   = 0.3724138 + 0.2 + 0.0119172 = 0.5843310 US$ → 58.43 credits at 100 a dollar.
        // Always on: 720 × 0.00375 + 0.2 + 0.0119172 = 2.9119172 US$ → 291.19 credits.
        var cost = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["runningCost"]!;
        Assert.Equal("estimated", cost["state"]!.GetValue<string>());
        Assert.Equal(58m, cost["measuredHours"]!.GetValue<decimal>());
        Assert.Equal(14, cost["windowDays"]!.GetValue<int>());
        Assert.Equal(24, cost["minimumHours"]!.GetValue<int>());
        Assert.Equal(58.43m, cost["sleep"]!["credits"]!.GetValue<decimal>());
        Assert.Equal(99.3m, cost["sleep"]!["awakeHoursPerMonth"]!.GetValue<decimal>());
        Assert.Equal(291.19m, cost["alwaysOn"]!["credits"]!.GetValue<decimal>());
        Assert.Equal(720m, cost["alwaysOn"]!["awakeHoursPerMonth"]!.GetValue<decimal>());
        Assert.Equal(448m, cost["measured"]!["memoryMb"]!.GetValue<decimal>());
        Assert.Equal(2048m, cost["measured"]!["storageMb"]!.GetValue<decimal>());
        Assert.Equal(8m, cost["measured"]!["awakeHours"]!.GetValue<decimal>());
        Assert.Equal(59586m, cost["measured"]!["requestsPerMonth"]!.GetValue<decimal>());
        var sleepBasis = cost["sleep"]!["basis"]!.GetValue<string>();
        Assert.Contains("8 of the 58 hours", sleepBasis);
        Assert.Contains("448 MB", sleepBasis);
        Assert.Contains("2 GB", sleepBasis);
        Assert.Contains("720 hours", cost["alwaysOn"]!["basis"]!.GetValue<string>());
        Assert.Contains("0.2 credits an awake hour", cost["prices"]!.GetValue<string>());
        // This month's actual hosting is far below either: the old figures were not this app's.
        Assert.True(cost["sleep"]!["credits"]!.GetValue<decimal>() < cost["alwaysOn"]!["credits"]!.GetValue<decimal>());

        // The current prices, not configuration's: doubling the awake-hour rate moves both at once.
        var pricing = (await ControlPlaneApp.Ok(owner.GetAsync("/api/operator/pricing")))["pricing"]!.AsObject();
        pricing["hosting"]!["usdPerAwakeHour"] = 0.004m;
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/operator/pricing", pricing));
        var repriced = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["runningCost"]!;
        // 99.3103 × 0.00575 + 0.2 + 0.0119172 = 0.7829517 → 78.30; 720 × 0.00575 + 0.2119172 = 4.3519172 → 435.19.
        Assert.Equal(78.30m, repriced["sleep"]!["credits"]!.GetValue<decimal>());
        Assert.Equal(435.19m, repriced["alwaysOn"]!["credits"]!.GetValue<decimal>());
        Assert.Contains("0.4 credits an awake hour", repriced["prices"]!.GetValue<string>());
    }
}

public sealed class OperatorVisitsTests
{
    [Fact]
    public void A_visit_slides_on_with_each_read_and_ends_after_the_window_without_one()
    {
        var visits = new Endgame.Infrastructure.Access.OperatorVisits();
        var op = Guid.NewGuid();
        var org = Guid.NewGuid();
        var start = new DateTimeOffset(2026, 11, 25, 9, 0, 0, TimeSpan.Zero);
        var window = TimeSpan.FromMinutes(10);

        Assert.False(visits.Continue(op, org, start, window)); // never seen: a new visit
        visits.Seen(op, org, start);
        // A polling org chart: a read every eight minutes for an hour is one visit.
        for (var t = 8; t <= 64; t += 8)
        {
            Assert.True(visits.Continue(op, org, start.AddMinutes(t), window));
        }

        Assert.False(visits.Continue(Guid.NewGuid(), org, start.AddMinutes(64), window)); // another operator
        Assert.False(visits.Continue(op, Guid.NewGuid(), start.AddMinutes(64), window)); // another organisation
        Assert.False(visits.Continue(op, org, start.AddMinutes(64 + 11), window)); // eleven quiet minutes: the next read is a new visit
    }
}
