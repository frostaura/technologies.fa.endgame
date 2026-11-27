using System.Text.Json.Nodes;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// R6-6: the live "Dive Seat Sheet" retry (run d09672a3) passed every part first time and was not published. Its first
/// security review found a real fault (a read of the person's own record without sign-in); the one repair fixed the code but
/// left <c>docs/app.md</c> saying "Signed in? No" for that endpoint; the second review failed on that document line alone, and
/// the run ended "Publishing is blocked by the security review". The reviews are replayed here from the run's own log
/// (<c>Fixtures/run-d09672a3-security-review.json</c>).
/// </summary>
public sealed partial class WorkflowTests
{
    private static readonly JsonObject SecurityRun = LoadFixture("run-d09672a3-security-review.json");

    private static JsonObject LoadFixture(string name)
    {
        using var stream = typeof(WorkflowTests).Assembly.GetManifestResourceStream($"Endgame.Tests.Harness.Fixtures.{name}")
            ?? throw new InvalidOperationException($"The fixture {name} is not embedded.");
        return JsonNode.Parse(stream)!.AsObject();
    }

    /// <summary>The real run's review number n, as its reviewer answered; null after them (a pass then).</summary>
    private static JsonObject? RealReview(int n) =>
        n < SecurityRun["reviews"]!.AsArray().Count ? SecurityRun["reviews"]![n]!["answer"]!.DeepClone().AsObject() : null;

    private static JsonObject Finding(string file, int line, string item, string problem) => new()
    {
        ["findings"] = new JsonArray(new JsonObject { ["item"] = item, ["file"] = file, ["line"] = line, ["problem"] = problem, ["fix"] = "Fix it." }),
        ["passed"] = false,
    };

    private const string DocsLine = "| Join a dive | `PUT/GET/DELETE api/dives/{id}/signup` (`getDiveSignUp`) | No |";

