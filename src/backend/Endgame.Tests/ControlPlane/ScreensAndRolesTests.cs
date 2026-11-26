using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The product doing what its screens say, held on the real control plane and a real PostgreSQL:
/// provisioning screens an organisation against the red lines (OP-03); everything an operator changes
/// inside an organisation is in its operator log (OP-04, OP-06); an Owner's top-up request reaches the
/// operators (NOTE); the people at a level include grants from above, a role change keeps a pending
/// person's code and a new code can be sent (PPL-01, PPL-05, PPL-06); the tree carries each node's
/// effective role and whether it is archived, and archived levels are not served (PPL-01, TREE-07);
/// pausing an employee stops their work (EMP-04).
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ScreensAndRolesTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private static Func<JsonObject, HttpContext, Task> Screened(bool breached, string? line, string reason) =>
        FakeOpenRouter.Completion(0.00042m, new JsonObject { ["breached"] = breached, ["line"] = line, ["reason"] = reason }.ToJsonString(), id: "gen-screen-1");

    private async Task<JsonNode> ProvisionAsync(string slug = "acme", object? screening = null, string description = "Sells booking software to squash clubs.") =>
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug, ownerEmail = $"ceo@{slug}.example", description, screening }));

    private async Task<JsonArray> LogAsync(string slug = "acme")
    {
        var ceo = await app.SignInAsync($"ceo@{slug}.example");
        return (await ControlPlaneApp.Ok(ceo.GetAsync($"/api/audit/operator-access?organisation={slug}"))).AsArray();
    }

    private async Task<List<(string Purpose, decimal Cost, string Detail)>> PlatformCostsAsync()
    {
        await using var scope = app.Scope();
        scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        return (await db.PlatformCosts.AsNoTracking().ToListAsync()).Select(c => (c.Purpose, c.CostUsd, c.DetailJson)).ToList();
    }

    [Fact]
    public async Task Provisioning_screens_what_the_organisation_does_as_a_platform_cost_and_logs_how()
    {
        openRouter.Chat = Screened(false, null, "It sells booking software; no red line is crossed.");
        var created = await ProvisionAsync();
        Assert.Equal("model", created["screening"]!["method"]!.GetValue<string>());

        // The model was asked about what it does, against the four lines, with the forecasting carve-out.
        var asked = Assert.Single(openRouter.Requests).ToJsonString();
        Assert.Contains("Sells booking software to squash clubs.", asked, StringComparison.Ordinal);
        Assert.Contains("Prediction markets", asked, StringComparison.Ordinal);

        // A platform cost, charged to no organisation: no organisation's ledger holds it.
        var cost = Assert.Single(await PlatformCostsAsync());
        Assert.Equal("organisation.screening", cost.Purpose);
        Assert.Equal(0.00042m, cost.Cost);
        await using (var scope = app.Scope())
        {
            scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
            Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<EndgameDbContext>().CreditEntries.CountAsync());
        }

        var screened = Assert.Single(await LogAsync(), e => e!["action"]!.GetValue<string>() == "organisation.screened")!;
        Assert.Equal("model", screened["detail"]!["method"]!.GetValue<string>());
        Assert.Equal("clear", screened["detail"]!["result"]!.GetValue<string>());
        Assert.Contains("booking software", screened["detail"]!["reason"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    /// <summary>Answers in turn: each call gets the next content, the last repeating.</summary>
    private static Func<JsonObject, HttpContext, Task> Answers(params string[] contents)
    {
        var next = 0;
        return (request, http) =>
        {
            var content = contents[Math.Min(Interlocked.Increment(ref next) - 1, contents.Length - 1)];
            // A cut-off answer arrives as OpenRouter sends it: finish_reason "length".
            return FakeOpenRouter.Completion(0.0003m, content, id: $"gen-screen-{next}", finish: content == CutOff ? "length" : null)(request, http);
        };
    }

    // What qwen/qwen3.7-flash really answered on 2026-11-26 at the old 400-token limit: it reasoned first, and
    // the answer was cut mid-sentence (finish_reason "length").
    private const string CutOff = "{\"breached\": false, \"line\": null, \"reason\": \"The organization builds booking software for squash clubs, which";

    [Fact]
    public async Task A_cut_off_answer_is_asked_again_once_and_the_model_is_asked_for_json_with_room_to_think()
    {
        // D54: the live model's answer could not be read, so every operator set-up failed with 503.
        openRouter.Chat = Answers(CutOff, "Here is my answer.\n```json\n{\"breached\": false, \"line\": null, \"reason\": \"Booking software {for clubs} crosses no line.\"}\n```\nThat is all.");
        var created = await ProvisionAsync();
        Assert.Equal("model", created["screening"]!["method"]!.GetValue<string>());
        Assert.Equal("clear", created["screening"]!["result"]!.GetValue<string>());
        Assert.Equal("Booking software {for clubs} crosses no line.", created["screening"]!["reason"]!.GetValue<string>());
        var asked = openRouter.Requests.ToList();
        Assert.Equal(2, asked.Count);
        Assert.All(asked, r => Assert.Equal("json_object", r["response_format"]!["type"]!.GetValue<string>()));
        // The cut-off answer is asked for again with twice the room (R2-6).
        Assert.Equal([Endgame.Infrastructure.Platform.OrganisationScreening.MaxTokens, Endgame.Infrastructure.Platform.OrganisationScreening.MaxTokens * 2], asked.Select(r => r["max_tokens"]!.GetValue<int>()));
        // Both calls are platform costs.
        Assert.Equal(2, (await PlatformCostsAsync()).Count);
    }

    [Fact]
    public async Task Two_unreadable_answers_leave_only_the_screening_by_hand()
    {
        openRouter.Chat = Answers(CutOff, "I cannot answer that.");
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations",
            new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = "Sells booking software to squash clubs." }), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("screening_unavailable", refused["code"]!.GetValue<string>());
        Assert.Contains("the model's answer could not be read", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(2, openRouter.Requests.Count);
        var created = await ProvisionAsync(screening: Provisioning.Manual);
        Assert.Equal("manual", created["screening"]!["method"]!.GetValue<string>());
    }

    [Fact]
    public async Task Two_cut_off_answers_are_reported_as_too_long_to_finish()
    {
        openRouter.Chat = Answers(CutOff, CutOff);
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations",
            new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = "Sells booking software to squash clubs." }), HttpStatusCode.ServiceUnavailable);
        Assert.Contains("the model's answer was too long to finish", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("{\"breached\": true, \"line\": \"weapons\", \"reason\": \"r\"}", true)]
    [InlineData("```json\n{\"breached\": false}\n```", false)]
    [InlineData("Sure {not json}. {\"breached\": true, \"reason\": \"a } in a string\"} and {\"other\": 1}", true)]
    public void The_first_whole_json_object_is_read_wherever_it_sits(string content, bool breached) =>
        Assert.Equal(breached, Endgame.Infrastructure.Platform.OrganisationScreening.ReadAnswer(content)!["breached"]!.GetValue<bool>());

    [Theory]
    [InlineData("")]
    [InlineData("No JSON here.")]
    [InlineData(CutOff)]
    public void A_missing_or_cut_off_object_reads_as_nothing(string content) =>
        Assert.Null(Endgame.Infrastructure.Platform.OrganisationScreening.ReadAnswer(content));

    [Fact]
    public async Task A_breach_is_refused_naming_the_line_and_why_and_nothing_is_set_up()
    {
        openRouter.Chat = Screened(true, "surveillance", "It sells tools to track protesters.");
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations",
            new { name = "Watch", slug = "watch", ownerEmail = "ceo@watch.example", description = "Tracks protesters for governments.", screening = Provisioning.Manual }), (HttpStatusCode)422);
        Assert.Equal("red_line", refused["code"]!.GetValue<string>());
        Assert.Contains("surveillance and authoritarian tooling", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("track protesters", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.DoesNotContain((await ControlPlaneApp.Ok(owner.GetAsync("/api/operator/organisations"))).AsArray(), o => o!["slug"]!.GetValue<string>() == "watch");
        Assert.Single(await PlatformCostsAsync());
    }

    [Fact]
    public async Task With_no_model_provisioning_is_refused_unless_the_operator_records_a_decision_with_a_reason()
    {
        await using var offline = await ControlPlaneApp.StartAsync(postgres);
        var operatorClient = await offline.OwnerWithOrganisationAsync();
        object Body(object? screening, string? description = "Runs a bakery's ordering site.") => new { name = "Bakery", slug = "bakery", ownerEmail = "ceo@bakery.example", description, screening };

        var missing = await ControlPlaneApp.Expect(await operatorClient.PostAsJsonAsync("/api/organisations", Body(null, null)), HttpStatusCode.BadRequest);
        Assert.Contains("Say what the organisation does", missing["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        var unscreened = await ControlPlaneApp.Expect(await operatorClient.PostAsJsonAsync("/api/organisations", Body(null)), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("screening_unavailable", unscreened["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await operatorClient.PostAsJsonAsync("/api/organisations", Body(new { decision = "clear", reason = "ok" })), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await operatorClient.PostAsJsonAsync("/api/organisations", Body(new { decision = "breach", reason = "It sells payday loans at ruinous rates.", line = "tobacco-gambling-finance" })), (HttpStatusCode)422);

        var created = await ControlPlaneApp.Created(operatorClient.PostAsJsonAsync("/api/organisations", Body(new { decision = "clear", reason = "A bakery's ordering site crosses no red line." })));
        Assert.Equal("manual", created["screening"]!["method"]!.GetValue<string>());
        var ceo = await offline.SignInAsync("ceo@bakery.example");
        var screened = Assert.Single((await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=bakery"))).AsArray(), e => e!["action"]!.GetValue<string>() == "organisation.screened")!;
        Assert.Equal("manual", screened["detail"]!["method"]!.GetValue<string>());
        Assert.Equal("A bakery's ordering site crosses no red line.", screened["detail"]!["reason"]!.GetValue<string>());
        Assert.Equal("owner@frostaura.net", screened["operator"]!["email"]!.GetValue<string>());
    }

    [Fact]
    public async Task Every_change_an_operator_makes_inside_an_entered_organisation_is_one_entry_in_its_log()
    {
        await ProvisionAsync(screening: Provisioning.Manual);
        var dean = await app.SignInAsync("dean@frostaura.net");
        await ControlPlaneApp.Ok(dean.PostAsync("/api/operator/organisations/acme/enter", null));
        await ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"));
        await dean.DivisionAsync("acme", "labs");
        await dean.SetAsync("acme/labs", "budget", "monthly_credits", 50);
        // A refused change is not an action; an Owner's own change is not an operator's.
        await ControlPlaneApp.Expect(await dean.PutAsJsonAsync("/api/credits/overdraft", new { scope = "acme", credits = 5 }), HttpStatusCode.Forbidden);
        var ceo = await app.SignInAsync("ceo@acme.example");
        await ceo.DivisionAsync("acme", "ops");

        var actions = (await LogAsync()).Select(e => e!).Where(e => e["action"]!.GetValue<string>().StartsWith("admin.", StringComparison.Ordinal)).ToList();
        Assert.Equal(["admin.SetCascadeValue", "admin.CreateDivision"], actions.Select(a => a["action"]!.GetValue<string>()));
        Assert.Equal("Added a division", actions[1]["detail"]!["title"]!.GetValue<string>());
        Assert.Equal("Changed a setting, budget or rule", actions[0]["detail"]!["title"]!.GetValue<string>());
        Assert.All(actions, a => Assert.Equal("dean@frostaura.net", a["operator"]!["email"]!.GetValue<string>()));
    }

    [Fact]
    public async Task An_owners_top_up_request_reaches_the_operators_and_its_answer_is_on_the_record()
    {
        await ProvisionAsync(screening: Provisioning.Manual);
        // An Admin of FrostAura's own organisation who is not an operator.
        var invited = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "colleague@example.com", role = "admin" }));
        Assert.NotNull(invited["member"]);
        var ceo = await app.SignInAsync("ceo@acme.example");
        var asked = await ControlPlaneApp.Created(ceo.PostAsJsonAsync("/api/credits/top-up-requests", new { organisation = "acme", credits = 250, note = "Launch week." }));
        var requestId = asked["id"]!.GetValue<string>();

        var notice = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/notifications?organisation=frostaura")))["notifications"]!.AsArray(),
            n => n!["kind"]!.GetValue<string>() == "topup.requested")!;
        Assert.Equal("Acme asks for 250 credits", notice["title"]!.GetValue<string>());
        Assert.Equal("Launch week.", notice["detail"]!.GetValue<string>());
        Assert.Equal("topup_request", notice["subject"]!["kind"]!.GetValue<string>());
        var colleague = await app.SignInAsync("colleague@example.com");
        Assert.DoesNotContain((await ControlPlaneApp.Ok(colleague.GetAsync("/api/notifications?organisation=frostaura")))["notifications"]!.AsArray(),
            n => n!["kind"]!.GetValue<string>() == "topup.requested");

        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/credits/top-ups", new { organisation = "acme", credits = 250, note = "Answering your request.", requestId }));
        var answered = Assert.Single((await ControlPlaneApp.Ok(ceo.GetAsync("/api/credits/top-up-requests?organisation=acme"))).AsArray())!;
        Assert.Equal("fulfilled", answered["status"]!.GetValue<string>());
        Assert.Equal("Answering your request.", answered["closeNote"]!.GetValue<string>());
        var fulfilled = Assert.Single(await LogAsync(), e => e!["action"]!.GetValue<string>() == "topup_request.fulfilled")!;
        Assert.Equal(250m, fulfilled["detail"]!["credits"]!.GetValue<decimal>());

        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/operator/pricing", (await ControlPlaneApp.Ok(owner.GetAsync("/api/operator/pricing")))["pricing"]));
        Assert.Single(await LogAsync(), e => e!["action"]!.GetValue<string>() == "pricing.changed");
    }

    [Fact]
    public async Task People_below_the_organisation_include_grants_from_above_and_a_pending_persons_code_is_kept_or_renewed()
    {
        await owner.DivisionAsync("frostaura", "labs");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "boss@example.com", role = "admin" }));
        var invited = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "ann@example.com", role = "viewer" }));
        var code = invited["invitationCode"]!.GetValue<string>();
        var membership = invited["member"]!["membershipId"]!.GetValue<string>();

        var people = (await ControlPlaneApp.Ok(owner.GetAsync("/api/members?scope=frostaura/labs"))).AsArray();
        Assert.Equal("frostaura", Assert.Single(people, p => p!["email"]!.GetValue<string>() == "owner@frostaura.net")!["scope"]!.GetValue<string>());
        Assert.Equal("frostaura", Assert.Single(people, p => p!["email"]!.GetValue<string>() == "boss@example.com")!["scope"]!.GetValue<string>());
        var ann = Assert.Single(people, p => p!["email"]!.GetValue<string>() == "ann@example.com")!;
        Assert.Equal("frostaura/labs", ann["scope"]!.GetValue<string>());
        Assert.NotNull(ann["invitationExpiresAt"]);

        // A role change keeps the code Ann was sent.
        var changed = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/members/{membership}", new { role = "builder" }));
        Assert.Null(changed["invitationCode"]);
        Assert.False(changed["member"]!["hasPasskey"]!.GetValue<bool>());
        await ControlPlaneApp.Ok(app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = code }));

        // A new code replaces it, shown once.
        var renewed = await ControlPlaneApp.Ok(owner.PostAsync($"/api/members/{membership}/invitation", null));
        var fresh = renewed["invitationCode"]!.GetValue<string>();
        Assert.NotEqual(code, fresh);
        Assert.NotNull(renewed["expiresAt"]);
        await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = code }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Ok(app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = fresh }));
    }

    [Fact]
    public async Task The_tree_carries_each_nodes_effective_role_and_archived_levels_are_marked_and_not_served()
    {
        await owner.DivisionAsync("frostaura", "labs");
        var ops = await owner.DivisionAsync("frostaura", "ops");
        await owner.ProjectAsync("frostaura/ops", "rota");
        var rota = await owner.AppAsync("frostaura/ops/rota", "rota");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "mixed@example.com", role = "admin" }));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "mixed@example.com", role = "viewer" }));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/ops", email = "part@example.com", role = "builder" }));

        JsonNode Division(JsonNode tree, string slug) => tree["divisions"]!.AsArray().Single(d => d!["slug"]!.GetValue<string>() == slug)!;

        // The deepest grant wins, as the server checks it: an organisation Admin who is a Viewer in Labs is a Viewer there.
        var mixed = await ControlPlaneApp.Ok((await app.SignInAsync("mixed@example.com")).GetAsync("/api/tree"));
        Assert.Equal("admin", mixed["organisation"]!["role"]!.GetValue<string>());
        Assert.Equal("viewer", Division(mixed, "labs")["role"]!.GetValue<string>());
        Assert.Equal("admin", Division(mixed, "ops")["role"]!.GetValue<string>());
        // The Owner is the Owner everywhere.
        Assert.Equal("owner", Division(await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")), "labs")["role"]!.GetValue<string>());
        // Someone granted one division holds no role at the organisation itself.
        var part = await ControlPlaneApp.Ok((await app.SignInAsync("part@example.com")).GetAsync("/api/tree"));
        Assert.Null(part["organisation"]!["role"]);
        Assert.Equal("builder", Assert.Single(part["divisions"]!.AsArray())!["role"]!.GetValue<string>());

        static bool Routed(JsonNode routes, Guid app) => routes["routes"]!.AsArray().Any(r => r!["appId"]!.GetValue<Guid>() == app);
        Assert.True(Routed(await ControlPlaneApp.Ok(app.Internal().GetAsync("/internal/routes")), rota));
        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/divisions/{ops}", new { status = "archived" }));
        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        Assert.True(Division(tree, "ops")["archived"]!.GetValue<bool>());
        Assert.False(Division(tree, "labs")["archived"]!.GetValue<bool>());
        Assert.False(Routed(await ControlPlaneApp.Ok(app.Internal().GetAsync("/internal/routes")), rota));
        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/divisions/{ops}", new { status = "active" }));
        Assert.True(Routed(await ControlPlaneApp.Ok(app.Internal().GetAsync("/internal/routes")), rota));
    }

    [Fact]
    public async Task Someone_with_no_role_is_offered_the_first_organisation_only_on_a_first_run()
    {
        await using var fresh = await ControlPlaneApp.StartAsync(postgres);
        var first = await fresh.SignInAsync("first@example.com");
        Assert.True((await ControlPlaneApp.Ok(first.GetAsync("/api/tree")))["firstRun"]!.GetValue<bool>());

        var stranger = await app.SignInAsync("stranger@example.com");
        var tree = await ControlPlaneApp.Ok(stranger.GetAsync("/api/tree"));
        Assert.Null(tree["organisation"]);
        Assert.False(tree["firstRun"]!.GetValue<bool>());
    }

    [Fact]
    public async Task A_released_employees_archived_memory_cannot_be_corrected_or_removed()
    {
        await owner.DivisionAsync("frostaura", "technologies");
        var service = app.Internal();
        var ada = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new
        {
            scope = "frostaura/technologies",
            name = "Ada",
            role = "Builder",
            mandate = "Builds features.",
            tools = new[] { "read_file" },
            services = new[] { "models" },
            modelTier = "build",
        })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Created(service.PostAsJsonAsync($"/internal/employees/{ada}/memory", new { entries = new[] { new { title = "Club rules", body = "Members book a week ahead.", kind = "fact" } } }));
        var entry = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory"))).AsArray())!["id"]!.GetValue<string>();
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/employees/{ada}/release", null));

        await ControlPlaneApp.Expect(await owner.PatchAsJsonAsync($"/api/employees/{ada}/memory/{entry}", new { body = "Changed." }), HttpStatusCode.Conflict);
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/employees/{ada}/memory/{entry}"), HttpStatusCode.Conflict);
        Assert.Equal("Members book a week ahead.", Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/employees/{ada}/memory?includeArchived=true"))).AsArray())!["body"]!.GetValue<string>());
    }

    [Fact]
    public async Task Pausing_an_employee_stops_their_work_and_resuming_releases_what_waited()
    {
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        var service = app.Internal();
        var ada = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new
        {
            scope = "frostaura/technologies/squash",
            name = "Ada",
            role = "Builder",
            mandate = "Builds features.",
            tools = new[] { "read_file" },
            services = new[] { "models" },
            modelTier = "build",
        })))["id"]!.GetValue<string>());
        async Task<JsonNode> RunAsync(Guid id) => await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{id}"));
        var own = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies/squash", kind = "build", title = "Build bookings", employeeId = ada })))["id"]!.GetValue<string>());
        var factory = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies/squash", kind = "build", title = "Factory build" })))["id"]!.GetValue<string>());
        var task = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/tasks", new { scope = "frostaura/technologies/squash", runId = factory, title = "Courts page" })))["id"]!.GetValue<string>();

        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}", new { status = "paused" }));
        Assert.Equal("paused", (await RunAsync(own))["status"]!.GetValue<string>());
        var said = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{own}/events"))).ToJsonString();
        Assert.Contains("Waiting for Ada, who is paused.", said, StringComparison.Ordinal);

        // A person starting work for them is refused plainly; the factory's work for them waits.
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/technologies/squash", message = "Hello", employeeId = ada }), HttpStatusCode.Conflict);
        Assert.Equal("Ada is paused, so they are given no new work. Resume them first.", refused["detail"]!.GetValue<string>());
        var later = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies/squash", kind = "build", title = "Later", employeeId = ada })))["id"]!.GetValue<string>());
        Assert.Equal("paused", (await RunAsync(later))["status"]!.GetValue<string>());
        // The Runner is handed only the work that is not waiting for Ada.
        var claimed = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/runs/claim", new { holder = "runner", leaseSeconds = 60, kinds = new[] { "build" } }));
        Assert.Equal(factory.ToString(), claimed["id"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.NoContent, (await service.PostAsJsonAsync("/internal/runs/claim", new { holder = "runner", leaseSeconds = 60, kinds = new[] { "build" } })).StatusCode);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/tasks/checkout", new { taskId = task, runId = factory, employeeId = ada, expectedStatus = "todo" }), HttpStatusCode.Conflict);
        Assert.Equal("paused", (await RunAsync(factory))["status"]!.GetValue<string>());

        await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{ada}", new { status = "idle" }));
        Assert.Equal("queued", (await RunAsync(own))["status"]!.GetValue<string>());
        Assert.Equal("queued", (await RunAsync(later))["status"]!.GetValue<string>());
        Assert.Equal("queued", (await RunAsync(factory))["status"]!.GetValue<string>());
    }
}
