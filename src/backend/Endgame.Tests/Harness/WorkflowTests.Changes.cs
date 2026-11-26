using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Runner;
using Endgame.Runner.Execution;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// The factory's second chances and second thoughts (CHG-01 to CHG-05, VERD-06, TALK-05, TALK-15): changing a built app
/// through the build's own stages, trying stopped work again from where it stopped, the agreed change reaching the planner,
/// and the conversation answered as the employee it is with.
/// </summary>
public sealed partial class WorkflowTests
{
    private const string RatingsRequest = "Members can rate each recipe from one to five stars.";

    private const string Progress = """
        # Progress

        - [x] **recipes-api** — Families can keep their recipes in one place. Checked: GET api/recipes as member-a → 200
        - [x] **recipes-page** — Households can share their recipes with each other. Checked: the share button works
        """;

    private static (object[] Items, object[] Requirements, string Summary) Ratings() => (
        [new { id = "ratings", text = "Members can rate each recipe.", detail = "A Rating entity and POST api/recipes/{id}/ratings", check = "make test passes RatingsTests; POST api/recipes/1/ratings signed in returns 201", covers = new[] { "r1" } }],
        [new { id = "r1", text = "rate each recipe from one to five stars" }],
        "Members can give each recipe one to five stars.");

    private static (FakeControlPlane Cp, FakeWorkspace Ws, FakeDock Dock) ChangeRun(string request = RatingsRequest)
    {
        var cp = new FakeControlPlane("frostaura/technologies/recipes/web", "task") { Headroom = 1000m };
        cp.Append("message", new JsonObject { ["from"] = "owner", ["kind"] = "change", ["text"] = request });
        var ws = new FakeWorkspace().With("api/Program.cs", "var api = app.UseEndgameApp();\napi.MapNotes();\napp.Run();\n").With("AGENTS.md", "# AGENTS\n").With(BuildWorkflow.ProgressFile, Progress);
        return (cp, ws, new FakeDock());
    }

    private static Task RunChangeAsync(FakeControlPlane cp, ScriptedModel model, FakeWorkspace ws, FakeDock dock)
    {
        var options = new RunnerOptions();
        var factory = new BuildWorkflow(new Estimator(options), new StubProbe(), new StubCaller());
        return EstimateTests.Executor(cp, model, ws, [new TaskWorkflow(factory)], dock, options).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
    }

