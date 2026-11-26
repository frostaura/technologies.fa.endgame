using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Planning;
using Endgame.Runner.Agents;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R2-11: the dive-club packing list's part 2 ("A diver opens a trip's share link, enters their name, and ticks off items —
/// all without signing in") failed its check after three repair rounds in both real builds. The evaluator showed it working
/// signed out on the preview (check_preview answered 201), but the gate counted only signed-in calls, and the evidence
/// named paths with placeholders ("{token}") that no exact match finds.
/// </summary>
public sealed partial class WorkflowTests
{
    private const string ShareLinkItem = "A diver opens a trip's share link, enters their name, and ticks off items — all without signing in.";
    private const string NoAccount = "Let members open a one-off trip link with no account (the leader signs in, not the members)";

    private const string PackingIdea = "A packing checklist for a dive club. Divers tick off their own kit for a trip. Let members open a one-off trip link with no account (the leader signs in, not the members).";

    private static PlanContract PackingPlan(string check = "make test passes; check_preview, signed out: POST api/shared-trips/{token}/packers answers 201") =>
        new("A packing list for dive trips.", [new PlanItem("checklist-api", ShareLinkItem, "Shared trip endpoints", check, ["r2", "r5"])],
            [new PlanRequirement("r2", "Tick off their own kit for a trip"), new PlanRequirement("r5", NoAccount)]);

    private static JsonObject PackingAnswer(string r2, string r5) => new()
    {
        ["passed"] = true,
        ["evidence"] = "make test passes.",
        ["requirements"] = new JsonArray(new JsonObject { ["id"] = "r2", ["met"] = true, ["evidence"] = r2 }, new JsonObject { ["id"] = "r5", ["met"] = true, ["evidence"] = r5 }),
        ["faults"] = new JsonArray(),
    };

    // What the evaluator really wrote, and the calls it really made, in run 81b029f2 round 0.
    private static readonly string[] SignedIn = ["POST api/trips", "GET api/trips/01a21818-1b09-7be8-9753-cb58f5234957"];
    private static readonly string[] SignedOutCalls =
    [
        "POST api/shared-trips/d83b2be84cb0acc0cccde7660d8d4591/packers",
        "PUT api/shared-trips/d83b2be84cb0acc0cccde7660d8d4591/packers/01a21818-3069-7e3a-ab9e-934df71af76b/items/01a21818-3069-75cc-9cc7-370faa0d9885",
    ];

    [Fact]
    public void A_part_for_people_who_do_not_sign_in_passes_on_signed_out_calls_cited_with_placeholders()
    {
        var plan = PackingPlan();
        var answer = PackingAnswer(
            "POST api/shared-trips/{token}/packers → 201 with 12 items all isPacked:false; PUT api/shared-trips/{token}/packers/{packerId}/items/{itemId} with {isPacked:true} → 200",
            "check_preview, signed out: POST api/shared-trips/{token}/packers → 201, no account needed");
        Assert.True(EvaluationGate.Apply(plan, plan.Items[0], answer, SignedIn, null, SignedOutCalls)["passed"]!.GetValue<bool>());

        // Before R2-11 only signed-in calls counted: the same evidence failed, every round.
        var before = EvaluationGate.Apply(plan, plan.Items[0], answer, SignedIn);
        Assert.False(before["passed"]!.GetValue<bool>());

        // A requirement for people with no account is shown signed out, never by a signed-in call.
        var signedInOnly = EvaluationGate.Apply(plan, plan.Items[0], PackingAnswer("POST api/trips → 201", "POST api/trips as member-a → 201"), SignedIn, null, SignedOutCalls);
        Assert.False(signedInOnly["passed"]!.GetValue<bool>());
        Assert.Contains("is about people who do not sign in, so it is shown with check_preview", signedInOnly["faults"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("PUT api/shared-trips/{token}/packers/{packerId}/items/{itemId} → 200", true)]
    [InlineData("PUT /api/shared-trips/:token/packers/:packer/items/<item>.", true)]
    [InlineData("PUT api/shared-trips/{token}/packers → 200", false)]
    [InlineData("GET api/shared-trips/{token}/packers/{packerId}/items/{itemId}", false)]
    public void Evidence_may_name_a_call_by_its_path_with_placeholders_for_the_ids(string evidence, bool cites) =>
        Assert.Equal(cites, EvaluationGate.Cites(evidence, SignedOutCalls[1]));

    [Fact]
    public void A_plan_part_for_people_who_do_not_sign_in_must_be_checked_signed_out()
    {
        Assert.True(PlanRequirement.NeedsNoSignIn(NoAccount));
        Assert.True(PlanRequirement.NeedsNoSignIn(ShareLinkItem));
        Assert.False(PlanRequirement.NeedsNoSignIn("Tick off their own kit for a trip"));
        Assert.False(PlanRequirement.NeedsNoSignIn("The leader signs in and sees who is ready"));
        Assert.Contains(PackingPlan("make test passes; call_app as member-a: POST api/shared-trips/{token}/packers answers 201").Faults(PackingIdea),
            f => f.Contains("its check must be made signed out", StringComparison.Ordinal));
        Assert.DoesNotContain(PackingPlan().Faults(PackingIdea), f => f.Contains("signed out", StringComparison.Ordinal));
    }

    [Fact]
    public void The_signed_out_calls_counted_are_the_evaluators_own_check_preview_calls_that_answered()
    {
        static RunEvent Result(string agent, string name, string content, bool error = false) =>
            new("tool.result", new JsonObject { ["agent"] = agent, ["name"] = name, ["content"] = content, ["isError"] = error });
        var log = new[]
        {
            Result("evaluator-a-0", "check_preview", "HTTP 201 application/json — POST api/shared-trips/abc/packers?x=1 signed out\n\n{}"),
            Result("evaluator-a-0", "call_app", "HTTP 201 application/json — POST api/trips as member-a (member)\n\n{}"),
            Result("evaluator-a-0", "check_preview", "The preview could not be reached", error: true),
            Result("evaluator-b-0", "check_preview", "HTTP 200 application/json — GET api/other signed out\n\n[]"),
        };
        Assert.Equal(["POST api/shared-trips/abc/packers"], CheckPreviewTool.CallsIn(log, "evaluator-a-0"));
        Assert.Equal(["POST api/trips"], CallAppTool.CallsIn(log, "evaluator-a-0"));
    }
}
