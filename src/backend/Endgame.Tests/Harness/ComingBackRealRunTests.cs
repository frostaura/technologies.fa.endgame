using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Planning;
using Endgame.Runner.Agents;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R6: the first live build after the check of coming back later — "Dive Seat Sheet", run 67018a21 — failed after three repair
/// rounds on ever stronger models, although its sign-up was correct from the first build. Its four failed evaluations are
/// replayed here from the run's own log (trimmed into <c>Fixtures/run-67018a21-dive-seat-sheet.json</c>): each look's answer
/// and every <c>call_app</c> result it made, in order, gated exactly as <c>BuildWorkflow.GateAsync</c> gates the second look —
/// both looks' calls counted, the second look's answer judged. Two of them (seq 1287, 1749) compared the first join with a join
/// made after the seat was given up; the other two (seq 1040, 1965) asked for the read after the repeat in the evidence's prose
/// although it was in the call log.
/// </summary>
public sealed class ComingBackRealRunTests
{
    private static readonly JsonObject Run = Load();

    private static JsonObject Load()
    {
        using var stream = typeof(ComingBackRealRunTests).Assembly.GetManifestResourceStream("Endgame.Tests.Harness.Fixtures.run-67018a21-dive-seat-sheet.json")
            ?? throw new InvalidOperationException("The run fixture is not embedded.");
        return JsonNode.Parse(stream)!.AsObject();
    }

    private static PlanContract Plan => PlanContract.FromJson(Run["plan"]!.AsObject())!;

    private static JsonObject Evaluation(int seq) => Run["evaluations"]!.AsArray().Select(e => e!.AsObject()).Single(e => e["seq"]!.GetValue<int>() == seq);

    /// <summary>The looks' call results as the run log holds them, one tool result per call, under each look's own agent.</summary>
    private static List<RunEvent> Log(JsonObject evaluation) =>
        evaluation["looks"]!.AsArray().SelectMany(look => look!["calls"]!.AsArray().Select(call => new RunEvent(HarnessEvents.ToolResult, new JsonObject
        {
            [HarnessEvents.AgentField] = look["agent"]!.GetValue<string>(),
            ["name"] = CallAppTool.ToolName,
            ["content"] = call!["content"]!.GetValue<string>(),
            ["isError"] = false,
        }))).ToList();

    /// <summary>The gate over the first <paramref name="looks"/> looks, judging the last one's answer, as the build does.</summary>
    private static JsonObject Gate(int seq, int looks = 2)
    {
        var evaluation = Evaluation(seq);
        var log = Log(evaluation);
        var agents = evaluation["looks"]!.AsArray().Take(looks).Select(l => l!["agent"]!.GetValue<string>()).ToList();
        var answer = evaluation["looks"]![looks - 1]!["answer"]!.AsObject();
        var plan = Plan;
        var calls = agents.SelectMany(a => CallAppTool.CallsIn(log, a)).Distinct(StringComparer.Ordinal).ToList();
        var attempts = agents.SelectMany(a => CallAppTool.AttemptsIn(log, a)).ToList();
        return EvaluationGate.Apply(plan, plan.Items[0], answer, calls, attempts: attempts);
    }

    private static List<string> Failing(JsonObject gated) => gated["failing"]!.AsArray().Select(f => f!.GetValue<string>()).ToList();

    [Theory]
    [InlineData(1040)]
    [InlineData(1287)]
    [InlineData(1749)]
    [InlineData(1965)]
    public void Each_of_the_real_runs_four_failed_checks_passes_the_check_of_coming_back(int seq)
    {
        var gated = Gate(seq);
        Assert.True(gated["passed"]!.GetValue<bool>(), $"seq {seq}: {gated["faults"]!.ToJsonString()}");
        Assert.Empty(Failing(gated));
        Assert.DoesNotContain("coming back later", gated["faults"]!.ToJsonString(), StringComparison.Ordinal);
        Assert.True(gated["requirements"]!.AsArray().Single(r => r!["id"]!.GetValue<string>() == "r3")!["met"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData(1040)]
    [InlineData(1287)]
    [InlineData(1749)]
    [InlineData(1965)]
    public void No_look_of_the_real_run_sends_its_correct_app_to_repair(int seq)
    {
        // The first looks gave the seat up straight after the repeat, before reading it back: that is how it was shown, so at
        // most it is looked at again — never a second record, which would send a correct app to the builder.
        var first = Gate(seq, looks: 1);
        Assert.DoesNotContain("r3:not-met", Failing(first));
        Assert.True(first["passed"]!.GetValue<bool>() || first["recheck"]!.GetValue<bool>(), $"seq {seq}: {first["faults"]!.ToJsonString()}");
    }

    [Fact]
    public void The_fixture_still_holds_what_the_gate_said_on_the_day()
    {
        // The replay is of the very calls those faults were about.
        Assert.Contains("id 01a21ad6-5792-74a7-991d-8eaadf6e8e4b, then id 01a21ad6-d577-78a3-ad4f-4111248ca9ca", Evaluation(1287)["gateSaid"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("Code found no read its evidence names after the repeat", Evaluation(1965)["gateSaid"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.True(PlanRequirement.IsOwnRecord(Plan.RequirementsOf(Plan.Items[0]).Single(r => r.Id == "r3").Text));
    }
}
