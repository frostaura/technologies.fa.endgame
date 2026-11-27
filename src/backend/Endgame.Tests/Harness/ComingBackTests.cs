using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Planning;
using Endgame.Harness.Tools;
using Endgame.Runner.Agents;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R3-5: a built "Dive Trip Ready" asked a returning, signed-in diver to join again and stored a second row for the same
/// person, and the factory's checks passed — each requirement was shown once, never by someone coming back. The gate now
/// holds a standing check for anything a signed-in person makes or joins of their own: the same person, signed in afresh
/// (every call_app is), makes the same call again and reads it back, and code sees one record. These tests drive the real
/// <c>call_app</c> tool against fixture apps — some that join twice, in several disguises, and some that find the person
/// again — read its results back from a run log exactly as the build does, and apply the gate.
/// </summary>
public sealed class ComingBackTests
{
    private const string Join = "api/trips/7/members";
    private const string Joined = """{"note":"Bringing my own fins"}""";

    private static readonly PlanContract Plan = PlanContract.FromJson(JsonNode.Parse("""
        {"summary":"s","requirements":[{"id":"r1","text":"Members sign in and join a trip"},{"id":"r2","text":"The leader sees how many divers have joined"}],
         "items":[{"id":"a","text":"t","detail":"d","check":"c","covers":["r1","r2"]}]}
        """)!.AsObject())!;

    // ---------------------------------------------------------------- fixture apps

    /// <summary>A trip's members, as a fixture app keeps them; how it answers a join is what each fixture varies.</summary>
    private abstract class TripApp : IAppCaller
    {
        protected readonly List<(string Id, string Person)> Members = [];

        public Task<AppCallAnswer> CallAsync(Guid appId, string persona, string role, string method, string path, string? body, CancellationToken cancellationToken)
        {
            if (method == "GET" && path == Join)
            {
                return Answer(200, new JsonArray(Members.Select(m => (JsonNode)new JsonObject { ["id"] = m.Id, ["person"] = m.Person }).ToArray()));
            }

            if (method == "GET" && path == Join + "/me")
            {
                var mine = Members.Where(m => m.Person == persona).ToList();
                return mine.Count == 0 ? Answer(404, new JsonObject { ["title"] = "Not joined" }) : Answer(200, new JsonObject { ["id"] = mine[0].Id, ["count"] = mine.Count });
            }

            return method == "POST" && path == Join ? Task.FromResult(JoinAs(persona)) : Answer(404, new JsonObject { ["title"] = "No such page" });
        }

        protected abstract AppCallAnswer JoinAs(string person);

        protected string Add(string person, string id)
        {
            Members.Add((id, person));
            return id;
        }

        protected static AppCallAnswer Body(int status, JsonNode body) => new(status, "application/json", body.ToJsonString());

        private static Task<AppCallAnswer> Answer(int status, JsonNode body) => Task.FromResult(Body(status, body));
    }

