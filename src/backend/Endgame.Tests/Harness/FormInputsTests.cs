using System.Text.Json.Nodes;
using Endgame.Harness.Planning;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R7-1: a factory-built app's "Add a dive" page — a form with a datetime-local field and a live preview card beside it, the
/// pattern the kit's new-note page teaches — went completely blank on a six-digit year a browser lets through, and the gate
/// passed it: the evaluator calls the API and reads the code, and nothing touched the page. Now, for every form field a part
/// adds, code runs the app's front-end tests itself and needs the field's bad-input test (the kit's holdsUpAgainstBadInput,
/// titled "holds up against bad input: &lt;field&gt;") to pass. The fixtures are the fragile and robust pages with the JSON
/// report vitest wrote when their suites were really run against the kit (<c>Fixtures/form-*-add-a-dive.json</c>).
/// </summary>
public sealed partial class FormInputsTests
{
    internal sealed record Captured(string PagePath, string Page, string TestPath, string Test, string Report);

    internal static Captured Fixture(string variant)
    {
        using var stream = typeof(FormInputsTests).Assembly.GetManifestResourceStream($"Endgame.Tests.Harness.Fixtures.form-{variant}-add-a-dive.json")
            ?? throw new InvalidOperationException($"The {variant} fixture is not embedded.");
        var json = JsonNode.Parse(stream)!.AsObject();
        return new Captured(json["page"]!["path"]!.GetValue<string>(), json["page"]!["source"]!.GetValue<string>(), json["test"]!["path"]!.GetValue<string>(), json["test"]!["source"]!.GetValue<string>(), json["report"]!.ToJsonString());
    }

    internal const string DiveItemText = "Members add a dive with its site and when it happens, and see it as it will read.";

    internal static readonly string[] DiveTestIds = ["page-new-dive", "new-dive", "dive-site", "dive-when", "save-dive"];

    private static PlanContract DivePlan() =>
        new("Club dives.",
            [new PlanItem("add-dive", DiveItemText, "NewDivePage in web/src/dives/", "make test; POST api/dives signed in", ["r1"]) { TestIds = DiveTestIds }],
            [new PlanRequirement("r1", "Members add a dive with its site and when it happens")]);

    private static JsonObject Works() => new()
    {
        ["passed"] = true,
        ["evidence"] = "make test and make lint exit 0.",
        ["requirements"] = new JsonArray(new JsonObject { ["id"] = "r1", ["met"] = true, ["evidence"] = "POST api/dives as member-a → 201, then GET api/dives lists it." }),
        ["faults"] = new JsonArray(),
    };

    private static readonly string[] Calls = ["POST api/dives", "GET api/dives"];

    private static IReadOnlyList<FormField> Fields(Captured fixture) =>
        FormInputs.Find(DiveTestIds, new Dictionary<string, string> { [fixture.PagePath] = fixture.Page });

    private static IReadOnlyList<string> Failing(JsonObject gated) => global::Endgame.Harness.Kernel.Json.Strings(gated, "failing");

    [Fact]
    public void A_parts_form_fields_are_read_from_its_source_with_what_each_takes()
    {
        foreach (var variant in new[] { "fragile", "robust" })
        {
            var fields = Fields(Fixture(variant));
            Assert.Equal([("dive-site", FormInputs.Text), ("dive-when", FormInputs.Date)], fields.Select(f => (f.TestId, f.Kind)));
            Assert.All(fields, f => Assert.Equal("web/src/dives/NewDivePage.tsx", f.File));
        }

        // Pages, links, lists, items and buttons are not fields.
        Assert.All(new[] { "page-new-dive", "nav-home", "new-dive", "open-dive", "save-dive", "set-status-done", "dive-list", "dive-item" }, id => Assert.False(FormInputs.IsFieldId(id)));
        Assert.True(FormInputs.IsFieldId("dive-max-depth"));
    }

    [Theory]
    [InlineData("<Input id=\"d\" type=\"number\" data-testid=\"dive-depth\" min={0} />", FormInputs.Number)]
    [InlineData("<select data-testid=\"dive-buddy\" value={b} onChange={(e) => setB(e.target.value)}>", FormInputs.Select)]
    [InlineData("<Textarea data-testid=\"dive-notes\" />", FormInputs.Text)]
    [InlineData("<input\n  type='date'\n  onChange={(e) => set(e.target.value > '' ? e.target.value : '')}\n  data-testid=\"dive-day\"\n/>", FormInputs.Date)]
    [InlineData("<Input type={\"email\"} data-testid=\"member-email\" />", FormInputs.Text)]
    [InlineData("<DatePicker data-testid=\"dive-day\" />", FormInputs.Date)]
    public void Each_control_is_classed_by_what_a_person_puts_in_it(string source, string kind) =>
        Assert.Equal(kind, FormInputs.KindOf(source, Id().Match(source).Groups[1].Value));

