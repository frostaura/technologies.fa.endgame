using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The console lane coded against exact JSON (lane-console src/frontend/src/store/types.ts, UC-001).
/// Every key its types name must be present in what the control plane returns; extra keys are allowed.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ConsoleContractTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;

    public async Task InitializeAsync() => app = await ControlPlaneApp.StartAsync(postgres);

    public async Task DisposeAsync() => await app.DisposeAsync();

    private static void HasKeys(JsonNode? node, params string[] keys)
    {
        var o = Assert.IsType<JsonObject>(node);
        var missing = keys.Where(k => !o.ContainsKey(k)).ToList();
        Assert.True(missing.Count == 0, $"Missing {string.Join(", ", missing)} in {o.ToJsonString()}");
    }

    [Fact]
    public async Task Every_read_has_the_shape_the_console_expects()
    {
        var anonymous = app.Client();
        HasKeys(await ControlPlaneApp.Ok(anonymous.GetAsync("/api/auth/options")), "passkey", "developmentSignIn");

        var owner = await app.OwnerWithOrganisationAsync();
        var me = await ControlPlaneApp.Ok(owner.GetAsync("/api/me"));
        HasKeys(me, "user", "organisation");
        HasKeys(me["user"], "id", "displayName", "email");
        HasKeys(me["organisation"], "id", "slug", "name");

        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        var appId = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        var service = app.Internal();
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/technologies/squash", name = "Ada", role = "Builder" }));
        var run = (await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/technologies/squash", kind = "build", title = "Build bookings" })))["id"]!.GetValue<string>();
        await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/approvals", new { runId = run, title = "Go?", detail = "" }));

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        HasKeys(tree, "organisation", "divisions", "needsYou");
        HasKeys(tree["organisation"], "id", "slug", "name", "summary", "spend", "workers");
        HasKeys(tree["organisation"]!["spend"], "monthCredits");
        var division = tree["divisions"]![0]!;
        HasKeys(division, "id", "slug", "name", "spend", "workers", "projects");
        var project = division["projects"]![0]!;
        HasKeys(project, "id", "slug", "name", "stage", "ideaId", "note", "progress", "spend", "workers", "apps");
        Assert.Equal("building", project["stage"]!.GetValue<string>());
        HasKeys(project["progress"], "runId", "label", "step", "of", "spentCredits", "estimatedCredits", "done");
        HasKeys(project["workers"]![0], "id", "name", "role", "kind", "activity");
        HasKeys(project["apps"]![0], "id", "slug", "name", "health", "running", "access", "sharedWith", "visitsToday", "lastVisitAt", "spend", "workers");
        HasKeys(tree["needsYou"]![0], "kind", "id", "runId", "approvalId", "title", "detail");

        HasKeys(await ControlPlaneApp.Ok(owner.GetAsync($"/api/runs/{run}")),
            "id", "kind", "title", "scope", "status", "startedAt", "finishedAt", "lastSeq", "ideaId", "estimateCredits", "spentCredits");

        HasKeys(await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/ideas/estimate", new { text = "x", constraints = Array.Empty<string>() })), "credits", "basis");
        var idea = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/ideas", new { text = "An idea", constraints = new[] { "c" } }));
        HasKeys(idea, "id", "title", "text", "constraints", "status", "runId", "scope", "research", "verdict", "decision", "record");
        HasKeys(idea["research"], "estimatedCredits", "spentCredits", "by");
        HasKeys(idea["record"], "total", "build", "change", "doNotBuild", "overruled");

        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}"));
        HasKeys(detail, "id", "name", "scope", "health", "running", "addresses", "telemetry", "cost", "settings", "runningCost", "sharedWith", "endUsers");
        HasKeys(detail["health"], "state", "summary");
        HasKeys(detail["addresses"], "path", "subdomain");
        HasKeys(detail["cost"], "monthCredits", "capCredits");
        HasKeys(detail["settings"], "running", "access");

        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura"));
        HasKeys(credits, "scope", "balance", "month", "monthsLeftAtPace", "budgets", "estimates", "notCharged", "overdraft", "topUps");
        HasKeys(credits["month"], "spent", "ai", "hosting");
        HasKeys(credits["budgets"]![0], "scope", "name", "level", "depth", "spentCredits", "capCredits", "appId");
        HasKeys(credits["notCharged"], "credits", "repairs");
        HasKeys(credits["overdraft"], "frostauraLimit", "ownLimit");

        // ConversationAttachment, ConversationRequest's attachmentIds and narrow, ConversationHistory's turns (ARCH-011).
        using var form = new MultipartFormDataContent { { new StringContent("frostaura"), "scope" }, { new ByteArrayContent("Notes for the call."u8.ToArray()), "file", "notes.txt" } };
        var attachment = await ControlPlaneApp.Created(owner.PostAsync("/api/conversations/attachments", form));
        HasKeys(attachment, "id", "name", "contentType", "kind", "bytes", "pages", "characters", "runId");
        var turn = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura", message = "Hello", attachmentIds = new[] { attachment["id"]!.GetValue<string>() }, narrow = new { noWebSearch = true } }));
        HasKeys(turn, "id", "kind", "title", "scope", "status", "lastSeq");
        var history = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura"));
        HasKeys(history, "scope", "conversationId", "employeeId", "messages", "turns");
        HasKeys(history["messages"]![0], "runId", "seq", "at", "from", "text", "by", "code", "attachments");
        HasKeys(history["messages"]![0]!["attachments"]![0], "id", "name", "contentType", "kind", "bytes", "pages", "characters", "runId");
        HasKeys(history["turns"]![0], "runId", "status", "toolCalls", "started");
        HasKeys(await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/conversations/estimate", new { scope = "frostaura", attachmentIds = Array.Empty<string>() })), "credits", "ceiling", "basis");

        var capabilities = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations/capabilities?scope=frostaura"));
        HasKeys(capabilities, "scope", "answerer", "tools", "asks", "actions", "skills", "services", "apps", "webSearch", "assistants", "narrowing", "attachments");
        HasKeys(capabilities["answerer"], "kind", "name", "role", "employeeId", "tier");
        HasKeys(capabilities["skills"]![0], "name", "trigger", "usedBy");
        HasKeys(capabilities["services"]![0], "id", "detail");
        HasKeys(capabilities["webSearch"], "available", "rule", "setAtPath");
        HasKeys(capabilities["narrowing"], "noWebSearch", "answerOnly");
        HasKeys(capabilities["attachments"], "maxFiles", "maxFileBytes", "maxMessageBytes", "images", "extensions");
        await ControlPlaneApp.TokenAsync(owner, "frostaura");
        var withAssistant = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations/capabilities?scope=frostaura"));
        HasKeys(withAssistant["assistants"]![0], "id", "name", "role", "prefix", "lastUsedAt");

        var options = await ControlPlaneApp.Ok(app.Client().PostAsJsonAsync("/api/auth/passkey/login/options", new { }));
        HasKeys(options, "publicKey");
        HasKeys(options["publicKey"], "challenge");
    }
}
