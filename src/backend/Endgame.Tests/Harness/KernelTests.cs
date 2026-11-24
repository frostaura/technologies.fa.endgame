using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Hooks;
using Endgame.Harness.Model;
using Endgame.Harness.Workspaces;

namespace Endgame.Tests.Harness;

/// <summary>The loop's rules from ARCH-006, each driven by a scripted model.</summary>
public sealed class KernelTests
{
    [Fact]
    public async Task The_loop_runs_tools_feeds_results_back_and_stops_when_the_model_stops()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var model = new ScriptedModel()
            .ThenTool("read_file", new { path = "a.txt" })
            .ThenTool("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" })
            .ThenTool("run", new { command = "dotnet test" })
            .ThenText("Changed one to two.");
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        Assert.Equal(StopReasons.Completed, result.StopReason);
        Assert.Equal("Changed one to two.", result.FinalText);
        Assert.Equal("two\n", ws.Text("a.txt"));
        Assert.Equal(4, result.State.Steps);
        Assert.Equal(4, model.Calls.Count);
        // The second call saw the first tool's result, verbatim and in order.
        var second = model.Calls[1].Messages;
        Assert.Equal("tool", second[^1]!["role"]!.GetValue<string>());
        Assert.Contains("    1\tone", second[^1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(["message", "tool.requested", "tool.permitted", "tool.result"], log.Types().Take(4));
    }

    [Fact]
    public async Task The_assistant_message_is_echoed_exactly_reasoning_details_included()
    {
        var model = new ScriptedModel().ThenTool("list_files", new { }).ThenText("Done.");
        await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace().With("a", "x"));
        var echoed = model.Calls[1].Messages.Single(m => m!["role"]!.GetValue<string>() == "assistant")!.AsObject();
        Assert.Equal("thinking about it", echoed["reasoning"]!.GetValue<string>());
        Assert.Equal("reasoning.text", echoed["reasoning_details"]![0]!["type"]!.GetValue<string>());
        Assert.Equal("list_files", echoed["tool_calls"]![0]!["function"]!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task Malformed_arguments_go_back_as_a_tool_result_and_arguments_as_an_object_or_empty_are_accepted()
    {
        var ws = new FakeWorkspace().With("a.txt", "x\n");
        var model = new ScriptedModel()
            .Then(_ => ScriptedModel.Tools(("read_file", "{\"path\": \"a.txt\"", null)))
            .Then(_ => ScriptedModel.Tools(("list_files", "", null)))
            .Then(_ =>
            {
                var reply = ScriptedModel.Tools(("read_file", "x", null));
                reply.Message["tool_calls"]![0]!["function"]!["arguments"] = new JsonObject { ["path"] = "a.txt" };
                return reply;
            })
            .ThenText("Done.");
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        var results = log.Events.Where(e => e.Type == "tool.result").ToList();
        Assert.Equal("malformed", results[0].Payload["errorKind"]!.GetValue<string>());
        Assert.Contains("not valid JSON", results[0].Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.False(results[1].Payload["isError"]!.GetValue<bool>());
        Assert.False(results[2].Payload["isError"]!.GetValue<bool>());
        Assert.Equal(1, result.State.MalformedCalls);
    }

    [Fact]
    public async Task An_unknown_tool_gets_the_list_of_real_ones()
    {
        var model = new ScriptedModel().ThenTool("open_file", new { path = "a" }).ThenText("Done.");
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace());
        var content = log.Events.Single(e => e.Type == "tool.result").Payload["content"]!.GetValue<string>();
        Assert.Contains("There is no tool called 'open_file'", content, StringComparison.Ordinal);
        Assert.Contains("edit_file, git_diff, list_files", content, StringComparison.Ordinal);
        Assert.Equal(1, result.State.UnknownToolCalls);
    }

    [Fact]
    public async Task A_tool_call_written_as_text_gets_a_corrective_nudge_at_most_three_times()
    {
        var model = new ScriptedModel();
        for (var i = 0; i < 5; i++)
        {
            model.ThenText("<tool_call>{\"name\": \"read_file\", \"arguments\": {}}</tool_call>");
        }

        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace());
        Assert.Equal(3, result.State.TextToolNudges);
        Assert.Equal(4, model.Calls.Count);
        Assert.Equal(3, log.Events.Count(e => e.Payload["kind"]?.GetValue<string>() == "nudge"));
    }

    [Fact]
    public async Task The_stop_hook_reminds_once_to_verify_after_an_edit()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var model = new ScriptedModel()
            .ThenTool("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" })
            .ThenText("Done, I think.")
            .ThenText("Still done.");
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        Assert.Equal(3, model.Calls.Count);
        Assert.Contains("Stop hook", model.Calls[2].Messages[^1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(1, result.State.StopHookRuns["verify-after-edit"]);
        Assert.Equal("Still done.", result.FinalText);
    }

    [Fact]
    public async Task A_check_hook_sends_the_agent_back_with_the_failure_and_how_to_fix_it()
    {
        var lints = 0;
        var ws = new FakeWorkspace
        {
            Shell = c => c.Shell!.Contains("make lint", StringComparison.Ordinal) && lints++ == 0
                ? FakeWorkspace.Fail(2, "web/src/App.tsx:3 no-root-relative-url")
                : FakeWorkspace.Ok("ok"),
        }.With("a.txt", "one\n");
        var model = new ScriptedModel()
            .ThenTool("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" })
            .ThenTool("run", new { command = "make test" })
            .ThenText("Done.")
            .ThenText("Fixed the lint.");
        var hook = new CheckCommandStopHook("lint", "make lint", "Fix each lint error at the file and line shown; never disable the rule.");
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(change: a => a with { StopHooks = [new VerifyAfterEditStopHook(), hook] }), model, ws);
        var nudge = model.Calls[3].Messages[^1]!["content"]!.GetValue<string>();
        Assert.Contains("Stop hook 'lint': `make lint` failed with exit code 2. Fix each lint error", nudge, StringComparison.Ordinal);
        Assert.Contains("no-root-relative-url", nudge, StringComparison.Ordinal);
        Assert.Equal(StopReasons.Completed, result.StopReason);
    }

    [Fact]
    public async Task A_repeated_identical_failing_call_stops_the_run_early()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var model = new ScriptedModel { Fallback = _ => ScriptedModel.Tools(("edit_file", new { path = "a.txt", old_string = "zzz", new_string = "y" }, null)) };
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        Assert.Equal(StopReasons.RepeatedFailure, result.StopReason);
        Assert.Equal(3, model.Calls.Count);
        Assert.Equal(3, result.State.FailedEdits);
    }

    [Fact]
    public async Task Different_failures_do_not_count_as_repeated()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var n = 0;
        var model = new ScriptedModel { Fallback = _ => n++ < 6 ? ScriptedModel.Tools(("edit_file", new { path = "a.txt", old_string = $"zzz{n}", new_string = "y" }, null)) : ScriptedModel.Text("Gave up.") };
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        Assert.Equal(StopReasons.CompletedNoEdits, result.StopReason);
    }

    [Fact]
    public async Task Tool_calls_per_turn_are_capped()
    {
        var calls = Enumerable.Range(0, 5).Select(i => ("list_files", (object)new { }, (string?)null)).ToArray();
        var model = new ScriptedModel().Then(_ => ScriptedModel.Tools(calls)).ThenText("Done.");
        var agent = TestAgents.Builder(change: a => a with { Limits = a.Limits with { MaxToolCallsPerTurn = 2 } });
        var (_, log) = await TestAgents.RunAsync(agent, model, new FakeWorkspace().With("a", "x"));
        var kinds = log.Events.Where(e => e.Type == "tool.result").Select(e => e.Payload["errorKind"]?.GetValue<string>()).ToList();
        Assert.Equal([null, null, "turn_cap", "turn_cap", "turn_cap"], kinds);
    }

    [Fact]
    public async Task The_step_limit_stops_a_looping_model()
    {
        var model = new ScriptedModel { Fallback = _ => ScriptedModel.Tools(("list_files", new { max_depth = Random.Shared.Next(1, 9) }, null)) };
        var agent = TestAgents.Builder(change: a => a with { Limits = a.Limits with { MaxSteps = 5 } });
        var (result, _) = await TestAgents.RunAsync(agent, model, new FakeWorkspace().With("a", "x"));
        Assert.Equal(StopReasons.MaxSteps, result.StopReason);
        Assert.Equal(5, model.Calls.Count);
    }

    [Fact]
    public async Task A_refused_budget_is_terminal_and_never_retried()
    {
        var model = new ScriptedModel().ThenFail(ModelFailure.BudgetExhausted).ThenText("never reached");
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace());
        Assert.Equal(StopReasons.BudgetExhausted, result.StopReason);
        Assert.Single(model.Calls);
        Assert.Equal("agent.stopped", log.Events[^1].Payload["kind"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(ModelFailure.RateLimited, 2)]
    [InlineData(ModelFailure.ServerError, 2)]
    [InlineData(ModelFailure.Timeout, 2)]
    [InlineData(ModelFailure.EmptyReply, 2)]
    [InlineData(ModelFailure.BadRequest, 1)]
    [InlineData(ModelFailure.CeilingUnreachable, 1)]
    public async Task Only_rate_limits_server_errors_timeouts_and_empty_replies_are_retried(ModelFailure failure, int calls)
    {
        var model = new ScriptedModel().ThenFail(failure).ThenText("Done.");
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace());
        Assert.Equal(calls, model.Calls.Count);
        Assert.Equal(calls == 2, result.Completed);
    }

    [Fact]
    public async Task The_provider_is_pinned_after_the_first_reply_and_qwen_gets_cache_marks()
    {
        var model = new ScriptedModel()
            .Then(_ => ScriptedModel.Reply(ScriptedModel.Tools(("list_files", new { }, null)).Message, 0.01m, "Alibaba", "qwen/qwen3.7-plus"))
            .ThenText("Done.");
        await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace().With("a", "x"));
        Assert.Null(model.Calls[0].ProviderOrder);
        Assert.Equal(["Alibaba"], model.Calls[1].ProviderOrder);
        var marked = model.Calls[1].Messages;
        Assert.Equal("ephemeral", marked[0]!["content"]![0]!["cache_control"]!["type"]!.GetValue<string>());
        Assert.Equal("ephemeral", marked[^1]!["content"]![0]!["cache_control"]!["type"]!.GetValue<string>());
        // The assistant message in between stays exactly as it came.
        Assert.IsAssignableFrom<JsonValue>(marked[2]!["content"]);
        Assert.All(model.Calls, c => Assert.StartsWith($"{c.RunId}:main:", c.IdempotencyKey, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Repair_work_is_sent_as_non_billable()
    {
        var model = new ScriptedModel().ThenText("Repaired.");
        await TestAgents.RunAsync(TestAgents.Builder(change: a => a with { Repair = true }), model, new FakeWorkspace());
        Assert.True(model.Calls.Single().Repair);
    }

    [Theory]
    [InlineData(RunSignal.Pause, StopReasons.Paused)]
    [InlineData(RunSignal.Cancel, StopReasons.Cancelled)]
    [InlineData(RunSignal.LeaseLost, StopReasons.LeaseLost)]
    public async Task Pause_cancel_and_a_lost_lease_are_honoured_between_steps(RunSignal signal, string reason)
    {
        var control = new SignalAfter(2, signal);
        var model = new ScriptedModel { Fallback = _ => ScriptedModel.Tools(("list_files", new { max_depth = Random.Shared.Next(1, 9) }, null)) };
        var (result, _) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace().With("a", "x"), services: TestAgents.Services(model) with { Control = control });
        Assert.Equal(reason, result.StopReason);
        Assert.Equal(2, model.Calls.Count);
    }

    [Fact]
    public async Task A_sub_agent_budget_slice_stops_the_agent_when_spent()
    {
        var model = new ScriptedModel { Fallback = _ => ScriptedModel.Tools(("list_files", new { max_depth = Random.Shared.Next(1, 9) }, null)) };
        var agent = TestAgents.Builder(change: a => a with { Limits = a.Limits with { CreditBudget = 0.025m } });
        var (result, _) = await TestAgents.RunAsync(agent, model, new FakeWorkspace().With("a", "x"));
        Assert.Equal(StopReasons.BudgetSliceSpent, result.StopReason);
        Assert.Equal(3, model.Calls.Count);
    }

    [Fact]
    public async Task A_workspace_refusal_is_a_tool_error_not_a_crash()
    {
        var ws = new ThrowingWorkspace();
        var model = new ScriptedModel().ThenTool("run", new { command = "ls" }).ThenText("Done.");
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        Assert.True(result.Completed);
        Assert.Equal("workspace_error", log.Events.Single(e => e.Type == "tool.result").Payload["errorKind"]!.GetValue<string>());
    }

    private sealed class SignalAfter(int continues, RunSignal then) : IRunControl
    {
        private int checks;

        public ValueTask<RunSignal> CheckAsync(CancellationToken cancellationToken) =>
            ValueTask.FromResult(checks++ < continues ? RunSignal.Continue : then);
    }

    private sealed class ThrowingWorkspace : IWorkspace
    {
        public string Root => "/workspace";

        public Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken) => throw new WorkspaceException("gone", "not_found");

        public Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken) => throw new WorkspaceException("gone", "not_found");

        public Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken) => throw new WorkspaceException("The workspace is gone.", "not_found");

        public Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken) => throw new WorkspaceException("gone", "not_found");
    }
}