    [Theory]
    [InlineData("<input type=\"checkbox\" data-testid=\"dive-paid\" />")]
    [InlineData("<input type=\"time\" data-testid=\"dive-time\" />")]
    [InlineData("<li data-testid=\"dive-site\">{d.site}</li>")]
    [InlineData("<Button data-testid=\"dive-share\">Share</Button>")]
    public void A_control_nobody_types_bad_input_into_is_not_asked(string source) =>
        Assert.Null(FormInputs.KindOf(source, Id().Match(source).Groups[1].Value));

    [Fact]
    public void The_fragile_page_fails_the_gate_on_the_field_that_broke_it()
    {
        var fragile = Fixture("fragile");
        var tests = ScreenTests.Parse(fragile.Report, "/workspace");
        var gated = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, tests, null, null, Fields(fragile));
        Assert.False(gated["passed"]!.GetValue<bool>());
        Assert.Equal(["form:dive-when:broken"], Failing(gated));
        var fault = Assert.Single(gated["faults"]!.AsArray().Select(f => f!.GetValue<string>()), f => f.StartsWith("The form broke", StringComparison.Ordinal));
        Assert.Contains("date field dive-when", fault, StringComparison.Ordinal);
        Assert.Contains("web/src/dives/NewDivePage.test.tsx > holds up against bad input: dive-when", fault, StringComparison.Ordinal);
        // The builder's to fix: never a second look at how it was shown.
        Assert.False(gated["recheck"]!.GetValue<bool>());
        // Over an evaluator that said it all works: a code-decided fault the escalation guard can stop on.
        var overruled = Assert.Single(gated["overruled"]!.AsArray())!;
        Assert.Equal(("form:dive-when", "broken"), (overruled["id"]!.GetValue<string>(), overruled["kind"]!.GetValue<string>()));
        Assert.Equal("web/src/dives/NewDivePage.test.tsx > holds up against bad input: dive-when → failed", overruled["calls"]![0]!.GetValue<string>());
    }

    [Fact]
    public void The_robust_page_passes()
    {
        var robust = Fixture("robust");
        var gated = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, ScreenTests.Parse(robust.Report, "/workspace"), null, null, Fields(robust));
        Assert.True(gated["passed"]!.GetValue<bool>(), gated.ToJsonString());
        Assert.Empty(Failing(gated));
    }

    [Fact]
    public void A_form_field_without_its_bad_input_test_fails_and_says_how_to_write_one()
    {
        var robust = Fixture("robust");
        var others = ScreenTests.Parse(robust.Report, "/workspace").Where(t => !t.Title.EndsWith("dive-when", StringComparison.Ordinal)).ToList();
        var gated = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, others, null, null, Fields(robust));
        Assert.False(gated["passed"]!.GetValue<bool>());
        Assert.Equal(["form:dive-when:untested"], Failing(gated));
        Assert.Contains("holdsUpAgainstBadInput(field", gated["faults"]!.ToJsonString(), StringComparison.Ordinal);

        // The suite could not be run at all: still the builder's, and the reason is in the fault.
        var none = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, [], "code ran the app's front-end tests and got no report (exit code 1: …)", null, Fields(robust));
        Assert.Equal(["form:dive-site:untested", "form:dive-when:untested"], Failing(none));
        Assert.Contains("got no report", none["faults"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public void A_part_with_no_form_is_not_asked()
    {
        var plan = new PlanContract("Club dives.",
            [new PlanItem("dive-list", "Members see the club's dives.", "DivesPage", "make test; GET api/dives", ["r1"]) { TestIds = ["page-home", "dive-list", "dive-item", "open-dive"] }],
            [new PlanRequirement("r1", "Members see the club's dives")]);
        var page = "<section data-testid=\"page-home\"><ul data-testid=\"dive-list\">{dives.map((d) => <li data-testid=\"dive-item\" data-id={d.id}><Link data-testid=\"open-dive\" to={d.id}>{d.site}</Link></li>)}</ul></section>";
        var fields = FormInputs.Find(plan.Items[0].TestIds, new Dictionary<string, string> { ["web/src/dives/DivesPage.tsx"] = page });
        Assert.Empty(fields);
        var gated = EvaluationGate.Apply(plan, plan.Items[0], Works(), ["GET api/dives"], null, null, [], null, null, fields);
        Assert.True(gated["passed"]!.GetValue<bool>(), gated.ToJsonString());
    }

    [Fact]
    public void A_form_fault_repeating_over_a_repair_that_changed_only_tests_needs_a_look_and_cannot_loop()
    {
        var fragile = Fixture("fragile");
        var tests = ScreenTests.Parse(fragile.Report, "/workspace");
        JsonObject Gate() => EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, tests, null, null, Fields(fragile));
        var (before, now) = (Gate(), Gate());
        var trigger = BuildWorkflow.NeedsLook(before, now, ["web/src/dives/NewDivePage.test.tsx"], "Added the test.");
        Assert.NotNull(trigger);
        Assert.Equal("form:dive-when", trigger![0]!["id"]!.GetValue<string>());
        // A repair that changed the page is the builder trying: repaired again, never stopped on the guard.
        Assert.Null(BuildWorkflow.NeedsLook(before, now, ["web/src/dives/NewDivePage.tsx"], "Bounded the date."));
        // An evaluator that itself found faults decided nothing code overruled.
        var faulted = Works();
        faulted["faults"] = new JsonArray("The preview throws on a bad date.");
        var own = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], faulted, Calls, null, null, tests, null, null, Fields(fragile));
        Assert.Empty(own["overruled"]!.AsArray());
    }

    [Fact]
    public void The_repair_brief_names_the_field_and_says_to_fix_the_page_not_the_test()
    {
        var fragile = Fixture("fragile");
        var last = EvaluationGate.Apply(DivePlan(), DivePlan().Items[0], Works(), Calls, null, null, ScreenTests.Parse(fragile.Report, "/workspace"), null, null, Fields(fragile));
        var brief = BuildWorkflow.RepairBrief(DivePlan(), DivePlan().Items[0], 1, 3, last, [Failing(last)], []);
        Assert.Contains("The form's field dive-when did not hold up against bad input.", brief, StringComparison.Ordinal);
        Assert.Contains("Fix the page, not the test", brief, StringComparison.Ordinal);
    }

    [Fact]
    public void The_kit_the_skill_the_briefs_and_the_gate_name_the_test_the_same_way()
    {
        Assert.Equal(FormInputs.TitlePrefix + "%s", KitText("sdk-web/src/testing.ts", "export const BAD_INPUT_TEST = \"", "\""));
        var skill = Endgame.Runner.Agents.RunnerResources.Skills().All.Single(s => s.Name == "write-a-screen").Body;
        Assert.Contains("holdsUpAgainstBadInput", skill, StringComparison.Ordinal);
        Assert.Contains(FormInputs.TitlePrefix, skill, StringComparison.Ordinal);
        Assert.Contains("holdsUpAgainstBadInput", Endgame.Runner.Agents.RunnerResources.Prompt("planner"), StringComparison.Ordinal);
        Assert.Contains("holdsUpAgainstBadInput", Endgame.Runner.Agents.RunnerResources.Prompt("builder"), StringComparison.Ordinal);
        Assert.Contains("holdsUpAgainstBadInput", KitText("template/AGENTS.md", "", null), StringComparison.Ordinal);
        Assert.Contains("it.each([\"note-title\", \"note-happens-at\", \"note-body\"])(BAD_INPUT_TEST", KitText("template/web/src/notes/NewNotePage.test.tsx", "", null), StringComparison.Ordinal);
    }

    private static string KitText(string path, string after, string? until)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "backend", "Endgame.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        var text = File.ReadAllText(Path.Combine(dir.FullName, "src", "appkit", path));
        if (until is null)
        {
            return text;
        }

        var start = text.IndexOf(after, StringComparison.Ordinal) + after.Length;
        return text[start..text.IndexOf(until, start, StringComparison.Ordinal)];
    }

    [System.Text.RegularExpressions.GeneratedRegex("data-testid=\"([a-z0-9-]+)\"")]
    private static partial System.Text.RegularExpressions.Regex Id();
}
