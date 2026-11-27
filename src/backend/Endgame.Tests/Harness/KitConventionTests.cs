using Endgame.Runner.Agents;

namespace Endgame.Tests.Harness;

/// <summary>
/// R6-5: the app kit's own worked example contradicted the security review's checklist. The template's follow example read
/// the person's own record with an optional user ("Take EndgameUser? where signing in is optional"), a live build copied it
/// for its dive sign-up, and the review blocked publishing on exactly that. The kit, its instructions, the checklist and the
/// planner's and builder's guidance now say one rule — an endpoint that takes the person requires sign-in, and what anyone may
/// see is on the public resource — and this test fails if any of them says otherwise again. The kit's own check of a running
/// app is <c>AppChecks</c> (the template's <c>AppRulesTests</c>).
/// </summary>
public sealed class KitConventionTests
{
    private static string Template(string path)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "backend", "Endgame.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return File.ReadAllText(Path.Combine(dir.FullName, "src", "appkit", "template", path));
    }

    private static string Skill(string name) => RunnerResources.Skills().All.Single(s => s.Name == name).Body;

    [Fact]
    public void The_kit_and_the_checklist_agree_that_an_endpoint_taking_the_person_requires_sign_in()
    {
        var agents = Template("AGENTS.md");
        Assert.DoesNotContain("where signing in is optional", agents, StringComparison.Ordinal);
        Assert.Contains("An endpoint that takes the person requires sign-in", agents, StringComparison.Ordinal);
        Assert.Contains("Reading it requires sign-in, like the writes", agents, StringComparison.Ordinal);

        var checklist = Skill("security-review-checklist");
        Assert.Contains("A handler\n  that takes `EndgameUser?` (signed in or not) is a finding", checklist, StringComparison.Ordinal);
        Assert.Contains("getCurrentUser", checklist, StringComparison.Ordinal);
        Assert.Contains("belongs\n  on the public resource", checklist, StringComparison.Ordinal);

        Assert.Contains("requires sign-in, reads included", Skill("add-an-endpoint"), StringComparison.Ordinal);
        Assert.Contains("Reading it requires\n     sign-in like the writes", RunnerResources.Prompt("planner"), StringComparison.Ordinal);
    }

    [Fact]
    public void The_kits_worked_example_takes_no_optional_user_and_its_document_is_checked_by_its_tests()
    {
        // The example the builder copies: no endpoint of it answers one way signed in and another signed out.
        Assert.DoesNotContain("EndgameUser? ", Template("api/Notes/NotesEndpoints.cs"), StringComparison.Ordinal);
        Assert.Contains("RequireUser()\n            .WithName(\"getNoteFollow\")", Template("api/Notes/NotesEndpoints.cs"), StringComparison.Ordinal);
        var rules = Template("api.tests/AppRulesTests.cs");
        Assert.Contains("AppChecks.OwnRecordFaults", rules, StringComparison.Ordinal);
        Assert.Contains("AppChecks.AppDocumentFaults", rules, StringComparison.Ordinal);
        Assert.Contains("(`getNoteFollow`, `followNote`, `unfollowNote`) | Yes |", Template("docs/app.md"), StringComparison.Ordinal);
    }
}
