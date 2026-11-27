using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Endgame.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// R5-3: the owner declined "Gap researcher" (three contractor briefings), and one research run later the same proposal was
/// back ("8 Gap researcher contractors were briefed here in the last 30 days"). A raise looked only for a proposal that was
/// not declined, so every further briefing proposed it again. Now a person's decline holds for
/// <see cref="WorkforceLimits.DeclinedHireHoldDays"/> at that role and place; a person asking for the hire is never held.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DeclinedHireHoldTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Project = "frostaura/technologies/squash";
    private const string Other = "frostaura/technologies/ladder";
    private const string Role = "Gap researcher";
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid ada;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        await owner.ProjectAsync("frostaura/technologies", "ladder");
        // The hire checkpoint is on, so a proposal waits for the owner instead of auto-mode hiring it.
        await owner.SetAsync("frostaura", "setting", "autonomy", "checkpoints");
        await owner.SetAsync("frostaura", "setting", "checkpoint.hire", true);
        service = app.Internal();
        ada = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura", name = "Ada", role = "Researcher", modelTier = "build" })))["id"]!.GetValue<string>());
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    /// <summary>One contractor in <paramref name="role"/> briefed at <paramref name="scope"/> and finished: what the finish proposed, or null.</summary>
    private async Task<JsonNode?> BriefAndFinishAsync(string scope, string role = Role)
    {
        var run = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope, kind = "research", title = "Research gaps" })))["id"]!.GetValue<string>());
        var contractor = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope, briefedBy = ada, role, name = $"{role} (contractor)", brief = "Find the gaps.", runId = run })))["id"]!.GetValue<string>();
        var finished = await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/contractors/{contractor}/finish", new { runId = run, learned = Array.Empty<object>() }));
        return finished["promotion"];
    }

    private async Task<JsonNode> ProposedAsync(string scope = Project)
    {
        JsonNode? proposed = null;
        for (var i = 0; i < WorkforceLimits.PromotionThreshold; i++)
        {
            proposed = await BriefAndFinishAsync(scope);
        }

        Assert.NotNull(proposed);
        Assert.Equal("proposed", proposed["status"]!.GetValue<string>());
        return proposed;
    }

    private async Task<JsonNode> DeclineAsync(JsonNode hire) =>
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/hires/{hire["id"]!.GetValue<string>()}/decline", new { note = "Not now." }));

    private async Task<IReadOnlyList<JsonNode>> OpenAsync() =>
        [.. (await ControlPlaneApp.Ok(owner.GetAsync("/api/hires?scope=frostaura&status=proposed"))).AsArray().Select(h => h!)];

    /// <summary>Moves the decline back by <paramref name="days"/>, as if it had been made that long ago.</summary>
    private async Task BackdateDeclineAsync(string hireId, int days)
    {
        await using var scope = app.Scope();
        scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        var id = Guid.Parse(hireId);
        await db.HireProposals.Where(h => h.Id == id).ExecuteUpdateAsync(s => s.SetProperty(h => h.DecidedAt, h => h.DecidedAt!.Value.AddDays(-days)));
    }

    [Fact]
    public async Task A_declined_recurring_role_is_not_proposed_again_inside_the_hold_however_many_more_are_briefed()
    {
        var proposal = await ProposedAsync();
        Assert.Equal(WorkforceLimits.DeclinedHireHoldDays, proposal["holdDays"]!.GetValue<int>());
        Assert.Null(proposal["proposedAgainFrom"]);

        var declined = await DeclineAsync(proposal);
        var decidedAt = declined["decision"]!["at"]!.GetValue<DateTimeOffset>();
        Assert.Equal(decidedAt.AddDays(WorkforceLimits.DeclinedHireHoldDays), declined["proposedAgainFrom"]!.GetValue<DateTimeOffset>());
        Assert.Null(declined["holdDays"]);

        // Five more briefings, as more research runs would make: nothing proposed, and nothing waits on the owner.
        for (var i = 0; i < 5; i++)
        {
            Assert.Null(await BriefAndFinishAsync(Project));
        }

        Assert.Empty(await OpenAsync());
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray(), n => n!["kind"]!.GetValue<string>() == "hire");

        // The runner raising the same need directly is held too, answered with the declined proposal.
        var raised = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/hires", new
        {
            scope = Project,
            trigger = "promotion",
            needKey = proposal["needKey"]!.GetValue<string>(),
            reason = "It keeps coming back.",
            name = Role,
            role = Role,
            expectedMonthlyCredits = 24m,
        }));
        Assert.Equal((proposal["id"]!.GetValue<string>(), "declined"), (raised["hire"]!["id"]!.GetValue<string>(), raised["hire"]!["status"]!.GetValue<string>()));
        Assert.False(raised["created"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Once_the_hold_lapses_the_role_is_proposed_again()
    {
        var declined = await DeclineAsync(await ProposedAsync());
        await BackdateDeclineAsync(declined["id"]!.GetValue<string>(), WorkforceLimits.DeclinedHireHoldDays + 1);

        var again = await BriefAndFinishAsync(Project);
        Assert.NotNull(again);
        Assert.Equal("proposed", again["status"]!.GetValue<string>());
        Assert.NotEqual(declined["id"]!.GetValue<string>(), again["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_owner_asking_for_the_hire_inside_the_hold_is_never_held()
    {
        var declined = await DeclineAsync(await ProposedAsync());

        // Proposing the recurring role from the hiring screen raises the very same need: a person's own ask, so a new proposal.
        var asked = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
        {
            scope = Project,
            trigger = "promotion",
            contractorRole = Role,
            reason = "I changed my mind.",
            name = Role,
            role = Role,
            expectedMonthlyCredits = 24m,
        }));
        Assert.Equal(declined["needKey"]!.GetValue<string>(), asked["needKey"]!.GetValue<string>());
        Assert.NotEqual(declined["id"]!.GetValue<string>(), asked["id"]!.GetValue<string>());
        Assert.Equal("proposed", asked["status"]!.GetValue<string>());
        Assert.Equal("person", asked["raisedBy"]!.GetValue<string>());
        Assert.Null(asked["holdDays"]);

        // "Ask for a hire" with no recurring role behind it is free too.
        var plain = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new { scope = Project, reason = "We need one.", name = "Gap finder", role = Role, expectedMonthlyCredits = 24m }));
        Assert.Equal("proposed", plain["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_decline_holds_only_its_own_role_at_its_own_place()
    {
        await DeclineAsync(await ProposedAsync());

        JsonNode? otherRole = null;
        JsonNode? otherPlace = null;
        for (var i = 0; i < WorkforceLimits.PromotionThreshold; i++)
        {
            otherRole = await BriefAndFinishAsync(Project, "Copy writer");
            otherPlace = await BriefAndFinishAsync(Other);
        }

        Assert.Equal(("proposed", "Copy writer"), (otherRole!["status"]!.GetValue<string>(), otherRole["contractorRole"]!.GetValue<string>()));
        Assert.Equal(("proposed", Other), (otherPlace!["status"]!.GetValue<string>(), otherPlace["scope"]!.GetValue<string>()));
        Assert.Equal(2, (await OpenAsync()).Count);
    }

    [Fact]
    public async Task A_proposal_the_platform_withdrew_holds_nothing()
    {
        // Withdrawn is not a person's decline: a later need is proposed again at once.
        var proposal = await ProposedAsync();
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
            var id = Guid.Parse(proposal["id"]!.GetValue<string>());
            await db.HireProposals.Where(h => h.Id == id).ExecuteUpdateAsync(s => s.SetProperty(h => h.Status, "declined").SetProperty(h => h.DecidedVia, "auto-mode")
                .SetProperty(h => h.DecidedBy, (Guid?)null).SetProperty(h => h.DecidedAt, DateTimeOffset.UtcNow));
        }

        Assert.Null((await ControlPlaneApp.Ok(owner.GetAsync($"/api/hires/{proposal["id"]!.GetValue<string>()}")))["proposedAgainFrom"]);
        var again = await BriefAndFinishAsync(Project);
        Assert.Equal("proposed", again!["status"]!.GetValue<string>());
    }
}
