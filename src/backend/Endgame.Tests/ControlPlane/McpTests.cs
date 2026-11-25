using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using ModelContextProtocol;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// MCP on by default (TEST-101, <i>MCP</i>): personal access tokens (hashed, scoped, capped, revocable,
/// last use shown); the SDK's own client listing and calling the control plane's tools in process,
/// held to the same roles and the same human-only rules as the console; and an app's own API derived
/// from its OpenAPI document and called through Edge with a member session.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class McpTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakePeer edge = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private Guid appId;
    private string? lastBody;

    private const string OpenApi = """
        {
          "openapi": "3.1.0",
          "info": { "title": "bookings", "version": "1" },
          "paths": {
            "/api/bookings": {
              "get": {
                "operationId": "listBookings",
                "description": "Lists the bookings on a court.",
                "parameters": [ { "name": "court", "in": "query", "required": true, "schema": { "type": "integer" }, "description": "The court." } ]
              },
              "post": {
                "operationId": "createBooking",
                "description": "Books a court.",
                "requestBody": { "required": true, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/NewBooking" } } } }
              }
            },
            "/api/bookings/{id}": {
              "delete": { "operationId": "cancelBooking", "description": "Cancels a booking.", "parameters": [ { "name": "id", "in": "path", "schema": { "type": "string" } } ] }
            },
            "/_platform/schedules/{name}": { "post": { "operationId": "platformSchedule", "description": "never offered" } },
            "/health": { "get": { "operationId": "health", "description": "never offered" } }
          },
          "components": { "schemas": { "NewBooking": { "type": "object", "properties": { "court": { "type": "integer" }, "at": { "type": "string" } }, "required": ["court", "at"] } } }
        }
        """;

    public async Task InitializeAsync()
    {
        edge = await FakePeer.StartAsync(routes =>
        {
            routes.MapPost("/internal/routes/refresh", () => Results.Ok(new { version = 1, apps = 0 }));
            routes.MapGet("/internal/apps/{id:guid}/call/openapi/v1.json", () => Results.Text(OpenApi, "application/json"));
            routes.MapGet("/internal/apps/{id:guid}/call/api/bookings", (int court, HttpContext http) =>
                Results.Ok(new { court, bookings = new[] { new { at = "09:00" } }, signedIn = http.Request.Headers["X-Endgame-Session"].ToString().StartsWith("egs_", StringComparison.Ordinal) }));
            routes.MapPost("/internal/apps/{id:guid}/call/api/bookings", async (HttpContext http) =>
            {
                lastBody = await new StreamReader(http.Request.Body).ReadToEndAsync();
                return Results.Created("/api/bookings/1", new { id = "1" });
            });
            routes.MapDelete("/internal/apps/{id:guid}/call/api/bookings/{booking}", () => Results.Problem(statusCode: 404, extensions: new Dictionary<string, object?> { ["code"] = "booking_not_found" }));
        });
        app = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?> { ["Services:EdgeControl"] = edge.BaseUrl });
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        appId = await owner.AppAsync("frostaura/products/squash", "bookings");
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await edge.DisposeAsync();
    }

    private static JsonNode Json(CallToolResult result) => JsonNode.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text)!;

    private static async Task<JsonNode> CallAsync(McpClient client, string tool, object arguments, bool expectError = false)
    {
        var args = JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(arguments))!;
        var result = await client.CallToolAsync(tool, args);
        Assert.True(result.IsError == expectError, $"{tool}: {Assert.IsType<TextContentBlock>(result.Content[0]).Text}");
        return Json(result);
    }

    [Fact]
    public async Task Tokens_are_shown_once_kept_as_a_hash_capped_at_the_persons_role_and_never_owner()
    {
        var created = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/tokens", new { name = "Claude Desktop", organisation = "frostaura" }));
        var token = created["token"]!.GetValue<string>();
        Assert.StartsWith("egp_", token, StringComparison.Ordinal);
        Assert.Equal("admin", created["accessToken"]!["role"]!.GetValue<string>()); // an Owner's token is an Admin at most
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/tokens", new { name = "x", organisation = "frostaura", role = "owner" }), HttpStatusCode.BadRequest);

        var listed = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync("/api/tokens"))).AsArray())!;
        Assert.Equal(token[..12], listed["prefix"]!.GetValue<string>());
        Assert.Null(listed["lastUsedAt"]);
        Assert.DoesNotContain(token, (await owner.GetStringAsync("/api/tokens")), StringComparison.Ordinal);

        await using (var client = await app.McpAsync(token))
        {
            await client.ListToolsAsync();
        }

        Assert.NotNull((await ControlPlaneApp.Ok(owner.GetAsync("/api/tokens"))).AsArray()[0]!["lastUsedAt"]);

        // A viewer's token is a viewer's; asking for more is refused.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "viewer@example.com", role = "viewer" }));
        var viewer = await app.SignInAsync("viewer@example.com");
        await ControlPlaneApp.Expect(await viewer.PostAsJsonAsync("/api/tokens", new { name = "x", organisation = "frostaura", role = "admin" }), HttpStatusCode.Forbidden);
        Assert.Equal("viewer", (await ControlPlaneApp.Created(viewer.PostAsJsonAsync("/api/tokens", new { name = "x", organisation = "frostaura" })))["accessToken"]!["role"]!.GetValue<string>());
        // A person with no role in an organisation is told it does not exist.
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        await ControlPlaneApp.Expect(await viewer.PostAsJsonAsync("/api/tokens", new { name = "x", organisation = "acme" }), HttpStatusCode.NotFound);

        // Revoked: refused at once. A console cookie never reaches /mcp, and a token never reaches /api.
        await ControlPlaneApp.Ok(owner.DeleteAsync($"/api/tokens/{created["accessToken"]!["id"]!.GetValue<string>()}"));
        await Assert.ThrowsAnyAsync<Exception>(async () => await app.McpAsync(token));
        Assert.Equal(HttpStatusCode.Unauthorized, (await owner.PostAsync("/mcp", JsonContent.Create(new { jsonrpc = "2.0", id = 1, method = "tools/list" }))).StatusCode);
        var live = await ControlPlaneApp.TokenAsync(owner, "frostaura");
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Bearer(live).GetAsync("/api/tree")).StatusCode);
    }

    [Fact]
    public async Task The_control_plane_tools_do_what_the_console_does_under_the_same_rules()
    {
        await using var client = await app.McpAsync(await ControlPlaneApp.TokenAsync(owner, "frostaura"));
        var tools = await client.ListToolsAsync();
        Assert.Contains(tools, t => t.Name == "tree_get");
        Assert.Contains(tools, t => t.Name == "idea_submit");
        Assert.DoesNotContain(tools, t => t.Name.Contains("top_up", StringComparison.Ordinal));
        Assert.Equal("object", tools.Single(t => t.Name == "node_create").JsonSchema.GetProperty("type").GetString());

        var tree = await CallAsync(client, "tree_get", new { });
        Assert.Equal("frostaura", tree["organisation"]!["slug"]!.GetValue<string>());
        Assert.Equal("admin", tree["viewerRole"]!.GetValue<string>()); // capped by the token

        var division = await CallAsync(client, "node_create", new { level = "division", parent = "frostaura", name = "Labs", slug = "labs" });
        Assert.Equal("frostaura/labs", division["path"]!.GetValue<string>());
        Assert.Contains((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["divisions"]!.AsArray(), d => d!["slug"]!.GetValue<string>() == "labs");

        // Secrets go in and never come out.
        await CallAsync(client, "secret_set", new { scope = "frostaura/labs", name = "STRIPE_KEY", value = "sk_live_never_shown" });
        var secrets = await CallAsync(client, "secrets_list", new { scope = "frostaura/labs" });
        Assert.Contains("STRIPE_KEY", secrets.ToJsonString(), StringComparison.Ordinal);
        Assert.DoesNotContain("sk_live_never_shown", secrets.ToJsonString(), StringComparison.Ordinal);

        await CallAsync(client, "budget_set", new { scope = "frostaura/labs", monthlyCredits = 40 });
        var credits = await CallAsync(client, "credits_get", new { scope = "frostaura/labs" });
        Assert.Equal(40m, credits["budgets"]![0]!["capCredits"]!.GetValue<decimal>());

        // Human-only: making an app public, and an organisation's deepest overdraft.
        var publicApp = await CallAsync(client, "app_settings", new { id = appId, access = "public" }, expectError: true);
        Assert.Equal("human_only", publicApp["code"]!.GetValue<string>());
        var shared = await CallAsync(client, "app_settings", new { id = appId, access = "shared", running = "always-on" });
        Assert.Equal("shared", shared["settings"]!["access"]!.GetValue<string>());
        var overdraft = await CallAsync(client, "cascade_set", new { scope = "frostaura", kind = "setting", key = "overdraft_limit", value = 1000 }, expectError: true);
        Assert.Equal(403, overdraft["status"]!.GetValue<int>());

        // God mode is a person at the console: an operator's token sees only its organisation.
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var foreign = await CallAsync(client, "credits_get", new { scope = "acme" }, expectError: true);
        Assert.Equal(404, foreign["status"]!.GetValue<int>());

        // Ideas, runs and the conversation, through the same services.
        var estimate = await CallAsync(client, "idea_estimate", new { text = "A ladder for squash players" });
        Assert.True(estimate["credits"]!.GetValue<decimal>() > 0);
        var idea = await CallAsync(client, "idea_submit", new { text = "A ladder for squash players", scope = "frostaura/labs" });
        Assert.Equal("researching", idea["status"]!.GetValue<string>());
        var runs = await CallAsync(client, "runs_list", new { scope = "frostaura" });
        Assert.Contains(runs.AsArray(), r => r!["kind"]!.GetValue<string>() == "research");
        var run = await CallAsync(client, "run_control", new { id = idea["runId"]!.GetValue<string>(), action = "cancel" });
        Assert.Equal("cancelled", run["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_viewers_token_reads_and_changes_nothing()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/products", email = "builder@example.com", role = "builder" }));
        var builder = await app.SignInAsync("builder@example.com");
        // A builder holding a viewer token acts as a viewer: the lower of the two.
        await using var client = await app.McpAsync(await ControlPlaneApp.TokenAsync(builder, "frostaura", "viewer"));
        await CallAsync(client, "app_get", new { id = appId });
        var refused = await CallAsync(client, "node_create", new { level = "project", parent = "frostaura/products", name = "Ladder", slug = "ladder" }, expectError: true);
        Assert.Equal(403, refused["status"]!.GetValue<int>());
        Assert.Contains("access token", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        // Outside the builder's branch the organisation's shape is not disclosed.
        var outside = await CallAsync(client, "credits_get", new { scope = "frostaura" }, expectError: true);
        Assert.Equal(404, outside["status"]!.GetValue<int>());
    }

    [Fact]
    public async Task An_apps_own_api_is_derived_from_its_openapi_and_called_through_edge_with_a_member_session()
    {
        await using var client = await app.McpAsync(await ControlPlaneApp.TokenAsync(owner, "frostaura"), $"/mcp/apps/{appId}");
        var tools = await client.ListToolsAsync();
        Assert.Equal(["cancelBooking", "createBooking", "listBookings"], tools.Select(t => t.Name).Order(StringComparer.Ordinal));
        var list = tools.Single(t => t.Name == "listBookings");
        Assert.Equal("Lists the bookings on a court.", list.Description);
        Assert.Equal("integer", list.JsonSchema.GetProperty("properties").GetProperty("court").GetProperty("type").GetString());
        var create = tools.Single(t => t.Name == "createBooking");
        Assert.Equal("object", create.JsonSchema.GetProperty("properties").GetProperty("body").GetProperty("type").GetString());
        Assert.True(create.JsonSchema.GetProperty("properties").GetProperty("body").GetProperty("properties").TryGetProperty("court", out _));

        var listed = await CallAsync(client, "listBookings", new { court = 2 });
        Assert.Equal(200, listed["status"]!.GetValue<int>());
        Assert.Equal(2, listed["body"]!["court"]!.GetValue<int>());
        Assert.True(listed["body"]!["signedIn"]!.GetValue<bool>());
        var call = edge.Requests.Last(r => r.Path.StartsWith($"/internal/apps/{appId:D}/call/api/bookings", StringComparison.Ordinal));
        Assert.Equal($"/internal/apps/{appId:D}/call/api/bookings?court=2", call.Path);
        Assert.Equal($"Bearer {ControlPlaneApp.ServiceToken}", call.Authorization);
        Assert.StartsWith("egs_", call.Session, StringComparison.Ordinal);

        var created = await CallAsync(client, "createBooking", new { body = new { court = 3, at = "10:00" } });
        Assert.Equal(201, created["status"]!.GetValue<int>());
        Assert.Equal(3, JsonNode.Parse(lastBody!)!["court"]!.GetValue<int>());

        var missing = await CallAsync(client, "cancelBooking", new { id = "nope" }, expectError: true);
        Assert.Equal("booking_not_found", missing["code"]!.GetValue<string>());

        // Someone with no role on the app does not reach it.
        await owner.DivisionAsync("frostaura", "other");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/other", email = "elsewhere@example.com", role = "builder" }));
        var elsewhere = await app.SignInAsync("elsewhere@example.com");
        await using var outsider = await app.McpAsync(await ControlPlaneApp.TokenAsync(elsewhere, "frostaura"), $"/mcp/apps/{appId}");
        await Assert.ThrowsAnyAsync<McpException>(async () => await outsider.ListToolsAsync());
    }
}
