using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

[Collection(PostgresCollection.Name)]
public sealed class IdeasAndConversationsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        service = app.Internal();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private static object Verdict(string outcome) => new
    {
        outcome,
        headline = "Others already do this",
        summary = "Three products cover it; demand evidence is thin.",
        existing = new[] { new { name = "Rival", description = "Does it", url = (string?)"https://rival.example" } },
        gap = new[] { "No cascade" },
        demand = new { paragraphs = new[] { "Few people asked." }, evidenceFound = false },
        wouldChange = (object?)null,
        method = "Searched the web.",
    };

    [Fact]
    public async Task The_estimate_is_free_and_works_before_an_organisation_exists()
    {
        var person = await app.SignInAsync();
        var estimate = await ControlPlaneApp.Ok(person.PostAsJsonAsync("/api/ideas/estimate", new { text = "A booking app for squash courts", constraints = new[] { "Members only" } }));
        Assert.True(estimate["credits"]!.GetValue<decimal>() > 0);
        Assert.False(string.IsNullOrWhiteSpace(estimate["basis"]!.GetValue<string>()));
        var problem = await ControlPlaneApp.Expect(await person.PostAsJsonAsync("/api/ideas", new { text = "x", constraints = Array.Empty<string>() }), HttpStatusCode.Conflict);
        Assert.Equal("no_organisation", problem["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_idea_queues_research_its_verdict_needs_the_owner_and_building_over_a_no_takes_an_overrule()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        var estimate = (await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/ideas/estimate", new { text = "Squash bookings\nwith minutes", constraints = new[] { "Members only", "Mobile first" } })))["credits"]!.GetValue<decimal>();
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "Squash bookings\nwith minutes", constraints = new[] { "Members only", "Mobile first" } }));
        var ideaId = idea["id"]!.GetValue<string>();
        Assert.Equal("Squash bookings", idea["title"]!.GetValue<string>());
        Assert.Equal(["Members only", "Mobile first"], idea["constraints"]!.AsArray().Select(c => c!.GetValue<string>()));
        Assert.Equal("researching", idea["status"]!.GetValue<string>());
        Assert.Equal(estimate, idea["research"]!["estimatedCredits"]!.GetValue<decimal>());
        Assert.Null(idea["verdict"]);
        Assert.Null(idea["decision"]);
        var runId = idea["runId"]!.GetValue<string>();

        var run = await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{runId}"));
        Assert.Equal("research", run["kind"]!.GetValue<string>());
        Assert.Equal("queued", run["status"]!.GetValue<string>());
        Assert.Equal(ideaId, run["ideaId"]!.GetValue<string>());
        Assert.Equal(estimate, run["estimateCredits"]!.GetValue<decimal>());
        var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{runId}/events"))).AsArray();
        Assert.Equal(["message", "estimate.made"], events.Select(e => e!["type"]!.GetValue<string>()));

        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "build" }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{ideaId}/verdict", Verdict("do_not_build")));

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        var need = Assert.Single(tree["needsYou"]!.AsArray())!;
        Assert.Equal("verdict", need["kind"]!.GetValue<string>());
        Assert.Equal("do-not-build", need["verdict"]!.GetValue<string>());

        var withVerdict = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{ideaId}"));
        Assert.Equal("verdict", withVerdict["status"]!.GetValue<string>());
        Assert.Equal("do-not-build", withVerdict["verdict"]!["outcome"]!.GetValue<string>());
        Assert.Equal("Rival", withVerdict["verdict"]!["existing"]![0]!["name"]!.GetValue<string>());
        Assert.Equal(1, withVerdict["record"]!["doNotBuild"]!.GetValue<int>());

        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "build" }), HttpStatusCode.Conflict);
        Assert.Contains("overrule", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);

        var decided = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "overrule" }));
        Assert.Equal("decided", decided["status"]!.GetValue<string>());
        Assert.Equal("overrule", decided["decision"]!["choice"]!.GetValue<string>());
        Assert.True(decided["decision"]!["overruled"]!.GetValue<bool>());
        Assert.Equal("The Owner", decided["decision"]!["by"]!.GetValue<string>());
        var buildRun = decided["decision"]!["runId"]!.GetValue<string>();
        Assert.Equal("build", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{buildRun}")))["kind"]!.GetValue<string>());
        var overruled = Assert.Single(decided["record"]!["overruled"]!.AsArray())!;
        Assert.Equal(ideaId, overruled["ideaId"]!.GetValue<string>());
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray());
    }

    [Fact]
    public async Task Change_runs_the_research_again_and_drop_ends_it()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        var ideaId = (await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A diary", constraints = Array.Empty<string>() })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{ideaId}/verdict", Verdict("change")));
        var changed = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "change" }));
        Assert.Equal("researching", changed["status"]!.GetValue<string>());
        Assert.Null(changed["verdict"]);
        Assert.Equal(changed["runId"]!.GetValue<string>(), changed["decision"]!["runId"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "drop" }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{ideaId}/verdict", Verdict("build")));
        var dropped = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{ideaId}/decision", new { choice = "drop" }));
        Assert.Equal("decided", dropped["status"]!.GetValue<string>());
        Assert.Null(dropped["decision"]!["runId"]);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/ideas/{ideaId}/verdict", Verdict("weird")), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_conversation_persists_per_scope_and_returns_runs()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "labs");
        var empty = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura/labs"));
        Assert.Null(empty["conversationId"]);
        Assert.Empty(empty["messages"]!.AsArray());

        var first = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "What is running here?" }));
        Assert.Equal("conversation", first["kind"]!.GetValue<string>());
        Assert.Equal("queued", first["status"]!.GetValue<string>());
        // The Runner replies into the run's log.
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{first["id"]!.GetValue<string>()}/events", new
        {
            events = new[] { new { type = "message", payload = new { from = "employee", text = "Nothing yet." } } },
        }));
        var second = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Then plan something." }));
        Assert.Equal(first["conversationId"]!.GetValue<string>(), second["conversationId"]!.GetValue<string>());

        var history = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura/labs"));
        Assert.Equal(first["conversationId"]!.GetValue<string>(), history["conversationId"]!.GetValue<string>());
        Assert.Equal(["What is running here?", "Nothing yet.", "Then plan something."], history["messages"]!.AsArray().Select(m => m!["text"]!.GetValue<string>()));
        Assert.Equal(["owner", "employee", "owner"], history["messages"]!.AsArray().Select(m => m!["from"]!.GetValue<string>()));

        // Another scope has its own conversation.
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura")))["messages"]!.AsArray());
    }
}
