using System.Text.Json.Nodes;
using Endgame.Ops.Cloudflare;
using Microsoft.Extensions.Logging.Abstractions;

namespace Endgame.Ops.Tests;

/// <summary>The reconciler against <see cref="FakeCloudflare"/>: never the real API.</summary>
public sealed class ReconcilerTests : IAsyncLifetime
{
    private const string Zone = "example.test";
    private const string Console = "endgame.example.test";
    private const string Tunnel = FakeCloudflare.TunnelId + ".cfargotunnel.com";

    private FakeCloudflare fake = null!;
    private HttpClient http = null!;

    public async Task InitializeAsync()
    {
        fake = await FakeCloudflare.StartAsync();
        http = new HttpClient();
    }

    public async Task DisposeAsync()
    {
        http.Dispose();
        await fake.DisposeAsync();
    }

    private CloudflareOptions Options(string? token = FakeCloudflare.Token) => new()
    {
        BaseUrl = fake.BaseUrl,
        ApiToken = token ?? "",
        AccountId = FakeCloudflare.AccountId,
        ZoneId = FakeCloudflare.ZoneId,
        TunnelId = FakeCloudflare.TunnelId,
        Zone = Zone,
        ConsoleHost = Console,
    };

    private CloudflareReconciler Reconciler(CloudflareOptions? options = null)
    {
        options ??= Options();
        return new CloudflareReconciler(new CloudflareClient(http, options), options, TimeProvider.System);
    }

    /// <summary>The founder's zone as it might stand today: a site, mail, a TXT record, a deeper host.</summary>
    private void SeedExistingZone()
    {
        fake.AddRecord("A", Zone, "192.0.2.10", proxied: true);
        fake.AddRecord("CNAME", "www.example.test", Zone, proxied: true, comment: "the marketing site");
        fake.AddRecord("MX", Zone, "mx.mail.example");
        fake.AddRecord("TXT", "_dmarc.example.test", "v=DMARC1; p=none");
        fake.AddRecord("A", "build.ci.example.test", "192.0.2.20");
    }

