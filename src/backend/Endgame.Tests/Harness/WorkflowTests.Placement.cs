using System.Text.Json.Nodes;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// Where a build goes (R9-1, BLD-01). On the real stack a second dive-club idea was placed in the first one's project —
/// research suggested the same project slug, placement "found" it and its published app with it, and the plan put to the
/// owner was to replace "the existing Dives example". A build from an idea always makes a new app: a taken slug gets the
/// next free address, the workspace starts from the kit's template, the owner is told where it goes before approving, and
/// the control plane's refusal of an app that is not new is obeyed — including by "Try again" on a run placed before this.
/// </summary>
public sealed partial class WorkflowTests
{
    private const string LiveProject = "frostaura/community/dive-club-tools";
    private const string ServiceLog = "Compressor service log\nMembers sign in and record each service with the date it was done, the hours on the meter and a short note.";

    /// <summary>A build of the compressor log whose research suggested the live Dive Seat Sheet's own project and app.</summary>
    private static (FakeControlPlane Cp, FakeWorkspace Ws, FakeDock Dock, string LiveApp) CollidingBuild()
    {
        var cp = new FakeControlPlane("frostaura/community", "build", ServiceLog) { Headroom = 1000m };
        cp.Context["levels"]![1]!["name"] = "Community";
        cp.Exists("project", LiveProject, "Dive Seat Sheet");
        var live = cp.Exists("app", $"{LiveProject}/web", "Dive Seat Sheet");
        var research = Guid.NewGuid();
        cp.Run["parentRunId"] = research.ToString();
        cp.EarlierRuns[research] =
        [
            (1, "message", new JsonObject
            {
                ["kind"] = "workflow.step",
                ["step"] = "verdict",
                ["data"] = new JsonObject { ["placement"] = new JsonObject { ["division"] = "community", ["project"] = "dive-club-tools", ["app"] = "web", ["name"] = "Compressor Service Log" } },
            }),
        ];
        var ws = new FakeWorkspace().With("api/Program.cs", "var api = app.UseEndgameApp();\napi.MapNotes();\napp.Run();\n").With("AGENTS.md", "# AGENTS\n");
        return (cp, ws, new FakeDock(), live);
    }

    private static (object[] Items, object[] Requirements, string Summary) ServicePlan() => (
        [new { id = "services", text = "Members record each service of the compressor.", detail = "A Service entity and GET/POST api/services", check = "make test passes ServicesTests; POST api/services signed in returns 201", covers = new[] { "r1", "r2" } }],
        [new { id = "r1", text = "Compressor service log" }, new { id = "r2", text = "Members sign in and record each service with the date it was done, the hours on the meter and a short note" }],
        "A service log for the club's compressor.");

    private static bool IsStep(JsonObject payload, string step) => payload["kind"]?.ToString() == "workflow.step" && payload["step"]?.ToString() == step;

    private static string Text(FakeControlPlane cp, string title) =>
        cp.Events.Last(e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == title).Payload["text"]!.GetValue<string>();

