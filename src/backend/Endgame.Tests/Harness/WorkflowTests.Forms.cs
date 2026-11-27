using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R7-1 in a whole build: a part that adds a page with a form is checked by code running the app's own front-end tests, and
/// fails for a form field whose bad-input test failed — the fragile "Add a dive" page, which blanked on a six-digit year —
/// while the robust page passes and a part with no form is never asked (its tests are not run for it). The page sources and
/// the vitest reports are the captured fixtures (<c>Fixtures/form-*-add-a-dive.json</c>).
/// </summary>
public sealed partial class WorkflowTests
{
    private static Factory DiveFactory() => new()
    {
        Plan = ([new { id = "add-dive", text = FormInputsTests.DiveItemText, detail = "Dive entity, api/dives, NewDivePage", check = "make test; POST api/dives signed in; each field's bad-input test passes", covers = new[] { "r1" }, testIds = FormInputsTests.DiveTestIds }],
            [new { id = "r1", text = "Members add a dive with its site and when it happens" }],
            "Club dives: members add a dive."),
    };

    private static (FakeControlPlane Cp, FakeWorkspace Ws, FakeDock Dock) DiveRun(string variant)
    {
        var fixture = FormInputsTests.Fixture(variant);
        var (cp, ws, dock) = BuildRun("Club dives\nMembers add a dive with its site and when it happens.", screens: false);
        ws.With(fixture.PagePath, fixture.Page).With(fixture.TestPath, fixture.Test)
            .With("web/src/App.tsx", "<Link data-testid=\"new-dive\" to=\"/dives/new\">Add a dive</Link>");
        ws.Shell = command => command.Shell == ScreenTests.Command ? FakeWorkspace.Ok(fixture.Report + "JSON report written to /dev/stdout") : FakeWorkspace.Ok("");
        return (cp, ws, dock);
    }

    [Fact]
    public async Task A_form_that_breaks_on_a_bad_date_fails_its_part_by_the_tests_code_ran()
    {
        var (cp, ws, dock) = DiveRun("fragile");
        await RunBuildAsync(cp, DiveFactory().Model(), ws, dock);
        Assert.Contains(ws.Commands, c => c.Shell == ScreenTests.Command);
        var first = Judgements(cp, "add-dive")[0];
        Assert.Equal("evaluation.failed", first.Type);
        Assert.Contains("The form broke on a bad value in its date field dive-when", first.Payload["faults"]!.ToJsonString(), StringComparison.Ordinal);
        // The builder was sent to fix the page, unbilled.
        Assert.False(first.Payload["repairCharged"]!.GetValue<bool>());
        Assert.NotEqual("succeeded", cp.Run["status"]!.GetValue<string>());
        var told = cp.Events.Last(e => e.Type == "message" && e.Payload["milestone"]?.GetValue<string>() == "finished").Payload["text"]!.GetValue<string>();
        Assert.Contains("the form did not hold up against a bad value in its field “dive-when”", told, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_form_that_holds_up_passes_its_part()
    {
        var (cp, ws, dock) = DiveRun("robust");
        await RunBuildAsync(cp, DiveFactory().Model(), ws, dock);
        Assert.Contains(ws.Commands, c => c.Shell == ScreenTests.Command);
        Assert.Equal("evaluation.passed", Judgements(cp, "add-dive")[0].Type);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_part_with_no_form_is_not_asked_and_its_tests_are_not_run_for_it()
    {
        var (cp, ws, dock) = BuildRun();
        await RunBuildAsync(cp, new Factory().Model(), ws, dock);
        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.DoesNotContain(ws.Commands, c => c.Shell == ScreenTests.Command);
    }
}
