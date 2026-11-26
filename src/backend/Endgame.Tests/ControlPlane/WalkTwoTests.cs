using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Defects found driving every academy flow by hand on the real stack (2026-11-26, second walk), held on the real
/// control plane and a real PostgreSQL.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class WalkTwoTests(PostgresServer postgres) : IAsyncLifetime
{
    private readonly LogSink logs = new();
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres, services: s => s.AddSingleton<ILoggerProvider>(logs));
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task A_deliberate_refusal_is_logged_once_as_a_warning_with_no_stack_trace()
    {
        // D55: a 503 refusal was logged as "Unhandled failure" and again by ASP.NET with a stack trace.
        logs.Entries.Clear();
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations",
            new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = "Sells booking software to squash clubs." }), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("screening_unavailable", refused["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.GetAsync($"/api/runs/{Guid.NewGuid()}"), HttpStatusCode.NotFound);

        var entries = logs.Entries.ToList();
        Assert.DoesNotContain(entries, e => e.Level >= LogLevel.Error);
        Assert.DoesNotContain(entries, e => e.Category.StartsWith("Microsoft.AspNetCore.Diagnostics", StringComparison.Ordinal));
        var problems = entries.Where(e => e.Category == "Endgame.Problems").ToList();
        Assert.Equal(2, problems.Count);
        Assert.All(problems, e => Assert.Null(e.Exception));
        var unavailable = Assert.Single(problems, e => e.Message.Contains("screening_unavailable", StringComparison.Ordinal));
        Assert.Equal(LogLevel.Warning, unavailable.Level);
        Assert.Equal(LogLevel.Information, Assert.Single(problems, e => e.Message.Contains("not_found", StringComparison.Ordinal)).Level);
    }

    [Fact]
    public async Task Removing_a_pending_invitees_last_grant_cancels_their_code_and_says_so()
    {
        // D8: the removed person still registered with their code and got a role-less account.
        await owner.DivisionAsync("frostaura", "labs");
        await owner.DivisionAsync("frostaura", "ops");
        var labs = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "vik@example.com", displayName = "Vik", role = "builder" }));
        Assert.NotNull(labs["invitationCode"]);
        // A second grant to someone with no passkey yet sends a fresh code; it is the one that works.
        var ops = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/ops", email = "vik@example.com", role = "viewer" }));
        var code = ops["invitationCode"]!.GetValue<string>();

        // Not their last grant: the code stands.
        var first = await ControlPlaneApp.Ok(owner.DeleteAsync($"/api/members/{labs["member"]!["membershipId"]!.GetValue<string>()}"));
        Assert.False(first["invitationCancelled"]!.GetValue<bool>());
        await ControlPlaneApp.Ok(app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "vik@example.com", invitationCode = code }));

        // Their last: the code is cancelled, the answer says so, and it registers nobody.
        var last = await ControlPlaneApp.Ok(owner.DeleteAsync($"/api/members/{ops["member"]!["membershipId"]!.GetValue<string>()}"));
        Assert.True(last["invitationCancelled"]!.GetValue<bool>());
        await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "vik@example.com", invitationCode = code }), HttpStatusCode.Forbidden);

        // Someone with a passkey keeps their account: nothing to cancel.
        var ann = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "ann@example.com", role = "builder" }));
        using (var key = new SoftwareAuthenticator())
        {
            var client = app.Client();
            var options = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = ann["invitationCode"]!.GetValue<string>() }));
            await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/register/complete", new { credential = key.Create(options["publicKey"]!) }));
        }

        Assert.False((await ControlPlaneApp.Ok(owner.DeleteAsync($"/api/members/{ann["member"]!["membershipId"]!.GetValue<string>()}")))["invitationCancelled"]!.GetValue<bool>());
    }

    [Fact]
    public async Task A_notice_whose_question_was_answered_says_what_happened_and_is_no_longer_unread()
    {
        // D40: "Approval needed: Accept this plan?" and "Hire Theo as Software engineer?" stayed open questions after both were answered.
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        var service = app.Internal();
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/products/squash", kind = "build", title = "Build squash" })))["id"]!.GetValue<string>();
        var approval = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Accept this plan?", detail = "Four parts." })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Publish privately?", detail = "It passed." }));
        var hire = (await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
        {
            scope = "frostaura/products",
            name = "Theo",
            role = "Software engineer",
            reason = "Nobody builds.",
            expectedMonthlyCredits = 100,
            jobDescription = new { mandate = "Build the apps." },
        })))["id"]!.GetValue<string>();
        await app.Services.GetRequiredService<Endgame.Infrastructure.Platform.NotificationSweep>().RunOnceAsync(CancellationToken.None);
        async Task<System.Text.Json.Nodes.JsonNode> Feed() => await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications"));
        System.Text.Json.Nodes.JsonNode Of(System.Text.Json.Nodes.JsonNode feed, string kind, string contains) =>
            feed["notifications"]!.AsArray().Single(n => n!["kind"]!.GetValue<string>() == kind && n["title"]!.GetValue<string>().Contains(contains, StringComparison.Ordinal))!;

        var before = await Feed();
        Assert.Equal(3, before["unread"]!.GetValue<int>());
        Assert.False(Of(before, "approval", "Accept this plan?")["resolved"]!.GetValue<bool>());
        Assert.Equal("Hire Theo as Software engineer?", Of(before, "hire", "Theo")["title"]!.GetValue<string>());

        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/runs/{run}/approvals/{approval}", new { decision = "approve" }), HttpStatusCode.NoContent);
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/hires/{hire}/accept", null));

        var after = await Feed();
        var answered = Of(after, "approval", "Accept this plan?");
        Assert.Equal("You approved “Accept this plan?”", answered["title"]!.GetValue<string>());
        Assert.True(answered["resolved"]!.GetValue<bool>());
        Assert.True(answered["read"]!.GetValue<bool>());
        var hired = Of(after, "hire", "Theo");
        Assert.Equal("Theo was hired as Software engineer", hired["title"]!.GetValue<string>());
        Assert.True(hired["resolved"]!.GetValue<bool>());
        // The one still waiting is still a question, and the only unread one.
        Assert.False(Of(after, "approval", "Publish privately?")["resolved"]!.GetValue<bool>());
        Assert.Equal(1, after["unread"]!.GetValue<int>());
        var unread = (await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications?unread=true")))["notifications"]!.AsArray();
        Assert.Equal("Approval needed: Publish privately?", Assert.Single(unread)!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_conversation_reads_what_is_waiting_on_the_owner_as_home_shows_it()
    {
        // D11: asked "is anything waiting on me?", the conversation said no while a verdict and an approval were waiting.
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        await owner.DivisionAsync("frostaura", "labs");
        var service = app.Internal();
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/products/squash", kind = "build", title = "Build squash" })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Accept this plan?", detail = "Four parts." }));
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
        {
            scope = "frostaura/products",
            name = "Theo",
            role = "Software engineer",
            reason = "Nobody builds.",
            expectedMonthlyCredits = 100,
            jobDescription = new { mandate = "Build the apps." },
        }));

        var home = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray();
        var context = (await ControlPlaneApp.Ok(service.GetAsync("/internal/context?scope=frostaura")))["needsYou"]!.AsArray();
        Assert.Equal(home.Select(n => (n!["kind"]!.GetValue<string>(), n["title"]!.GetValue<string>())).Order(), context.Select(n => (n!["kind"]!.GetValue<string>(), n["title"]!.GetValue<string>())).Order());
        Assert.Contains(context, n => n!["kind"]!.GetValue<string>() == "approval" && n["title"]!.GetValue<string>() == "Accept this plan?");
        Assert.Contains(context, n => n!["kind"]!.GetValue<string>() == "hire");

        // Beneath the scope only: the products division sees both, labs sees neither.
        Assert.Equal(2, (await ControlPlaneApp.Ok(service.GetAsync("/internal/context?scope=frostaura/products")))["needsYou"]!.AsArray().Count);
        Assert.Empty((await ControlPlaneApp.Ok(service.GetAsync("/internal/context?scope=frostaura/labs")))["needsYou"]!.AsArray());
    }

    [Theory]
    [InlineData(277.323824, "277.32")]
    [InlineData(12, "12")]
    [InlineData(0.5, "0.5")]
    [InlineData(11.68, "11.68")]
    [InlineData(1500, "1,500")]
    [InlineData(0.004, "less than 0.01")]
    [InlineData(0, "0")]
    [InlineData(-35.255, "-35.26")]
    public void A_credit_amount_in_a_sentence_has_at_most_two_decimals(double credits, string shown) =>
        Assert.Equal(shown, Endgame.Domain.Credits.CreditText.Format((decimal)credits));

    [Fact]
    public async Task A_refusal_names_credit_amounts_rounded()
    {
        // D44: composed sentences printed amounts such as "277.323824 credits".
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/operator/organisations/frostaura/overdraft", new { credits = 120.255m }));
        var refused = await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/credits/overdraft", new { scope = "frostaura", credits = 500 }), HttpStatusCode.BadRequest);
        Assert.Contains("120.26 credits", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
    }
}

