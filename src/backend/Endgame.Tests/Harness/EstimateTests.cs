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

    [Fact]
    public async Task In_auto_mode_work_whose_estimate_would_break_the_budget_does_not_begin()
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 1m };
        var model = new ScriptedModel();
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.Empty(model.Calls);
        Assert.Equal("paused", cp.Run["status"]!.GetValue<string>());
        Assert.Equal("estimate_over_budget", cp.Payload("message")!["code"]!.GetValue<string>());
        Assert.DoesNotContain("run.finished", cp.Types);
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
    [InlineData(false, "failed")]
    public async Task With_a_start_checkpoint_the_owner_approves_the_estimate_first(bool approve, string status)
    {
        var cp = new FakeControlPlane(Scope, "task", "x") { Headroom = 100m, AnswerApproval = _ => approve };
        cp.Setting("autonomy", JsonValue.Create("checkpoints")!);
        cp.Setting("checkpoint.start", JsonValue.Create(true)!);
        var model = new ScriptedModel();
        await Executor(cp, model).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);
        Assert.StartsWith("Start this work? Estimated 1.5 credits.", Assert.Single(cp.Approvals), StringComparison.Ordinal);
        Assert.Equal(status, cp.Run["status"]!.GetValue<string>());
        Assert.Equal(approve, model.Calls.Count > 0);
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
}