    [Fact]
    public async Task On_a_fresh_account_the_plan_creates_everything_and_changes_nothing()
    {
        SeedExistingZone();
        var plan = await Reconciler().PlanAsync(default);

        Assert.Empty(fake.Mutations);
        Assert.False(plan.HasConflicts);
        Assert.Contains(plan.Changes, c => c is { Resource: "dns", Action: "create", Target: Console });
        Assert.Contains(plan.Changes, c => c is { Resource: "dns", Action: "create", Target: "*.example.test" });
        Assert.Contains(plan.Changes, c => c is { Resource: "tunnel", Action: "update" });
        Assert.Contains(plan.Changes, c => c is { Resource: "worker", Action: "create" });
        Assert.Contains(plan.Changes, c => c is { Resource: "route", Action: "create", Target: "endgame.example.test/*" });
        Assert.Contains(plan.Changes, c => c is { Resource: "route", Action: "create", Target: "*.example.test/*" });
        // Every other web host gets an excluding route, so the wildcard Worker never fronts it.
        Assert.Contains(plan.Changes, c => c is { Resource: "route", Action: "create", Target: "www.example.test/*" });
        Assert.Contains(plan.Changes, c => c is { Resource: "route", Action: "create", Target: "build.ci.example.test/*" });
        Assert.DoesNotContain(plan.Changes, c => c.Target.StartsWith("_dmarc", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Apply_reaches_the_desired_state_and_a_second_apply_is_a_no_op()
    {
        SeedExistingZone();
        var before = fake.Records.Select(r => r.ToJsonString()).ToList();
        var first = await Reconciler().ApplyAsync(default);

        Assert.True(first.After.InSync, string.Join("\n", first.After.Changes.Select(c => $"{c.Action} {c.Resource} {c.Target}: {c.Detail}")));
        Assert.Equal(1, fake.WorkerUploads);

        var console = fake.Records.Single(r => (string)r["name"]! == Console);
        Assert.Equal("CNAME", (string)console["type"]!);
        Assert.Equal(Tunnel, (string)console["content"]!);
        Assert.True((bool)console["proxied"]!);
        Assert.StartsWith(CloudflareReconciler.ManagedMark, (string)console["comment"]!, StringComparison.Ordinal);
        var wildcard = fake.Records.Single(r => (string)r["name"]! == "*.example.test");
        Assert.Equal(Tunnel, (string)wildcard["content"]!);
        Assert.True((bool)wildcard["proxied"]!);

        var ingress = (JsonArray)fake.TunnelConfig["ingress"]!;
        Assert.Equal(3, ingress.Count);
        Assert.Equal(Console, (string)ingress[0]!["hostname"]!);
        Assert.Equal("*.example.test", (string)ingress[1]!["hostname"]!);
        Assert.All(ingress.Take(2), r => Assert.Equal("http://edge:8080", (string)r!["service"]!));
        Assert.Null(ingress[2]!["hostname"]);
        Assert.Equal("http_status:404", (string)ingress[2]!["service"]!);

        Assert.Equal(CloudflareReconciler.WorkerSource, fake.WorkerSource);
        Assert.Contains(fake.Routes, r => (string)r["pattern"]! == "*.example.test/*" && (string?)r["script"] == "endgame-outage");
        Assert.Contains(fake.Routes, r => (string)r["pattern"]! == "www.example.test/*" && r["script"] is null);

        // Every record that was there before is still there, byte for byte.
        foreach (var original in before)
        {
            Assert.Contains(original, fake.Records.Select(r => r.ToJsonString()));
        }

        var mutationsAfterFirst = fake.Mutations.Count();
        var second = await Reconciler().ApplyAsync(default);
        Assert.Empty(second.Applied);
        Assert.True(second.After.InSync);
        Assert.Equal(mutationsAfterFirst, fake.Mutations.Count());
        Assert.Equal(1, fake.WorkerUploads);
        Assert.True((await Reconciler().PlanAsync(default)).InSync);
    }

    [Fact]
    public async Task An_untagged_record_where_endgame_needs_one_is_a_conflict_and_is_never_touched()
    {
        SeedExistingZone();
        // What the dashboard's "public hostname" button makes: a CNAME to the tunnel with no comment.
        var handMade = fake.AddRecord("CNAME", Console, Tunnel, proxied: true);
        var original = handMade.ToJsonString();

        var plan = await Reconciler().PlanAsync(default);
        var conflict = Assert.Single(plan.Changes, c => c.Action == "conflict");
        Assert.Equal(Console, conflict.Target);
        Assert.Contains("never modified", conflict.Detail);
        Assert.Contains($"{CloudflareReconciler.ManagedMark}: console host", conflict.Detail);

        var refused = await Assert.ThrowsAsync<CloudflarePlanRefusedException>(() => Reconciler().ApplyAsync(default));
        Assert.Contains("nothing was applied", refused.Message);
        Assert.Empty(fake.Mutations);
        Assert.Equal(original, fake.Records.Single(r => (string)r["name"]! == Console).ToJsonString());

        // The founder adopts it by marking it Endgame's; from then on it is managed.
        handMade["comment"] = $"{CloudflareReconciler.ManagedMark}: console host";
        var applied = await Reconciler().ApplyAsync(default);
        Assert.True(applied.After.InSync);
        Assert.DoesNotContain(applied.Applied, c => c.Resource == "dns" && c.Target == Console);
    }

    [Fact]
    public async Task No_request_ever_modifies_or_deletes_a_record_endgame_did_not_create()
    {
        SeedExistingZone();
        fake.AddRecord("CNAME", "old-endgame.example.test", Tunnel, proxied: true, comment: $"{CloudflareReconciler.ManagedMark}: console host");
        fake.AddRecord("A", "shop.example.test", "192.0.2.30", comment: "endgame is not mentioned at the start");
        var foreignIds = fake.Records.Where(r => !((string?)r["comment"] ?? "").StartsWith(CloudflareReconciler.ManagedMark, StringComparison.Ordinal))
            .Select(r => (string)r["id"]!).ToList();

        var result = await Reconciler().ApplyAsync(default);
        Assert.True(result.After.InSync);
        // The stale managed record was removed; nothing foreign was patched or deleted.
        Assert.Contains(result.Applied, c => c is { Resource: "dns", Action: "delete" } && c.Target.Contains("old-endgame", StringComparison.Ordinal));
        Assert.DoesNotContain(fake.Records, r => (string)r["name"]! == "old-endgame.example.test");
        foreach (var (method, path, _) in fake.Mutations.Where(m => m.Path.Contains("/dns_records/", StringComparison.Ordinal)))
        {
            Assert.DoesNotContain(foreignIds, id => path.Contains(id, StringComparison.Ordinal));
            Assert.True(method is "DELETE" or "PATCH");
        }

        Assert.All(foreignIds, id => Assert.Contains(fake.Records, r => (string)r["id"]! == id));
    }

    [Fact]
    public async Task A_managed_record_that_drifted_is_put_back()
    {
        var drifted = fake.AddRecord("CNAME", "*.example.test", "somewhere-else.example.net", proxied: false, comment: $"{CloudflareReconciler.ManagedMark}: organisation subdomains");
        var plan = await Reconciler().PlanAsync(default);
        Assert.Contains(plan.Changes, c => c is { Resource: "dns", Action: "update", Target: "*.example.test" });
        await Reconciler().ApplyAsync(default);
        Assert.Equal(Tunnel, (string)drifted["content"]!);
        Assert.True((bool)drifted["proxied"]!);
    }

    [Fact]
    public async Task Other_hostnames_on_the_tunnel_keep_their_rules_in_order()
    {
        fake.TunnelConfig = new JsonObject
        {
            ["ingress"] = new JsonArray(
                new JsonObject { ["hostname"] = "grafana.example.test", ["service"] = "http://grafana:3000", ["originRequest"] = new JsonObject { ["noTLSVerify"] = true } },
                new JsonObject { ["hostname"] = Console, ["service"] = "http://old-edge:8080" },
                new JsonObject { ["service"] = "http_status:503" }),
            ["warp-routing"] = new JsonObject { ["enabled"] = false },
        };
        var plan = await Reconciler().PlanAsync(default);
        var tunnel = Assert.Single(plan.Changes, c => c.Resource == "tunnel");
        Assert.Contains("1 other hostname rule(s) kept", tunnel.Detail);
        Assert.Contains("the catch-all was http_status:503", tunnel.Detail);

        await Reconciler().ApplyAsync(default);
        var ingress = (JsonArray)fake.TunnelConfig["ingress"]!;
        Assert.Equal(["grafana.example.test", Console, "*.example.test", null], ingress.Select(r => (string?)r!["hostname"]));
        Assert.True((bool)ingress[0]!["originRequest"]!["noTLSVerify"]!);
        Assert.False((bool)fake.TunnelConfig["warp-routing"]!["enabled"]!);
        Assert.Equal(2, fake.TunnelVersion);
    }

    [Fact]
    public async Task A_changed_worker_is_uploaded_again_and_an_unchanged_one_never()
    {
        await Reconciler().ApplyAsync(default);
        Assert.Equal(1, fake.WorkerUploads);
        // Someone uploaded another version by hand: its source mark no longer matches.
        var hash = fake.WorkerBindings!.OfType<JsonObject>().Single(b => (string)b["name"]! == CloudflareReconciler.SourceHashBinding);
        hash["text"] = "0000";
        var plan = await Reconciler().PlanAsync(default);
        Assert.Contains(plan.Changes, c => c is { Resource: "worker", Action: "update" });
        await Reconciler().ApplyAsync(default);
        Assert.Equal(2, fake.WorkerUploads);
    }

    [Fact]
    public async Task Another_workers_route_on_an_endgame_pattern_is_a_conflict()
    {
        fake.Routes.Add(new JsonObject { ["id"] = "r1", ["pattern"] = "*.example.test/*", ["script"] = "someone-elses-worker" });
        var plan = await Reconciler().PlanAsync(default);
        Assert.Contains(plan.Changes, c => c is { Resource: "route", Action: "conflict", Target: "*.example.test/*" });
        await Assert.ThrowsAsync<CloudflarePlanRefusedException>(() => Reconciler().ApplyAsync(default));
        Assert.Empty(fake.Mutations);
    }

    [Fact]
    public async Task With_no_token_nothing_is_called()
    {
        var error = await Assert.ThrowsAsync<CloudflarePlanRefusedException>(() => Reconciler(Options(token: null)).PlanAsync(default));
        Assert.Contains("No Cloudflare API token", error.Message);
        Assert.Empty(fake.Requests);
    }

    [Fact]
    public async Task A_console_host_two_levels_down_is_refused_before_any_call()
    {
        var options = Options();
        options.ConsoleHost = "endgame.apps.example.test";
        var error = await Assert.ThrowsAsync<CloudflarePlanRefusedException>(() => Reconciler(options).PlanAsync(default));
        Assert.Contains("one label directly under", error.Message);
        Assert.Empty(fake.Requests);
    }

    [Fact]
    public async Task A_wrong_token_surfaces_cloudflares_error()
    {
        var error = await Assert.ThrowsAsync<CloudflareException>(() => Reconciler(Options(token: "wrong")).PlanAsync(default));
        Assert.Contains("10000", error.Message);
    }

    [Fact]
    public async Task Records_are_read_across_every_page()
    {
        foreach (var i in Enumerable.Range(0, CloudflareClient.PageSize + 7))
        {
            fake.AddRecord("A", $"host{i}.example.test", "192.0.2.1");
        }

        var records = await new CloudflareClient(http, Options()).ListDnsRecordsAsync(default);
        Assert.Equal(CloudflareClient.PageSize + 7, records.Count);
        Assert.Equal(2, fake.Requests.Count(r => r.Path.Contains("dns_records?page=", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Reserved_hosts_list_every_label_the_zone_already_uses()
    {
        SeedExistingZone();
        await Reconciler().ApplyAsync(default);
        var hosts = new ReservedHosts(new CloudflareClient(http, Options()), Options(), TimeProvider.System, NullLogger<ReservedHosts>.Instance);
        var view = await hosts.GetAsync(default);

        Assert.True(view.Complete);
        Assert.Equal("cloudflare", view.Source);
        Assert.Contains("www", view.Labels);
        Assert.Contains("_dmarc", view.Labels);
        // build.ci.example.test makes ci.example.test exist, so the wildcard would never answer for it.
        Assert.Contains("ci", view.Labels);
        Assert.Contains("endgame", view.Labels);
        Assert.Equal("the console host", view.Reserved.Single(l => l.Label == "endgame").Reason);
        Assert.DoesNotContain("*", view.Labels);
        Assert.Contains("CNAME www.example.test", view.Reserved.Single(l => l.Label == "www").Records);

        // Cached: a second read inside the window does not call Cloudflare again.
        var reads = fake.Requests.Count;
        await hosts.GetAsync(default);
        Assert.Equal(reads, fake.Requests.Count);
    }

    [Fact]
    public async Task Reserved_hosts_without_a_token_say_they_are_incomplete()
    {
        var options = Options(token: null);
        var view = await new ReservedHosts(new CloudflareClient(http, options), options, TimeProvider.System, NullLogger<ReservedHosts>.Instance).GetAsync(default);
        Assert.False(view.Complete);
        Assert.Equal("static", view.Source);
        Assert.Contains("No Cloudflare API token", view.Reason);
        Assert.Contains("www", view.Labels);
        Assert.Contains("endgame", view.Labels);
        Assert.Empty(fake.Requests);
    }
}
