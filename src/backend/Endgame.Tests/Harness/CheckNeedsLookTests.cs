using System.Text.Json.Nodes;
using Endgame.Harness.Planning;
using Endgame.Runner.Agents;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// The escalation guard. In run 67018a21 ("Dive Seat Sheet") three repair rounds on ever stronger models were spent on a
/// correct app because the gate's own code check was wrong: the evaluator marked "Join a dive once" met every time, code's
/// check of coming back later decided "a second record" (seq 1287, 1749) — it compared a join with one made after the seat
/// was given up — and the repairs between changed only tests (round 2) or nothing, saying the code was correct (round 3).
/// When a code-decided fault over the evaluator's "met" repeats after a repair that changed no application code, or whose
/// builder disputes it, the part stops as "the check needs a look" (<see cref="BuildWorkflow.NeedsLook"/>), never another
/// round on a stronger model. Replayed from the run's own log (<c>Fixtures/run-67018a21-dive-seat-sheet.json</c>).
/// </summary>
public sealed class CheckNeedsLookTests
{
    private static readonly JsonObject Run = Load();

    private static JsonObject Load()
    {
        using var stream = typeof(CheckNeedsLookTests).Assembly.GetManifestResourceStream("Endgame.Tests.Harness.Fixtures.run-67018a21-dive-seat-sheet.json")
            ?? throw new InvalidOperationException("The run fixture is not embedded.");
        return JsonNode.Parse(stream)!.AsObject();
    }

    private static JsonObject Repair(int round) => Run["repairs"]!.AsArray().Select(r => r!.AsObject()).Single(r => r["round"]!.GetValue<int>() == round);

    private static List<string> Files(int round) => Repair(round)["files"]!.AsArray().Select(f => f!.GetValue<string>()).ToList();

    /// <summary>
    /// The evaluation code's gate recorded that day: the evaluator's answer (every requirement marked met), failed on what code
    /// decided (<c>failing</c>), with each requirement code decided over the evaluator's "met" listed as overruled, carrying the calls it read.
    /// </summary>
    private static JsonObject OnTheDay(int seq)
    {
        var evaluation = Run["evaluations"]!.AsArray().Select(e => e!.AsObject()).Single(e => e["seq"]!.GetValue<int>() == seq);
        var look = evaluation["looks"]!.AsArray()[^1]!.AsObject();
        var gated = look["answer"]!.DeepClone().AsObject();
        var failing = evaluation["failing"]!.AsArray().Select(f => f!.GetValue<string>()).ToList();
        gated["passed"] = false;
        gated["failing"] = new JsonArray(failing.Select(f => (JsonNode)f).ToArray());
        gated["faults"] = new JsonArray(evaluation["gateSaid"]!.GetValue<string>());
        var calls = look["calls"]!.AsArray().Select(c => (JsonNode)c!["content"]!.GetValue<string>().Split('\n')[0]).ToArray();
        gated["overruled"] = new JsonArray(failing.Where(f => f.EndsWith(":" + EvaluationGate.NotMet, StringComparison.Ordinal))
            .Select(f => (JsonNode)new JsonObject { ["id"] = f.Split(':')[0], ["kind"] = EvaluationGate.NotMet, ["calls"] = new JsonArray(calls.Select(c => c.DeepClone()).ToArray()) }).ToArray());
        return gated;
    }

