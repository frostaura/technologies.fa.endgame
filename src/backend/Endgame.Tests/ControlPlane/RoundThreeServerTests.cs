using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Harness.Platform;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Sweeps;
using Endgame.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Round three's server findings, each on the real control plane and a real PostgreSQL: approvals of a run that ended stop
/// waiting (R3-2); sentences people read name a level, never its path, and keep what an agent is told apart; a verdict
/// auto-mode acted on says so.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RoundThreeServerTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Division = "frostaura/labs";
    private const string Project = "frostaura/labs/dive-club-trips";
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private ControlPlaneClient runner = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        openRouter.Chat = FakeOpenRouter.Completion(0.0003m);
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "labs");
        await owner.ProjectAsync(Division, "dive-club-trips", "Dive Trip Ready");
        service = app.Internal();
        runner = new ControlPlaneClient(app.Internal());
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<string> RunAsync(string kind, string title) =>
        (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = Project, kind, title })))["id"]!.GetValue<string>();

    private async Task<string> AskAsync(string run, string title) =>
        (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title, detail = "It searches the web for prices." })))["id"]!.GetValue<string>();

    private async Task<JsonArray> NeedsYouAsync() => (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["needsYou"]!.AsArray();

    private async Task<JsonArray> NoticesAsync() => (await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications")))["notifications"]!.AsArray();

    [Fact]
    public async Task Approvals_of_a_run_that_ended_stop_waiting_and_the_sweep_closes_ones_left_open()
    {
        // R3-2: three "Approval needed: Let this step search the web…" cards stayed open after their research run was cancelled.
        var research = await RunAsync("research", "Research: dive trips");
        var asked = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            asked.Add(await AskAsync(research, $"Let this step search the web for kit list {i + 1}?"));
        }

        await app.Services.GetRequiredService<NotificationSweep>().RunOnceAsync(CancellationToken.None);
        Assert.Equal(3, (await NeedsYouAsync()).Count(n => n!["kind"]!.GetValue<string>() == "approval"));
        Assert.Equal(3, (await NoticesAsync()).Count(n => n!["kind"]!.GetValue<string>() == "approval" && !n["resolved"]!.GetValue<bool>()));

        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{research}/cancel", null));

        // Closed with the run, in the same append: none is left on home or open in the notifications.
        Assert.DoesNotContain(await NeedsYouAsync(), n => n!["kind"]!.GetValue<string>() == "approval");
        var notices = (await NoticesAsync()).Where(n => n!["kind"]!.GetValue<string>() == "approval").ToList();
        Assert.Equal(3, notices.Count);
        Assert.All(notices, n => Assert.True(n!["resolved"]!.GetValue<bool>()));
        Assert.All(notices, n => Assert.EndsWith("— the work ended before it was answered", n!["title"]!.GetValue<string>(), StringComparison.Ordinal));
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Tenancy.TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Persistence.EndgameDbContext>();
            var runId = Guid.Parse(research);
            var rows = await db.Approvals.AsNoTracking().Where(a => a.RunId == runId).ToListAsync();
            Assert.Equal(3, rows.Count);
            Assert.All(rows, a => Assert.Equal(("expired", "The work ended before this was answered.", (Guid?)null), (a.Status, a.Comment, a.AnsweredBy)));
            Assert.All(rows, a => Assert.NotNull(a.AnsweredAt));
        }

        // Answering one now says plainly why it cannot be.
        var late = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/runs/{research}/approvals/{asked[0]}", new { decision = "approve" }), HttpStatusCode.Conflict);
        Assert.Equal("The work ended before this was answered, so there is nothing left to approve.", late["detail"]!.GetValue<string>());

        // Rows from before the fix: still pending under a run that has ended. The sweep closes them, once.
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Tenancy.TenantSession>().UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Persistence.EndgameDbContext>();
            var id = Guid.Parse(asked[1]);
            await db.Approvals.Where(a => a.Id == id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, "pending").SetProperty(a => a.AnsweredAt, (DateTimeOffset?)null).SetProperty(a => a.Comment, (string?)null));
        }

        Assert.Single(await NeedsYouAsync(), n => n!["kind"]!.GetValue<string>() == "approval");
        var sweep = app.Services.GetRequiredService<LeaseSweep>();
        Assert.Equal(1, (await sweep.SweepOnceAsync(CancellationToken.None)).ApprovalsExpired);
        Assert.Equal(0, (await sweep.SweepOnceAsync(CancellationToken.None)).ApprovalsExpired);
        Assert.DoesNotContain(await NeedsYouAsync(), n => n!["kind"]!.GetValue<string>() == "approval");

        // A run still going keeps its question open.
        var live = await RunAsync("research", "Research: wreck dives");
        await AskAsync(live, "Let this step search the web for wreck sites?");
        await sweep.SweepOnceAsync(CancellationToken.None);
        Assert.Single(await NeedsYouAsync(), n => n!["kind"]!.GetValue<string>() == "approval");
    }

    [Fact]
    public async Task A_verdict_auto_mode_built_on_says_auto_mode_chose_to_build()
    {
        var idea = Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A packing checklist for a dive club", constraints = Array.Empty<string>(), scope = Division })))["id"]!.GetValue<string>());
        await runner.RecordVerdictAsync(idea, VerdictSamples.Valid("build", null), CancellationToken.None);
        await app.Services.GetRequiredService<NotificationSweep>().RunOnceAsync(CancellationToken.None);
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/ideas/{idea}/decision", new { decision = "build", by = "auto-mode" }));

        var notice = (await NoticesAsync()).Single(n => n!["kind"]!.GetValue<string>() == "verdict");
        Assert.Equal("Auto-mode chose to build: A packing checklist for a dive club", notice!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task Checkpoints_and_a_spent_budget_are_said_by_the_levels_name_and_the_agents_instruction_is_kept_apart()
    {
        await owner.SetAsync(Division, "setting", "autonomy", "checkpoints");
        var idea = Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A packing checklist for a dive club", constraints = Array.Empty<string>(), scope = Division })))["id"]!.GetValue<string>());
        await runner.RecordVerdictAsync(idea, VerdictSamples.Valid("build", null), CancellationToken.None);
        var held = await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/ideas/{idea}/decision", new { decision = "build", by = "auto-mode" }), HttpStatusCode.Conflict);
        var name = (await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray().Single(d => d!["slug"]!.GetValue<string>() == "labs")!["name"]!.GetValue<string>();
        Assert.Equal($"Checkpoints are on for {name}, so the owner decides on the verdict.", held["detail"]!.GetValue<string>());
        Assert.Equal(Division, held["scope"]!.GetValue<string>());

        await owner.TopUpAsync("frostaura", 100m);
        await owner.SetAsync(Project, "budget", "monthly_credits", 0.001m);
        var run = await RunAsync("task", "Gateway test");
        var refused = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", new
        {
            taskType = "chat",
            scope = Project,
            runId = run,
            stream = false,
            messages = new[] { new { role = "user", content = "Say hello." } },
        }), HttpStatusCode.PaymentRequired);
        var detail = refused["detail"]!.GetValue<string>();
        Assert.True(detail.StartsWith("The monthly budget for Dive Trip Ready has ", StringComparison.Ordinal), detail);
        Assert.DoesNotContain("/", detail, StringComparison.Ordinal);
        Assert.DoesNotContain("do not retry", detail, StringComparison.Ordinal);
        Assert.Equal("This is terminal for the run: do not retry it.", refused["forAgent"]!.GetValue<string>());
        Assert.Equal(Project, refused["bindingScope"]!.GetValue<string>());
    }
}