    /// <summary>Broken: every join is a new row, answered 201 with its new id — the Dive Trip Ready defect.</summary>
    private sealed class JoinsTwice : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) => Body(201, new JsonObject { ["id"] = Add(person, $"m{Members.Count + 1}"), ["person"] = person });
    }

    /// <summary>Broken, disguised: every join is a new row, but answered 200, as if it were the one already there.</summary>
    private sealed class JoinsTwiceSaying200 : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) => Body(200, new JsonObject { ["id"] = Add(person, Guid.NewGuid().ToString()), ["person"] = person });
    }

    /// <summary>Broken, wrapped: the new row's id inside the one object it answers with.</summary>
    private sealed class JoinsTwiceWrapped : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) => Body(200, new JsonObject { ["member"] = new JsonObject { ["id"] = Add(person, $"w{Members.Count + 1}") } });
    }

    /// <summary>Correct: the person's own row, found by who they are; made once (201), answered as it is after (200).</summary>
    private sealed class FindsAgain : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) =>
            Members.FirstOrDefault(m => m.Person == person) is { Id: not null } mine
                ? Body(200, new JsonObject { ["id"] = mine.Id, ["person"] = person })
                : Body(201, new JsonObject { ["id"] = Add(person, $"m{Members.Count + 1}"), ["person"] = person });
    }

    /// <summary>Correct, the other way: a second join is refused with 409, the row already there.</summary>
    private sealed class RefusesAgain : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) =>
            Members.Any(m => m.Person == person)
                ? Body(409, new JsonObject { ["title"] = "Already joined" })
                : Body(201, new JsonObject { ["member"] = new JsonObject { ["id"] = Add(person, "only") } });
    }

    /// <summary>Broken the other way: the second join fails outright.</summary>
    private sealed class FailsOnReturn : TripApp
    {
        protected override AppCallAnswer JoinAs(string person) =>
            Members.Any(m => m.Person == person) ? Body(500, new JsonObject { ["title"] = "Server error" }) : Body(201, new JsonObject { ["id"] = Add(person, "m1") });
    }

    // ---------------------------------------------------------------- driving it

    private sealed record Step(string Method, string Path, string? Body = null, string As = "member-a");

    /// <summary>The evaluator's calls through the real tool, logged as the harness logs a tool's result.</summary>
    private static async Task<List<RunEvent>> CallAsync(IAppCaller app, params Step[] steps)
    {
        var tool = new CallAppTool(app, Guid.NewGuid());
        var log = new List<RunEvent>();
        foreach (var (step, i) in steps.Select((s, i) => (s, i)))
        {
            var args = new JsonObject { ["method"] = step.Method, ["path"] = step.Path, ["as"] = step.As };
            if (step.Body is not null)
            {
                args["body"] = step.Body;
            }

            var outcome = await tool.ExecuteAsync(new ToolCall($"c{i}", tool.Name, args, null!), CancellationToken.None);
            log.Add(new RunEvent(HarnessEvents.ToolResult, new JsonObject { [HarnessEvents.AgentField] = "evaluator-a-0", ["name"] = tool.Name, ["content"] = outcome.Content, ["isError"] = outcome.IsError }));
        }

        return log;
    }

    private const string Evidence = "POST api/trips/7/members as member-a → joined; the same POST api/trips/7/members again, signed in afresh → their own; GET api/trips/7/members → one row for member-a";

    private static JsonObject Gate(List<RunEvent> log, string evidence = Evidence)
    {
        var answer = JsonNode.Parse($$"""
            {"passed":true,"evidence":"e","faults":[],"requirements":[
              {"id":"r1","met":true,"evidence":{{JsonValue.Create(evidence).ToJsonString()}}},
              {"id":"r2","met":true,"evidence":"GET api/trips/7/members as member-a → the count"}]}
            """)!.AsObject();
        return EvaluationGate.Apply(Plan, Plan.Items[0], answer, CallAppTool.CallsIn(log, "evaluator-a-0"), attempts: CallAppTool.AttemptsIn(log, "evaluator-a-0"));
    }

    private static Step[] ComeBack => [new("POST", Join, Joined), new("POST", Join, Joined), new("GET", Join)];

    public static TheoryData<string> Broken => ["joins twice", "joins twice saying 200", "joins twice wrapped", "fails on return"];

    private static TripApp Fixture(string name) => name switch
    {
        "joins twice" => new JoinsTwice(),
        "joins twice saying 200" => new JoinsTwiceSaying200(),
        "joins twice wrapped" => new JoinsTwiceWrapped(),
        "fails on return" => new FailsOnReturn(),
        "finds again" => new FindsAgain(),
        _ => new RefusesAgain(),
    };

    [Theory]
    [MemberData(nameof(Broken))]
    public async Task An_app_that_makes_a_returning_person_a_second_record_fails_the_gate_however_the_evaluator_marked_it(string fixture)
    {
        var gated = Gate(await CallAsync(Fixture(fixture), ComeBack));
        Assert.False(gated["passed"]!.GetValue<bool>());
        Assert.Contains("r1:not-met", gated["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        // Sent to the builder to fix, never only checked again: code saw the app do it.
        Assert.False(gated["recheck"]!.GetValue<bool>());
        var fault = gated["faults"]!.AsArray().Select(f => f!.GetValue<string>()).Single(f => f.StartsWith("Requirement r1 (", StringComparison.Ordinal));
        Assert.Contains("coming back later, and it failed", fault, StringComparison.Ordinal);
        Assert.True(gated["requirements"]![1]!["met"]!.GetValue<bool>(), "the leader's count is not this check's business");
    }

    [Theory]
    [InlineData("finds again")]
    [InlineData("refuses again")]
    public async Task An_app_that_finds_the_person_again_passes(string fixture)
    {
        var gated = Gate(await CallAsync(Fixture(fixture), ComeBack));
        Assert.True(gated["passed"]!.GetValue<bool>(), gated.ToJsonString());
        Assert.Empty(gated["failing"]!.AsArray());
    }

    [Fact]
    public async Task Joining_once_is_not_coming_back_and_is_checked_again_not_repaired()
    {
        var gated = Gate(await CallAsync(new FindsAgain(), new Step("POST", Join, Joined), new Step("GET", Join)));
        Assert.False(gated["passed"]!.GetValue<bool>());
        Assert.Contains("r1:unshown", gated["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        Assert.True(gated["recheck"]!.GetValue<bool>());
        Assert.Contains("make the same call again as that same member", gated["faults"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Another_member_joining_or_another_body_is_not_the_same_person_coming_back()
    {
        // The broken app would be caught by a true repeat; these are not one, so nothing is shown.
        var otherMember = Gate(await CallAsync(new JoinsTwice(), new Step("POST", Join, Joined), new Step("POST", Join, Joined, As: "member-b"), new Step("GET", Join)));
        Assert.Contains("r1:unshown", otherMember["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        var otherBody = Gate(await CallAsync(new JoinsTwice(), new Step("POST", Join, Joined), new Step("POST", Join, """{"note":"Hiring fins"}"""), new Step("GET", Join)));
        Assert.Contains("r1:unshown", otherBody["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
    }

    [Fact]
    public async Task Coming_back_is_read_back_afterwards()
    {
        var gated = Gate(await CallAsync(new FindsAgain(), new Step("GET", Join), new Step("POST", Join, Joined), new Step("POST", Join, Joined)));
        Assert.Contains("r1:unshown", gated["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
        Assert.Contains("Code found no read its evidence names after the repeat", gated["faults"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_repeat_the_evidence_does_not_name_does_not_count()
    {
        var gated = Gate(await CallAsync(new FindsAgain(), ComeBack), evidence: "GET api/trips/7/members as member-a → joined");
        Assert.Contains("r1:unshown", gated["failing"]!.AsArray().Select(f => f!.GetValue<string>()));
    }

    [Fact]
    public async Task What_was_sent_is_on_its_own_line_so_the_calls_the_gate_counts_are_unchanged()
    {
        var log = await CallAsync(new FindsAgain(), new Step("POST", Join, Joined));
        var content = log[0].Payload["content"]!.GetValue<string>();
        Assert.StartsWith("HTTP 201 application/json — POST api/trips/7/members as member-a (member)\nSent: {\"note\":\"Bringing my own fins\"}\n\n{", content, StringComparison.Ordinal);
        Assert.Equal(["POST api/trips/7/members"], CallAppTool.CallsIn(log, "evaluator-a-0"));
        var attempt = Assert.Single(CallAppTool.AttemptsIn(log, "evaluator-a-0"));
        Assert.Equal(("member-a", 201, Joined), (attempt.Persona, attempt.Status, attempt.Sent));
        Assert.Equal("m1", EvaluationGate.IdOf(attempt.Body));
    }

    [Theory]
    [InlineData("Members sign in and join a trip", true)]
    [InlineData("Divers tick off their kit list", true)]
    [InlineData("People sign up for the league night", true)]
    [InlineData("Each member keeps their own reading list", true)]
    [InlineData("RSVP to the club dinner", true)]
    [InlineData("The trip leader sees who is ready", false)]
    [InlineData("The leader sees how many divers have joined", false)]
    [InlineData("Members add books and mark what they finished", false)]
    [InlineData("Open a trip link and join without signing in", false)]
    public void Something_of_a_persons_own_is_told_from_its_words(string text, bool own) =>
        Assert.Equal(own, PlanRequirement.IsOwnRecord(text));
}