    [Fact]
    public void The_fixture_still_holds_what_the_real_run_said()
    {
        Assert.Equal("api/Dives/DivesEndpoints.cs", SecurityRun["reviews"]![0]!["answer"]!["findings"]![0]!["file"]!.GetValue<string>());
        Assert.Equal("docs/app.md", SecurityRun["reviews"]![1]!["answer"]!["findings"]![0]!["file"]!.GetValue<string>());
        Assert.DoesNotContain("docs/app.md", SecurityRun["repair"]!["files"]!.AsArray().Select(f => f!.GetValue<string>()));
        Assert.StartsWith("Publishing is blocked by the security review: docs/app.md:", SecurityRun["finished"]!["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        // The brief the repair had said nothing about the app's documents.
        Assert.DoesNotContain("docs/app.md", SecurityRun["repair"]!["task"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Replaying_the_real_runs_reviews_ends_published_after_a_free_fix_of_the_document()
    {
        var (cp, ws, dock) = BuildRun();
        ws.With("docs/app.md", $"# The app\n\n| Feature | Where | Signed in? |\n| --- | --- | --- |\n{DocsLine}\n");
        var factory = new Factory
        {
            ReviewAnswer = RealReview,
            BuilderEdit = task => task.StartsWith(BuildWorkflow.SecurityDocsFixLead, StringComparison.Ordinal) ? ("docs/app.md", DocsLine, DocsLine.Replace("| No |", "| Yes |", StringComparison.Ordinal)) : null,
        };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.Single(dock.Starts);
        // Two reviews, as on the day: the document line is fixed at no charge and needs no third review.
        Assert.Equal(2, factory.Reviews);
        Assert.Contains("| Yes |", ws.Text("docs/app.md"), StringComparison.Ordinal);
        var docsFix = Assert.Single(factory.BuilderTasks, t => t.StartsWith(BuildWorkflow.SecurityDocsFixLead, StringComparison.Ordinal));
        Assert.Contains("docs/app.md", docsFix, StringComparison.Ordinal);
        Assert.Contains("Documentation says getDiveSignUp doesn't require sign-in", docsFix, StringComparison.Ordinal);
        Assert.Contains(cp.Events, e => e.Payload["agent"]?.GetValue<string>() == "builder-security-docs");
        Assert.Contains(cp.Events, e => e.Type == "message" && e.Payload["title"]?.GetValue<string>() == "Security review passed" && e.Payload["text"]!.GetValue<string>().Contains("its documents", StringComparison.Ordinal));
        AssertMessagesAreForPeople(cp);
        AssertOwnerFieldsArePlain(cp);
    }

    [Fact]
    public async Task The_security_repair_brief_says_to_bring_the_apps_documents_in_line_with_every_endpoint_it_changes()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory { ReviewAnswer = n => n == 0 ? RealReview(0) : null };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        var brief = Assert.Single(factory.BuilderTasks, t => t.StartsWith(BuildWorkflow.SecurityRepairLead, StringComparison.Ordinal));
        Assert.Contains("docs/app.md", brief, StringComparison.Ordinal);
        Assert.Contains("\"Signed in?\"", brief, StringComparison.Ordinal);
        Assert.Contains("WithDescription", brief, StringComparison.Ordinal);
        Assert.Contains("GetSignUpAsync", brief, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_finding_in_a_document_about_a_secret_still_blocks_publishing()
    {
        var (cp, ws, dock) = BuildRun();
        var leak = Finding("docs/decisions.md", 4, "Secrets - No key, token, password or connection string in code, config, tests, docs or the front end", "The OpenRouter key is written in the decisions document.");
        var factory = new Factory { ReviewAnswer = _ => leak.DeepClone().AsObject() };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Contains("Publishing is blocked by the security review: docs/decisions.md", cp.Run["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Empty(dock.Starts);
        Assert.DoesNotContain(factory.BuilderTasks, t => t.StartsWith(BuildWorkflow.SecurityDocsFixLead, StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_second_review_that_finds_a_different_narrower_problem_gets_one_more_repair_then_the_hard_stop()
    {
        // Each review clears the last finding and finds a different one: the first repair is followed by a second, and then
        // the review cap holds, however the findings keep moving.
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory
        {
            ReviewAnswer = n => Finding($"api/Thing{n}.cs", 10, "Identity and access - Ownership is checked", $"Thing {n} is read by id with no owner filter."),
        };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.Equal("failed", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(BuildWorkflow.SecurityRepairRounds + 1, factory.Reviews);
        Assert.Equal(BuildWorkflow.SecurityRepairRounds, factory.BuilderTasks.Count(t => t.StartsWith(BuildWorkflow.SecurityRepairLead, StringComparison.Ordinal)));
        Assert.Contains("api/Thing2.cs", cp.Run["summary"]!.GetValue<string>(), StringComparison.Ordinal);
        // The second repair is told what the first did and what the review found after it.
        var second = factory.BuilderTasks.Where(t => t.StartsWith(BuildWorkflow.SecurityRepairLead, StringComparison.Ordinal)).Last();
        Assert.Contains("api/Thing1.cs", second, StringComparison.Ordinal);
        Assert.Contains("The last repair cleared", second, StringComparison.Ordinal);
        Assert.Empty(dock.Starts);
    }

    [Fact]
    public async Task A_second_review_that_finds_a_different_narrower_problem_and_then_passes_is_published()
    {
        var (cp, ws, dock) = BuildRun();
        var factory = new Factory
        {
            ReviewAnswer = n => n < 2 ? Finding($"api/Thing{n}.cs", 10, "Identity and access - Ownership is checked", $"Thing {n} is read by id with no owner filter.") : null,
        };
        await RunBuildAsync(cp, factory.Model(), ws, dock);

        Assert.True(cp.Run["status"]!.GetValue<string>() == "succeeded", cp.Run["summary"]?.ToString());
        Assert.Equal(3, factory.Reviews);
        Assert.Single(dock.Starts);
        AssertMessagesAreForPeople(cp);
    }

    [Fact]
    public void A_finding_is_a_documentation_finding_only_in_a_document_never_about_a_secret_and_never_one_the_reviewer_calls_code()
    {
        static JsonObject F(string file, string item = "Identity and access - Every endpoint that writes", string? kind = null, string problem = "The table says No.") =>
            new() { ["file"] = file, ["item"] = item, ["problem"] = problem, ["kind"] = kind };

        Assert.True(SecurityFindings.IsDocumentation(RealReview(1)!["findings"]![0]!.AsObject()));
        Assert.False(SecurityFindings.IsDocumentation(RealReview(0)!["findings"]![0]!.AsObject()));
        Assert.True(SecurityFindings.IsDocumentation(F("docs/data.md", kind: "docs")));
        Assert.True(SecurityFindings.IsDocumentation(F("README.md")));
        Assert.False(SecurityFindings.IsDocumentation(F("docs/app.md", kind: "code")));
        Assert.False(SecurityFindings.IsDocumentation(F("api/Program.cs", kind: "docs")));
        Assert.False(SecurityFindings.IsDocumentation(F("docs/app.md", item: "Secrets - No key, token, password or connection string")));
        Assert.False(SecurityFindings.IsDocumentation(F("docs/setup.md", problem: "An API key sk-live-123 is pasted here.")));
        Assert.False(SecurityFindings.IsDocumentation(F("")));
    }

    [Fact]
    public void A_further_repair_is_earned_only_when_the_last_one_cleared_its_finding_and_what_is_left_is_different_and_no_larger()
    {
        static JsonObject F(string file, int line, string item = "Identity and access - Ownership is checked") =>
            new() { ["file"] = file, ["line"] = line, ["item"] = item, ["problem"] = "p" };

        var first = new[] { F("api/A.cs", 54) };
        Assert.True(SecurityFindings.Narrower(first, [F("api/B.cs", 12)]));
        Assert.True(SecurityFindings.Narrower(first, [F("api/A.cs", 120)]));
        // The same finding again (lines move a little when a file is edited): the repair did not clear it.
        Assert.False(SecurityFindings.Narrower(first, [F("api/A.cs", 57)]));
        Assert.False(SecurityFindings.Narrower(first, [F("api/B.cs", 12), F("api/C.cs", 3)]));
        Assert.False(SecurityFindings.Narrower(first, []));
        Assert.False(SecurityFindings.Narrower([], [F("api/B.cs", 12)]));
    }
}