    [Fact]
    public async Task A_change_is_screened_planned_from_the_request_built_checked_with_what_worked_before_reviewed_and_republished()
    {
        var (cp, ws, dock) = ChangeRun();
        var factory = new Factory { Plan = Ratings() };
        var model = factory.Model();
        await RunChangeAsync(cp, model, ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        // The red lines are screened, research is not repeated, and nothing is placed: the app already exists.
        Assert.Equal(1, factory.Screens);
        Assert.DoesNotContain(model.Calls, c => c.TaskType == "research");
        Assert.DoesNotContain(cp.Requests, r => r == "POST /internal/tree/nodes");
        // The plan quotes the request, and code adds the check of everything the app did before, one requirement per part.
        var plan = cp.Payload("plan.accepted")!;
        Assert.Contains(plan["requirements"]!.AsArray(), r => r!["text"]!.GetValue<string>() == "Rate each recipe from one to five stars");
        var keep = plan["items"]!.AsArray().Single(i => i!["id"]!.GetValue<string>() == BuildWorkflow.KeepItem)!;
        Assert.Equal(["k1", "k2"], keep["covers"]!.AsArray().Select(c => c!.GetValue<string>()));
        Assert.Contains(plan["requirements"]!.AsArray(), r => r!["id"]!.GetValue<string>() == "k1" && r["text"]!.GetValue<string>() == "Families can keep their recipes in one place");
        // Each part is checked by the evaluator on a preview; the old parts are checked again, with nothing built for them first.
        Assert.Equal(["ratings", BuildWorkflow.KeepItem], cp.Events.Where(e => e.Type == "evaluation.passed").Select(e => e.Payload["item"]!.GetValue<string>()));
        Assert.DoesNotContain(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == $"builder-{BuildWorkflow.KeepItem}-0");
        Assert.Equal(2, dock.Previews.Count);
        // R2-4: previews are of the run's own branch; the work reaches the app's line once, at publish, titled with what was asked.
        Assert.All(dock.Builds.Take(2), b => Assert.Equal(Endgame.Hosting.Contracts.RunBranches.Of(cp.RunId), b));
        Assert.Equal("c0020000", dock.Builds[^1]);
        Assert.Equal(cp.Run["title"]!.GetValue<string>().Replace("Change: ", "", StringComparison.Ordinal), Assert.Single(dock.Published)["title"]!.GetValue<string>());
        // Reviewed, then the new version is built and the app restarted.
        Assert.Equal(1, factory.Reviews);
        Assert.Single(dock.Starts);
        Assert.Contains(cp.Events, e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "New version running");
        // The progress file gains the change's part under a key of its own, so the build's ids are never hidden.
        Assert.Matches(@"\*\*[0-9a-f]{8}-ratings\*\* — Members can rate each recipe\.", ws.Text(BuildWorkflow.ProgressFile));
        AssertMessagesAreForPeople(cp);
    }

    [Fact]
    public void What_worked_before_is_read_from_the_factorys_lines_and_from_a_builders_own_notes()
    {
        // As a live build left it: the builder kept PROGRESS.md in its own words; the factory added its lines for a change.
        const string progress = """
            # Progress

            ## Done

            - **counter-api** — `api/Counters/` holds the `Counter` entity and its endpoints,
              covered by `CountersApiTests`.
            - **reset-counter** — `POST api/counters/{id}/reset`.

            - [x] **78cc3e94-reset-counter** — A signed-in member can reset any counter's total back to zero. Checked: POST api/counters/1/reset → 201
            """;
        var earlier = BuildWorkflow.EarlierWork(progress);
        Assert.Equal(["A signed-in member can reset any counter's total back to zero", "Part 2 of what was built before still works, as its note describes"],
            earlier["parts"]!.AsArray().Select(p => p!.GetValue<string>()));
        var note = Assert.Single(earlier["notes"]!.AsArray())!.GetValue<string>();
        Assert.StartsWith("k2 (counter-api): `api/Counters/` holds the `Counter` entity and its endpoints, covered by `CountersApiTests`.", note, StringComparison.Ordinal);
        var plan = BuildWorkflow.WithKeep(new Endgame.Harness.Planning.PlanContract("S", [new Endgame.Harness.Planning.PlanItem("a", "A thing.", "d", "c", ["r1"])], [new Endgame.Harness.Planning.PlanRequirement("r1", "a thing")]), earlier);
        Assert.Contains("k2 (counter-api)", plan.Items[^1].Detail, StringComparison.Ordinal);
        Assert.True(Endgame.Harness.Events.OwnerText.IsPlain(plan.Requirements[^1].Text));
    }

    [Fact]
    public async Task A_change_that_breaks_what_worked_before_is_repaired_unbilled_before_it_is_published()
    {
        var (cp, ws, dock) = ChangeRun();
        // The change passes; the first check of the old parts fails; the repair passes.
        var factory = new Factory { Plan = Ratings(), EvaluationPasses = n => n != 1 };
        var model = factory.Model();
        await RunChangeAsync(cp, model, ws, dock);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        var failed = cp.Payload("evaluation.failed")!;
        Assert.Equal(BuildWorkflow.KeepItem, failed["item"]!.GetValue<string>());
        Assert.False(failed["repairCharged"]!.GetValue<bool>());
        var repairs = model.Calls.Where(c => c.Messages[1]!["content"]!.GetValue<string>().StartsWith("The evaluator checked your work", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(repairs);
        Assert.All(repairs, c => Assert.Equal(("build-t1", true), (c.TaskType, c.Repair)));
        Assert.Single(dock.Starts);
    }

    [Fact]
    public async Task A_change_over_a_red_line_changes_nothing()
    {
        var (cp, ws, dock) = ChangeRun("Track where each member goes all day, without telling them.");
        var factory = new Factory { ScreenReply = """{"breached": true, "line": "surveillance", "reasoning": "It watches people against their interest."}""" };
        var model = factory.Model();
        await RunChangeAsync(cp, model, ws, dock);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(0, factory.Plans);
        Assert.Empty(dock.Previews);
        Assert.Empty(dock.Starts);
        Assert.Contains("crosses a red line (surveillance)", cp.Events.Last(e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "Stopped").Payload["text"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_build_tried_again_keeps_its_placement_plan_and_finished_parts_and_builds_only_the_rest()
    {
        // The first attempt: the first part passes, the second never does, so the build stops.
        var (first, ws, dock) = BuildRun();
        var factory = new Factory { EvaluationPasses = n => n == 0 };
        await RunBuildAsync(first, factory.Model(), ws, dock);
        Assert.Equal("failed", first.Run["status"]!.GetValue<string>());
        Assert.Contains("“Try again” carries on from it", first.Events.Last(e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "Stopped").Payload["text"]!.GetValue<string>(), StringComparison.Ordinal);

        // The second attempt carries on from the first.
        var (again, _, _) = BuildRun();
        again.Events.Clear();
        again.Append("message", new JsonObject { ["from"] = "owner", ["text"] = "Recipe box for families\nShare recipes between households.", ["constraints"] = "", ["retryOf"] = first.RunId.ToString() });
        again.EarlierRuns[first.RunId] = [.. first.Events];
        factory.EvaluationPasses = _ => true;
        var model = factory.Model();
        await RunBuildAsync(again, model, ws, dock);

        Assert.Equal("succeeded", again.Run["status"]!.GetValue<string>());
        Assert.Equal(1, factory.Plans);
        Assert.DoesNotContain(again.Requests, r => r == "POST /internal/tree/nodes");
        Assert.Equal("earlier-attempt", again.Payload("plan.accepted")!["by"]!.GetValue<string>());
        Assert.Equal(["recipes-api"], again.Events.Single(e => e.Payload["kind"]?.GetValue<string>() == "plan.carried").Payload["items"]!.AsArray().Select(i => i!.GetValue<string>()));
        // The finished part is neither built nor checked again, so it is not billed twice.
        Assert.DoesNotContain(again.Events, e => e.Payload["agent"]?.GetValue<string>()?.StartsWith("builder-recipes-api", StringComparison.Ordinal) == true);
        Assert.Equal(["recipes-page"], again.Events.Where(e => e.Type == "evaluation.passed").Select(e => e.Payload["item"]!.GetValue<string>()));
        Assert.Contains("1 of 2 parts were already built and checked", again.Events.Single(e => e.Payload["title"]?.GetValue<string>() == "Carrying on").Payload["text"]!.GetValue<string>(), StringComparison.Ordinal);
        // Not priced again as if nothing were built: the try's own estimate stands.
        Assert.DoesNotContain(again.Events, e => e.Type == "estimate.made" && e.Payload["basis"]?.GetValue<string>() == "plan");
    }

    [Fact]
    public async Task A_declined_plan_says_so_and_a_try_again_plans_afresh()
    {
        var (first, ws, dock) = BuildRun();
        first.Setting("autonomy", JsonValue.Create("checkpoints"));
        first.Setting("checkpoint.plan", JsonValue.Create(true));
        first.AnswerApproval = title => title == "Accept this plan?" ? false : true;
        first.ApprovalNote = "Leave sharing out for now.";
        var factory = new Factory();
        await RunBuildAsync(first, factory.Model(), ws, dock);

        Assert.Equal("failed", first.Run["status"]!.GetValue<string>());
        Assert.Equal("stops", first.ApprovalsAsked.Single(a => a["title"]!.GetValue<string>() == "Accept this plan?")["onDecline"]!.GetValue<string>());
        var stopped = first.Events.Last(e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "Stopped").Payload["text"]!.GetValue<string>();
        Assert.Contains("You declined the plan, so nothing was built", stopped, StringComparison.Ordinal);
        Assert.Contains("Leave sharing out for now.", stopped, StringComparison.Ordinal);

        var (again, _, _) = BuildRun();
        again.Events.Clear();
        again.Append("message", new JsonObject { ["from"] = "owner", ["text"] = "Recipe box for families\nShare recipes between households.", ["constraints"] = "", ["retryOf"] = first.RunId.ToString() });
        again.EarlierRuns[first.RunId] = [.. first.Events];
        await RunBuildAsync(again, factory.Model(), ws, dock);
        Assert.Equal("succeeded", again.Run["status"]!.GetValue<string>());
        Assert.Equal(2, factory.Plans);
    }

    [Fact]
    public async Task The_change_agreed_after_research_is_part_of_what_the_planner_is_held_to()
    {
        var (cp, ws, dock) = BuildRun();
        cp.Events.Clear();
        cp.Append("message", new JsonObject
        {
            ["from"] = "owner",
            ["text"] = "Recipe box for families\nShare recipes between households.",
            ["constraints"] = "",
            ["changes"] = new JsonArray("Add a shopping list made from a recipe."),
        });
        var factory = new Factory();
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);

        var planner = model.Calls.First(c => System(c).Contains("You are the planner", StringComparison.Ordinal));
        var task = planner.Messages[1]!["content"]!.GetValue<string>();
        Assert.Contains("Agreed after research, and part of what is built:\n- Add a shopping list made from a recipe.", task, StringComparison.Ordinal);
        // D31: what an agreed change replaces is marked replaced, never kept beside it as a second requirement.
        Assert.Contains(BuildWorkflow.ChangeWins, task, StringComparison.Ordinal);
        Assert.Equal("Recipe box for families\nShare recipes between households.\n\nAgreed after research, and part of what is built:\n- Add a shopping list made from a recipe.\n\n" + BuildWorkflow.ChangeWins,
            BuildWorkflow.WithAgreedChanges("Recipe box for families\nShare recipes between households.", ["Add a shopping list made from a recipe.", " "]));
    }

    [Fact]
    public async Task Talking_to_an_employee_is_answered_by_that_employee_from_its_job_and_memory()
    {
        var iris = Guid.NewGuid();
        var cp = new FakeControlPlane("frostaura/technologies", "conversation", "What did you find about the dive-log market?") { Headroom = 100m };
        cp.Run["employeeId"] = iris.ToString();
        cp.EmployeeDetails[iris] = new JsonObject
        {
            ["employee"] = new JsonObject
            {
                ["id"] = iris.ToString(),
                ["name"] = "Iris",
                ["role"] = "Market researcher",
                ["jobDescription"] = new JsonObject { ["mandate"] = "Research each idea's market, arguing the case against it first.", ["modelTier"] = "research" },
            },
        };
        cp.Memory[iris] = [new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["title"] = "Dive logs", ["body"] = "Three apps already log dives.", ["kind"] = "fact", ["scope"] = "frostaura" }];
        var model = new ScriptedModel().ThenText("I found three apps that already log dives.");
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        var call = Assert.Single(model.Calls);
        Assert.Equal("research", call.TaskType);
        Assert.Equal(iris, call.EmployeeId);
        var system = System(call);
        Assert.Contains("You are Iris, Market researcher", system, StringComparison.Ordinal);
        Assert.Contains("Research each idea's market, arguing the case against it first.", system, StringComparison.Ordinal);
        Assert.Contains("Three apps already log dives.", system, StringComparison.Ordinal);
        Assert.Contains(call.Tools ?? [], t => t!["function"]?["name"]?.GetValue<string>() == "remember");
        var said = cp.Events.Last(e => e.Type == "message" && e.Payload["from"]?.GetValue<string>() == "assistant").Payload;
        Assert.Equal("Iris", said["by"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_conversation_the_budget_stops_says_so_in_the_conversation()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "conversation", "How are we doing?") { Headroom = 100m };
        var model = new ScriptedModel().ThenFail(ModelFailure.BudgetExhausted);
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        var notice = cp.Events.Single(e => e.Type == "message" && e.Payload["code"]?.GetValue<string>() == "budget_exhausted" && e.Payload["from"]?.GetValue<string>() == "runner").Payload;
        Assert.Contains("ran out before a reply could be written", notice["text"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.DoesNotContain(cp.Events, e => e.Type == "message" && e.Payload["from"]?.GetValue<string>() == "assistant");
    }

    [Fact]
    public async Task The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully()
    {
        var cp = new FakeControlPlane("frostaura/technologies/recipes/web", "conversation", "Add star ratings, and try the failed build again.") { Headroom = 100m, AnswerApproval = _ => false, ApprovalNote = "Not this week." };
        var stoppedRun = Guid.NewGuid();
        var model = new ScriptedModel()
            .ThenTool("change_app", new { request = RatingsRequest })
            .ThenTool("try_again", new { run_id = stoppedRun.ToString(), title = "Build: Recipe box" })
            .ThenTool("adjust_setting", new { key = "checkpoint.plan", value = "true" })
            .ThenText("You declined all three, so none of them was done.");
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal(
            ["Change web: Members can rate each recipe from one to five stars?", "Try again: Build: Recipe box?", "Turn on the “Before the plan is carried out” checkpoint in web?"],
            cp.Approvals);
        Assert.All(cp.Approvals, a => Assert.DoesNotContain("_", a, StringComparison.Ordinal));
        Assert.DoesNotContain(cp.Requests, r => r is "POST /internal/apps/changes" || r.EndsWith("/retry", StringComparison.Ordinal) || r == "PUT /internal/cascade");
        var denied = cp.Events.Where(e => e.Type == "tool.result" && e.Payload["isError"]?.GetValue<bool>() == true).Select(e => e.Payload["content"]!.GetValue<string>()).ToList();
        Assert.Equal(3, denied.Count);
        Assert.All(denied, d => Assert.Contains("declined this call, so it was not done. Their note: \"Not this week.\"", d, StringComparison.Ordinal));
    }
}
