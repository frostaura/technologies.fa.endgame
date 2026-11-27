namespace App.Tests;

/// <summary>
/// The app held to the security review's checklist and to its own document, by code, on every <c>make test</c> — so neither
/// the example nor anything copied from it can drift again. A built app once copied a read of the person's own record that
/// did not require sign-in, and its review blocked publishing; its repair then left <c>docs/app.md</c> saying the endpoint
/// needed no sign-in, and the second review blocked it again on that line (AGENTS.md, "A person's own record").
/// </summary>
public sealed class AppRulesTests(EndgameAppFactory<Program> app) : IClassFixture<EndgameAppFactory<Program>>
{
    [Fact]
    public void Every_endpoint_that_takes_the_signed_in_person_requires_sign_in()
    {
        using var started = app.CreateClient();
        Assert.Empty(AppChecks.OwnRecordFaults(app.Services));
    }

    [Fact]
    public void The_apps_document_says_who_may_call_each_endpoint_exactly_as_the_code_does()
    {
        using var started = app.CreateClient();
        Assert.Empty(AppChecks.AppDocumentFaults(app.Services, AppChecks.ReadAppDocument()));
    }
}
