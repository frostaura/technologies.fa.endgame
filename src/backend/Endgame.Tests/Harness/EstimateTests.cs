using System.Text.Json.Nodes;
using Endgame.Runner;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Workflows;
using Microsoft.Extensions.Logging.Abstractions;

namespace Endgame.Tests.Harness;

/// <summary>Estimates before work, the auto-mode budget gate, the start checkpoint, and scoring against actuals.</summary>
public sealed class EstimateTests
{
    private const string Scope = "frostaura/technologies/endgame/notes";

    [Fact]
    public async Task An_estimate_is_made_before_work_and_scored_at_the_end_against_what_the_gateway_settled()
    {
        var cp = new FakeControlPlane(Scope, "task", "Change one to two.") { Headroom = 100m };
        var model = new ScriptedModel().ThenTool("read_file", new { path = "a.txt" }).ThenText("Nothing to change.");
        model.Fallback = _ => ScriptedModel.Text("Done.");
        // The gateway's own settlements, as the control plane appends them.
        cp.Append("model.replied", new JsonObject { ["settledCredits"] = 0.4m, ["billable"] = true });
        cp.Append("model.replied", new JsonObject { ["settledCredits"] = 0.1m, ["billable"] = false });
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        var made = cp.Payload("estimate.made")!;
        Assert.Equal(1.5m, made["credits"]!.GetValue<decimal>());
        Assert.Contains("starting figure for task runs", made["basis"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.True(cp.Types.ToList().IndexOf("estimate.made") < cp.Types.ToList().IndexOf("tool.requested"));
        var scored = cp.Payload("estimate.scored")!;
        Assert.Equal(1.5m, scored["expectedCredits"]!.GetValue<decimal>());
        Assert.Equal(0.4m, scored["actualCredits"]!.GetValue<decimal>());
        Assert.Equal(0.1m, scored["nonBillableCredits"]!.GetValue<decimal>());
        Assert.Equal(["estimate.scored", "message", "run.finished"], cp.Types.TakeLast(3));
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task With_history_the_estimate_is_the_median_of_past_runs()
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 100m };
        cp.History.AddRange([1m, 9m, 3m, 2m]);
        await Executor(cp, new ScriptedModel()).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        var made = cp.Payload("estimate.made")!;
        Assert.Equal(2.5m, made["credits"]!.GetValue<decimal>());
        Assert.Contains("median of the last 4 task runs", made["basis"]!.GetValue<string>(), StringComparison.Ordinal);
        // History is read within the run's own organisation: the scope is sent.
        Assert.Contains(cp.Addresses, a => a.StartsWith("GET /internal/estimates/history?taskType=task&scope=" + Uri.EscapeDataString(Scope), StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("auto", false)]
    [InlineData("checkpoints", false)]
    [InlineData("checkpoints", true)]
    public async Task In_every_autonomy_mode_work_whose_estimate_would_break_the_budget_does_not_begin(string? autonomy, bool startCheckpoint)
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 1m, AnswerApproval = _ => true };
        if (autonomy is not null)
        {
            cp.Setting("autonomy", JsonValue.Create(autonomy)!);
        }

        if (startCheckpoint)
        {
            cp.Setting("checkpoint.start", JsonValue.Create(true)!);
        }

        var model = new ScriptedModel();
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Empty(model.Calls);
        Assert.Equal("paused", cp.Run["status"]!.GetValue<string>());
        Assert.Equal("estimate_over_budget", cp.Payload("message")!["code"]!.GetValue<string>());
        Assert.DoesNotContain("run.finished", cp.Types);
        // The budget waits before anything is asked: no "Start this work?" for work that cannot be paid for.
        Assert.Empty(cp.Approvals);
    }

    [Fact]
    public async Task An_estimate_the_control_plane_made_is_kept_and_gated_on()
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 5m };
        cp.Append("estimate.made", new JsonObject { ["credits"] = 8m, ["basis"] = "research" });
        var model = new ScriptedModel();
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Single(cp.Types, t => t == "estimate.made");
        Assert.Equal("paused", cp.Run["status"]!.GetValue<string>());
        Assert.Empty(model.Calls);
    }

    [Theory]
    [InlineData(true, "succeeded")]
    [InlineData(false, "cancelled")]
    public async Task With_a_start_checkpoint_the_owner_approves_the_estimate_first(bool approve, string status)
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 100m, AnswerApproval = _ => approve, ApprovalNote = approve ? null : "Too dear this month." };
        cp.Setting("autonomy", JsonValue.Create("checkpoints")!);
        cp.Setting("checkpoint.start", JsonValue.Create(true)!);
        var model = new ScriptedModel();
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.StartsWith("Start this work? Estimated 1.5 credits.", Assert.Single(cp.Approvals), StringComparison.Ordinal);
        Assert.Equal(status, cp.Run["status"]!.GetValue<string>());
        Assert.Equal(approve, model.Calls.Count > 0);
        // Declining the start stops the work, and the console says so rather than "the work carries on" (RUN-07).
        Assert.Equal("stops", cp.ApprovalsAsked.Single()["onDecline"]!.GetValue<string>());
        if (!approve)
        {
            // D19: a decline is not a failure and is not scored; it is told with the owner's own note.
            var said = cp.Events.Last(e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "You declined").Payload["text"]!.GetValue<string>();
            Assert.Contains("You declined to start this work", said, StringComparison.Ordinal);
            Assert.Contains("Too dear this month.", said, StringComparison.Ordinal);
            Assert.DoesNotContain("estimate.scored", cp.Types);
            Assert.Equal("declined_at_start", cp.Payload("run.finished")!["reason"]!.GetValue<string>());
        }
        else
        {
            Assert.Contains("estimate.scored", cp.Types);
        }
    }

    [Fact]
    public async Task A_conversation_is_never_held_at_the_start_checkpoint_but_still_waits_for_budget()
    {
        // D43: with "Before work starts" on, a chat message is answered without asking to start it first.
        var cp = new FakeControlPlane(Scope, "conversation", "How many apps do we have?") { Headroom = 100m };
        cp.Setting("autonomy", JsonValue.Create("checkpoints")!);
        cp.Setting("checkpoint.start", JsonValue.Create(true)!);
        var model = new ScriptedModel().ThenText("You have one app.");
        await Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Empty(cp.Approvals);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());

        // The budget still holds: an estimate over the headroom pauses it before anything is asked of a model.
        var poor = new FakeControlPlane(Scope, "conversation", "How many apps do we have?") { Headroom = 0.1m };
        var none = new ScriptedModel();
        await Executor(poor, none, workflows: [new ConversationWorkflow()]).ExecuteAsync(poor.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("paused", poor.Run["status"]!.GetValue<string>());
        Assert.Empty(none.Calls);
    }

    [Fact]
    public async Task A_resumed_run_does_not_gate_twice()
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 100m };
        cp.Append("estimate.made", new JsonObject { ["credits"] = 1m });
        cp.Append("message", new JsonObject { ["kind"] = "workflow.step", ["step"] = "estimate.gate", ["agent"] = "workflow", ["data"] = new JsonObject() });
        cp.Headroom = 0m;
        await Executor(cp, new ScriptedModel()).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
    }

    internal static RunExecutor Executor(FakeControlPlane cp, ScriptedModel model, FakeWorkspace? workspace = null, IEnumerable<IWorkflow>? workflows = null, FakeDock? dock = null, RunnerOptions? options = null)
    {
        options ??= new RunnerOptions();
        return new RunExecutor(cp.Client(), model, new FakeWorkspaces(workspace ?? new FakeWorkspace().With("a.txt", "one\n")), workflows ?? [new TaskWorkflow()],
            new AgentFactory(options), new Estimator(options), options, NullLogger<RunExecutor>.Instance, dock?.Client(), RunnerResources.Skills());
    }

    [Fact]
    public async Task A_workspace_waits_while_dock_prepares_its_image_and_still_fails_on_any_other_refusal()
    {
        var answers = new Queue<(System.Net.HttpStatusCode, string)>([
            (System.Net.HttpStatusCode.ServiceUnavailable, "{\"code\":\"workspace_image_not_ready\",\"detail\":\"building\"}"),
            (System.Net.HttpStatusCode.ServiceUnavailable, "{\"code\":\"workspace_image_not_ready\",\"detail\":\"building\"}"),
            (System.Net.HttpStatusCode.Created, $"{{\"id\":\"{Guid.NewGuid()}\",\"appId\":\"{Guid.NewGuid()}\",\"root\":\"/workspace\",\"branch\":\"main\",\"head\":\"c0\",\"leaseExpiresAt\":\"2026-11-25T03:00:00Z\"}}"),
        ]);
        var dock = new Endgame.Runner.Platform.DockClient(new HttpClient(new Answers(answers)) { BaseAddress = new Uri("http://dock") }) { WorkspaceImagePoll = TimeSpan.FromMilliseconds(10) };
        var request = new Endgame.Hosting.Contracts.CreateWorkspaceRequest(Guid.NewGuid(), Guid.NewGuid(), null, DateTimeOffset.UtcNow.AddMinutes(5), null, null);
        Assert.NotNull(await dock.CreateWorkspaceAsync(request, CancellationToken.None));
        Assert.Empty(answers);

        var refused = new Queue<(System.Net.HttpStatusCode, string)>([(System.Net.HttpStatusCode.ServiceUnavailable, "{\"code\":\"unavailable\",\"detail\":\"no database\"}")]);
        var other = new Endgame.Runner.Platform.DockClient(new HttpClient(new Answers(refused)) { BaseAddress = new Uri("http://dock") }) { WorkspaceImagePoll = TimeSpan.FromMilliseconds(10) };
        await Assert.ThrowsAsync<Endgame.Harness.Workspaces.WorkspaceException>(() => other.CreateWorkspaceAsync(request, CancellationToken.None));
    }

    private sealed class Answers(Queue<(System.Net.HttpStatusCode Status, string Body)> answers) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var (status, body) = answers.Dequeue();
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") });
        }
    }
}
