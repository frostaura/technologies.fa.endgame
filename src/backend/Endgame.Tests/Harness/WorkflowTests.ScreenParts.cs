using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Planning;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// Round three: the real four-part dive-club build (run cafe1c2e) passed part 2 and then failed part 3 — "The trip leader sees
/// a readiness view on their phone showing which divers have packed, with a share link to send to the group" — four checks
/// running, 32 credits, no app. Its requirement r4, "Make the trip leader's readiness view the product and treat the checklist
/// as just its content", is about what a screen leads with: no call to the running app can show it. Every round the evaluator
/// showed it honestly, by the screen's own passing test, and every round the gate refused it because the evidence named no
/// call_app call; the builder was then sent to "repair" a fault in the evaluator's own evidence (it added a refresh button,
/// then rewrote the page), and the fourth check ran out of steps. These tests replay the recorded shapes.
/// </summary>
public sealed partial class WorkflowTests
{
    private const string ReadinessItem = "The trip leader sees a readiness view on their phone showing which divers have packed, with a share link to send to the group.";
    private const string WhoIsReady = "The trip leader sees who is ready";
    private const string ReadinessIsTheProduct = "Make the trip leader's readiness view the product and treat the checklist as just its content";
    private const string LeadsWithReadiness = "leads with readiness, above the share link and the kit list";

    private static PlanContract ReadinessPlan() =>
        new("A packing list for dive trips.",
            [new PlanItem("leader-screens", ReadinessItem, "TripsPage, NewTripPage and TripPage in web/src/trips/",
                "make test passes. Vitest: TripsPage renders trip list with readiness counts; TripPage renders packer list with progress.", ["r3", "r4"])],
            [new PlanRequirement("r3", WhoIsReady), new PlanRequirement("r4", ReadinessIsTheProduct)]);

    // The calls the evaluator really made in round 0 (a few of the 24), and its evidence for r3 and r4, word for word.
    private static readonly string[] Round0Calls =
    [
        "POST api/trips", "GET api/trips", "GET api/trips/01a21861-18a3-7c9d-bc00-1a5a8ebfd8e4",
        "POST api/shared-trips/564bdcb72e9f457d30d25f370c7ba0db/packers",
        "PUT api/shared-trips/564bdcb72e9f457d30d25f370c7ba0db/packers/01a21861-41cd-786a-bdd7-566b4192d9c5/items/01a21861-18a3-7646-85c8-c53b269dac84",
    ];

    private const string Round0R3 = "GET api/trips/01a21861-18a3-7c9d-bc00-1a5a8ebfd8e4 as member-a returns packers array with Ben (12/12 packed) and Cleo (3/12 packed); TripPage renders packer-list with packer-item elements showing name and 'X/Y packed' progress, with 'Ready' badge for complete packers (highlighted with success styling).";
    private const string Round0R4 = "TripPage.tsx renders Readiness component before ShareLink and Checklist components; the packer-list appears first in the DOM, with the checklist as its content below. The test 'leads with readiness, above the share link and the kit list' verifies packer-list.compareDocumentPosition(shareLink) shows packer-list comes before share-link.";
    private const string Round1R4 = "TripPage.tsx lines 29-33: Readiness component renders before ShareLink and Checklist; the 'Who is ready' heading and packer-list come first, with the kit list below as its content. TripPage.test.tsx 'leads with readiness' test verifies packer-list.compareDocumentPosition(shareLink) is DOCUMENT_POSITION_FOLLOWING.";
    private const string Round2R4 = "TripPage renders Readiness component before ShareLink and Checklist (line 31-33 of TripPage.tsx). Test 'leads with readiness, above the share link and the kit list' verifies packer-list.compareDocumentPosition(shareLink) is DOCUMENT_POSITION_FOLLOWING. Readiness summary ('1/2 divers ready') sits above the packer list, and the kit list is below as content.";

