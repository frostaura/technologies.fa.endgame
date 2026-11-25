using System.Collections.Concurrent;
using System.Formats.Tar;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Hosting.Contracts;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Version history, restore and export (TEST-101, <i>Versions</i>; spec: code and data can always
/// leave), proxied to a fake of Dock's internal API with its real shapes.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class VersionsAndExportTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakePeer dock = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private Guid appId;
    private Guid employeeId;
    private readonly ConcurrentQueue<string> calls = new();
    private RestoreRequest? restored;
    private bool hasDatabase = true;

    public async Task InitializeAsync()
    {
        dock = await FakePeer.StartAsync(routes =>
        {
            routes.MapGet("/internal/repos/{id:guid}/log", (Guid id) => Results.Ok(new CommitLog(
            [
                new CommitInfo("c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3", "Restore the version a1a1a1a1a1a1", "The Owner", "owner@frostaura.net", DateTimeOffset.Parse("2026-11-25T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture), ["b2"]),
                new CommitInfo("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", "Build F1: bookings", "Endgame employee", $"{employeeId:N}@agents.endgame.frostaura.net", DateTimeOffset.Parse("2026-11-25T09:00:00Z", System.Globalization.CultureInfo.InvariantCulture), ["a1"]),
                new CommitInfo("a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", "Record progress", "Endgame factory", "factory@agents.endgame.frostaura.net", DateTimeOffset.Parse("2026-11-25T08:00:00Z", System.Globalization.CultureInfo.InvariantCulture), []),
            ], false)));
            routes.MapPost("/internal/repos/{id:guid}/restore", (Guid id, RestoreRequest request) =>
            {
                restored = request;
                calls.Enqueue("restore");
                return Results.Ok(new CommitInfo("d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4", request.Message ?? "", request.AuthorName, request.AuthorEmail, DateTimeOffset.UtcNow, ["c3"]));
            });
            routes.MapPost("/internal/apps/{id:guid}/build", (Guid id, BuildRequest request) =>
            {
                calls.Enqueue($"build {request.Ref}");
                return Results.Ok(new BuildResult(id, request.Ref ?? "", "endgame-app:abc", 10, ""));
            });
            routes.MapPost("/internal/apps/{id:guid}/start", (Guid id, StartAppRequest request) =>
            {
                calls.Enqueue($"start {request.Image} token:{request.AppToken?.StartsWith("egt_", StringComparison.Ordinal)}");
                return Results.Ok(new AppStatus(id, "running", request.Image, "d4", "http://app:8080", null, DateTimeOffset.UtcNow, null, null, false, null, null));
            });
            routes.MapGet("/internal/repos/{id:guid}/export", () => Results.Bytes(Encoding.UTF8.GetBytes("# v2 git bundle\n"), "application/octet-stream"));
            routes.MapGet("/internal/apps/{id:guid}/database/dump", () => hasDatabase
                ? Results.Bytes(Encoding.UTF8.GetBytes("PGDMP-custom"), "application/octet-stream")
                : Results.Json(new { code = "not_found" }, statusCode: 404));
        });
        app = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?> { ["Services:Dock"] = dock.BaseUrl });
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        appId = await owner.AppAsync("frostaura/products/squash", "bookings");
        var hired = await ControlPlaneApp.Created(app.Internal().PostAsJsonAsync("/internal/employees", new { scope = "frostaura/products", name = "Ada", role = "Builder" }));
        employeeId = Guid.Parse(hired["id"]!.GetValue<string>());
        // An app that has published the version built by the employee.
        await ControlPlaneApp.Ok(app.Internal().PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2" }));
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await dock.DisposeAsync();
    }

    [Fact]
    public async Task The_history_names_the_employee_the_person_and_the_factory_and_marks_what_is_live()
    {
        var view = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}/versions"));
        var versions = view["versions"]!.AsArray();
        Assert.Equal(3, versions.Count);
        Assert.Equal(("person", "The Owner"), (versions[0]!["author"]!["kind"]!.GetValue<string>(), versions[0]!["author"]!["name"]!.GetValue<string>()));
        Assert.Equal(("employee", "Ada"), (versions[1]!["author"]!["kind"]!.GetValue<string>(), versions[1]!["author"]!["name"]!.GetValue<string>()));
        Assert.Equal(employeeId.ToString(), versions[1]!["author"]!["id"]!.GetValue<string>());
        Assert.Equal("factory", versions[2]!["author"]!["kind"]!.GetValue<string>());
        Assert.True(versions[1]!["live"]!.GetValue<bool>());
        Assert.False(versions[0]!["live"]!.GetValue<bool>());
        Assert.Equal("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", view["live"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_restore_is_a_new_change_by_the_person_republished_and_a_public_app_turns_private()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { access = "public" }));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/products", email = "viewer@example.com", role = "viewer" }));
        var viewer = await app.SignInAsync("viewer@example.com");
        await ControlPlaneApp.Expect(await viewer.PostAsync($"/api/apps/{appId}/versions/a1a1a1a1a1a1/restore", null), HttpStatusCode.Forbidden);

        var result = await ControlPlaneApp.Ok(owner.PostAsync($"/api/apps/{appId}/versions/a1a1a1a1a1a1/restore", null));
        Assert.True(result["published"]!.GetValue<bool>());
        Assert.True(result["madePrivate"]!.GetValue<bool>());
        Assert.Equal("person", result["version"]!["author"]!["kind"]!.GetValue<string>());
        Assert.Equal("a1a1a1a1a1a1", restored!.Ref);
        Assert.Equal("owner@frostaura.net", restored.AuthorEmail);
        Assert.Equal(["restore", "build d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4", "start endgame-app:abc token:True"], calls);
        Assert.Equal("private", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["settings"]!["access"]!.GetValue<string>());

        await ControlPlaneApp.Expect(await owner.PostAsync($"/api/apps/{appId}/versions/not-a-commit/restore", null), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Only_the_owner_exports_and_the_archive_holds_code_history_data_and_platform_records()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "admin@example.com", role = "admin" }));
        var admin = await app.SignInAsync("admin@example.com");
        await ControlPlaneApp.Expect(await admin.GetAsync($"/api/apps/{appId}/export"), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{appId}/shares", new { email = "friend@example.com" }));

        var response = await owner.GetAsync($"/api/apps/{appId}/export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/gzip", response.Content.Headers.ContentType?.MediaType);
        var entries = await EntriesAsync(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(["bookings/code.bundle", "bookings/database.dump", "bookings/manifest.json", "bookings/platform.json"], entries.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("# v2 git bundle\n", entries["bookings/code.bundle"]);
        Assert.Equal("PGDMP-custom", entries["bookings/database.dump"]);
        var manifest = JsonNode.Parse(entries["bookings/manifest.json"])!;
        Assert.Equal("endgame-app-export/1", manifest["format"]!.GetValue<string>());
        Assert.Equal("frostaura/products/squash/bookings", manifest["app"]!["scope"]!.GetValue<string>());
        Assert.Contains("friend@example.com", entries["bookings/platform.json"], StringComparison.Ordinal);

        // An app that never ran has no database: the archive says so instead of failing.
        hasDatabase = false;
        var withoutData = await EntriesAsync(await (await owner.GetAsync($"/api/apps/{appId}/export")).Content.ReadAsByteArrayAsync());
        Assert.DoesNotContain("bookings/database.dump", withoutData.Keys);
        Assert.Null(JsonNode.Parse(withoutData["bookings/manifest.json"])!["database"]);
    }

    private static async Task<Dictionary<string, string>> EntriesAsync(byte[] archive)
    {
        var entries = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var gzip = new GZipStream(new MemoryStream(archive), CompressionMode.Decompress);
        await using var tar = new TarReader(gzip);
        while (await tar.GetNextEntryAsync() is { } entry)
        {
            using var reader = new StreamReader(entry.DataStream!);
            entries[entry.Name] = await reader.ReadToEndAsync();
        }

        return entries;
    }
}
