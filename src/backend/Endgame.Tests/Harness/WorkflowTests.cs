using System.Text.Json.Nodes;
using Endgame.Harness.Model;
using Endgame.Runner;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// The factory's workflows, deterministically: a scripted model that answers by role, and fakes of the
/// control plane and Dock. No network.
/// </summary>
public sealed class WorkflowTests
{
    private static readonly Guid Idea = Guid.NewGuid();

    // ---- research ------------------------------------------------------------------------------------

    private static ScriptedModel Researchers(JsonObject verdict, bool demandFound = true) => new()
    {
        Fallback = call =>
        {
            var system = System(call);
            if (system.Contains("market researcher", StringComparison.Ordinal))
            {
                var demand = system.Contains("Demand:", StringComparison.Ordinal);
                var existing = system.Contains("Existing products:", StringComparison.Ordinal);
                return ScriptedModel.Text(new JsonObject
                {
                    ["findings"] = demand && !demandFound ? new JsonArray() : Json("[\"Forum threads ask for this (example.org/t/1)\"]"),
                    ["products"] = existing ? Json("[\"Paprika\", \"Mealie\"]") : new JsonArray(),
                    ["sources"] = Json("[\"https://example.org/t/1\"]"),
                    ["confidence"] = "medium",
                }.ToJsonString());
            }

            Assert.Contains("Argue the case AGAINST the idea", system, StringComparison.Ordinal);
            Assert.Contains("Paprika", call.Messages[0]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
            return ScriptedModel.Text("Here is my verdict:\n```json\n" + verdict.ToJsonString() + "\n```");
        },
    };

    private static JsonObject Verdict(string outcome = "build", bool breach = false, string demand = "Families on two forums asked for it.") => new()
    {
        ["outcome"] = outcome,
        ["headline"] = "A recipe box with a gap at family sharing.",
        ["summary"] = "Against: crowded market. For: sharing is unserved.",
        ["against"] = "Paprika and Mealie are good and cheap.",
        ["existing"] = new JsonObject { ["products"] = Json("[\"Paprika\"]"), ["evidence"] = "Two strong products." },
        ["gap"] = new JsonObject { ["evidence"] = "Neither shares between households." },
        ["demand"] = new JsonObject { ["evidence"] = demand },
        ["wouldChange"] = "A household-sharing feature in either product.",
        ["redLines"] = new JsonObject { ["breached"] = breach, ["line"] = breach ? "surveillance" : null, ["reasoning"] = "r" },
        ["placement"] = new JsonObject { ["division"] = "technologies", ["project"] = "recipe-box", ["app"] = "web", ["name"] = "Recipe Box" },
    };

    [Fact]
    public async Task Research_fans_out_contractors_argues_against_first_and_records_a_verdict_naming_every_product_found()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
        var model = Researchers(Verdict());
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.Equal(4, model.Calls.Count);
        Assert.All(model.Calls, c => Assert.Equal("research", c.TaskType));
        var verdict = cp.Verdict!;
        Assert.Equal("build", verdict["outcome"]!.GetValue<string>());
        Assert.Equal(["Paprika", "Mealie"], verdict["existing"]!["products"]!.AsArray().Select(p => p!.GetValue<string>()));
        Assert.Equal(3, verdict["method"]!["contractors"]!.GetValue<int>());
        Assert.Equal("against first", verdict["method"]!["argued"]!.GetValue<string>());
        foreach (var agent in new[] { "contractor-existing", "contractor-gap", "contractor-demand", "judge" })
        {
            Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == agent);
        }
    }

    [Fact]
    public async Task No_evidence_of_demand_turns_a_build_into_do_not_build()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box.", Idea) { Headroom = 100m };
        await EstimateTests.Executor(cp, Researchers(Verdict(demand: ""), demandFound: false), workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("do-not-build", cp.Verdict!["outcome"]!.GetValue<string>());
        Assert.Contains("missing demand counts against building", cp.Verdict["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("Nothing will be built unless you overrule it", cp.Payload("message")!["text"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_red_line_is_do_not_build_whatever_the_market_says()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "Track employees' phones.", Idea) { Headroom = 100m };
        await EstimateTests.Executor(cp, Researchers(Verdict(breach: true)), workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("do-not-build", cp.Verdict!["outcome"]!.GetValue<string>());
        Assert.Equal("surveillance", cp.Verdict["redLine"]!["line"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_judge_without_a_verdict_document_fails_the_research_rather_than_guessing()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "An idea.", Idea) { Headroom = 100m };
        var model = new ScriptedModel { Fallback = c => ScriptedModel.Text(System(c).Contains("market researcher", StringComparison.Ordinal) ? "{\"findings\":[]}" : "I think it is fine.") };
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Null(cp.Verdict);
    }

    // ---- build ---------------------------------------------------------------------------------------

    private sealed class Factory
    {
        public int Evaluations { get; set; }

        public Func<int, bool> EvaluationPasses { get; set; } = _ => true;

        public Func<int, bool> ReviewPasses { get; set; } = _ => true;

        public int Reviews { get; set; }

        public int Plans { get; set; }

        public Action<ChatCall>? OnBuilder { get; set; }

        public ScriptedModel Model() => new() { Fallback = Answer };

        private ModelReply Answer(ChatCall call)
        {
            var system = System(call);
            var turn = call.Messages.Count(m => m!["role"]!.GetValue<string>() == "assistant");
            if (system.Contains("You are the planner", StringComparison.Ordinal))
            {
                if (turn == 0)
                {
                    Plans++;
                    return ScriptedModel.Tools(("propose_plan", new
                    {
                        summary = "Replace notes with recipes.",
                        items = new[]
                        {
                            new { id = "recipes-api", deliverable = "A recipes API", check = "make test passes RecipesApiTests" },
                            new { id = "recipes-page", deliverable = "A recipes page with four states", check = "make test passes RecipesPage.test.tsx" },
                        },
                    }, null));
                }

                return ScriptedModel.Text("Plan proposed.");
            }

            if (system.Contains("sceptical evaluator", StringComparison.Ordinal))
            {
                if (turn == 0)
                {
                    return ScriptedModel.Tools(("run", new { command = "make test" }, null));
                }

                var passed = EvaluationPasses(Evaluations++);
                return ScriptedModel.Text(new JsonObject { ["passed"] = passed, ["evidence"] = "make test: 12 passed", ["faults"] = passed ? new JsonArray() : Json("[\"RecipesApiTests fails: POST without a title returns 500\"]") }.ToJsonString());
            }

            if (system.Contains("security reviewer", StringComparison.Ordinal))
            {
                var passed = ReviewPasses(Reviews++);
                return ScriptedModel.Text(new JsonObject
                {
                    ["passed"] = passed,
                    ["findings"] = passed ? new JsonArray() : Json("[{\"item\":\"Secrets\",\"file\":\"api/appsettings.json\",\"line\":3,\"problem\":\"An API key in config\",\"fix\":\"Use IEndgameSecrets\"}]"),
                    ["checked"] = Json("[\"Secrets\"]"),
                }.ToJsonString());
            }

            // The builder.
            OnBuilder?.Invoke(call);
            return turn switch
            {
                0 => ScriptedModel.Tools(("edit_file", new { path = "api/Program.cs", old_string = "api.MapNotes();", new_string = $"api.MapNotes(); // {Guid.NewGuid():N}" }, null)),
                1 => ScriptedModel.Tools(("run", new { command = "make test" }, null)),
                _ => ScriptedModel.Text("Built and tested."),
            };
        }
    }

    private static (FakeControlPlane Cp, FakeWorkspace Ws, FakeDock Dock) BuildRun()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "build", "Recipe box for families\nShare recipes between households.") { Headroom = 1000m };
        var ws = new FakeWorkspace().With("api/Program.cs", "var api = app.UseEndgameApp();\napi.MapNotes();\napp.Run();\n").With("AGENTS.md", "# AGENTS\n");
        return (cp, ws, new FakeDock());
    }

    private static Task RunBuildAsync(FakeControlPlane cp, ScriptedModel model, FakeWorkspace ws, FakeDock dock, CancellationToken cancellationToken = default)
    {
        var options = new RunnerOptions();
        return EstimateTests.Executor(cp, model, ws, [new BuildWorkflow(new Estimator(options), new StubProbe())], dock, options)
            .ExecuteAsync(cp.Info(), "runner-test", () => false, cancellationToken);
    }

    [Fact]
    public async Task Build_places_plans_builds_each_feature_with_a_sceptical_evaluator_reviews_and_publishes_privately()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory();
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        // Placement: a project and an app under the run's division.
        Assert.Equal(["project", "app"], cp.Nodes.Select(n => n["level"]!.GetValue<string>()));
        Assert.Equal("frostaura/technologies/recipe-box-for-families", cp.Nodes[0]["path"]!.GetValue<string>());
        // The plan is a contract, proposed in plan mode and accepted before any building.
        var types = cp.Types.ToList();
        Assert.True(types.IndexOf("plan.proposed") < types.IndexOf("plan.accepted"));
        Assert.True(types.IndexOf("plan.accepted") < cp.Events.FindIndex(e => e.Payload["agent"]?.GetValue<string>() == "builder-recipes-api-0"));
        Assert.Equal(2, types.Count(t => t == "estimate.made"));
        // One session, one clean commit and one progress entry per feature; a separate evaluator each.
        Assert.Equal(2, types.Count(t => t == "evaluation.passed"));
        Assert.Equal(4, ws.CommitMessages.Count);
        Assert.Contains("**recipes-api**", ws.Text("PROGRESS.md"), StringComparison.Ordinal);
        Assert.Contains("**recipes-page**", ws.Text("PROGRESS.md"), StringComparison.Ordinal);
        Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "evaluator-recipes-page-0");
        Assert.All(model.Calls.Where(c => System(c).Contains("sceptical evaluator", StringComparison.Ordinal)), c => Assert.Equal("evaluate", c.TaskType));
        Assert.All(model.Calls.Where(c => System(c).Contains("software engineer", StringComparison.Ordinal)), c => Assert.Equal(("build", false), (c.TaskType, c.Repair)));
        // The evaluator never had a tool that writes.
        Assert.All(model.Calls.Where(c => System(c).Contains("sceptical evaluator", StringComparison.Ordinal)), c =>
            Assert.DoesNotContain(c.Tools!, t => t!["function"]!["name"]!.GetValue<string>() is "edit_file" or "write_file" or "commit"));
        // Reviewed, then started privately: Dock's start carries no visibility, and nothing made the app public.
        Assert.Equal(1, factory.Reviews);
        Assert.Equal(3, dock.Starts.Count);
        Assert.All(dock.Starts, s => Assert.Null(s["visibility"]));
        Assert.Contains("running privately", cp.Payload("message")!["text"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_failed_evaluation_is_repaired_not_billed_and_on_the_next_tier()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory { EvaluationPasses = n => n != 0 };
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        var failed = cp.Payload("evaluation.failed")!;
        Assert.Equal("recipes-api", failed["item"]!.GetValue<string>());
        Assert.Contains("POST without a title returns 500", failed["faults"]!.ToJsonString(), StringComparison.Ordinal);
        var repairCalls = model.Calls.Where(c => c.Messages[1]!["content"]!.GetValue<string>().StartsWith("The evaluator checked your work", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(repairCalls);
        Assert.All(repairCalls, c => Assert.Equal(("build-t1", true), (c.TaskType, c.Repair)));
        Assert.Contains("POST without a title returns 500", repairCalls[0].Messages[1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Repair_rounds_are_capped_and_escalate_one_tier_each()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory { EvaluationPasses = _ => false };
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);
        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Contains("still failed its check after 3 repair rounds", cp.Run["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(4, cp.Types.Count(t => t == "evaluation.failed"));
        var tiers = cp.Events.Where(e => e.Type == "evaluation.failed").Select(e => e.Payload["tier"]!.GetValue<string>());
        Assert.Equal(["build", "build-t1", "build-t2", "build-t3"], tiers);
        Assert.DoesNotContain(cp.Events, e => e.Payload["agent"]?.GetValue<string>()?.StartsWith("builder-recipes-page", StringComparison.Ordinal) == true);
    }

    [Fact]
    public async Task A_security_finding_blocks_publishing_after_one_repair()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory { ReviewPasses = _ => false };
        await RunBuildAsync(cp, factory.Model(), ws, dock);
        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Contains("Publishing is blocked by the security review", cp.Run["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(2, factory.Reviews);
        Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "builder-security-repair");
        // Two items built and previewed, never published.
        Assert.Equal(2, dock.Starts.Count);
    }

    [Fact]
    public async Task A_build_killed_part_way_resumes_without_repeating_placement_planning_or_finished_features()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory();
        using var kill = new CancellationTokenSource();
        factory.OnBuilder = call =>
        {
            if (call.Messages[1]!["content"]!.GetValue<string>().Contains("The feature: [recipes-page]", StringComparison.Ordinal))
            {
                kill.Cancel();
            }
        };
        await RunBuildAsync(cp, factory.Model(), ws, dock, kill.Token);
        Assert.Equal("running", cp.Run["status"]!.GetValue<string>());
        Assert.Single(cp.Types, t => t == "evaluation.passed");

        factory.OnBuilder = null;
        await RunBuildAsync(cp, factory.Model(), ws, dock);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(2, cp.Nodes.Count);
        Assert.Equal(1, factory.Plans);
        Assert.Equal(2, cp.Types.Count(t => t == "evaluation.passed"));
        Assert.Single(cp.Types, t => t == "plan.accepted");
    }

    // ---- conversation --------------------------------------------------------------------------------

    [Fact]
    public async Task A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "conversation", "How many people work here, and start an idea for a habit tracker.") { Headroom = 100m, AnswerApproval = _ => false };
        var model = new ScriptedModel()
            .ThenTool("read_organisation", new { what = "workforce" })
            .ThenTool("start_idea", new { text = "A habit tracker." })
            .ThenText("One person works here: Ada, a builder. You declined starting the habit tracker, so I did not.");
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.All(model.Calls, c => Assert.Equal("chat", c.TaskType));
        Assert.Contains("Ada", model.Calls[1].Messages[^1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.StartsWith("Allow start_idea: A habit tracker.", Assert.Single(cp.Approvals), StringComparison.Ordinal);
        Assert.DoesNotContain(cp.Requests, r => r == "POST /internal/ideas");
        Assert.Contains(cp.Events, e => e.Type == "message" && e.Payload["from"]?.GetValue<string>() == "assistant" && e.Payload["text"]!.GetValue<string>().StartsWith("One person works here", StringComparison.Ordinal));
    }

    private static string System(ChatCall call) => call.Messages[0]!["content"] is JsonValue v ? v.GetValue<string>() : call.Messages[0]!["content"]![0]!["text"]!.GetValue<string>();

    private static JsonNode Json(string text) => JsonNode.Parse(text)!;

    private sealed class StubProbe : IPreviewProbe
    {
        public Task<PreviewAnswer> SendAsync(Guid appId, string method, string path, string? body, CancellationToken cancellationToken) =>
            Task.FromResult(new PreviewAnswer(200, "application/json", "[]"));
    }
}
