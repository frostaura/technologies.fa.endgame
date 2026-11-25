using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Context;
using Endgame.Harness.Events;
using Endgame.Harness.Model;
using Endgame.Harness.Planning;
using Endgame.Harness.Skills;
using Endgame.Harness.Subagents;
using Endgame.Harness.Tasks;
using Endgame.Harness.Tools;

namespace Endgame.Tests.Harness;

/// <summary>Replay and resume, compaction, sub-agents, plans, skills and tasks.</summary>
public sealed class ReplayAndContextTests
{
    /// <summary>
    /// A model that answers from the conversation, as a real one does: the next step is decided by how
    /// many results it has had, and a call answered "interrupted" is simply made again.
    /// </summary>
    private static ScriptedModel FourSteps()
    {
        (string Name, object Args)[] steps =
        [
            ("read_file", new { path = "a.txt" }),
            ("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" }),
            ("run", new { command = "dotnet test" }),
            ("notes", new { action = "append", text = "tests pass" }),
        ];
        return new ScriptedModel
        {
            Fallback = call =>
            {
                var step = call.Messages.Count(m => m!["role"]!.GetValue<string>() == "tool"
                    && !(m["content"]?.ToString() ?? "").StartsWith("This call was interrupted", StringComparison.Ordinal));
                if (step >= steps.Length)
                {
                    return ScriptedModel.Text("All done.");
                }

                // An edit that already happened before the crash: the model sees it and moves on.
                return ScriptedModel.Tools((steps[step].Name, steps[step].Args, $"c{step}-{Guid.NewGuid():N}"[..12]));
            },
        };
    }

    [Fact]
    public async Task Replaying_a_log_rebuilds_exactly_the_state_the_loop_had()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var (live, log) = await TestAgents.RunAsync(Agent(), FourSteps(), ws);
        var replayed = Replay.Fold(log.Events, "main").State;
        Assert.Equal(live.State.Messages.ToJsonString(), replayed.Messages.ToJsonString());
        Assert.Equal(live.State.Steps, replayed.Steps);
        Assert.Equal(live.State.ToolCalls, replayed.ToolCalls);
        Assert.Equal(live.State.SettledCredits, replayed.SettledCredits);
        Assert.Equal(live.State.PinnedProvider, replayed.PinnedProvider);
        Assert.Equal(live.State.Notes, replayed.Notes);
        Assert.Equal(live.State.EverEdited, replayed.EverEdited);
        Assert.Equal(StopReasons.Completed, replayed.StopReason);
        Assert.Equal("All done.", replayed.FinalText);
    }

    [Theory]
    [InlineData(3)]
    [InlineData(6)]
    [InlineData(9)]
    [InlineData(12)]
    public async Task A_run_killed_at_any_event_resumes_from_its_log_and_finishes_the_same_way(int dieAtEvent)
    {
        // The reference: the same script, never interrupted.
        var (reference, _) = await TestAgents.RunAsync(Agent(), FourSteps(), new FakeWorkspace().With("a.txt", "one\n"));

        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var log = new InMemoryRunLog();
        var written = 0;
        log.FailWhen = _ => ++written == dieAtEvent ? new IOException("the Runner process died") : null;
        var agent = Agent();
        var model = FourSteps();
        await Assert.ThrowsAsync<IOException>(() => new AgentLoop(agent, TestAgents.Services(model), ws, log).StartAsync("Do the task.", CancellationToken.None));
        log.FailWhen = null;

        // A new process: a fresh loop, the same definition, the log as it was left. The model answers
        // from where the script had got to (what the crashed process had consumed is gone).
        var resumed = await new AgentLoop(agent, TestAgents.Services(model), ws, log).ResumeAsync(log.Events, "Do the task.", CancellationToken.None);
        Assert.True(reference.StopReason == resumed.StopReason, string.Join("\n", log.Events.Select(e => $"{e.Seq} {e.Type} {e.Payload.ToJsonString()[..Math.Min(220, e.Payload.ToJsonString().Length)]}")));
        Assert.Equal("two\n", ws.Text("a.txt"));
        var seqs = log.Events.Select(e => e.Seq).ToList();
        Assert.Equal(Enumerable.Range(1, seqs.Count).Select(i => (long)i), seqs);
        // Every tool call has exactly one recorded result, interrupted or not.
        var requested = log.Events.Where(e => e.Type == "tool.requested").Select(e => e.Payload["callId"]!.GetValue<string>()).ToList();
        var results = log.Events.Where(e => e.Type == "tool.result").Select(e => e.Payload["callId"]!.GetValue<string>()).ToList();
        Assert.Equal(requested.Distinct().Order(), results.Distinct().Order());
        Assert.Equal(results.Count, results.Distinct().Count());
    }

    [Fact]
    public async Task A_call_in_flight_when_the_run_died_is_answered_as_interrupted()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var log = new InMemoryRunLog();
        log.FailWhen = e => e.Type == "tool.result" ? new IOException("died mid-call") : null;
        var agent = TestAgents.Builder();
        var model = new ScriptedModel().ThenTool("run", new { command = "make migration name=X" }, "c1").ThenText("Checked; done.");
        await Assert.ThrowsAsync<IOException>(() => new AgentLoop(agent, TestAgents.Services(model), ws, log).StartAsync("t", CancellationToken.None));
        log.FailWhen = null;
        var resumed = await new AgentLoop(agent, TestAgents.Services(model), ws, log).ResumeAsync(log.Events, "t", CancellationToken.None);
        Assert.True(resumed.Completed);
        var interrupted = log.Events.Single(e => e.Type == "tool.result");
        Assert.Equal("interrupted", interrupted.Payload["errorKind"]!.GetValue<string>());
        Assert.Contains("effect is unknown", model.Calls[^1].Messages[^1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Resuming_an_agent_that_had_finished_does_not_call_the_model_again()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var (_, log) = await TestAgents.RunAsync(Agent(), FourSteps(), ws);
        var model = new ScriptedModel();
        var resumed = await new AgentLoop(Agent(), TestAgents.Services(model), ws, log).ResumeAsync(log.Events, "t", CancellationToken.None);
        Assert.Equal("All done.", resumed.FinalText);
        Assert.Empty(model.Calls);
    }

    [Fact]
    public void The_cut_point_never_separates_a_tool_result_from_its_call()
    {
        var messages = new JsonArray
        {
            Msg("system"), Msg("user"),
            Msg("assistant"), Msg("tool"), Msg("assistant"), Msg("tool"), Msg("tool"), Msg("assistant"), Msg("tool"), Msg("assistant"), Msg("tool"), Msg("tool"), Msg("tool"),
        };
        var cut = Compactor.CutPoint(messages, new CompactionOptions { KeepRecentMessages = 4 });
        Assert.Equal("assistant", messages[cut]!["role"]!.GetValue<string>());
        Assert.Equal(9, cut);
        var applied = Compactor.Apply(messages, 2, cut, "summary");
        Assert.Equal(["system", "user", "user", "assistant", "tool", "tool", "tool"], applied.Select(m => m!["role"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Near_the_limit_the_loop_compacts_keeping_the_plan_tasks_notes_and_recent_results()
    {
        var ws = new FakeWorkspace();
        for (var i = 0; i < 12; i++)
        {
            ws.With($"f{i}.txt", string.Join('\n', Enumerable.Range(0, 200).Select(n => $"file {i} line {n} with padding text that makes every line long enough to matter here")));
        }

        var model = new ScriptedModel
        {
            Summariser = call =>
            {
                Assert.Contains("file 0 line", call.Messages[1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
                return ScriptedModel.Text("We read f0 to f8; nothing changed yet.");
            },
        };
        model.ThenTool("propose_plan", new { summary = "Read every file.", items = new[] { new { id = "read", deliverable = "all files read", check = "notes list them" } } });
        model.ThenTool("notes", new { action = "append", text = "f3 holds the config" });
        for (var i = 0; i < 12; i++)
        {
            model.ThenTool("read_file", new { path = $"f{i}.txt" });
        }

        model.ThenText("Read them all.");
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new ProposePlanTool(), new NotesTool()]);
        var agent = TestAgents.Builder(tools, a => a with { Compaction = new CompactionOptions { ContextTokens = 40_000, KeepRecentMessages = 4 } });
        var (result, log) = await TestAgents.RunAsync(agent, model, ws);
        Assert.True(result.Completed);
        Assert.True(result.State.Compactions >= 1);
        var summary = result.State.Messages[2]!["content"]!.GetValue<string>();
        Assert.Contains("We read f0 to f8", summary, StringComparison.Ordinal);
        Assert.Contains("[read] all files read", summary, StringComparison.Ordinal);
        Assert.Contains("notes are kept outside the conversation", summary, StringComparison.Ordinal);
        Assert.Contains("file 11 line", result.State.Messages[^2]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.True(Compactor.EstimateTokens(result.State.Messages) < 40_000);
        // The compacted state survives replay too.
        Assert.Equal(result.State.Messages.ToJsonString(), Replay.Fold(log.Events, "main").State.Messages.ToJsonString());
    }

    [Fact]
    public async Task A_sub_agent_has_its_own_context_tool_subset_and_nested_events_and_returns_only_its_summary()
    {
        var ws = new FakeWorkspace().With("secret.txt", "TOKEN-IN-CHILD-CONTEXT\n");
        var model = new ScriptedModel()
            .ThenTool("spawn", new { objective = "Read secret.txt and say how long it is.", output_format = "One sentence.", boundaries = "Read only.", tools = new[] { "read_file" } })
            // The child's turns:
            .Then(call =>
            {
                Assert.Equal("read_file", Assert.Single(call.Tools!)!["function"]!["name"]!.GetValue<string>());
                Assert.Contains("You are a sub-agent", call.Messages[0]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
                return ScriptedModel.Tools(("read_file", new { path = "secret.txt" }, null));
            })
            .Then(call => ScriptedModel.Tools(("write_file", new { path = "x.txt", content = "x" }, null)))
            .ThenText("It is one line long.")
            // The parent again:
            .Then(call =>
            {
                var context = call.Messages.ToJsonString();
                Assert.DoesNotContain("TOKEN-IN-CHILD-CONTEXT", context, StringComparison.Ordinal);
                Assert.Contains("It is one line long.", context, StringComparison.Ordinal);
                return ScriptedModel.Text("The file is one line.");
            });
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new SpawnTool()]);
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(tools), model, ws);
        Assert.Equal("The file is one line.", result.FinalText);
        Assert.False(ws.Files.ContainsKey("/workspace/x.txt"));
        var childEvents = log.Events.Where(e => Replay.Agent(e) == "main.sub-1").ToList();
        Assert.Contains(childEvents, e => e.Type == "tool.result" && e.Payload["errorKind"]?.GetValue<string>() == "unknown_tool");
        Assert.Contains(log.Events, e => e.Type == "subagent.started" && e.Payload["brief"]!.GetValue<string>().StartsWith("Read secret", StringComparison.Ordinal)
            && e.Payload["title"]!.GetValue<string>().Length is > 0 and <= 60 && e.Payload["briefDetail"]!["objective"] is not null);
        Assert.Equal("It is one line long.", log.Events.Single(e => e.Type == "subagent.finished").Payload["summary"]!.GetValue<string>());
        Assert.Equal(0.05m, result.State.SettledCredits);
    }

    [Fact]
    public async Task Independent_read_only_sub_agents_of_one_turn_work_at_the_same_time_and_report_in_order()
    {
        // Each child waits until both are in flight: run one after the other, this would never finish.
        var model = new BarrierModel(2);
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new SpawnTool()]);
        var run = TestAgents.RunAsync(TestAgents.Builder(tools), model, new FakeWorkspace().With("a.txt", "a\n"));
        var (result, log) = await run.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(result.Completed, result.StopReason);
        Assert.Equal(2, model.MostAtOnce);
        var started = log.Events.Where(e => e.Type == "subagent.started").Select(e => e.Payload["subagent"]!.GetValue<string>()).Order().ToList();
        Assert.Equal(["main.sub-1", "main.sub-2"], started);
        // Results enter the parent's conversation in the order the calls were made, and replay agrees.
        var results = log.Events.Where(e => e.Type == "tool.result" && Replay.Agent(e) == "main").Select(e => e.Payload["callId"]!.GetValue<string>()).ToList();
        Assert.Equal(["survey-a", "survey-b"], results);
        var replayed = Replay.Fold(log.Events, "main").State;
        Assert.Equal(result.State.Messages.ToJsonString(), replayed.Messages.ToJsonString());
        Assert.Equal(2, replayed.SubagentsStarted);
    }

    /// <summary>The parent asks for two surveys at once; each child blocks until the other has started.</summary>
    private sealed class BarrierModel(int parties) : IModelClient
    {
        private readonly TaskCompletionSource all = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int inFlight;
        private int arrived;

        public int MostAtOnce { get; private set; }

        public async Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken)
        {
            var system = call.Messages[0]!["content"]!.GetValue<string>();
            if (!system.Contains("You are a sub-agent", StringComparison.Ordinal))
            {
                return call.Messages.Count == 2
                    ? ScriptedModel.Tools(
                        ("spawn", new { title = "Survey A", objective = "Survey part A.", output_format = "One line.", boundaries = "Read only." }, "survey-a"),
                        ("spawn", new { title = "Survey B", objective = "Survey part B.", output_format = "One line.", boundaries = "Read only." }, "survey-b"))
                    : ScriptedModel.Text("Both surveys are in.");
            }

            lock (this)
            {
                inFlight++;
                MostAtOnce = Math.Max(MostAtOnce, inFlight);
                if (++arrived == parties)
                {
                    all.TrySetResult();
                }
            }

            await all.Task.WaitAsync(cancellationToken);
            await Task.Yield();
            lock (this)
            {
                inFlight--;
            }

            return ScriptedModel.Text(system.Contains("part A", StringComparison.Ordinal) ? "A is fine." : "B is fine.");
        }
    }

    [Fact]
    public async Task A_tool_that_prints_binary_never_puts_a_nul_into_the_log()
    {
        // The first real build failed on this: grep -a over a DLL printed NUL bytes, and jsonb refused the event.
        var ws = new FakeWorkspace { Shell = _ => FakeWorkspace.Ok("match\0\u0001here\ttab\n") };
        var model = new ScriptedModel().ThenTool("run", new { command = "grep -a x lib.dll" }).ThenText("Done.");
        var (_, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        var content = log.Events.Single(e => e.Type == "tool.result").Payload["content"]!.GetValue<string>();
        Assert.DoesNotContain('\0', content);
        Assert.DoesNotContain('\u0001', content);
        Assert.Contains("match\uFFFD\uFFFDhere\ttab", content, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_fan_out_cap_refuses_more_sub_agents()
    {
        var spawn = new { objective = "o", output_format = "f", boundaries = "b" };
        var model = new ScriptedModel()
            .ThenTool("spawn", spawn).ThenText("child 1")
            .ThenTool("spawn", spawn)
            .ThenText("Done.");
        var agent = TestAgents.Builder(TestAgents.WorkspaceTools.Concat<ITool>([new SpawnTool()]), a => a with { Limits = a.Limits with { MaxSubagents = 1 } });
        var (_, log) = await TestAgents.RunAsync(agent, model, new FakeWorkspace());
        Assert.Equal("fan_out_cap", log.Events.Where(e => e.Type == "tool.result" && Replay.Agent(e) == "main").Last().Payload["errorKind"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_sub_agent_cannot_be_given_tools_its_parent_lacks()
    {
        var model = new ScriptedModel().ThenTool("spawn", new { objective = "o", output_format = "f", boundaries = "b", tools = new[] { "deploy" } }).ThenText("Done.");
        var (_, log) = await TestAgents.RunAsync(TestAgents.Builder(TestAgents.WorkspaceTools.Concat<ITool>([new SpawnTool()])), model, new FakeWorkspace());
        Assert.Contains("tools you do not have: deploy", log.Events.Single(e => e.Type == "tool.result").Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task In_plan_mode_the_agent_explores_read_only_and_must_emit_a_plan_before_any_edit()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var model = new ScriptedModel()
            .ThenTool("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" })
            .ThenTool("propose_plan", new { summary = "Change one to two.", items = new[] { new { id = "edit", deliverable = "a.txt says two", check = "" } } })
            .ThenTool("propose_plan", new { summary = "Change one to two.", items = new[] { new { id = "edit", deliverable = "a.txt says two", check = "cat a.txt shows two" } } })
            .ThenTool("edit_file", new { path = "a.txt", old_string = "one", new_string = "two" })
            .ThenTool("mark_item", new { id = "edit", status = "done", evidence = "edited" })
            .ThenText("Done.");
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new ProposePlanTool(), new MarkItemTool()]);
        var agent = TestAgents.Builder(tools, a => a with { Permissions = a.Permissions.WithRequirePlan(true), StopHooks = [] });
        var (result, log) = await TestAgents.RunAsync(agent, model, ws);
        var results = log.Events.Where(e => e.Type == "tool.result").Select(e => e.Payload["errorKind"]?.GetValue<string>()).ToList();
        Assert.Equal(["denied", "bad_arguments", null, null, null], results);
        Assert.Equal("plan:required", log.Events.First(e => e.Type == "tool.denied").Payload["rule"]!.GetValue<string>());
        var proposed = log.Events.Single(e => e.Type == "plan.proposed");
        Assert.True(proposed.Seq < log.Events.Single(e => e.Type == "tool.result" && e.Payload["name"]!.GetValue<string>() == "edit_file" && e.Payload["isError"]!.GetValue<bool>() == false).Seq);
        Assert.Contains(log.Events, e => e.Type == "plan.accepted");
        Assert.Equal("done", result.State.Marks["edit"].Status);
        Assert.Equal("two\n", ws.Text("a.txt"));
    }

    [Fact]
    public async Task A_plan_mode_run_cannot_change_anything_and_ends_with_its_plan()
    {
        var ws = new FakeWorkspace().With("a.txt", "one\n");
        var model = new ScriptedModel()
            .ThenTool("write_file", new { path = "b.txt", content = "x" })
            .ThenTool("propose_plan", new { summary = "s", items = new[] { new { id = "i", deliverable = "d", check = "c" } } })
            .ThenText("Plan proposed.");
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new ProposePlanTool()]);
        var agent = TestAgents.Builder(tools, a => a with { Permissions = a.Permissions.WithMode(Endgame.Harness.Permissions.AgentMode.Plan), AutoAcceptPlan = false });
        var (result, log) = await TestAgents.RunAsync(agent, model, ws);
        Assert.Equal("mode:plan", log.Events.Single(e => e.Type == "tool.denied").Payload["rule"]!.GetValue<string>());
        Assert.NotNull(result.State.Plan);
        Assert.DoesNotContain(log.Events, e => e.Type == "plan.accepted");
        Assert.False(ws.Files.ContainsKey("/workspace/b.txt"));
    }

    [Fact]
    public async Task Skills_sit_in_context_as_a_name_and_trigger_and_load_on_demand()
    {
        var library = new SkillLibrary([SkillLibrary.Parse("---\nname: add-endpoint\ntrigger: Adding an API endpoint.\n---\n# Steps\n1. Map it on the api group.\n", "a.md")]);
        Assert.Equal("Skills — procedures you can load with load_skill when one fits the work:\n- add-endpoint: Adding an API endpoint.\n", SkillLibrary.Index(library));
        var model = new ScriptedModel().ThenTool("load_skill", new { name = "add-endpoint" }).ThenTool("load_skill", new { name = "nope" }).ThenText("Done.");
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new LoadSkillTool()]);
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(tools), model, new FakeWorkspace(), services: TestAgents.Services(model) with { Skills = library });
        var results = log.Events.Where(e => e.Type == "tool.result").ToList();
        Assert.Contains("1. Map it on the api group.", results[0].Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("Skills: add-endpoint", results[1].Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("add-endpoint", result.State.LoadedSkills);
        Assert.Throws<FormatException>(() => SkillLibrary.Parse("# no front matter", "b.md"));
    }

    [Fact]
    public async Task The_tasks_tool_creates_claims_and_completes_and_a_lost_race_is_a_clear_error()
    {
        var board = new FakeBoard();
        var model = new ScriptedModel()
            .ThenTool("tasks", new { action = "create", title = "Wire the booking form" })
            .Then(_ => ScriptedModel.Tools(("tasks", new { action = "claim", id = board.Created[0].Id.ToString() }, null)))
            .Then(_ => ScriptedModel.Tools(("tasks", new { action = "complete", id = board.Created[0].Id.ToString(), summary = "done" }, null)))
            .Then(_ => ScriptedModel.Tools(("tasks", new { action = "claim", id = board.Taken.ToString() }, null)))
            .ThenTool("tasks", new { action = "list" })
            .ThenText("Done.");
        var tools = TestAgents.WorkspaceTools.Concat<ITool>([new TasksTool()]);
        var (_, log) = await TestAgents.RunAsync(TestAgents.Builder(tools), model, new FakeWorkspace(), services: TestAgents.Services(model) with { Tasks = board });
        var results = log.Events.Where(e => e.Type == "tool.result").Select(e => e.Payload["content"]!.GetValue<string>()).ToList();
        Assert.StartsWith("Created", results[0], StringComparison.Ordinal);
        Assert.StartsWith("Claimed", results[1], StringComparison.Ordinal);
        Assert.StartsWith("Completed", results[2], StringComparison.Ordinal);
        Assert.Contains("held by run", results[3], StringComparison.Ordinal);
        Assert.Contains("[done] Wire the booking form", results[4], StringComparison.Ordinal);

        // The owner reads task titles: one naming files or endpoints is refused with how to say it.
        var plain = new ScriptedModel().ThenTool("tasks", new { action = "create", title = "Add POST api/bookings in BookingsEndpoints.cs" }).ThenText("Done.");
        var (_, refused) = await TestAgents.RunAsync(TestAgents.Builder(tools), plain, new FakeWorkspace(), services: TestAgents.Services(plain) with { Tasks = new FakeBoard() });
        Assert.Contains("plain words", refused.Events.First(e => e.Type == "tool.result").Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    private static AgentDefinition Agent() => TestAgents.Builder(TestAgents.WorkspaceTools.Concat<ITool>([new NotesTool()]));

    private static JsonObject Msg(string role) => new() { ["role"] = role, ["content"] = new string('x', 100) };

    private sealed class FakeBoard : ITaskBoard
    {
        public List<TaskInfo> Created { get; } = [];

        public Guid Taken { get; } = Guid.NewGuid();

        public Task<TaskInfo> CreateAsync(string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken)
        {
            var task = new TaskInfo(Guid.NewGuid(), title, "todo", null, estimateCredits);
            Created.Add(task);
            return Task.FromResult(task);
        }

        public Task<TaskInfo> CheckoutAsync(Guid taskId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken) =>
            taskId == Taken
                ? throw new TaskConflictException("conflict: the task's status or holder was not what you expected.", new TaskInfo(taskId, "Theirs", "in_progress", Guid.NewGuid(), null))
                : Task.FromResult(Created.Single(t => t.Id == taskId) with { Status = "in_progress" });

        public Task<TaskInfo> FinishAsync(Guid taskId, string status, string summary, decimal? actualCredits, CancellationToken cancellationToken) =>
            Task.FromResult(Created.Single(t => t.Id == taskId) with { Status = status });
    }
}