    private static JsonObject ReadinessAnswer(string r4, string r3 = Round0R3) => new()
    {
        ["passed"] = true,
        ["evidence"] = "All 31 tests pass (make test exits 0), lint passes (make lint exits 0).",
        ["requirements"] = new JsonArray(new JsonObject { ["id"] = "r3", ["met"] = true, ["evidence"] = r3 }, new JsonObject { ["id"] = "r4", ["met"] = true, ["evidence"] = r4 }),
        ["faults"] = new JsonArray(),
    };

    /// <summary>The app's front-end suite as vitest's JSON reporter prints it, then its trailer line, as the kit's workspace runs it.</summary>
    private static string VitestReport(bool readinessPasses = true) => new JsonObject
    {
        ["numTotalTests"] = 3,
        ["testResults"] = new JsonArray(
            new JsonObject
            {
                ["name"] = "/workspace/web/src/trips/TripPage.test.tsx",
                ["assertionResults"] = new JsonArray(
                    new JsonObject { ["ancestorTitles"] = new JsonArray("TripPage"), ["fullName"] = "TripPage shows the trip, its templates' items and each packer's progress", ["title"] = "shows the trip, its templates' items and each packer's progress", ["status"] = "passed" },
                    new JsonObject { ["ancestorTitles"] = new JsonArray("TripPage"), ["fullName"] = $"TripPage {LeadsWithReadiness}", ["title"] = LeadsWithReadiness, ["status"] = readinessPasses ? "passed" : "failed" }),
            },
            new JsonObject
            {
                ["name"] = "/workspace/web/src/App.test.tsx",
                ["assertionResults"] = new JsonArray(new JsonObject { ["fullName"] = "moving between pages home → “New trip” shows the form", ["title"] = "home → “New trip” shows the form", ["status"] = "passed" }),
            }),
    }.ToJsonString() + "JSON report written to /dev/stdout";

    private static IReadOnlyList<string> Failing(JsonObject gated) => global::Endgame.Harness.Kernel.Json.Strings(gated, "failing");

    private static IReadOnlyList<ScreenTest> Suite(bool readinessPasses = true) => ScreenTests.Parse(VitestReport(readinessPasses), "/workspace");

    [Fact]
    public void A_requirement_about_how_a_screen_presents_something_is_told_apart_from_one_about_data()
    {
        Assert.True(PlanRequirement.IsAboutScreen(ReadinessIsTheProduct));
        Assert.True(PlanRequirement.IsAboutScreen(ReadinessItem));
        Assert.True(PlanRequirement.IsAboutScreen("A diver opens the share link on their phone, enters their name, and ticks off items one by one."));
        Assert.True(PlanRequirement.IsAboutScreen("Show the court list in dark mode"));
        Assert.False(PlanRequirement.IsAboutScreen(WhoIsReady));
        Assert.False(PlanRequirement.IsAboutScreen("Tick off their own kit for a trip"));
        Assert.False(PlanRequirement.IsAboutScreen("Members view their bookings"));
        Assert.False(PlanRequirement.IsAboutScreen("Members add their phone number"));
        // Something people do without signing in is shown signed out, never by a test (R2-11).
        Assert.False(PlanRequirement.IsAboutScreen("Let members open a one-off trip link with no account (the leader signs in, not the members)"));
    }

    [Fact]
    public void The_app_s_tests_are_read_from_vitest_s_report_as_code_ran_them()
    {
        var tests = Suite();
        Assert.Equal(3, tests.Count);
        var leads = Assert.Single(tests, t => t.Title == LeadsWithReadiness);
        Assert.Equal(("web/src/trips/TripPage.test.tsx", true), (leads.File, leads.Passed));
        Assert.Empty(ScreenTests.Parse("vitest: command not found", "/workspace"));
    }

    [Theory]
    [InlineData(Round0R4)]
    [InlineData(Round1R4)]
    [InlineData(Round2R4)]
    public void Each_rounds_real_evidence_names_the_screens_own_test(string evidence)
    {
        var named = ScreenTests.Named(new JsonObject { ["evidence"] = evidence }, Suite());
        Assert.Equal(LeadsWithReadiness, Assert.Single(named).Title);
        // Named the structured way the evaluator is now asked to, too.
        var listed = ScreenTests.Named(new JsonObject { ["evidence"] = "see test", ["tests"] = new JsonArray($"web/src/trips/TripPage.test.tsx > {LeadsWithReadiness}") }, Suite());
        Assert.Equal(LeadsWithReadiness, Assert.Single(listed).Title);
    }