    [Fact]
    public void The_fixture_holds_the_days_code_decided_faults_and_the_repairs_between()
    {
        Assert.Equal(["r3:not-met"], Run["evaluations"]![1]!["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        Assert.Equal(["r3:not-met"], Run["evaluations"]![2]!["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        Assert.All(Run["evaluations"]!.AsArray(), e => Assert.All(e!["looks"]![1]!["answer"]!["requirements"]!.AsArray(), r => Assert.True(r!["met"]!.GetValue<bool>())));
        Assert.Equal(["api.tests/ProbeTests.cs", "api.tests/DiveSignUpTests.cs", "PROGRESS.md"], Files(2));
        Assert.Empty(Files(3));
    }

    [Fact]
    public void The_real_runs_second_code_decided_fault_after_a_test_only_repair_stops_the_part_before_its_third_round()
    {
        // seq 1287 (round 1) sent it to repair round 2, which changed only tests and its progress file; seq 1749 (round 2)
        // failed on the same code-decided fault. The guard stops there: round 3 on build-t3 is never spent.
        var look = BuildWorkflow.NeedsLook(OnTheDay(1287), OnTheDay(1749), Files(2), Repair(2)["reply"]!.GetValue<string>());
        var r3 = Assert.Single(Assert.IsType<JsonArray>(look));
        Assert.Equal("r3", r3!["id"]!.GetValue<string>());
        Assert.NotEmpty(r3["calls"]!.AsArray());
    }

    [Fact]
    public void A_first_code_decided_fault_is_repaired_as_usual()
    {
        // seq 1040 failed on how it was shown (unshown), not on a code-decided "not met": nothing to repeat yet.
        Assert.Null(BuildWorkflow.NeedsLook(OnTheDay(1040), OnTheDay(1287), Files(1), Repair(1)["reply"]!.GetValue<string>()));
        Assert.Null(BuildWorkflow.NeedsLook(null, OnTheDay(1287), [], null));
    }

    [Fact]
    public void A_repair_that_changed_the_app_and_does_not_dispute_the_fault_goes_on_escalating()
    {
        Assert.Null(BuildWorkflow.NeedsLook(OnTheDay(1287), OnTheDay(1749), ["api/Dives/DivesEndpoints.cs", "api.tests/DiveSignUpTests.cs"], "Made joining look the member up first, so a second join answers the seat they have."));
    }

    [Fact]
    public void A_repair_that_disputes_the_fault_stops_it_even_when_it_touched_the_app()
    {
        // Round 3's builder: "I couldn't find a fault in the code, so I made no changes".
        var reply = Repair(3)["reply"]!.GetValue<string>();
        Assert.True(BuildWorkflow.DisputesTheFault(reply));
        Assert.NotNull(BuildWorkflow.NeedsLook(OnTheDay(1287), OnTheDay(1749), ["api/Dives/DivesEndpoints.cs"], reply));
        Assert.False(BuildWorkflow.DisputesTheFault("Fixed the join: it now finds the member's seat by their id and answers it, 200."));
    }

    [Fact]
    public void A_different_failure_or_one_the_evaluator_agreed_with_is_never_the_checks_fault()
    {
        var then = OnTheDay(1749);
        // Something else failing beside it: the builder still has work, so the guard does not stop it.
        var more = OnTheDay(1749);
        more["failing"] = new JsonArray("r3:not-met", "r4:not-met");
        Assert.Null(BuildWorkflow.NeedsLook(OnTheDay(1287), more, Files(2), null));
        // The evaluator itself said it is not met: nothing was overruled.
        var agreed = OnTheDay(1749);
        agreed["overruled"] = new JsonArray();
        Assert.Null(BuildWorkflow.NeedsLook(OnTheDay(1287), agreed, Files(2), null));
        Assert.NotNull(BuildWorkflow.NeedsLook(OnTheDay(1287), then, Files(2), null));
    }

    [Theory]
    [InlineData("api.tests/DiveSignUpTests.cs", false)]
    [InlineData("/workspace/web/src/dives/DiveDetailPage.test.tsx", false)]
    [InlineData("PROGRESS.md", false)]
    [InlineData("docs/app.md", false)]
    [InlineData("api/Dives/DivesEndpoints.cs", true)]
    [InlineData("/workspace/web/src/dives/DiveSignUp.tsx", true)]
    [InlineData("api/Migrations/20261127_AddSeats.cs", true)]
    public void Application_code_is_everything_but_tests_and_documents(string path, bool code) =>
        Assert.Equal(code, BuildWorkflow.IsApplicationCode(path));

    [Fact]
    public void The_gate_names_a_requirement_it_decided_over_the_evaluators_met_with_the_calls_it_read()
    {
        var plan = PlanContract.FromJson(JsonNode.Parse("""
            {"summary":"s","requirements":[{"id":"r1","text":"Members join a dive once to claim a seat"}],
             "items":[{"id":"a","text":"t","detail":"d","check":"c","covers":["r1"]}]}
            """)!.AsObject())!;
        const string Seat = "api/dives/d1/signup";
        var attempts = new List<AppAttempt>
        {
            new("PUT", Seat, "member-a", 201, null, """{"id":"s1"}"""),
            new("PUT", Seat, "member-a", 201, null, """{"id":"s2"}"""),
            new("GET", Seat, "member-a", 200, null, """{"id":"s2"}"""),
        };
        var answer = JsonNode.Parse($$"""{"passed":true,"requirements":[{"id":"r1","met":true,"evidence":"PUT {{Seat}} as member-a twice, then GET {{Seat}}"}],"faults":[]}""")!.AsObject();
        var gated = EvaluationGate.Apply(plan, plan.Items[0], answer, ["PUT " + Seat, "GET " + Seat], attempts: attempts);

        Assert.False(gated["passed"]!.GetValue<bool>());
        var overruled = Assert.Single(gated["overruled"]!.AsArray());
        Assert.Equal("r1", overruled!["id"]!.GetValue<string>());
        Assert.Equal(["member-a PUT api/dives/d1/signup → 201 (id s1)", "member-a PUT api/dives/d1/signup → 201 (id s2)"], overruled["calls"]!.AsArray().Select(c => c!.GetValue<string>()));

        // The evaluator's own "not met" is its finding, not code's: nothing is overruled.
        var agreed = JsonNode.Parse($$"""{"passed":false,"requirements":[{"id":"r1","met":false,"evidence":"PUT {{Seat}} twice made two seats."}],"faults":["Two seats."]}""")!.AsObject();
        Assert.Empty(EvaluationGate.Apply(plan, plan.Items[0], agreed, ["PUT " + Seat], attempts: attempts)["overruled"]!.AsArray());
    }
}
