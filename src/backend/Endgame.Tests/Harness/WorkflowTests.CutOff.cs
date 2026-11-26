using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Model;
using Endgame.Harness.Tools;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R2-6: an answer read by code and cut off at its output limit (<c>finish_reason: length</c>, the shape OpenRouter
/// returns: the content stops mid-object) is asked for again once with twice the room, never billed, and a second
/// cut is reported as "too long to finish" — never as an answer "not in the agreed form".
/// </summary>
public sealed partial class WorkflowTests
{
    /// <summary>A reply cut at its limit, as a reasoning model returns it: a JSON object that stops halfway.</summary>
    private static ModelReply CutOff(ChatCall call) => new(
        new JsonObject { ["role"] = "assistant", ["content"] = "{\"merged\": [{\"from\": [\"" },
        FinishReasons.Length, "qwen/qwen3.7-flash", "ProviderA", 6168, call.MaxTokens, 0, 0.1m, 0.01m, !call.Repair);

    [Fact]
    public async Task A_structured_answer_cut_off_is_asked_for_again_with_twice_the_room_unbilled_and_as_json()
    {
        var model = new ScriptedModel().Then(CutOff).ThenText("{\"ok\": true}");
        var agent = TestAgents.Builder([], a => a with { TaskType = "summarise", StructuredAnswer = true, Limits = new AgentLimits { MaxSteps = 1, MaxOutputTokens = 2000 } });
        var (result, log) = await TestAgents.RunAsync(agent, model, new FakeWorkspace());

        Assert.True(result.Completed, result.StopReason);
        Assert.Equal("{\"ok\": true}", result.FinalText);
        Assert.Equal([(2000, false, true), (4000, true, true)], model.Calls.Select(c => (c.MaxTokens, c.Repair, c.PreferJson)));
        // The cut reply is recorded for technical mode and never becomes part of the conversation.
        Assert.Single(log.Events, e => e.Payload["kind"]?.GetValue<string>() == MessageKinds.ReplyCutOff);
        Assert.DoesNotContain(model.Calls[1].Messages, m => m!["content"]?.ToString().StartsWith("{\"merged\"", StringComparison.Ordinal) == true);
    }

    [Fact]
    public async Task A_structured_answer_cut_off_twice_ends_the_agent_saying_it_was_too_long_and_a_plain_agent_keeps_its_reply()
    {
        var model = new ScriptedModel().Then(CutOff).Then(CutOff);
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder([], a => a with { StructuredAnswer = true }), model, new FakeWorkspace());
        Assert.Equal(StopReasons.AnswerCutOff, result.StopReason);
        Assert.True(result.CutOff);
        Assert.Contains("too long to finish", result.FinalText, StringComparison.Ordinal);
        Assert.Equal(2, model.Calls.Count);

        // An agent with tools is not asked for a JSON object outright; one whose answer nobody parses is not retried.
        var withTools = new ScriptedModel().Then(CutOff).ThenText("{}");
        await TestAgents.RunAsync(TestAgents.Builder([new ReadFileTool()], a => a with { StructuredAnswer = true }), withTools, new FakeWorkspace());
        Assert.All(withTools.Calls, c => Assert.False(c.PreferJson));
        var plain = new ScriptedModel().Then(CutOff);
        var (prose, _) = await TestAgents.RunAsync(TestAgents.Builder(), plain, new FakeWorkspace());
        Assert.True(prose.Completed);
        Assert.Single(plain.Calls);
    }

    [Fact]
    public async Task A_large_memory_is_reviewed_in_batches_and_applied_once()
    {
        var employee = Guid.NewGuid();
        var cp = new FakeControlPlane("frostaura/technologies", "review");
        cp.Append("message", new JsonObject { ["from"] = "owner", ["kind"] = "memory.review", ["employeeId"] = employee.ToString(), ["text"] = "Review it." });
        var ids = Enumerable.Range(0, 100).Select(_ => Guid.NewGuid()).ToList();
        cp.Memory[employee] = [.. ids.Select((id, n) => new JsonObject { ["id"] = id.ToString(), ["title"] = $"Entry {n:000}", ["body"] = "Body.", ["kind"] = "fact", ["scope"] = "frostaura" })];
        // Each batch removes the first entry it was given.
        var model = new ScriptedModel
        {
            Fallback = call =>
            {
                var first = global::System.Text.RegularExpressions.Regex.Match(System(call), "- id ([0-9a-f-]{36})").Groups[1].Value;
                return ScriptedModel.Text(new JsonObject { ["merged"] = new JsonArray(), ["removed"] = Json($"[{{\"id\":\"{first}\",\"why\":\"Stale.\"}}]"), ["corrected"] = new JsonArray() }.ToJsonString());
            },
        };
        await EstimateTests.Executor(cp, model, workflows: [new ReviewWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.Equal(3, model.Calls.Count);
        Assert.All(model.Calls, c => Assert.True(c.PreferJson && c.Tools is null && c.MaxTokens == MemoryReview.OutputTokens));
        Assert.Equal(3, Assert.Single(cp.MemoryReviews)["removed"]!.AsArray().Count);
        Assert.Equal([40, 40, 20], MemoryReview.Batches(ids.Select((id, n) => new Endgame.Harness.Platform.MemoryEntry(id, $"Entry {n:000}", "Body.", "fact", "frostaura")).ToList()).Select(b => b.Count));
    }

    public static TheoryData<string> CutOffSites => ["memory review", "change screen", "suggestions", "verdict judge", "evaluator"];

    /// <summary>Every workflow that reads a model's JSON answer, with a model that only ever answers cut off.</summary>
    [Theory]
    [MemberData(nameof(CutOffSites))]
    public async Task Every_structured_call_site_reports_a_cut_off_answer_as_too_long_never_as_the_wrong_form(string site)
    {
        var model = new ScriptedModel { Fallback = CutOff };
        FakeControlPlane cp;
        switch (site)
        {
            case "memory review":
                var employee = Guid.NewGuid();
                cp = new FakeControlPlane("frostaura/technologies", "review");
                cp.Append("message", new JsonObject { ["from"] = "owner", ["kind"] = "memory.review", ["employeeId"] = employee.ToString(), ["text"] = "Review it." });
                cp.Memory[employee] = [new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["title"] = "Entry", ["body"] = "Body.", ["kind"] = "fact", ["scope"] = "frostaura" }];
                await EstimateTests.Executor(cp, model, workflows: [new ReviewWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
                Assert.Empty(cp.MemoryReviews);
                break;
            case "change screen":
                (cp, var ws, var dock) = ChangeRun();
                await RunChangeAsync(cp, model, ws, dock);
                break;
            case "suggestions":
                cp = new FakeControlPlane("frostaura", "suggest") { Headroom = 100m, SuggestionContext = SuggestionContext() };
                cp.Append("estimate.made", new JsonObject { ["credits"] = 3m, ["basis"] = "suggest" });
                cp.Append("message", new JsonObject { ["from"] = "owner", ["kind"] = "ideas.suggest", ["text"] = "Suggest ideas." });
                await EstimateTests.Executor(cp, model, workflows: [new SuggestWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
                break;
            case "verdict judge":
                // The screen and the researchers answer; only the judge's verdict is cut off, every time.
                cp = new FakeControlPlane("frostaura/technologies", "research", "A recipe box for families.", Idea) { Headroom = 100m };
                var researchers = Researchers(Verdict());
                model = new ScriptedModel { Fallback = c => System(c).StartsWith("You judge whether a product idea", StringComparison.Ordinal) ? CutOff(c) : researchers.CompleteAsync(c, CancellationToken.None).Result };
                await EstimateTests.Executor(cp, model, workflows: [new ResearchWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
                Assert.Null(cp.Verdict);
                break;
            default:
                (cp, var cws, var cdock) = ChangeRun();
                var factory = new Factory { Plan = Ratings() };
                var inner = factory.Model();
                model = new ScriptedModel { Fallback = c => System(c).StartsWith("You are a sceptical evaluator", StringComparison.Ordinal) ? CutOff(c) : inner.CompleteAsync(c, CancellationToken.None).Result };
                await RunChangeAsync(cp, model, cws, cdock);
                Assert.Contains(cp.Events, e => e.Type == "evaluation.failed" && e.Payload.ToJsonString().Contains("too long to finish", StringComparison.Ordinal));
                break;
        }

        var said = cp.Run.ToJsonString() + string.Join("\n", cp.Events.Select(e => e.Payload.ToJsonString()));
        Assert.Contains("too long to finish", said, StringComparison.Ordinal);
        Assert.DoesNotContain("agreed form", said, StringComparison.Ordinal);
        // Each cut answer was asked for again once, with twice the room and never billed.
        var cut = model.Calls.Where(c => c.Repair && model.Calls.Any(o => !o.Repair && o.MaxTokens * 2 == c.MaxTokens && o.TaskType == c.TaskType)).ToList();
        Assert.NotEmpty(cut);
    }
}