    [Fact]
    public void Part_three_passes_on_the_evidence_it_really_gave_once_code_runs_the_screens_test()
    {
        var plan = ReadinessPlan();
        foreach (var evidence in new[] { Round0R4, Round1R4, Round2R4 })
        {
            // Before: calls alone counted, and the honest evidence for r4 failed every round.
            var before = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(evidence), Round0Calls);
            Assert.False(before["passed"]!.GetValue<bool>());
            Assert.Equal(["r4:unshown"], Failing(before));

            var gated = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(evidence), Round0Calls, null, null, Suite());
            Assert.True(gated["passed"]!.GetValue<bool>(), gated.ToJsonString());
            var r4 = gated["requirements"]!.AsArray().Single(r => r!["id"]!.GetValue<string>() == "r4")!;
            Assert.Equal($"web/src/trips/TripPage.test.tsx > {LeadsWithReadiness}", r4["tests"]![0]!.GetValue<string>());
        }
    }

    [Fact]
    public void A_screen_claim_code_cannot_verify_still_fails()
    {
        var plan = ReadinessPlan();
        // The named test failed when code ran it.
        var failedTest = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(Round0R4), Round0Calls, null, null, Suite(readinessPasses: false));
        Assert.False(failedTest["passed"]!.GetValue<bool>());
        Assert.Contains("did not pass when code ran it", failedTest["faults"]!.ToJsonString(), StringComparison.Ordinal);

        // A test that does not exist, or only the code: nothing code can verify.
        Assert.False(EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer("The test 'puts the readiness list at the very top' verifies it."), Round0Calls, null, null, Suite())["passed"]!.GetValue<bool>());
        Assert.False(EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer("TripPage.tsx renders Readiness first."), Round0Calls, null, null, Suite())["passed"]!.GetValue<bool>());

        // A requirement about data is never shown by a test, however well it passes.
        var dataByTest = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(Round0R4, r3: $"The test '{LeadsWithReadiness}' passes."), Round0Calls, null, null, Suite());
        Assert.False(dataByTest["passed"]!.GetValue<bool>());
        Assert.Equal(["r3:unshown"], Failing(dataByTest));

        // And a screen part whose evaluator never called the running app has shown nothing working.
        Assert.False(EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(Round0R4), [], null, null, Suite())["passed"]!.GetValue<bool>());
    }

    [Fact]
    public void A_refusal_only_of_how_the_work_was_shown_is_checked_again_and_one_of_the_work_is_repaired()
    {
        var plan = ReadinessPlan();
        // r4 marked met, nothing code can verify: the builder cannot repair that, so it is checked again.
        var unshown = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer("TripPage.tsx renders Readiness first."), Round0Calls);
        Assert.True(unshown["recheck"]!.GetValue<bool>());
        // The evaluator found it not working: that is the builder's.
        var answer = ReadinessAnswer(Round0R4);
        answer["passed"] = false;
        answer["requirements"]![1]!["met"] = false;
        var notMet = EvaluationGate.Apply(plan, plan.Items[0], answer, Round0Calls);
        Assert.False(notMet["recheck"]!.GetValue<bool>());
        Assert.Equal(["r4:not-met"], Failing(notMet));
        // The calls listed in a fault are said once per shape, ids folded, not 24 lines of ids.
        Assert.Contains("calls made: POST api/trips, GET api/trips, GET api/trips/{id}, POST api/shared-trips/{id}/packers, PUT api/shared-trips/{id}/packers/{id}/items/{id}", unshown["faults"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public void The_repair_brief_quotes_the_failed_requirement_what_the_checker_saw_and_what_earlier_rounds_did()
    {
        var plan = ReadinessPlan();
        var last = EvaluationGate.Apply(plan, plan.Items[0], ReadinessAnswer(Round1R4), Round0Calls);
        var log = new[]
        {
            new RunEvent(HarnessEvents.ToolRequested, new JsonObject { ["agent"] = "builder-leader-screens-0", ["name"] = "edit_file", ["arguments"] = "{\"path\": \"web/src/trips/TripPage.tsx\"}" }),
            new RunEvent(HarnessEvents.Message, new JsonObject { ["agent"] = "builder-leader-screens-0", ["kind"] = "agent.reply", ["final"] = true, ["reply"] = "Built TripPage with the readiness list first." }),
            new RunEvent(HarnessEvents.Message, new JsonObject { ["agent"] = "builder-other-0", ["kind"] = "agent.reply", ["final"] = true, ["reply"] = "Not this part." }),
        };
        var once = BuildWorkflow.RepairBrief(plan, plan.Items[0], 1, 3, last, [Failing(last)], log);
        Assert.Contains("r4 (\"Make the trip leader's readiness view the product", once, StringComparison.Ordinal);
        Assert.Contains("The checker wrote: \"TripPage.tsx lines 29-33", once, StringComparison.Ordinal);
        Assert.Contains("is about how a screen presents something", once, StringComparison.Ordinal);
        Assert.Contains("make sure one test says exactly this in its title", once, StringComparison.Ordinal);
        Assert.Contains("The build: Built TripPage with the readiness list first.", once, StringComparison.Ordinal);
        Assert.Contains("start there; the rest of the app is as it was): web/src/trips/TripPage.tsx", once, StringComparison.Ordinal);
        Assert.DoesNotContain("Not this part", once, StringComparison.Ordinal);
        Assert.DoesNotContain("same reason", once, StringComparison.Ordinal);

        var twice = BuildWorkflow.RepairBrief(plan, plan.Items[0], 2, 3, last, [Failing(last), Failing(last)], log);
        Assert.Contains("second check running that failed for the same reason (r4:unshown)", twice, StringComparison.Ordinal);
        Assert.Contains("change the approach", twice, StringComparison.Ordinal);
    }

    [Fact]
    public void The_same_failure_three_rounds_running_stops_and_free_form_faults_never_do()
    {
        IReadOnlyList<string> r4 = ["r4:unshown"];
        Assert.False(BuildWorkflow.SameFailureThrice([r4, r4]));
        Assert.True(BuildWorkflow.SameFailureThrice([r4, r4, r4]));
        Assert.False(BuildWorkflow.SameFailureThrice([["r3:not-met"], r4, r4]));
        Assert.True(BuildWorkflow.SameFailureTwice([["r3:not-met"], r4, r4]));
        Assert.False(BuildWorkflow.SameFailureThrice([["item:faults"], ["item:faults"], ["item:faults"]]));
    }

    [Fact]
    public async Task A_check_that_cannot_verify_how_it_was_shown_is_looked_at_again_not_sent_to_the_builder()
    {
        var (cp, ws, dock) = BuildRun();
        // The first check says it works from the tests alone; the second look calls the app and shows it.
        var factory = new Factory { EvaluatorCallsTheApp = n => n != 0 };
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);
        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.DoesNotContain(cp.Types, t => t == "evaluation.failed");
        var first = cp.Events.First(e => e.Type == "evaluation.passed").Payload;
        Assert.True(first["rechecked"]!.GetValue<bool>());
        Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "evaluator-recipes-api-0-recheck");
        // The second look is told what code refused, and is not billed; no builder was sent to repair the evaluator's evidence.
        Assert.Contains(model.Calls, c => c.Repair && c.Messages[1]!["content"]!.GetValue<string>().Contains("This is a second look at the same build", StringComparison.Ordinal));
        Assert.DoesNotContain(model.Calls, c => c.Messages[1]!["content"]!.GetValue<string>().StartsWith("The evaluator checked your work", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_part_that_fails_the_same_way_three_times_stops_before_a_fourth_round()
    {
        var (cp, ws, dock) = BuildRun();
        // Every check says it works and never shows it: the same requirement, unshown, round after round.
        var factory = new Factory { EvaluatorCallsTheApp = _ => false };
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);
        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        var judgements = Judgements(cp, "recipes-api");
        Assert.Equal(["build", "build-t1", "build-t2"], judgements.Select(j => j.Payload["tier"]!.GetValue<string>()));
        Assert.True(judgements[2].Payload["stoppedEarly"]!.GetValue<bool>());
        Assert.True(judgements[2].Payload["final"]!.GetValue<bool>());
        Assert.Null(judgements[2].Payload["repairCharged"]);
        Assert.DoesNotContain(model.Calls, c => c.TaskType == "build-t3");
        var told = cp.Events.Last(e => e.Type == "message" && e.Payload["milestone"]?.GetValue<string>() == "finished").Payload["text"]!.GetValue<string>();
        Assert.Contains("three times in a row for the same reason", told, StringComparison.Ordinal);
        Assert.Contains("“Recipe box for families” could not be shown working in the running app", told, StringComparison.Ordinal);
        // The third round was told to change its approach.
        Assert.Contains(model.Calls, c => c.TaskType == "build-t2" && c.Messages[1]!["content"]!.GetValue<string>().Contains("failed for the same reason", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_check_reports_its_result_once_not_again_as_its_task()
    {
        var (cp, ws, dock) = BuildRun();
        await RunBuildAsync(cp, new Factory().Model(), ws, dock);
        var said = cp.Events.Where(e => e.Type is "evaluation.passed" or "task.done").Select(e => e.Payload["summary"]?.GetValue<string>()).OfType<string>().ToList();
        Assert.Contains(said, s => s.StartsWith("Checked and working:", StringComparison.Ordinal));
        Assert.Equal(said.Count, said.Distinct(StringComparer.Ordinal).Count());
        Assert.Single(said, s => s.StartsWith("Checked and working: Families can keep their recipes", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task In_a_build_code_runs_the_apps_own_tests_for_a_screen_requirement_and_counts_only_a_pass(bool passes)
    {
        const string newestFirst = "leads with the newest recipe, above the list";
        var (cp, ws, dock) = BuildRun("Recipe box for families. Make the newest recipe the first thing on the page.");
        ws.Shell = command => command.Shell == ScreenTests.Command
            ? FakeWorkspace.Ok(new JsonObject
            {
                ["testResults"] = new JsonArray(new JsonObject
                {
                    ["name"] = "/workspace/web/src/recipes/RecipesPage.test.tsx",
                    ["assertionResults"] = new JsonArray(new JsonObject { ["title"] = newestFirst, ["fullName"] = $"RecipesPage {newestFirst}", ["status"] = passes ? "passed" : "failed" }),
                }),
            }.ToJsonString())
            : FakeWorkspace.Ok("");
        var factory = new Factory
        {
            Plan = ([new { id = "recipes", text = "Families keep their recipes, the newest first.", detail = "Recipe entity, api/recipes, RecipesPage", check = "make test; GET api/recipes signed in", covers = new[] { "r1", "r2" }, testIds = new[] { "page-home", "recipe-list", "recipe-item", "set-shared-true" } }],
                [new { id = "r1", text = "Recipe box for families" }, new { id = "r2", text = "Make the newest recipe the first thing on the page" }],
                "A recipe box with the newest recipe first."),
            EvidenceFor = id => id == "r2" ? $"RecipesPage.test.tsx '{newestFirst}' verifies the newest recipe comes first." : null,
        };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.Contains(ws.Commands, c => c.Shell == ScreenTests.Command);
        var first = Judgements(cp, "recipes")[0];
        Assert.Equal(passes ? "evaluation.passed" : "evaluation.failed", first.Type);
        if (passes)
        {
            Assert.Null(first.Payload["rechecked"]);
            var r2 = first.Payload["requirements"]!.AsArray().Single(r => r!["id"]!.GetValue<string>() == "r2")!;
            Assert.Equal($"web/src/recipes/RecipesPage.test.tsx > {newestFirst}", r2["tests"]![0]!.GetValue<string>());
        }
        else
        {
            Assert.Contains("did not pass when code ran it", first.Payload["faults"]!.ToJsonString(), StringComparison.Ordinal);
        }
    }
}
