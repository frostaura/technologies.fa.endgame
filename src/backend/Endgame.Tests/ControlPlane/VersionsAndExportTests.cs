using System.Collections.Concurrent;
using System.Formats.Tar;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Hosting.Contracts;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
    private CommitLog? log;

    public async Task InitializeAsync()
    {
        dock = await FakePeer.StartAsync(routes =>
        {
            routes.MapGet("/internal/repos/{id:guid}/log", (Guid id) => Results.Ok(log ?? new CommitLog(
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
        // The restore and the live version; the factory's bookkeeping commit was never live, so it is not a version (R2-4).
        Assert.Equal(2, versions.Count);
        Assert.Equal(("person", "The Owner"), (versions[0]!["author"]!["kind"]!.GetValue<string>(), versions[0]!["author"]!["name"]!.GetValue<string>()));
        Assert.Equal("Brought back an earlier version", versions[0]!["title"]!.GetValue<string>());
        Assert.True(versions[0]!["current"]!.GetValue<bool>());
        Assert.Equal(("employee", "Ada"), (versions[1]!["author"]!["kind"]!.GetValue<string>(), versions[1]!["author"]!["name"]!.GetValue<string>()));
        Assert.Equal(employeeId.ToString(), versions[1]!["author"]!["id"]!.GetValue<string>());
        Assert.True(versions[1]!["live"]!.GetValue<bool>());
        Assert.False(versions[0]!["live"]!.GetValue<bool>());
        Assert.Equal("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", view["live"]!.GetValue<string>());
    }

    [Fact]
    public async Task History_lists_only_what_was_live_by_the_plain_title_of_what_was_asked_and_never_a_failed_changes_work()
    {
        // A change published as one version (its run named in the trailer), an older version published before run branches
        // (recognised from its run's publish), and a failed change's commits and bookkeeping left on the line by then.
        var (published, legacy, failed) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await using (var scope = app.Scope())
        {
            var session = scope.ServiceProvider.GetRequiredService<TenantSession>();
            session.UseSystem();
            var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
            var row = await db.Apps.SingleAsync(a => a.Id == appId);
            var org = row.OrganisationId;
            var division = (await db.Projects.SingleAsync(p => p.Id == row.ProjectId)).DivisionId;
            session.UseOrganisation(org);
            foreach (var (id, title, status) in new[] { (published, "Change: Show how many books the home page lists.", "succeeded"), (legacy, "Build: A reading list for a book club.", "succeeded"), (failed, "Change: Verify the count line.", "failed") })
            {
                db.Runs.Add(new RunRecord { OrganisationId = org, Id = id, DivisionId = division, ProjectId = row.ProjectId, AppId = appId, Kind = "task", Status = status, Title = title, CreatedAt = DateTimeOffset.UtcNow, StartedAt = DateTimeOffset.UtcNow, FinishedAt = DateTimeOffset.UtcNow, LastSeq = 1 });
            }

            db.RunEvents.Add(new RunEventRecord
            {
                OrganisationId = org, RunId = legacy, Seq = 1, Type = "message", At = DateTimeOffset.UtcNow,
                PayloadJson = new JsonObject { ["kind"] = "workflow.step", ["step"] = "publish", ["agent"] = "workflow", ["data"] = new JsonObject { ["started"] = true, ["commit"] = "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5" } }.ToJsonString(),
            });
            await db.SaveChangesAsync();
        }

        var at = DateTimeOffset.Parse("2026-11-26T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture);
        log = new CommitLog(
        [
            new CommitInfo("f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6", $"Show how many books the home page lists.\n\nEndgame-Run: {published:D}", "Endgame factory", "factory@agents.endgame.frostaura.net", at, ["a7", "b8"]),
            new CommitInfo("a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7", "Repair [book-count-line] evidence: connect call_app calls to r1/r2/r3", "Endgame employee", $"{employeeId:N}@agents.endgame.frostaura.net", at.AddMinutes(-10), ["a8"]),
            new CommitInfo("a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8", "Record progress: book-count-line is built and checked", "Endgame factory", "factory@agents.endgame.frostaura.net", at.AddMinutes(-20), ["e5"]),
            new CommitInfo("e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5", "Record progress: i3 is built and checked", "Endgame factory", "factory@agents.endgame.frostaura.net", at.AddHours(-2), ["e4"]),
            new CommitInfo("e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4", "Start from the app kit", "Endgame", "dock@endgame.invalid", at.AddHours(-3), []),
        ], false);
        await ControlPlaneApp.Ok(app.Internal().PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6" }));

        var versions = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}/versions")))["versions"]!.AsArray();
        Assert.Equal(["f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6", "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"], versions.Select(v => v!["commit"]!.GetValue<string>()));
        Assert.Equal(["Show how many books the home page lists.", "A reading list for a book club."], versions.Select(v => v!["title"]!.GetValue<string>()));
        Assert.Equal([published.ToString(), legacy.ToString()], versions.Select(v => v!["runId"]!.GetValue<string>()));
        Assert.Equal([true, false], versions.Select(v => v!["live"]!.GetValue<bool>()));
        // The raw message stays for technical mode.
        Assert.StartsWith("Record progress", versions[1]!["message"]!.GetValue<string>(), StringComparison.Ordinal);
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
    public async Task Rebuild_and_restart_publishes_the_newest_version_again_without_touching_history_or_access()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { access = "public" }));
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/products", email = "viewer@example.com", role = "viewer" }));
        var viewer = await app.SignInAsync("viewer@example.com");
        await ControlPlaneApp.Expect(await viewer.PostAsync($"/api/apps/{appId}/republish", null), HttpStatusCode.Forbidden);

        var result = await ControlPlaneApp.Ok(owner.PostAsync($"/api/apps/{appId}/republish", null));
        Assert.True(result["published"]!.GetValue<bool>());
        Assert.False(result["madePrivate"]!.GetValue<bool>());
        Assert.Equal("c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3", result["version"]!["commit"]!.GetValue<string>());
        Assert.Equal(["build c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3", "start endgame-app:abc token:True"], calls);
        Assert.Null(restored);
        Assert.Equal("public", (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["settings"]!["access"]!.GetValue<string>());
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
