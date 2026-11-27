using Endgame.Runner.Agents;

namespace Endgame.Tests.Harness;

/// <summary>
/// The escalation guard in a whole build (run 67018a21's shape): the evaluator marks "join once" met, code's check of coming
/// back later decides otherwise, the repair changes only a test, and code decides the same again — the part stops as "the
/// check needs a look", with the calls code read attached, instead of a further round on a stronger model.
/// </summary>
public sealed partial class WorkflowTests
{
    private const string SeatPath = "api/dives/d1/signup";

    /// <summary>A sign-up the gate reads as making a second seat on every repeat (201 with a new id), whatever the builder does.</summary>
    private sealed class SeatEveryTime : IAppCaller
    {
        private int seats;

        public Task<AppCallAnswer> CallAsync(Guid appId, string persona, string role, string method, string path, string? body, CancellationToken cancellationToken) =>
            Task.FromResult(method == "PUT"
                ? new AppCallAnswer(201, "application/json", $"{{\"id\":\"s{++seats}\",\"signedUp\":true}}")
                : new AppCallAnswer(200, "application/json", $"{{\"id\":\"s{seats}\",\"signedUp\":true}}"));
    }

    private static Factory SeatFactory(Func<string, (string Path, string Old, string New)?> edit) => new()
    {
        Plan = (
            [new { id = "seats", text = "Members can claim a seat on a dive, once.", detail = "DiveSignUp, a person's own record: PUT and GET api/dives/{id}/signup", check = "PUT api/dives/d1/signup twice as member-a answers the same seat; GET shows it", covers = new[] { "r1" } }],
            [new { id = "r1", text = "Members join a dive once to claim a seat on the boat" }],
            "A seat sheet for club dives."),
        EvaluatorCalls =
        [
            new { method = "PUT", path = SeatPath, @as = "member-a" },
            new { method = "PUT", path = SeatPath, @as = "member-a" },
            new { method = "GET", path = SeatPath, @as = "member-a" },
        ],
        EvidenceFor = _ => $"PUT {SeatPath} as member-a, the same PUT again signed in afresh, then GET {SeatPath}: one seat.",
        BuilderEdit = edit,
    };

    private static bool IsRepair(string task) => task.StartsWith("The evaluator checked your work against the contract and it failed", StringComparison.Ordinal);

    [Fact]
    public async Task A_code_decided_fault_that_repeats_after_a_repair_that_changed_only_tests_stops_as_the_check_needing_a_look()
    {
        var (cp, ws, dock) = BuildRun("Members join a dive once to claim a seat on the boat.", screens: false);
        ws.With("api.tests/SeatTests.cs", "// seats\n");
        var factory = SeatFactory(task => IsRepair(task) ? ("api.tests/SeatTests.cs", "// seats", "// seats, joined twice") : null);
        await RunBuildAsync(cp, factory.Model(), ws, dock, caller: new SeatEveryTime());

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        // Built, sent back once, checked again: two checks, one repair — not three repairs on ever stronger models.
        var checks = cp.Events.Where(e => e.Type == "evaluation.failed").ToList();
        Assert.Equal(2, checks.Count);
        Assert.Equal(["build", "build-t1"], checks.Select(e => e.Payload["tier"]!.GetValue<string>()));
        Assert.DoesNotContain(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "builder-seats-2");
        var last = checks[^1].Payload;
        Assert.True(last["final"]!.GetValue<bool>());
        Assert.True(last["needsLook"]!.GetValue<bool>());
        Assert.Null(last["repairCharged"]);
        var trigger = Assert.Single(last["trigger"]!.AsArray());
        Assert.Equal("r1", trigger!["id"]!.GetValue<string>());
        Assert.Contains($"member-a PUT {SeatPath} → 201 (id s3)", trigger["calls"]!.AsArray().Select(c => c!.GetValue<string>()));
        Assert.StartsWith("Not sent back for repair: the check needs a look", last["summary"]!.GetValue<string>(), StringComparison.Ordinal);

        var owner = cp.Events.Last(e => e.Type == "message" && e.Payload["milestone"]?.GetValue<string>() == "finished").Payload["text"]!.GetValue<string>();
        Assert.Contains("the check needs a look", owner, StringComparison.Ordinal);
        Assert.Contains("Nothing in it was shown not to work", owner, StringComparison.Ordinal);
        var task = cp.Tasks.Single(t => t["title"]!.GetValue<string>() == "Members can claim a seat on a dive, once.")["id"]!.GetValue<string>();
        Assert.Contains("the check needs a look", cp.Events.Single(e => e.Type == "task.failed" && e.Payload["taskId"]?.GetValue<string>() == task).Payload["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Empty(dock.Starts);
        AssertMessagesAreForPeople(cp);
        AssertOwnerFieldsArePlain(cp);
    }

    [Fact]
    public async Task The_same_fault_after_a_repair_that_changed_the_app_is_repaired_again_one_tier_up()
    {
        // The default builder edits api/Program.cs every round: application code, no dispute — the guard stays out of it.
        var (cp, ws, dock) = BuildRun("Members join a dive once to claim a seat on the boat.", screens: false);
        await RunBuildAsync(cp, SeatFactory(_ => null).Model(), ws, dock, caller: new SeatEveryTime());

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.DoesNotContain(cp.Events, e => e.Type == "evaluation.failed" && e.Payload["needsLook"] is not null);
        Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "builder-seats-2");
    }
}