    [Fact]
    public async Task A_new_idea_whose_suggested_project_and_app_already_exist_is_placed_as_a_new_app_and_the_owner_is_told_before_approving()
    {
        var (cp, ws, dock, live) = CollidingBuild();
        cp.Setting("autonomy", JsonValue.Create("checkpoints"));
        cp.Setting("checkpoint.plan", JsonValue.Create(true));
        var factory = new Factory { Plan = ServicePlan() };
        var model = factory.Model();
        await RunBuildAsync(cp, model, ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        // The model's answer named the live app; code placed a new project, and a new app in it, beside it.
        var placement = cp.Events.Single(e => IsStep(e.Payload, "placement")).Payload["data"]!;
        Assert.NotEqual(live, placement["appId"]!.GetValue<string>());
        Assert.Equal(($"{LiveProject}-2", $"{LiveProject}-2/web", true), (placement["projectPath"]!.GetValue<string>(), placement["appPath"]!.GetValue<string>(), placement["newApp"]!.GetValue<bool>()));
        Assert.Equal(["project", "app"], cp.Nodes.Select(n => n["level"]!.GetValue<string>()));
        Assert.Equal("Compressor Service Log", cp.Nodes[0]["name"]!.GetValue<string>());

        // Said plainly, on the timeline and first on the approval card.
        var where = "Compressor Service Log is a new app. It will live in Community as a new project of its own, beside Dive Seat Sheet.";
        Assert.Equal(where, Text(cp, "Placed"));
        var asked = cp.ApprovalsAsked.Single(a => a["title"]!.GetValue<string>() == "Accept this plan?");
        Assert.StartsWith(where, asked["detail"]!.GetValue<string>(), StringComparison.Ordinal);

        // The new app's workspace, from the kit's template: never another app's code.
        Assert.Equal((Guid.Parse(placement["appId"]!.GetValue<string>()), (string?)null), Assert.Single(ws.Ensured));
        Assert.DoesNotContain(ws.Ensured, e => e.AppId == Guid.Parse(live));
        var planner = model.Calls.First(c => System(c).Contains("You are the planner", StringComparison.Ordinal));
        Assert.Contains("It starts from the app kit's template (the Notes example), which it replaces.", planner.Messages[1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.DoesNotContain(dock.Calls, c => c.Contains(live, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Every_taken_address_is_passed_over_until_a_free_one_and_a_slug_at_the_limit_keeps_its_suffix()
    {
        var (cp, ws, dock, _) = CollidingBuild();
        cp.Exists("project", $"{LiveProject}-2", "Dive Kit Check");
        await RunBuildAsync(cp, new Factory { Plan = ServicePlan() }.Model(), ws, dock);
        Assert.Equal($"{LiveProject}-3", cp.Nodes[0]["path"]!.GetValue<string>());
        Assert.Contains("beside Dive Seat Sheet.", Text(cp, "Placed"), StringComparison.Ordinal);

        // A forty-character slug that is taken keeps its suffix inside the limit.
        var (longer, ws2, dock2, _) = CollidingBuild();
        var slug = new string('a', 40);
        longer.EarlierRuns.Values.Single()[0].Payload["data"]!["placement"]!["project"] = slug;
        longer.Exists("project", $"frostaura/community/{slug}", "Forty");
        await RunBuildAsync(longer, new Factory { Plan = ServicePlan() }.Model(), ws2, dock2);
        Assert.Equal($"frostaura/community/{new string('a', 38)}-2", longer.Nodes[0]["path"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_placement_the_control_plane_refuses_stops_the_build_before_any_hire_workspace_or_plan()
    {
        // Whatever placement returns, code below the model has the last word: an app that is not new is never built over.
        var (cp, ws, dock) = BuildRun();
        cp.RefuseEveryPlacement = true;
        var factory = new Factory();
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(1, cp.PlacementsRefused);
        Assert.Contains("about to be placed in an app that already exists", Text(cp, "Stopped"), StringComparison.Ordinal);
        Assert.Contains("That app is untouched.", Text(cp, "Stopped"), StringComparison.Ordinal);
        Assert.DoesNotContain(cp.Events, e => IsStep(e.Payload, "placement"));
        Assert.DoesNotContain(cp.Events, e => e.Payload["title"]?.GetValue<string>() == "Placed");
        Assert.Empty(cp.Hires);
        Assert.Empty(ws.Ensured);
        Assert.Empty(dock.Calls);
        Assert.Equal(0, factory.Plans);
    }

    [Fact]
    public async Task Try_again_on_a_build_placed_in_another_apps_project_before_the_fix_is_placed_afresh_as_a_new_app_from_the_template()
    {
        // The stranded run: placed in the live app, its plan declined. Its journal names the live app.
        var (again, ws, dock, live) = CollidingBuild();
        var earlier = Guid.NewGuid();
        again.EarlierRuns[earlier] =
        [
            (1, "message", new JsonObject { ["kind"] = "workflow.step", ["step"] = "placement", ["data"] = new JsonObject { ["name"] = "Compressor Service Log", ["division"] = "frostaura/community", ["divisionCreated"] = false, ["projectPath"] = LiveProject, ["appPath"] = $"{LiveProject}/web", ["appId"] = live } }),
            (2, "message", new JsonObject { ["kind"] = "workflow.step", ["step"] = "plan", ["data"] = new JsonObject { ["summary"] = "The existing Dives example is replaced entirely with the new service log.", ["items"] = new JsonArray() } }),
        ];
        again.Events.Clear();
        again.Append("message", new JsonObject { ["from"] = "owner", ["text"] = ServiceLog, ["constraints"] = "", ["retryOf"] = earlier.ToString() });
        again.TakenApps.Add(live);
        var factory = new Factory { Plan = ServicePlan() };
        await RunBuildAsync(again, factory.Model(), ws, dock);

        Assert.True(again.Run["status"]!.GetValue<string>() == "succeeded", again.Run["summary"]?.ToString());
        Assert.Contains("is not this idea's, so it is left as it is", Text(again, "Placed afresh"), StringComparison.Ordinal);
        var placement = again.Events.Single(e => IsStep(e.Payload, "placement")).Payload["data"]!;
        Assert.Equal($"{LiveProject}-2/web", placement["appPath"]!.GetValue<string>());
        // Planned anew, not carried; the workspace is the new app's, from its own line (the template), not the earlier branch.
        Assert.Equal(1, factory.Plans);
        Assert.NotEqual("earlier-attempt", again.Payload("plan.accepted")!["by"]!.GetValue<string>());
        Assert.Equal((Guid.Parse(placement["appId"]!.GetValue<string>()), (string?)null), Assert.Single(ws.Ensured));
        Assert.DoesNotContain(dock.Calls, c => c.Contains(live, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Try_again_on_a_build_of_a_new_app_keeps_that_same_app()
    {
        var (first, ws, dock, live) = CollidingBuild();
        var factory = new Factory { Plan = ServicePlan(), EvaluationPasses = _ => false };
        await RunBuildAsync(first, factory.Model(), ws, dock);
        Assert.Equal("failed", first.Run["status"]!.GetValue<string>());
        var own = first.Events.Single(e => IsStep(e.Payload, "placement")).Payload["data"]!["appId"]!.GetValue<string>();

        var (again, ws2, dock2, _) = CollidingBuild();
        again.Events.Clear();
        again.Append("message", new JsonObject { ["from"] = "owner", ["text"] = ServiceLog, ["constraints"] = "", ["retryOf"] = first.RunId.ToString() });
        again.EarlierRuns[first.RunId] = [.. first.Events];
        factory.EvaluationPasses = _ => true;
        await RunBuildAsync(again, factory.Model(), ws2, dock2);

        Assert.Equal("succeeded", again.Run["status"]!.GetValue<string>());
        Assert.Empty(again.Nodes);
        Assert.Equal(own, again.Events.Single(e => IsStep(e.Payload, "placement")).Payload["data"]!["appId"]!.GetValue<string>());
        Assert.NotEqual(live, own);
        Assert.Equal(Guid.Parse(own), Assert.Single(ws2.Ensured).AppId);
    }

    [Fact]
    public async Task A_runner_that_dies_after_making_the_project_finds_it_again_and_leaves_no_empty_project()
    {
        // The project was made and recorded; the Runner died before the app and the placement were.
        var (cp, ws, dock, _) = CollidingBuild();
        cp.Exists("project", $"{LiveProject}-2", "Compressor Service Log");
        cp.Append("message", new JsonObject { ["kind"] = "workflow.step", ["step"] = "placement.project", ["data"] = new JsonObject { ["path"] = $"{LiveProject}-2", ["name"] = "Compressor Service Log", ["beside"] = "Dive Seat Sheet" } });
        await RunBuildAsync(cp, new Factory { Plan = ServicePlan() }.Model(), ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.Equal([$"{LiveProject}-2/web"], cp.Nodes.Select(n => n["path"]!.GetValue<string>()));
        Assert.Contains("beside Dive Seat Sheet.", Text(cp, "Placed"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_change_names_the_app_it_changes_on_the_plan_approval()
    {
        var (cp, ws, dock) = ChangeRun();
        cp.Context["levels"]![1]!["name"] = "Technologies";
        cp.Context["levels"]![2]!["name"] = "Recipes";
        cp.Setting("autonomy", JsonValue.Create("checkpoints"));
        cp.Setting("checkpoint.plan", JsonValue.Create(true));
        await RunChangeAsync(cp, new Factory { Plan = Ratings() }.Model(), ws, dock);

        var asked = cp.ApprovalsAsked.Single(a => a["title"]!.GetValue<string>() == "Accept this plan for the change?");
        Assert.StartsWith("This changes Recipes, the app already built and running in Technologies. Nothing else is touched.", asked["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.DoesNotContain(cp.Requests, r => r == "POST /internal/tree/nodes");
    }

    [Theory]
    [InlineData(true, null, "Log is a new app. It will live in a new division, Community, as a new project of its own.")]
    [InlineData(false, null, "Log is a new app. It will live in Community as a new project of its own.")]
    [InlineData(false, "Dive Seat Sheet", "Log is a new app. It will live in Community as a new project of its own, beside Dive Seat Sheet.")]
    public void Where_it_goes_is_one_plain_sentence(bool divisionCreated, string? beside, string expected) =>
        Assert.Equal(expected, BuildWorkflow.WhereItGoes(new JsonObject { ["name"] = "Log", ["division"] = "frostaura/community", ["divisionName"] = "Community", ["divisionCreated"] = divisionCreated, ["beside"] = beside, ["newApp"] = true }));
}
