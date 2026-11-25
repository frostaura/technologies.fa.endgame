using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.ControlPlane.Mcp;
using Endgame.Domain.Access;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The four roles enforced everywhere (TEST-101, <i>Authorisation matrix</i>): every public endpoint,
/// called by every role, inside the caller's scope and outside it. Inside, a role at or above the
/// endpoint's minimum is let through (whatever the endpoint then answers, it is never 401, 403 or
/// 404) and a role below it is refused with 403; outside, the scope is not disclosed (404). Every
/// endpoint the control plane maps under <c>/api</c> must appear in the table or be exempt with a
/// reason, so a new endpoint without a row fails the build. The MCP tools are held to the same table.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AuthorizationMatrixTests(PostgresServer postgres) : IAsyncLifetime
{
    private enum Level
    {
        /// <summary>Roles granted at a division; inside is that division, outside is its sibling.</summary>
        Branch,

        /// <summary>Roles granted at the organisation; inside is it, outside is another organisation.</summary>
        Organisation,

        /// <summary>FrostAura operators only: every member, the Owner included, is refused.</summary>
        Operator,
    }

    private sealed record Req(string Url, object? Body = null);

    private sealed record Row(string Method, string Route, MemberRole Min, Level Level, Func<Side, Task<Req>> Build);

    /// <summary>The resources on one side of the matrix: inside or outside the caller's scope.</summary>
    private sealed class Side
    {
        public required string Org { get; init; }

        public required string Division { get; init; }

        public required Guid DivisionId { get; init; }

        public required string Project { get; init; }

        public required Guid ProjectId { get; init; }

        public required string App { get; init; }

        public required Guid AppId { get; init; }

        public required Guid OrgId { get; init; }

        public required Guid EmployeeId { get; init; }

        public required Guid RunId { get; init; }

        public required Guid FinishedRunId { get; init; }

        public required Guid IdeaId { get; init; }

        public required Guid HireId { get; init; }

        public required Func<Task<string>> FreshProject { get; init; }

        public required Func<Task<Guid>> FreshApp { get; init; }

        public required Func<Task<Guid>> FreshRun { get; init; }

        public required Func<Task<(Guid Run, Guid Approval)>> FreshApproval { get; init; }

        public required Func<Task<Guid>> FreshEmployee { get; init; }

        public required Func<Task<Guid>> FreshMembership { get; init; }

        public required Func<Guid, Task<Guid>> FreshMemory { get; init; }

        public required Func<Task<Guid>> FreshHire { get; init; }

        public required Func<Task<Guid>> FreshSuggestion { get; init; }

        public required Func<Task<Guid>> FreshQuestion { get; init; }

        public required Func<Task> SetSecret { get; init; }

        public required Func<Task> SetBudget { get; init; }

        public required Func<Task> SetRuleSet { get; init; }

        public required Func<Task> SetAutonomy { get; init; }

        public required Func<Task> Share { get; init; }
    }

    /// <summary>Endpoints a role does not decide, and why.</summary>
    private static readonly Dictionary<string, string> Exempt = new(StringComparer.Ordinal)
    {
        ["GET /api/me"] = "the caller's own account",
        ["POST /api/ideas/estimate"] = "free arithmetic, deliberately open before an organisation exists",
        ["GET /api/tokens"] = "the caller's own tokens",
        ["POST /api/tokens"] = "the caller's own token; its role cap is tested in McpTests",
        ["DELETE /api/tokens/{id:guid}"] = "the caller's own token",
        ["GET /api/notifications"] = "the caller's own feed, filtered by their grants (BreadthTests)",
        ["POST /api/notifications/{id:guid}/read"] = "the caller's own read state",
        ["POST /api/notifications/read-all"] = "the caller's own read state",
        ["GET /api/tree"] = "shows each member their own branch (TreeEndpointTests); outside it is tested below",
    };

    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private HttpClient operatorClient = null!;
    private readonly Dictionary<(Level, MemberRole), HttpClient> people = [];
    private readonly Dictionary<(Level, MemberRole), string> tokens = [];
    private Side inside = null!;
    private Side outside = null!;
    private Side elsewhere = null!;
    private int counter;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        // The Owner is not an operator, so God mode never stands in for a missing role here.
        owner = await app.OwnerWithOrganisationAsync("acme", "boss@acme.example");
        service = app.Internal();
        operatorClient = await app.SignInAsync("dean@frostaura.net");
        await ControlPlaneApp.Created(operatorClient.PostAsJsonAsync("/api/organisations", new { name = "Other", slug = "other", ownerEmail = "boss@acme.example" }));
        await operatorClient.TopUpAsync("acme", 1000m);

        inside = await SideAsync("acme", "alpha");
        outside = await SideAsync("acme", "beta");
        elsewhere = await SideAsync("other", "gamma");

        foreach (var role in new[] { MemberRole.Admin, MemberRole.Builder, MemberRole.Viewer })
        {
            foreach (var (level, scope) in new[] { (Level.Branch, "acme/alpha"), (Level.Organisation, "acme") })
            {
                var email = $"{role.ToWire()}.{level.ToString().ToLowerInvariant()}@example.com";
                await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope, email, role = role.ToWire() }));
                people[(level, role)] = await app.SignInAsync(email);
                tokens[(level, role)] = await ControlPlaneApp.TokenAsync(people[(level, role)], "acme", role.ToWire());
            }
        }

        people[(Level.Branch, MemberRole.Owner)] = owner;
        people[(Level.Organisation, MemberRole.Owner)] = owner;
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private string Unique(string prefix) => $"{prefix}-{Interlocked.Increment(ref counter)}";

    private async Task<Side> SideAsync(string org, string division)
    {
        var divisionId = await owner.DivisionAsync(org, division);
        var project = $"{org}/{division}/pp";
        var projectId = await owner.ProjectAsync($"{org}/{division}", "pp");
        var appId = await owner.AppAsync(project, "aa");
        var orgId = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync($"/api/tree?organisation={org}")))["organisation"]!["id"]!.GetValue<string>());

        async Task<Guid> Run()
        {
            var run = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = project, kind = "build", title = Unique("run") }));
            return Guid.Parse(run["id"]!.GetValue<string>());
        }

        async Task<Guid> Employee() =>
            Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = $"{org}/{division}", name = Unique("Ada"), role = "Builder" })))["id"]!.GetValue<string>());

        async Task<Guid> Hire() =>
            Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/hires", new
            {
                scope = $"{org}/{division}", name = Unique("Grace"), role = Unique("Tester"), reason = "Nobody tests.", expectedMonthlyCredits = 1_000_000,
                needKey = Unique("need"), jobDescription = new { mandate = "Test." },
            })))["id"]!.GetValue<string>());

        var finished = await Run();
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{finished}/cancel", null));
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "A ladder", scope = $"{org}/{division}" }));
        return new Side
        {
            Org = org,
            Division = $"{org}/{division}",
            DivisionId = divisionId,
            Project = project,
            ProjectId = projectId,
            App = $"{project}/aa",
            AppId = appId,
            OrgId = orgId,
            EmployeeId = await Employee(),
            RunId = await Run(),
            FinishedRunId = finished,
            IdeaId = Guid.Parse(idea["id"]!.GetValue<string>()),
            HireId = await Hire(),
            FreshProject = async () => (await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/projects", new { parent = $"{org}/{division}", name = "x", slug = Unique("xx") })))["id"]!.GetValue<string>(),
            FreshApp = async () => await owner.AppAsync(project, Unique("xx")),
            FreshRun = Run,
            FreshApproval = async () =>
            {
                var run = await Run();
                var approval = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Go?" }));
                return (run, Guid.Parse(approval["id"]!.GetValue<string>()));
            },
            FreshEmployee = Employee,
            FreshMembership = async () =>
                Guid.Parse((await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = project, email = $"{Unique("m")}@example.com", role = "viewer" })))["member"]!["membershipId"]!.GetValue<string>()),
            FreshMemory = async employee =>
                Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/employees/{employee}/memory", new { title = Unique("fact"), body = "The club opens at six.", kind = "fact" })))["id"]!.GetValue<string>()),
            FreshHire = Hire,
            FreshSuggestion = async () =>
            {
                var run = (await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas/suggestions", new { scope = $"{org}/{division}" })))["run"]!["id"]!.GetValue<string>();
                var recorded = await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/runs/{run}/suggestions", new
                {
                    suggestions = new[] { new { title = Unique("Idea"), idea = "An idea.", gap = "A gap.", whyUs = "Placed.", reuses = Array.Empty<string>() } },
                }));
                return Guid.Parse(recorded[0]!["id"]!.GetValue<string>());
            },
            FreshQuestion = async () =>
                Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{appId}/dashboard", new { question = "How many?", sql = "SELECT count(*) AS n FROM requests" })))["id"]!.GetValue<string>()),
            SetSecret = async () => await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/secrets", new { scope = $"{org}/{division}", name = "API_KEY", value = "x" })),
            SetBudget = async () => await owner.SetAsync($"{org}/{division}", "budget", "monthly_credits", 1000),
            SetRuleSet = async () => await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = $"{org}/{division}", stage = "build", deny = new[] { "x" } })),
            SetAutonomy = async () => await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy", new { scope = $"{org}/{division}", autonomy = "checkpoints" })),
            Share = async () => await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{appId}/shares", new { email = "friend@example.com" })),
        };
    }

    private static Task<Req> R(string url, object? body = null) => Task.FromResult(new Req(url, body));

    private static IReadOnlyList<Row> Rows() =>
    [
        // The tree
        new("POST", "/api/organisations", MemberRole.Owner, Level.Operator, s => R("/api/organisations", new { name = "New", slug = $"n{Guid.NewGuid():N}"[..12], ownerEmail = "new@example.com" })),
        new("PATCH", "/api/organisations/{id:guid}", MemberRole.Owner, Level.Organisation, s => R($"/api/organisations/{s.OrgId}", new { name = s.Org == "acme" ? "Acme" : "Other" })),
        new("DELETE", "/api/organisations/{id:guid}", MemberRole.Owner, Level.Organisation, s => R($"/api/organisations/{s.OrgId}")),
        new("POST", "/api/divisions", MemberRole.Admin, Level.Organisation, s => R("/api/divisions", new { parent = s.Org, name = "D", slug = $"d{Guid.NewGuid():N}"[..10] })),
        new("PATCH", "/api/divisions/{id:guid}", MemberRole.Admin, Level.Branch, s => R($"/api/divisions/{s.DivisionId}", new { name = "Alpha" })),
        new("DELETE", "/api/divisions/{id:guid}", MemberRole.Admin, Level.Branch, s => R($"/api/divisions/{s.DivisionId}")),
        new("POST", "/api/projects", MemberRole.Builder, Level.Branch, s => R("/api/projects", new { parent = s.Division, name = "P", slug = $"p{Guid.NewGuid():N}"[..10] })),
        new("PATCH", "/api/projects/{id:guid}", MemberRole.Builder, Level.Branch, s => R($"/api/projects/{s.ProjectId}", new { name = "P" })),
        new("DELETE", "/api/projects/{id:guid}", MemberRole.Admin, Level.Branch, async s => new Req($"/api/projects/{await s.FreshProject()}")),
        new("POST", "/api/apps", MemberRole.Builder, Level.Branch, s => R("/api/apps", new { parent = s.Project, name = "A", slug = $"a{Guid.NewGuid():N}"[..10] })),
        new("PATCH", "/api/apps/{id:guid}", MemberRole.Builder, Level.Branch, s => R($"/api/apps/{s.AppId}", new { name = "A" })),
        new("DELETE", "/api/apps/{id:guid}", MemberRole.Admin, Level.Branch, async s => new Req($"/api/apps/{await s.FreshApp()}")),

        // The cascade, members, credits
        new("GET", "/api/cascade", MemberRole.Viewer, Level.Branch, s => R($"/api/cascade?scope={s.Division}&kind=budget")),
        new("GET", "/api/cascade", MemberRole.Admin, Level.Branch, s => R($"/api/cascade?scope={s.Division}&kind=secret")),
        new("PUT", "/api/cascade", MemberRole.Admin, Level.Branch, s => R("/api/cascade", new { scope = s.Division, kind = "budget", key = "monthly_credits", value = 1000 })),
        new("PUT", "/api/cascade", MemberRole.Builder, Level.Branch, s => R("/api/cascade", new { scope = s.Division, kind = "context", key = "tone", value = "plain" })),
        new("DELETE", "/api/cascade", MemberRole.Admin, Level.Branch, async s =>
        {
            await s.SetBudget();
            return new Req($"/api/cascade?scope={s.Division}&kind=budget&key=monthly_credits");
        }),
        new("GET", "/api/members", MemberRole.Admin, Level.Branch, s => R($"/api/members?scope={s.Division}")),
        new("POST", "/api/members", MemberRole.Admin, Level.Branch, s => R("/api/members", new { scope = s.Project, email = $"{Guid.NewGuid():N}@example.com", role = "viewer" })),
        new("PATCH", "/api/members/{membershipId:guid}", MemberRole.Admin, Level.Branch, async s => new Req($"/api/members/{await s.FreshMembership()}", new { role = "builder" })),
        new("DELETE", "/api/members/{membershipId:guid}", MemberRole.Admin, Level.Branch, async s => new Req($"/api/members/{await s.FreshMembership()}")),
        new("GET", "/api/credits", MemberRole.Viewer, Level.Branch, s => R($"/api/credits?scope={s.Division}")),
        new("POST", "/api/credits/top-ups", MemberRole.Owner, Level.Operator, s => R("/api/credits/top-ups", new { organisation = s.Org, credits = 1, note = "matrix" })),
        new("POST", "/api/credits/top-up-requests", MemberRole.Owner, Level.Organisation, s => R("/api/credits/top-up-requests", new { organisation = s.Org, credits = 1 })),
        new("GET", "/api/credits/top-up-requests", MemberRole.Admin, Level.Organisation, s => R($"/api/credits/top-up-requests?organisation={s.Org}")),
        new("PUT", "/api/credits/overdraft", MemberRole.Owner, Level.Organisation, s => R("/api/credits/overdraft", new { scope = s.Org, credits = 0 })),
        new("PUT", "/api/credits/overdraft", MemberRole.Admin, Level.Branch, s => R("/api/credits/overdraft", new { scope = s.Division, credits = 0 })),
        new("GET", "/api/audit/operator-access", MemberRole.Owner, Level.Organisation, s => R($"/api/audit/operator-access?organisation={s.Org}")),

        // Ideas, runs, tasks, approvals, the conversation
        new("POST", "/api/ideas", MemberRole.Builder, Level.Branch, s => R("/api/ideas", new { text = "Another idea", scope = s.Division })),
        new("GET", "/api/ideas/{id:guid}", MemberRole.Viewer, Level.Branch, s => R($"/api/ideas/{s.IdeaId}")),
        new("POST", "/api/ideas/{id:guid}/decision", MemberRole.Builder, Level.Branch, s => R($"/api/ideas/{s.IdeaId}/decision", new { choice = "build" })),
        new("POST", "/api/ideas/suggestions/estimate", MemberRole.Builder, Level.Branch, s => R("/api/ideas/suggestions/estimate", new { scope = s.Division })),
        new("POST", "/api/ideas/suggestions", MemberRole.Builder, Level.Branch, s => R("/api/ideas/suggestions", new { scope = s.Division })),
        new("GET", "/api/ideas/suggestions", MemberRole.Viewer, Level.Branch, s => R($"/api/ideas/suggestions?scope={s.Division}")),
        new("POST", "/api/ideas/suggestions/{id:guid}/take", MemberRole.Builder, Level.Branch, async s => new Req($"/api/ideas/suggestions/{await s.FreshSuggestion()}/take")),
        new("POST", "/api/ideas/suggestions/{id:guid}/dismiss", MemberRole.Builder, Level.Branch, async s => new Req($"/api/ideas/suggestions/{await s.FreshSuggestion()}/dismiss")),
        new("GET", "/api/runs", MemberRole.Viewer, Level.Branch, s => R($"/api/runs?scope={s.Division}")),
        new("GET", "/api/runs", MemberRole.Viewer, Level.Branch, s => R($"/api/runs?employeeId={s.EmployeeId}")),
        new("GET", "/api/runs/{id:guid}", MemberRole.Viewer, Level.Branch, s => R($"/api/runs/{s.RunId}")),
        new("GET", "/api/runs/{id:guid}/events", MemberRole.Viewer, Level.Branch, s => R($"/api/runs/{s.FinishedRunId}/events")),
        new("POST", "/api/runs/{id:guid}/pause", MemberRole.Builder, Level.Branch, async s => new Req($"/api/runs/{await s.FreshRun()}/pause")),
        new("POST", "/api/runs/{id:guid}/resume", MemberRole.Builder, Level.Branch, s => R($"/api/runs/{s.RunId}/resume")),
        new("POST", "/api/runs/{id:guid}/cancel", MemberRole.Builder, Level.Branch, async s => new Req($"/api/runs/{await s.FreshRun()}/cancel")),
        new("POST", "/api/runs/{id:guid}/approvals/{approvalId:guid}", MemberRole.Builder, Level.Branch, async s =>
        {
            var (run, approval) = await s.FreshApproval();
            return new Req($"/api/runs/{run}/approvals/{approval}", new { decision = "approve" });
        }),
        new("GET", "/api/tasks", MemberRole.Viewer, Level.Branch, s => R($"/api/tasks?scope={s.Division}")),
        new("POST", "/api/conversations", MemberRole.Builder, Level.Branch, s => R("/api/conversations", new { scope = s.Division, message = "Hello" })),
        new("GET", "/api/conversations", MemberRole.Viewer, Level.Branch, s => R($"/api/conversations?scope={s.Division}")),

        // Apps: settings, sharing, asking, versions, export
        new("GET", "/api/apps/{id:guid}", MemberRole.Viewer, Level.Branch, s => R($"/api/apps/{s.AppId}")),
        new("POST", "/api/apps/{id:guid}/settings", MemberRole.Builder, Level.Branch, s => R($"/api/apps/{s.AppId}/settings", new { running = "sleep" })),
        new("POST", "/api/apps/{id:guid}/settings", MemberRole.Admin, Level.Branch, s => R($"/api/apps/{s.AppId}/settings", new { access = "private" })),
        new("GET", "/api/apps/{id:guid}/shares", MemberRole.Admin, Level.Branch, s => R($"/api/apps/{s.AppId}/shares")),
        new("POST", "/api/apps/{id:guid}/shares", MemberRole.Admin, Level.Branch, s => R($"/api/apps/{s.AppId}/shares", new { email = "friend@example.com" })),
        new("DELETE", "/api/apps/{id:guid}/shares", MemberRole.Admin, Level.Branch, async s =>
        {
            await s.Share();
            return new Req($"/api/apps/{s.AppId}/shares?email=friend@example.com");
        }),
        new("POST", "/api/apps/{id:guid}/ask/estimate", MemberRole.Viewer, Level.Branch, s => R($"/api/apps/{s.AppId}/ask/estimate", new { question = "How many requests?" })),
        new("POST", "/api/apps/{id:guid}/ask", MemberRole.Builder, Level.Branch, s => R($"/api/apps/{s.AppId}/ask", new { question = "How many requests?" })),
        new("GET", "/api/apps/{id:guid}/dashboard", MemberRole.Viewer, Level.Branch, s => R($"/api/apps/{s.AppId}/dashboard")),
        new("POST", "/api/apps/{id:guid}/dashboard", MemberRole.Builder, Level.Branch, s => R($"/api/apps/{s.AppId}/dashboard", new { question = "Count", sql = "SELECT count(*) AS n FROM requests" })),
        new("DELETE", "/api/apps/{id:guid}/dashboard/{questionId:guid}", MemberRole.Builder, Level.Branch, async s => new Req($"/api/apps/{s.AppId}/dashboard/{await s.FreshQuestion()}")),
        new("GET", "/api/apps/{id:guid}/versions", MemberRole.Viewer, Level.Branch, s => R($"/api/apps/{s.AppId}/versions")),
        new("POST", "/api/apps/{id:guid}/versions/{commit}/restore", MemberRole.Builder, Level.Branch, s => R($"/api/apps/{s.AppId}/versions/abcdef1234/restore")),
        new("GET", "/api/apps/{id:guid}/export", MemberRole.Owner, Level.Branch, s => R($"/api/apps/{s.AppId}/export")),

        // Secrets
        new("GET", "/api/secrets", MemberRole.Admin, Level.Branch, s => R($"/api/secrets?scope={s.Division}")),
        new("PUT", "/api/secrets", MemberRole.Admin, Level.Branch, s => R("/api/secrets", new { scope = s.Division, name = "API_KEY", value = "x" })),
        new("DELETE", "/api/secrets", MemberRole.Admin, Level.Branch, async s =>
        {
            await s.SetSecret();
            return new Req($"/api/secrets?scope={s.Division}&name=API_KEY");
        }),

        // Autonomy
        new("GET", "/api/autonomy", MemberRole.Viewer, Level.Branch, s => R($"/api/autonomy?scope={s.Division}")),
        new("PUT", "/api/autonomy", MemberRole.Admin, Level.Branch, s => R("/api/autonomy", new { scope = s.Division, autonomy = "auto" })),
        new("DELETE", "/api/autonomy", MemberRole.Admin, Level.Branch, async s =>
        {
            await s.SetAutonomy();
            return new Req($"/api/autonomy?scope={s.Division}&key=autonomy");
        }),
        new("PUT", "/api/autonomy/rule-sets", MemberRole.Admin, Level.Branch, s => R("/api/autonomy/rule-sets", new { scope = s.Division, stage = "build", deny = new[] { "x" } })),
        new("DELETE", "/api/autonomy/rule-sets", MemberRole.Admin, Level.Branch, async s =>
        {
            await s.SetRuleSet();
            return new Req($"/api/autonomy/rule-sets?scope={s.Division}&stage=build");
        }),

        // The workforce
        new("GET", "/api/employees", MemberRole.Viewer, Level.Branch, s => R($"/api/employees?scope={s.Division}")),
        new("GET", "/api/employees/recurring-roles", MemberRole.Viewer, Level.Branch, s => R($"/api/employees/recurring-roles?scope={s.Division}")),
        new("GET", "/api/employees/{id:guid}", MemberRole.Viewer, Level.Branch, s => R($"/api/employees/{s.EmployeeId}")),
        new("GET", "/api/employees/{id:guid}/track-record", MemberRole.Viewer, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/track-record")),
        new("PATCH", "/api/employees/{id:guid}", MemberRole.Admin, Level.Branch, s => R($"/api/employees/{s.EmployeeId}", new { role = "Builder" })),
        new("POST", "/api/employees/{id:guid}/reassign", MemberRole.Admin, Level.Branch, async s => new Req($"/api/employees/{await s.FreshEmployee()}/reassign", new { scope = s.Project })),
        new("POST", "/api/employees/{id:guid}/release", MemberRole.Admin, Level.Branch, async s => new Req($"/api/employees/{await s.FreshEmployee()}/release")),
        new("POST", "/api/employees/{id:guid}/rehire", MemberRole.Admin, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/rehire")),
        new("GET", "/api/employees/{id:guid}/memory", MemberRole.Viewer, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/memory")),
        new("POST", "/api/employees/{id:guid}/memory", MemberRole.Builder, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/memory", new { title = $"t{Guid.NewGuid():N}", body = "b", kind = "fact" })),
        new("PATCH", "/api/employees/{id:guid}/memory/{entryId:guid}", MemberRole.Builder, Level.Branch, async s => new Req($"/api/employees/{s.EmployeeId}/memory/{await s.FreshMemory(s.EmployeeId)}", new { body = "corrected" })),
        new("DELETE", "/api/employees/{id:guid}/memory/{entryId:guid}", MemberRole.Builder, Level.Branch, async s => new Req($"/api/employees/{s.EmployeeId}/memory/{await s.FreshMemory(s.EmployeeId)}?why=stale")),
        new("GET", "/api/employees/{id:guid}/memory/changes", MemberRole.Viewer, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/memory/changes")),
        new("POST", "/api/employees/{id:guid}/reviews", MemberRole.Builder, Level.Branch, s => R($"/api/employees/{s.EmployeeId}/reviews")),
        new("GET", "/api/hires", MemberRole.Viewer, Level.Branch, s => R($"/api/hires?scope={s.Division}")),
        new("GET", "/api/hires/{id:guid}", MemberRole.Viewer, Level.Branch, s => R($"/api/hires/{s.HireId}")),
        new("POST", "/api/hires", MemberRole.Admin, Level.Branch, s => R("/api/hires", new { scope = s.Division, name = "N", role = $"r{Guid.NewGuid():N}", reason = "Why", expectedMonthlyCredits = 1_000_000, needKey = $"k{Guid.NewGuid():N}", jobDescription = new { mandate = "M" } })),
        new("PATCH", "/api/hires/{id:guid}", MemberRole.Admin, Level.Branch, async s => new Req($"/api/hires/{await s.FreshHire()}", new { reason = "Still needed" })),
        new("POST", "/api/hires/{id:guid}/accept", MemberRole.Admin, Level.Branch, async s => new Req($"/api/hires/{await s.FreshHire()}/accept")),
        new("POST", "/api/hires/{id:guid}/decline", MemberRole.Admin, Level.Branch, async s => new Req($"/api/hires/{await s.FreshHire()}/decline")),
        new("GET", "/api/ontology", MemberRole.Viewer, Level.Branch, s => R($"/api/ontology?scope={s.Division}")),

        // God mode
        new("GET", "/api/operator/organisations", MemberRole.Owner, Level.Operator, s => R("/api/operator/organisations")),
        new("POST", "/api/operator/organisations/{slug}/enter", MemberRole.Owner, Level.Operator, s => R($"/api/operator/organisations/{s.Org}/enter")),
        new("PUT", "/api/operator/organisations/{slug}/overdraft", MemberRole.Owner, Level.Operator, s => R($"/api/operator/organisations/{s.Org}/overdraft", new { credits = 0 })),
        new("GET", "/api/operator/top-ups", MemberRole.Owner, Level.Operator, s => R("/api/operator/top-ups")),
        new("GET", "/api/operator/top-up-requests", MemberRole.Owner, Level.Operator, s => R("/api/operator/top-up-requests")),
        new("POST", "/api/operator/top-up-requests/{id:guid}/close", MemberRole.Owner, Level.Operator, s => R($"/api/operator/top-up-requests/{Guid.NewGuid()}/close", new { status = "declined" })),
        new("GET", "/api/operator/pricing", MemberRole.Owner, Level.Operator, s => R("/api/operator/pricing")),
        new("PUT", "/api/operator/pricing", MemberRole.Owner, Level.Operator, s => R("/api/operator/pricing", new
        {
            creditsPerUsd = 100, margin = 1.0, hosting = new { usdPerAwakeHour = 0.002, usdPerGbHourMemory = 0.004, usdPerGbMonthStorage = 0.1, usdPerMillionRequests = 0.2 }, defaultAppModelMonthlyCredits = 500,
        })),
    ];

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string method, Req request)
    {
        using var message = new HttpRequestMessage(new HttpMethod(method), request.Url);
        if (request.Body is not null)
        {
            message.Content = new StringContent(JsonSerializer.Serialize(request.Body, ControlPlaneApp.Web), Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(message);
    }

    private static readonly MemberRole[] AllRoles = [MemberRole.Owner, MemberRole.Admin, MemberRole.Builder, MemberRole.Viewer];

    [Fact]
    public void Every_public_endpoint_is_in_the_matrix_or_exempt_with_a_reason()
    {
        var mapped = app.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("/api", StringComparison.Ordinal) == true && e.Metadata.GetMetadata<IAuthorizeData>() is not null)
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(m => $"{m} {e.RoutePattern.RawText!.TrimEnd('/')}"))
            .ToHashSet(StringComparer.Ordinal);
        var covered = Rows().Select(r => $"{r.Method} {r.Route}").Concat(Exempt.Keys).ToHashSet(StringComparer.Ordinal);
        Assert.Empty(mapped.Except(covered).Order(StringComparer.Ordinal));
        Assert.Empty(covered.Except(mapped).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Every_endpoint_lets_each_role_through_or_refuses_it_inside_scope_and_discloses_nothing_outside()
    {
        var failures = new List<string>();
        foreach (var row in Rows())
        {
            foreach (var role in AllRoles)
            {
                if (row.Level == Level.Operator)
                {
                    var refused = await SendAsync(people[(Level.Organisation, role)], row.Method, await row.Build(inside));
                    Check(failures, row, role, "member", refused, HttpStatusCode.Forbidden);
                    continue;
                }

                var client = people[(row.Level, role)];
                var response = await SendAsync(client, row.Method, await row.Build(inside));
                if (role.Allows(row.Min))
                {
                    if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound or HttpStatusCode.InternalServerError)
                    {
                        failures.Add($"{row.Method} {row.Route} as {role} inside: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
                    }
                }
                else
                {
                    Check(failures, row, role, "inside", response, HttpStatusCode.Forbidden);
                }

                if (role != MemberRole.Owner)
                {
                    var away = await SendAsync(client, row.Method, await row.Build(row.Level == Level.Branch ? outside : elsewhere));
                    Check(failures, row, role, "outside", away, HttpStatusCode.NotFound);
                }
            }

            if (row.Level == Level.Operator)
            {
                var allowed = await SendAsync(operatorClient, row.Method, await row.Build(inside));
                if (allowed.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.InternalServerError)
                {
                    failures.Add($"{row.Method} {row.Route} as an operator: {(int)allowed.StatusCode}");
                }
            }
        }

        // The tree: each member sees their own branch; another organisation does not exist for them.
        foreach (var role in new[] { MemberRole.Admin, MemberRole.Builder, MemberRole.Viewer })
        {
            Check(failures, new Row("GET", "/api/tree", role, Level.Branch, _ => R("")), role, "outside", await people[(Level.Branch, role)].GetAsync("/api/tree?organisation=other"), HttpStatusCode.NotFound);
            Check(failures, new Row("GET", "/api/tree", role, Level.Branch, _ => R("")), role, "inside", await people[(Level.Branch, role)].GetAsync("/api/tree"), HttpStatusCode.OK);
        }

        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    private static void Check(List<string> failures, Row row, MemberRole role, string where, HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode != expected)
        {
            failures.Add($"{row.Method} {row.Route} as {role} {where}: expected {(int)expected}, got {(int)response.StatusCode} {response.Content.ReadAsStringAsync().GetAwaiter().GetResult()}");
        }
    }

    /// <summary>Arguments for each MCP tool against one side's resources.</summary>
    private static async Task<object> ArgumentsAsync(string tool, Side s) => tool switch
    {
        "tree_get" or "notifications_list" => new { },
        "node_create" => new { level = "project", parent = s.Division, name = "P", slug = $"m{Guid.NewGuid():N}"[..10] },
        "node_update" => new { scope = s.Project, name = "p" },
        "cascade_get" => new { scope = s.Division, kind = "budget" },
        "cascade_set" => new { scope = s.Division, kind = "budget", key = "monthly_credits", value = 1000 },
        "cascade_remove" => new { scope = s.Division, kind = "budget", key = "monthly_credits" },
        "idea_estimate" => new { text = "An idea" },
        "idea_submit" => new { text = "An idea", scope = s.Division },
        "idea_get" => new { id = s.IdeaId },
        "idea_decide" => new { id = s.IdeaId, choice = "build" },
        "ideas_suggest" => new { scope = s.Division },
        "ideas_suggestions" => new { scope = s.Division },
        "suggestion_take" => new { id = await s.FreshSuggestion() },
        "runs_list" => new { scope = s.Division },
        "run_get" => new { id = s.RunId },
        "run_events" => new { id = s.RunId },
        "run_control" => new { id = await s.FreshRun(), action = "cancel" },
        "approval_answer" => await Approval(s),
        "tasks_list" => new { scope = s.Division },
        "credits_get" => new { scope = s.Division },
        "budget_set" => new { scope = s.Division, monthlyCredits = 1000 },
        "employees_list" => new { scope = s.Division },
        "employee_get" => new { id = s.EmployeeId },
        "employee_update" => new { id = s.EmployeeId, role = "Builder" },
        "employee_release" => new { id = await s.FreshEmployee() },
        "hires_list" => new { scope = s.Division },
        "hire_raise" => new { scope = s.Division, name = "N", role = $"r{Guid.NewGuid():N}", mandate = "M", reason = "Why", expectedMonthlyCredits = 1_000_000 },
        "hire_decide" => new { id = await s.FreshHire(), decision = "decline" },
        "autonomy_get" => new { scope = s.Division },
        "autonomy_set" => new { scope = s.Division, autonomy = "auto" },
        "rule_set_set" => new { scope = s.Division, stage = "build", deny = new[] { "x" } },
        "members_list" => new { scope = s.Division },
        "member_invite" => new { scope = s.Project, email = $"{Guid.NewGuid():N}@example.com", role = "viewer" },
        "member_revoke" => new { membershipId = await s.FreshMembership() },
        "secrets_list" => new { scope = s.Division },
        "secret_set" => new { scope = s.Division, name = "API_KEY", value = "x" },
        "secret_remove" => new { scope = s.Division, name = "API_KEY" },
        "app_get" or "app_versions" => new { id = s.AppId },
        "app_settings" => new { id = s.AppId, running = "sleep" },
        "app_ask" => new { id = s.AppId, question = "How many requests?" },
        "app_restore" => new { id = s.AppId, commit = "abcdef1234" },
        "conversation_post" => new { scope = s.Division, message = "Hello" },
        "ontology_get" => new { scope = s.Division },
        _ => throw new InvalidOperationException($"No arguments for {tool}."),
    };

    private static async Task<object> Approval(Side s)
    {
        var (run, approval) = await s.FreshApproval();
        return new { runId = run, approvalId = approval, decision = "approve" };
    }

    [Fact]
    public async Task Every_mcp_tool_is_held_to_the_same_roles_inside_its_scope_and_discloses_nothing_outside()
    {
        Assert.Equal(ControlPlaneTools.All.Select(t => t.Name).Order(StringComparer.Ordinal), ControlPlaneTools.Roles.Keys.Order(StringComparer.Ordinal));
        var failures = new List<string>();
        foreach (var role in new[] { MemberRole.Admin, MemberRole.Builder, MemberRole.Viewer })
        {
            await using var client = await app.McpAsync(tokens[(Level.Branch, role)]);
            foreach (var tool in ControlPlaneTools.All)
            {
                var min = ControlPlaneTools.Roles[tool.Name];
                if (tool.Name is "tree_get" or "notifications_list" or "idea_estimate")
                {
                    continue; // organisation-wide or scope-free: below
                }

                var inside = await CallAsync(client, tool.Name, await ArgumentsAsync(tool.Name, this.inside));
                if (role.Allows(min))
                {
                    if (inside.Status is 401 or 403 or 404 or 500)
                    {
                        failures.Add($"{tool.Name} as {role} inside: {inside.Status} {inside.Text}");
                    }
                }
                else if (inside.Status != 403)
                {
                    failures.Add($"{tool.Name} as {role} inside: expected 403, got {inside.Status} {inside.Text}");
                }

                var outside = await CallAsync(client, tool.Name, await ArgumentsAsync(tool.Name, this.outside));
                if (outside.Status != 404)
                {
                    failures.Add($"{tool.Name} as {role} outside: expected 404, got {outside.Status} {outside.Text}");
                }
            }
        }

        // Scope-free and organisation-wide tools, with organisation-level tokens.
        foreach (var role in new[] { MemberRole.Admin, MemberRole.Builder, MemberRole.Viewer })
        {
            await using var client = await app.McpAsync(tokens[(Level.Organisation, role)]);
            foreach (var name in new[] { "tree_get", "idea_estimate", "notifications_list" })
            {
                var result = await CallAsync(client, name, await ArgumentsAsync(name, inside));
                var allowed = role.Allows(ControlPlaneTools.Roles[name]);
                if (allowed ? result.Status is 401 or 403 or 404 or 500 : result.Status != 403)
                {
                    failures.Add($"{name} as {role}: {result.Status} {result.Text}");
                }
            }

            // A token of one organisation never reaches another.
            var foreign = await CallAsync(client, "credits_get", new { scope = elsewhere.Org });
            if (foreign.Status != 404)
            {
                failures.Add($"credits_get in another organisation as {role}: {foreign.Status}");
            }
        }

        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    private static async Task<(int Status, string Text)> CallAsync(McpClient client, string tool, object arguments)
    {
        var args = JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(arguments, ControlPlaneApp.Web))!;
        var result = await client.CallToolAsync(tool, args);
        var text = result.Content.OfType<TextContentBlock>().FirstOrDefault()?.Text ?? "";
        return result.IsError == true ? (JsonNode.Parse(text)?["status"]?.GetValue<int>() ?? 500, text) : (200, text);
    }
}
