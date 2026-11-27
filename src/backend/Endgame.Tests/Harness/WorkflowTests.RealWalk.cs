using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Credits;
using Endgame.Harness;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Platform;
using Endgame.Runner;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Platform;
using Endgame.Runner.Workflows;
using Microsoft.Extensions.Logging.Abstractions;

namespace Endgame.Tests.Harness;

/// <summary>
/// The defects of the second real-stack walk (2026-11-26) in the Runner and the harness, each pinned by the behaviour the
/// owner saw: web search under the stage's rules (D18), refusals read without a second fault (D25), the human-only acts a
/// conversation must not route into a build (D48), one plainly titled approval per setting (D45, D46, D71), chats in a lane of
/// their own (D47), the red-line screen before research (D58), models that cannot be reached (D64), contractors closed with
/// their run (D60, D73), and the change run's debts.
/// </summary>
public sealed partial class WorkflowTests
{
    // ---- D18: web search is governed by the stage's rules ---------------------------------------------------------------

    private static ChatCall[] StrandCalls(ScriptedModel model) => model.Calls.Where(c => System(c).Contains("market researcher", StringComparison.Ordinal)).ToArray();

    [Fact]
    public async Task Under_may_not_the_researchers_are_not_offered_web_search_and_nobody_is_asked()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
        cp.RuleSet("research", JsonNode.Parse("""{ "deny": ["web_search"] }""")!);
        var model = Researchers(Verdict());
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(3, StrandCalls(model).Length);
        Assert.All(StrandCalls(model), c => Assert.Equal(0, c.MaxSearches));
        Assert.Empty(cp.Approvals);
        // Each refusal is an event the run page shows ("refused by your rules"), and the model is told it may not search.
        Assert.Equal(3, cp.Events.Count(e => e.Type == "tool.denied" && e.Payload["name"]?.GetValue<string>() == "web_search" && e.Payload["by"]?.GetValue<string>() == "rule"));
        Assert.All(StrandCalls(model), c => Assert.Contains(c.Messages.OfType<JsonObject>(), m => m["content"]?.ToString().StartsWith("Web search is not available for this step", StringComparison.Ordinal) == true));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Under_asks_you_first_each_step_raises_one_plain_approval_before_its_first_search_and_a_decline_runs_it_without(bool approve)
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m, AnswerApproval = t => t.Contains("search the web", StringComparison.Ordinal) ? approve : true };
        cp.RuleSet("research", JsonNode.Parse("""{ "ask": ["web_search"] }""")!);
        var model = Researchers(Verdict());
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(
            ["Let this step search the web: looking for evidence people will pay?", "Let this step search the web: looking for existing products?", "Let this step search the web: looking for what they leave undone?"],
            cp.Approvals.Order(StringComparer.Ordinal));
        Assert.All(cp.ApprovalsAsked, a =>
        {
            Assert.True(Endgame.Harness.Events.OwnerText.IsPlain(a["detail"]!.GetValue<string>()), a["detail"]!.GetValue<string>());
            Assert.Equal("continues", a["onDecline"]!.GetValue<string>());
        });
        Assert.All(StrandCalls(model), c => Assert.Equal(approve ? 7 : 0, c.MaxSearches));
        Assert.Equal(3, cp.Events.Count(e => e.Type == (approve ? "tool.permitted" : "tool.denied") && e.Payload["name"]?.GetValue<string>() == "web_search"));
        if (!approve)
        {
            // R6-1: a search the owner declined by hand is said as theirs ("You declined: search the web for …").
            Assert.Equal(
                ["search the web for evidence people will pay", "search the web for existing products", "search the web for what they leave undone"],
                cp.Events.Where(e => e.Type == "tool.denied").Select(e => e.Payload["declined"]!.GetValue<string>()).Order(StringComparer.Ordinal));
            Assert.All(cp.Events.Where(e => e.Type == "tool.denied"), e => Assert.Equal("owner", e.Payload["by"]!.GetValue<string>()));
        }
    }

    [Fact]
    public async Task A_step_asks_about_web_search_once_and_a_resumed_step_never_asks_again()
    {
        var policy = new PermissionPolicy { Stage = "research", Cascade = [CascadeRuleSet.FromJson("research", "frostaura", JsonNode.Parse("""{ "ask": ["web_search"] }"""))] };
        var agent = TestAgents.Builder([new Endgame.Harness.Skills.NotesTool()], a => a with { Permissions = policy, Title = "Looked for existing products", Limits = new AgentLimits { MaxSearchesPerCall = 5 } });
        var gate = new CountingApprovals(false);
        var model = new ScriptedModel().ThenTool("notes", new { action = "add", text = "a note" }).ThenText("Done.");
        var (result, log) = await TestAgents.RunAsync(agent, model, new FakeWorkspace(), services: TestAgents.Services(model) with { Approvals = gate });
        Assert.True(result.Completed);
        Assert.Equal(1, gate.Asked);
        Assert.All(model.Calls, c => Assert.Equal(0, c.MaxSearches));

        // Replayed from its log, the decision stands: no second approval, still no search.
        var replayed = Replay.Fold(log.Events, agent.Id);
        Assert.False(replayed.State.SearchAllowed);
    }

    // ---- D25: reading a refusal never throws a different error ------------------------------------------------------------

    [Theory]
    [InlineData("""{"type":"about:blank","title":"Conflict","status":409,"detail":"The run has succeeded.","code":"conflict","status":"succeeded"}""", "conflict", "The run has succeeded.", "succeeded")]
    [InlineData("<html><body>Bad gateway</body></html>", "Conflict", "<html><body>Bad gateway</body></html>", null)]
    [InlineData("", "Conflict", "409 Conflict", null)]
    [InlineData("[1,2]", "Conflict", "[1,2]", null)]
    [InlineData("""{"code":409,"detail":{"nested":true}}""", "409", """{"nested":true}""", null)]
    public async Task A_problem_body_of_any_shape_is_read_without_a_second_fault(string body, string code, string detail, string? runStatus)
    {
        using var response = new HttpResponseMessage(HttpStatusCode.Conflict) { Content = new StringContent(body, Encoding.UTF8, "application/problem+json") };
        var problem = await ServiceProblemException.FromAsync(response, CancellationToken.None);
        Assert.Equal((HttpStatusCode.Conflict, code, detail, runStatus), (problem.Status, problem.Code, problem.Detail, problem.RunStatus));
    }

    [Fact]
    public async Task A_model_refusal_naming_a_key_twice_is_still_classified()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
        {
            Content = new StringContent("""{"status":503,"code":"model_provider_unconfigured","title":"No model provider is configured","status":"x"}""", Encoding.UTF8, "application/json"),
        };
        var refusal = await GatewayModelClient.RefusalAsync(response, CancellationToken.None);
        Assert.Equal(ModelFailure.Unavailable, refusal.Failure);
        Assert.True(refusal.Unreachable);
    }

    [Fact]
    public async Task A_refused_renewal_on_a_finished_run_is_the_normal_end_not_a_fault()
    {
        var handler = new Answering(HttpStatusCode.Conflict, """{"title":"Conflict","status":409,"detail":"The run has succeeded.","code":"conflict","status":"succeeded"}""");
        var client = new ControlPlaneClient(new HttpClient(handler) { BaseAddress = new Uri("http://control-plane") });
        await using var keeper = new LeaseKeeper(client, Guid.NewGuid(), "runner-test", TimeSpan.FromMinutes(1), DateTimeOffset.UtcNow.AddMinutes(1), TimeProvider.System, NullLogger.Instance);
        Assert.False(await keeper.RenewAsync(CancellationToken.None));
        Assert.Equal("succeeded", keeper.Status);
        Assert.Equal(RunSignal.Cancel, await keeper.CheckAsync(CancellationToken.None));
        await keeper.ReleaseAsync();

        // Even an answer that cannot be read at all is retried, never thrown.
        var garbled = new LeaseKeeper(new ControlPlaneClient(new HttpClient(new Answering(HttpStatusCode.OK, "not json")) { BaseAddress = new Uri("http://control-plane") }),
            Guid.NewGuid(), "runner-test", TimeSpan.FromMinutes(1), DateTimeOffset.UtcNow.AddMinutes(1), TimeProvider.System, NullLogger.Instance);
        Assert.True(await garbled.RenewAsync(CancellationToken.None));
        await garbled.DisposeAsync();
    }

    // ---- D48: what only a person can do is never routed into a build ---------------------------------------------------------

    [Theory]
    [InlineData("Make the Club Reading List app public", "Who can open it")]
    [InlineData("make it private again", "Who can open it")]
    [InlineData("Share the app with Thandi and Lee", "Who can open it")]
    [InlineData("Let anyone open it: who can see the app should be everyone", "Who can open it")]
    [InlineData("Top up our credits by 200", "Credits page")]
    [InlineData("Raise our overdraft to 500", "Credits page")]
    [InlineData("Export the app so I can download its code", "app's page")]
    public void A_request_about_who_may_open_the_app_credits_or_export_is_a_persons_act(string request, string screen)
    {
        var act = ChangeAppTool.PersonsAct(request);
        Assert.NotNull(act);
        Assert.Contains(screen, act, StringComparison.Ordinal);
        var (_, error) = new ChangeAppTool(new FakeControlPlane("frostaura/community/club/web", "conversation").Client(), "frostaura/community/club/web").Target(new JsonObject { ["request"] = request }, "/workspace");
        Assert.NotNull(error);
    }

    [Theory]
    [InlineData("Members can share a book with each other")]
    [InlineData("Show which books are public domain")]
    [InlineData("Add a private note to each book")]
    [InlineData("Members earn reading credits for each finished book")]
    public void An_ordinary_change_is_not_mistaken_for_a_persons_act(string request) => Assert.Null(ChangeAppTool.PersonsAct(request));

    [Fact]
    public async Task Asked_to_make_an_app_public_the_conversation_asks_nobody_and_starts_no_change()
    {
        var cp = new FakeControlPlane("frostaura/community/club/web", "conversation", "Make the Club Reading List app public") { Headroom = 100m };
        var model = new ScriptedModel()
            .ThenTool("change_app", new { request = "Make the Club Reading List app public" })
            .ThenText("I cannot make it public; you do that on the app's page, under Who can open it.");
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Empty(cp.Approvals);
        Assert.DoesNotContain("POST /internal/apps/changes", cp.Requests);
        Assert.Contains("Who can open it", cp.Events.Single(e => e.Type == "tool.result").Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
        // The instructions name the human-only acts and where each is done.
        var system = System(model.Calls[0]);
        Assert.Contains("making it public, private or shared", system, StringComparison.Ordinal);
        Assert.Contains("Credits page", system, StringComparison.Ordinal);
    }

    // ---- D45, D46, D71: one approval per setting, titled with what changes, replies with names -------------------------------

    private static string ValueFor(string key) => key switch
    {
        "autonomy" => "\"checkpoints\"",
        "sleep.mode" => "\"always_on\"",
        "sleep.idle_minutes" => "25",
        "workforce.idle_days" => "14",
        _ => "false",
    };

    [Fact]
    public void Every_setting_the_tool_takes_has_a_plain_title_and_reply_naming_the_place()
    {
        var names = PlaceNames.FromContext(new FakeControlPlane("frostaura/community", "conversation").Context.Also(c => c["levels"]![1]!["name"] = "Community"));
        foreach (var key in Endgame.Domain.Cascade.AgentSettings.Allowed)
        {
            var described = AdjustSettingTool.Describe(key, ValueFor(key), names, "frostaura/community");
            Assert.True(described is not null, key);
            var (title, done) = described.Value;
            foreach (var text in new[] { title, done })
            {
                Assert.True(Endgame.Harness.Events.OwnerText.IsPlain(text), $"{key}: {text}");
                Assert.DoesNotContain("frostaura/", text, StringComparison.Ordinal);
                Assert.DoesNotContain(key, text, StringComparison.Ordinal);
                Assert.Contains("Community", text, StringComparison.Ordinal);
            }

            Assert.NotEqual("Change a setting", title);
            // A pure function of the key and value: the same call, the same words.
            Assert.Equal(described, AdjustSettingTool.Describe(key, ValueFor(key), names, "frostaura/community"));
        }

        Assert.Equal(("Let apps in Community sleep after 25 idle minutes", "Apps in Community now sleep after 25 idle minutes."), AdjustSettingTool.Describe("sleep.idle_minutes", "25", names, "frostaura/community"));
        Assert.Null(AdjustSettingTool.Describe("sleep.idle_minutes", "soon", names, "frostaura/community"));
        Assert.Null(AdjustSettingTool.Describe("access", "\"public\"", names, "frostaura/community"));
    }

    [Fact]
    public async Task A_setting_asked_for_in_chat_raises_exactly_one_approval_and_the_reply_names_the_place()
    {
        var cp = new FakeControlPlane("frostaura/community", "conversation", "Turn off the hire checkpoint here") { Headroom = 100m };
        cp.Context["levels"]![1]!["name"] = "Community";
        var model = new ScriptedModel()
            .ThenTool("adjust_setting", new { key = "hire_checkpoint", value = "false" })
            .ThenTool("adjust_setting", new { key = "checkpoint.hire", value = "false" })
            .ThenText("The “Before anyone is hired” checkpoint is now off in Community.");
        var handler = new CascadeAccepting(cp);
        var options = new RunnerOptions();
        var executor = new RunExecutor(new ControlPlaneClient(new HttpClient(handler) { BaseAddress = new Uri("http://control-plane") }), model, new FakeWorkspaces(new FakeWorkspace()), [new ConversationWorkflow()],
            new AgentFactory(options), new Estimator(options), options, NullLogger<RunExecutor>.Instance);
        await executor.ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        // The wrong key is refused before anyone is asked; the right one asks once, in plain words, with a plain detail.
        Assert.Equal(["Turn off the “Before anyone is hired” checkpoint in Community?"], cp.Approvals);
        var asked = cp.ApprovalsAsked.Single();
        Assert.True(Endgame.Harness.Events.OwnerText.IsPlain(asked["detail"]!.GetValue<string>()), asked["detail"]!.GetValue<string>());
        Assert.Contains("adjust_setting", asked["technical"]!.GetValue<string>(), StringComparison.Ordinal);
        var results = cp.Events.Where(e => e.Type == "tool.result").Select(e => e.Payload["content"]!.GetValue<string>()).ToList();
        Assert.Contains("is not a setting you can change", results[0], StringComparison.Ordinal);
        Assert.Equal("Done. Tell the owner, in these words: The “Before anyone is hired” checkpoint is now off in Community.", results[1]);
        Assert.Contains("Community, the division at frostaura/community", System(model.Calls[0]), StringComparison.Ordinal);
    }

    // ---- D47: chats have a lane of their own --------------------------------------------------------------------------------

    [Fact]
    public void Conversations_are_claimed_in_their_own_lane_and_neither_lane_starves_the_other()
    {
        var options = new RunnerOptions { Concurrency = 2, ConversationConcurrency = 2 };
        string[] all = ["research", "conversation", "build", "task", "review", "suggest"];

        // Two long runs fill the work lane: a chat is still claimed, and only chats are asked for.
        var full = RunLanes.Plan(all, options, activeWork: 2, activeConversations: 0);
        var chat = Assert.Single(full);
        Assert.Equal(RunLanes.Conversation, chat.Name);
        Assert.Equal(["conversation"], chat.Kinds);

        // Two chats fill their lane: builds are still claimed, and never a chat in a build's place.
        var chatty = Assert.Single(RunLanes.Plan(all, options, activeWork: 0, activeConversations: 2));
        Assert.Equal(RunLanes.Work, chatty.Name);
        Assert.DoesNotContain("conversation", chatty.Kinds);

        Assert.Equal([RunLanes.Conversation, RunLanes.Work], RunLanes.Plan(all, options, 0, 0).Select(c => c.Name));
        Assert.Empty(RunLanes.Plan(all, options, 2, 2));
        // A Runner that takes only some kinds asks only for those.
        Assert.Equal([RunLanes.Work], RunLanes.Plan(["build"], options, 0, 0).Select(c => c.Name));
    }

    // ---- D58: the red lines are screened before research ---------------------------------------------------------------------

    [Fact]
    public async Task An_idea_plainly_over_a_red_line_is_refused_at_once_without_researchers_or_searches()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "Spyware that reads a partner's messages without them knowing.", Idea) { Headroom = 100m };
        var model = Researchers(Verdict(), screen: "breach", line: "surveillance");
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        var call = Assert.Single(model.Calls);
        Assert.True(IsScreen(call));
        Assert.Equal(0, call.MaxSearches);
        Assert.Empty(cp.Contractors);
        var verdict = cp.Verdict!;
        Assert.Empty(Endgame.Domain.Runs.VerdictDocument.Validate(verdict));
        Assert.Equal(("do-not-build", true, "surveillance"), (verdict["outcome"]!.GetValue<string>(), verdict["redLines"]!["breached"]!.GetValue<bool>(), verdict["redLines"]!["line"]!.GetValue<string>()));
        Assert.Equal(0, verdict["method"]!["searches"]!.GetValue<int>());
        Assert.Contains("no one can overrule", cp.Events.Single(e => e.Payload["milestone"]?.GetValue<string>() == "verdict").Payload["text"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Empty(cp.Decisions);
        AssertMessagesAreForPeople(cp);
        AssertOwnerFieldsArePlain(cp);
    }

    [Fact]
    public async Task An_idea_the_screen_is_unsure_of_is_researched_in_full()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A location-sharing app for families.", Idea) { Headroom = 100m };
        var model = Researchers(Verdict(), screen: "unclear");
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal(3, StrandCalls(model).Length);
        Assert.Equal("build", cp.Verdict!["outcome"]!.GetValue<string>());
    }

    // ---- D64: models that cannot be reached are not answers in the wrong form ------------------------------------------------

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, """{"status":503,"code":"model_provider_unconfigured","title":"No model provider is configured"}""")]
    [InlineData(HttpStatusCode.BadGateway, """{"status":502,"code":"upstream_error","title":"The model provider refused the call","upstreamStatus":401}""")]
    [InlineData(HttpStatusCode.BadGateway, """{"status":502,"code":"upstream_unavailable","title":"The model provider could not be reached"}""")]
    public async Task With_no_model_connection_research_stops_plainly_without_correction_rounds(HttpStatusCode status, string body)
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
        var gateway = new GatewayModelClient(new HttpClient(new Answering(status, body)) { BaseAddress = new Uri("http://control-plane") }, stream: false);
        var model = new Unreachable(gateway);
        var options = new RunnerOptions();
        var executor = new RunExecutor(cp.Client(), model, new FakeWorkspaces(new FakeWorkspace()), [new ResearchWorkflow()], new AgentFactory(options), new Estimator(options), options, NullLogger<RunExecutor>.Instance);
        await executor.ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Null(cp.Verdict);
        var finished = cp.Payload("run.finished")!;
        Assert.Equal("Endgame could not reach its AI models, so no research was done and nothing was charged. Try again; if it keeps happening, tell FrostAura.", finished["summary"]!.GetValue<string>());
        Assert.False(string.IsNullOrWhiteSpace(finished["detail"]?.GetValue<string>()));
        // Stopped at the screen: no researcher, no judge, no "corrected" round.
        Assert.DoesNotContain(model.Agents, a => a.StartsWith("contractor-", StringComparison.Ordinal) || a.StartsWith("judge", StringComparison.Ordinal));
        Assert.DoesNotContain(cp.Events, e => e.Payload["summary"]?.ToString().Contains("agreed form", StringComparison.Ordinal) == true);
        AssertMessagesAreForPeople(cp);
    }

    [Fact]
    public async Task Researchers_that_cannot_reach_a_model_say_so_and_no_judge_is_asked()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
        var model = new ScriptedModel { Fallback = c => IsScreen(c) ? ScriptedModel.Text("""{"screen":"clear"}""") : throw new ModelCallException(ModelFailure.Unavailable, "503 model_provider_unconfigured: No model provider is configured") };
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.All(cp.Events.Where(e => e.Type == "subagent.finished"), e => Assert.Equal("It could not reach Endgame's AI models, so it found nothing.", e.Payload["summary"]!.GetValue<string>()));
        Assert.DoesNotContain(model.Calls, c => System(c).Contains("Argue the case AGAINST", StringComparison.Ordinal));
        Assert.StartsWith("Endgame could not reach its AI models, so no research was done", cp.Run["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        // D73: the contractors were finished with the run, not left working.
        Assert.Equal(3, cp.ContractorsFinished.Count);
        // D60: none is named by its step: no name is sent, so the control plane names it by its role.
        Assert.All(cp.Contractors, c => Assert.Null(c["name"]));
        Assert.All(cp.Contractors, c => Assert.EndsWith("researcher", c["role"]!.GetValue<string>(), StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_conversation_that_cannot_reach_a_model_says_so()
    {
        var cp = new FakeControlPlane("frostaura", "conversation", "Is anything waiting on me?") { Headroom = 100m };
        var model = new ScriptedModel().ThenFail(ModelFailure.Unavailable);
        await EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        var answers = cp.Events.Where(e => e.Type == "message" && e.Payload["from"]?.GetValue<string>() == "assistant").ToList();
        Assert.Equal(ConversationWorkflow.UnreachableAnswer, Assert.Single(answers).Payload["text"]!.GetValue<string>());
        Assert.Single(model.Calls);
    }

    // ---- D73: contractors end with their run ---------------------------------------------------------------------------------

    [Fact]
    public async Task Contractors_of_a_run_that_ended_part_way_are_closed_with_it()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
        // The run was closed under the researchers (cancelled by the owner): none of them writes its own finish.
        var model = new ScriptedModel { Fallback = c => IsScreen(c) ? ScriptedModel.Text("""{"screen":"clear"}""") : throw new ModelCallException(ModelFailure.RunClosed, "409 conflict: The run has cancelled.") };
        await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal(3, cp.Contractors.Count);
        Assert.DoesNotContain(cp.Events, e => e.Type == "subagent.finished");
        Assert.Equal(cp.Contractors.Select(c => c["id"]!.GetValue<string>()).Order(), cp.ContractorsFinished.Select(c => c["contractorId"]!.GetValue<string>()).Order());
    }

    // ---- D29 and the change run's debts --------------------------------------------------------------------------------------

    [Fact]
    public async Task A_long_step_reports_its_progress_in_plain_counts()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n").With("b.txt", "two\n");
        var model = new ScriptedModel()
            .ThenTool("read_file", new { path = "a.txt" }).ThenTool("read_file", new { path = "b.txt" }).ThenTool("search", new { pattern = "one" })
            .ThenTool("list_files", new { }).ThenText("Done.");
        var agent = TestAgents.Builder(change: a => a with { Progress = new ProgressReports("planner", "Still planning", "Still reading the app", Every: 3) });
        var (_, log) = await TestAgents.RunAsync(agent, model, ws);
        var report = Assert.Single(log.Events, e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "Still planning").Payload;
        Assert.Equal("Still reading the app. Since the last update it read 2 parts of the app and searched it once; 3 actions so far.", report["text"]!.GetValue<string>());
        Assert.Equal("planner", report["from"]!.GetValue<string>());
        Assert.True(Endgame.Harness.Events.OwnerText.IsPlain(report["text"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Each_finished_task_says_what_it_did_once_in_its_own_words()
    {
        var (cp, ws, dock) = BuildRun();
        await RunBuildAsync(cp, new Factory().Model(), ws, dock);
        var done = cp.Events.Where(e => e.Type == "task.done").Select(e => e.Payload["summary"]!.GetValue<string>()).ToList();
        Assert.NotEmpty(done);
        Assert.Equal(done.Count, done.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains(done, d => d.StartsWith("Built and handed over: ", StringComparison.Ordinal));
    }

    [Fact]
    public void A_to_do_line_in_the_builders_own_notes_is_not_a_part_the_app_already_has()
    {
        const string progress = """
            # Progress

            ## Done

            - **book-list** — Members see the club's books, newest first.
            - **search** — TODO: search by author.

            ## Next

            - **ratings** — Members rate each book from one to five.
            """;
        var earlier = BuildWorkflow.EarlierWork(progress);
        Assert.Single(earlier["parts"]!.AsArray());
        Assert.StartsWith("k1 (book-list)", Assert.Single(earlier["notes"]!.AsArray())!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public void A_finished_runs_open_contractors_are_those_briefed_and_never_finished()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var log = new List<Endgame.Harness.Events.RunEvent>
        {
            new("subagent.started", new JsonObject { ["subagent"] = "contractor-existing", ["contractorId"] = a.ToString() }),
            new("subagent.started", new JsonObject { ["subagent"] = "contractor-gap", ["contractorId"] = b.ToString() }),
            new("subagent.started", new JsonObject { ["subagent"] = "sub-1" }),
            new("subagent.finished", new JsonObject { ["subagent"] = "contractor-existing" }),
        };
        Assert.Equal([b], RunExecutor.OpenContractors(log));
    }

    // ---- D44: credits as people read them -----------------------------------------------------------------------------

    [Theory]
    [InlineData("277.323824", "277.32")]
    [InlineData("20", "20")]
    [InlineData("1.50", "1.5")]
    [InlineData("0.005", "0.01")]
    public void Credits_are_shown_with_at_most_two_decimals(string credits, string shown) =>
        Assert.Equal(shown, CreditText.Format(decimal.Parse(credits, global::System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public async Task The_start_checkpoint_and_the_budget_pause_show_rounded_credits()
    {
        var cp = new FakeControlPlane("frostaura/technologies", "task", "x") { Headroom = 277.323824m, AnswerApproval = _ => true };
        cp.Setting("autonomy", JsonValue.Create("checkpoints")!);
        cp.Setting("checkpoint.start", JsonValue.Create(true)!);
        await EstimateTests.Executor(cp, new ScriptedModel()).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("277.32 credits are left in the budget.", cp.ApprovalsAsked.Single()["detail"]!.GetValue<string>());

        var poor = new FakeControlPlane("frostaura/technologies", "task", "x") { Headroom = 0.123456m };
        await EstimateTests.Executor(poor, new ScriptedModel()).ExecuteAsync(poor.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.StartsWith("This work is estimated at 1.5 credits, more than the 0.12 left", poor.Events.Single(e => e.Payload["code"]?.GetValue<string>() == "estimate_over_budget").Payload["text"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    // ---- D83: a requirement is a whole statement -------------------------------------------------------------------------

    [Fact]
    public void A_sentence_is_one_requirement_with_its_example_and_qualifier_attached()
    {
        const string request = "Show how many books are on the list, as a line above the list, for example \"3 books\".";
        static Endgame.Harness.Planning.PlanContract Plan(params string[] requirements) => Endgame.Harness.Planning.PlanContract.FromJson(new JsonObject
        {
            ["summary"] = "A count of the books above the list.",
            ["items"] = new JsonArray(new JsonObject { ["id"] = "count", ["text"] = "Members see how many books are on the list.", ["detail"] = "d", ["check"] = "c", ["covers"] = new JsonArray(requirements.Select((_, i) => (JsonNode)$"r{i + 1}").ToArray()) }),
            ["requirements"] = new JsonArray(requirements.Select((r, i) => (JsonNode)new JsonObject { ["id"] = $"r{i + 1}", ["text"] = r }).ToArray()),
        })!;

        var split = Plan("Show how many books are on the list", "as a line above the list", "for example \"3 books\"").Faults(request);
        Assert.Equal(2, split.Count(f => f.Contains("is part of another statement", StringComparison.Ordinal)));
        Assert.Empty(Plan(request.TrimEnd('.')).Faults(request));

        // Three clauses that each ask for something stay three, each read as a statement of its own.
        const string dive = "Members sign in, tick off their own kit for a trip, and the trip leader sees who is ready.";
        var plan = Plan("Members sign in", "tick off their own kit for a trip", "and the trip leader sees who is ready");
        Assert.Empty(plan.Faults(dive));
        Assert.Equal(["Members sign in", "Tick off their own kit for a trip", "The trip leader sees who is ready"], plan.Requirements.Select(r => r.Text));
    }

    // ---- fakes ----------------------------------------------------------------------------------------------------------------

    private sealed class Answering(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/problem+json") });
    }

    /// <summary>The real gateway client over a gateway that refuses every call, recording which agent called.</summary>
    private sealed class Unreachable(IModelClient inner) : IModelClient
    {
        public List<string> Agents { get; } = [];

        public Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken)
        {
            lock (Agents)
            {
                Agents.Add(call.IdempotencyKey?.Split(':')[1] ?? "");
            }

            return inner.CompleteAsync(call, cancellationToken);
        }
    }

    /// <summary>The fake control plane, plus the cascade write that adjust_setting makes, accepted.</summary>
    private sealed class CascadeAccepting(FakeControlPlane inner) : DelegatingHandler(inner)
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            request.Method == HttpMethod.Put && request.RequestUri!.AbsolutePath == "/internal/cascade"
                ? Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", Encoding.UTF8, "application/json") })
                : base.SendAsync(request, cancellationToken);
    }

    private sealed class CountingApprovals(bool answer) : IApprovalGate
    {
        public int Asked { get; private set; }

        public Task<bool> RequestAsync(string title, string detail, CancellationToken cancellationToken)
        {
            Asked++;
            return Task.FromResult(answer);
        }
    }
}

internal static class JsonObjectTestExtensions
{
    public static JsonObject Also(this JsonObject o, Action<JsonObject> change)
    {
        change(o);
        return o;
    }
}
