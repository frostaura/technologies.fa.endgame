using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The control plane's side of trying again (CHG-03, VERD-12), changing a built app (CHG-01), the decision history after
/// "change the idea" (VERD-07) and what a conversation shows before and after a message (TALK-11, TALK-15).
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class TryAgainAndChangesTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        service = app.Internal();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private async Task FinishAsync(string runId, string outcome, params object[] before)
    {
        var events = before.Select(p => (object)new { type = "message", payload = p }).Append(new { type = "run.finished", payload = new { outcome, summary = "Stopped in the test." } }).ToArray();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{runId}/events", new { events }));
    }

    private async Task<JsonArray> EventsAsync(string runId) => (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{runId}/events?after=0&limit=500"))).AsArray();

    [Fact]
    public async Task A_new_verdict_clears_the_decision_keeps_it_in_the_history_and_the_agreed_changes_reach_the_build()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A dive log", constraints = Array.Empty<string>() }));
        var id = idea["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{id}/verdict", VerdictSamples.Valid("change")));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{id}/decision", new { choice = "change", note = "Make it for dive centres." }));

        var second = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{id}/verdict", VerdictSamples.Valid("change")));
        var read = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{id}"));
        Assert.Equal("verdict", read["status"]!.GetValue<string>());
        // The earlier decision no longer blocks this verdict's buttons; it is kept in the history.
        Assert.Null(read["decision"]);
        var history = Assert.Single(read["history"]!.AsArray())!;
        Assert.Equal(("change", "Make it for dive centres.", "The Owner"),
            (history["choice"]!.GetValue<string>(), history["note"]!.GetValue<string>(), history["by"]!.GetValue<string>()));
        Assert.NotNull(second);

        // Building with research's change applied: the owner's note and research's change both reach the build.
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{id}/decision", new { choice = "drop", applyChange = true }), HttpStatusCode.OK);
        var other = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A tide table", constraints = Array.Empty<string>() }));
        var otherId = other["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{otherId}/verdict", VerdictSamples.Valid("change")));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{otherId}/decision", new { choice = "change", note = "Only for one coast." }));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{otherId}/verdict", VerdictSamples.Valid("change")));
        var built = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{otherId}/decision", new { choice = "build", applyChange = true }));
        var buildRun = built["decision"]!["runId"]!.GetValue<string>();
        var message = (await EventsAsync(buildRun)).First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!;
        Assert.Equal(["Only for one coast.", "Lead with sharing between households."], message["changes"]!.AsArray().Select(c => c!.GetValue<string>()));
        Assert.Equal("Lead with sharing between households.", message["appliedChange"]!.GetValue<string>());

        // There is nothing to apply over a build verdict.
        var plain = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A buoy map", constraints = Array.Empty<string>() }));
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{plain["id"]}/verdict", VerdictSamples.Valid("build")));
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/ideas/{plain["id"]}/decision", new { choice = "build", applyChange = true }), HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Research_that_did_not_finish_is_tried_again_once_with_its_estimate_first()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A dive log", constraints = Array.Empty<string>() }));
        var id = idea["id"]!.GetValue<string>();
        var failed = idea["runId"]!.GetValue<string>();
        await FinishAsync(failed, "failed");

        var read = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{id}"));
        Assert.Equal(("research", failed, "failed"), (read["tryAgain"]!["what"]!.GetValue<string>(), read["tryAgain"]!["runId"]!.GetValue<string>(), read["tryAgain"]!["why"]!.GetValue<string>()));
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{failed}")))["canTryAgain"]!.GetValue<bool>());
        var estimate = await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{failed}/retry/estimate", null));
        Assert.Equal("research", estimate["what"]!.GetValue<string>());
        Assert.True(estimate["credits"]!.GetValue<decimal>() > 0);

        var again = await ControlPlaneApp.Created(owner.PostAsync($"/api/runs/{failed}/retry", null));
        Assert.Equal("research", again["kind"]!.GetValue<string>());
        var events = await EventsAsync(again["id"]!.GetValue<string>());
        Assert.Equal(failed, events.First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!["retryOf"]!.GetValue<string>());
        Assert.Contains(events, e => e!["type"]!.GetValue<string>() == "estimate.made");
        var after = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{id}"));
        Assert.Equal(again["id"]!.GetValue<string>(), after["runId"]!.GetValue<string>());
        Assert.Null(after["tryAgain"]);
        // The same stopped research is not tried twice, and the history records the try.
        Assert.False((await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{failed}")))["canTryAgain"]!.GetValue<bool>());
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/runs/{failed}/retry", null), HttpStatusCode.Conflict);
        Assert.Equal("retry", Assert.Single(after["history"]!.AsArray())!["choice"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_stopped_build_is_built_again_priced_for_what_is_left_and_carrying_on_from_the_earlier_attempt()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A dive log", constraints = Array.Empty<string>() }));
        var id = idea["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{id}/verdict", VerdictSamples.Valid("build")));
        var decided = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/ideas/{id}/decision", new { choice = "build" }));
        var build = decided["decision"]!["runId"]!.GetValue<string>();
        // The earlier attempt agreed a two-part plan and finished one part, then was cancelled.
        await FinishAsync(build, "cancelled",
            new { kind = "workflow.step", agent = "workflow", step = "plan", data = new { summary = "A log", items = new[] { new { id = "a", text = "Log a dive." }, new { id = "b", text = "See the log." } } } },
            new { kind = "workflow.step", agent = "workflow", step = "item:a", data = new { passed = true } });

        var read = await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{id}"));
        Assert.Equal(("build", "cancelled"), (read["tryAgain"]!["what"]!.GetValue<string>(), read["tryAgain"]!["why"]!.GetValue<string>()));
        var estimate = await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{build}/retry/estimate", null));
        Assert.Equal((1, 2), (estimate["partsDone"]!.GetValue<int>(), estimate["parts"]!.GetValue<int>()));
        Assert.Equal(10m, estimate["credits"]!.GetValue<decimal>());
        Assert.Contains("Only 1 of its 2 parts are left to build", estimate["basis"]!.GetValue<string>(), StringComparison.Ordinal);

        var again = await ControlPlaneApp.Created(owner.PostAsync($"/api/runs/{build}/retry", null));
        Assert.Equal("build", again["kind"]!.GetValue<string>());
        Assert.Equal(10m, again["estimateCredits"]!.GetValue<decimal>());
        var message = (await EventsAsync(again["id"]!.GetValue<string>())).First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!;
        Assert.Equal((build, "A dive log"), (message["retryOf"]!.GetValue<string>(), message["text"]!.GetValue<string>()));
        Assert.Equal(again["id"]!.GetValue<string>(), (await ControlPlaneApp.Ok(owner.GetAsync($"/api/ideas/{id}")))["decision"]!["runId"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/runs/{build}/retry", null), HttpStatusCode.Conflict);
        // A run still going cannot be "tried again".
        var refused = await ControlPlaneApp.Expect(await owner.PostAsync($"/api/runs/{again["id"]}/retry", null), HttpStatusCode.Conflict);
        Assert.Equal("not_retryable", refused["code"]?.GetValue<string>() ?? refused["type"]?.GetValue<string>()?.Split('/')[^1]);
    }

    [Fact]
    public async Task A_built_app_is_changed_by_a_run_that_shows_its_estimate_first_and_one_change_at_a_time()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "labs");
        await owner.ProjectAsync("frostaura/labs", "dives");
        var appId = await owner.AppAsync("frostaura/labs/dives", "web");
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{appId}/changes", new { request = "Add a depth field." }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "abc123" }));
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{appId}/changes", new { request = " " }), HttpStatusCode.BadRequest);

        var estimate = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/changes/estimate", new { request = "Add a depth field." }));
        Assert.Equal(10m, estimate["credits"]!.GetValue<decimal>());
        var run = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{appId}/changes", new { request = "Add a depth field.\nShow it on each dive." }));
        Assert.Equal(("factory", "Change: Add a depth field.", "frostaura/labs/dives/web", 10m),
            (run["kind"]!.GetValue<string>(), run["title"]!.GetValue<string>(), run["scope"]!.GetValue<string>(), run["estimateCredits"]!.GetValue<decimal>()));
        var message = (await EventsAsync(run["id"]!.GetValue<string>())).First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!;
        Assert.Equal(("change", "Add a depth field.\nShow it on each dive."), (message["kind"]!.GetValue<string>(), message["text"]!.GetValue<string>()));
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{appId}/changes", new { request = "Another change." }), HttpStatusCode.Conflict);

        // A change that stopped can be tried again, as a change.
        await FinishAsync(run["id"]!.GetValue<string>(), "failed");
        Assert.True((await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run["id"]}")))["canTryAgain"]!.GetValue<bool>());
        var again = await ControlPlaneApp.Created(owner.PostAsync($"/api/runs/{run["id"]}/retry", null));
        var retried = (await EventsAsync(again["id"]!.GetValue<string>())).First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!;
        Assert.Equal(("change", run["id"]!.GetValue<string>()), (retried["kind"]!.GetValue<string>(), retried["retryOf"]!.GetValue<string>()));

        // The conversation asks for a change only within its own part of the tree.
        await FinishAsync(again["id"]!.GetValue<string>(), "succeeded");
        var asked = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/apps/changes", new { scope = "frostaura/labs/dives/web", request = "Add a buddy field." }));
        Assert.Equal("task", asked["run"]!["kind"]!.GetValue<string>(), StringComparer.Ordinal);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/apps/changes", new { scope = "frostaura/labs", request = "Add a buddy field." }), HttpStatusCode.BadRequest);
        await FinishAsync(asked["run"]!["id"]!.GetValue<string>(), "failed");
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/runs/{asked["run"]!["id"]}/retry", new { scope = "frostaura/other" }), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_message_shows_what_it_can_cost_first_and_the_conversation_names_who_said_what()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "labs");
        var estimate = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/conversations/estimate", new { scope = "frostaura/labs" }));
        Assert.True(estimate["ceiling"]!.GetValue<decimal>() >= estimate["credits"]!.GetValue<decimal>());
        Assert.Contains("It can never cost more than", estimate["basis"]!.GetValue<string>(), StringComparison.Ordinal);

        var turn = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "What is running here?" }));
        var runId = turn["id"]!.GetValue<string>();
        Assert.Contains(await EventsAsync(runId), e => e!["type"]!.GetValue<string>() == "estimate.made" && e["payload"]!["ceiling"] is not null);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{runId}/events", new
        {
            events = new object[]
            {
                new { type = "message", payload = new { kind = "workflow.step", agent = "workflow", step = "answered", data = new { } } },
                new { type = "message", payload = new { from = "runner", code = "budget_exhausted", text = "The credit budget ran out before a reply could be written." } },
            },
        }));
        var history = (await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura/labs")))["messages"]!.AsArray();
        Assert.Equal(2, history.Count);
        Assert.Equal(("owner", "The Owner"), (history[0]!["from"]!.GetValue<string>(), history[0]!["by"]!.GetValue<string>()));
        Assert.Equal(("runner", "budget_exhausted"), (history[1]!["from"]!.GetValue<string>(), history[1]!["code"]!.GetValue<string>()));
    }
}
