using System.Formats.Tar;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Hosting.Contracts;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using AppAccess = Endgame.Domain.Platform.AppAccess;

namespace Endgame.Infrastructure.Platform;

/// <param name="Kind"><c>employee</c>, <c>person</c> or <c>factory</c>.</param>
/// <param name="Id">The employee's or the person's id, when known.</param>
public sealed record VersionAuthor(string Kind, Guid? Id, string Name);

public sealed record AppVersionView(string Commit, string Message, DateTimeOffset At, VersionAuthor Author, bool Live);

/// <param name="Live">The commit the running app was built from, or null before it was published.</param>
public sealed record AppVersionsView(Guid AppId, string? Live, IReadOnlyList<AppVersionView> Versions, bool HasMore);

/// <param name="Published">The restored version was built and started.</param>
/// <param name="MadePrivate">The app was public and is now private: a person looks at a restored version before it is public again.</param>
public sealed record RestoreResult(AppVersionView Version, bool Published, bool MadePrivate, string? PublishError);

/// <summary>
/// An app's version history, restore and export (spec: code lives inside Endgame and can always
/// leave), proxied to Dock. Authors are named as the console shows them: the employee or the person.
/// </summary>
public sealed class AppVersionService(
    EndgameDbContext db,
    TenantSession session,
    DockClient dock,
    AppTokenService tokens,
    CascadeService cascade,
    AppIdentityService identity,
    EdgeNotifier edge,
    TimeProvider clock)
{
    public const string FactoryAuthor = "factory@";

    public async Task<AppVersionsView> ListAsync(ResolvedScope app, int skip, int limit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var log = await dock.LogAsync(app.AppId!.Value, Math.Max(0, skip), Math.Clamp(limit, 1, 200), cancellationToken);
        session.UseOrganisation(app.OrganisationId);
        var live = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == app.OrganisationId && a.Id == app.AppId).Select(a => a.CurrentVersion).SingleOrDefaultAsync(cancellationToken);
        var authors = await AuthorsAsync(app.OrganisationId, log.Commits, cancellationToken);
        return new AppVersionsView(app.AppId.Value, live,
            log.Commits.Select(c => new AppVersionView(c.Id, c.Message.Trim(), c.At, authors[c.Id], IsLive(c.Id, live))).ToList(), log.HasMore);
    }

    /// <summary>
    /// Makes <paramref name="commit"/>'s code the newest version, as a new commit by the person, then
    /// rebuilds and restarts the app. A public app becomes private first.
    /// </summary>
    public async Task<RestoreResult> RestoreAsync(ResolvedScope app, string commit, EndgameUser by, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(by);
        if (string.IsNullOrWhiteSpace(commit) || commit.Length > 64 || !commit.All(Uri.IsHexDigit))
        {
            throw EndgameProblem.Invalid("Name the version by its commit id.");
        }

        var appId = app.AppId!.Value;
        var restored = await dock.RestoreAsync(appId, new RestoreRequest(commit, by.DisplayName, by.Email ?? "", $"Restore the version {commit[..Math.Min(12, commit.Length)]}"), cancellationToken);

        var madePrivate = false;
        if (await identity.AccessOfAsync(app, cancellationToken) == AppAccess.Public)
        {
            await cascade.SetAsync(app, CascadeKind.Setting, CascadeKeys.Access, JsonValue.Create(AppAccess.Private), by.Id, actor, cancellationToken);
            madePrivate = true;
            edge.RoutesChanged();
        }

        string? error = null;
        var published = false;
        try
        {
            var image = await dock.BuildAsync(appId, restored.Id, cancellationToken);
            var token = await tokens.IssueAsync(app, cancellationToken);
            await dock.StartAsync(appId, new StartAppRequest(app.OrganisationId, image.Image, token, null, null), cancellationToken);
            published = true;
        }
        catch (EndgameProblem p) when (p.Status >= 400)
        {
            // The restore stands as the newest version; publishing it can be retried.
            error = p.Detail ?? p.Title;
        }

        session.UseOrganisation(app.OrganisationId);
        var authors = await AuthorsAsync(app.OrganisationId, [restored], cancellationToken);
        return new RestoreResult(new AppVersionView(restored.Id, restored.Message.Trim(), restored.At, authors[restored.Id], published), published, madePrivate, error);
    }

    /// <summary>
    /// Builds the app's newest version again and restarts it, for when publishing it failed (after a
    /// restore, or a build) or the app stopped. Nothing in the history and nothing about who may open
    /// it changes.
    /// </summary>
    public async Task<RestoreResult> RepublishAsync(ResolvedScope app, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var appId = app.AppId!.Value;
        var log = await dock.LogAsync(appId, 0, 1, cancellationToken);
        var newest = log.Commits.FirstOrDefault()
            ?? throw EndgameProblem.Conflict("Nothing has been built for this app yet, so there is no version to publish again.");

        string? error = null;
        var published = false;
        try
        {
            var image = await dock.BuildAsync(appId, newest.Id, cancellationToken);
            var token = await tokens.IssueAsync(app, cancellationToken);
            await dock.StartAsync(appId, new StartAppRequest(app.OrganisationId, image.Image, token, null, null), cancellationToken);
            published = true;
        }
        catch (EndgameProblem p) when (p.Status >= 400)
        {
            error = p.Detail ?? p.Title;
        }

        session.UseOrganisation(app.OrganisationId);
        var live = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == app.OrganisationId && a.Id == appId).Select(a => a.CurrentVersion).SingleOrDefaultAsync(cancellationToken);
        var authors = await AuthorsAsync(app.OrganisationId, [newest], cancellationToken);
        return new RestoreResult(new AppVersionView(newest.Id, newest.Message.Trim(), newest.At, authors[newest.Id], published || IsLive(newest.Id, live)), published, false, error);
    }

    /// <summary>
    /// One archive the organisation can take anywhere (spec): the code with its whole history, the
    /// app's own database, what the platform holds for it (end users, shares, schedules, webhooks,
    /// custom events), and a manifest. Written as a gzipped tar to <paramref name="output"/>.
    /// </summary>
    public async Task ExportAsync(ResolvedScope app, Stream output, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(output);
        var appId = app.AppId!.Value;
        var work = Directory.CreateTempSubdirectory("endgame-export-");
        try
        {
            var bundle = Path.Combine(work.FullName, "code.bundle");
            await using (var file = File.Create(bundle))
            {
                await dock.CodeBundleAsync(appId, file, cancellationToken);
            }

            var dump = Path.Combine(work.FullName, "database.dump");
            bool hasDatabase;
            await using (var file = File.Create(dump))
            {
                hasDatabase = await dock.DatabaseDumpAsync(appId, file, cancellationToken);
            }

            var platform = Path.Combine(work.FullName, "platform.json");
            await File.WriteAllTextAsync(platform, (await PlatformDataAsync(app, cancellationToken)).ToJsonString(new JsonSerializerOptions { WriteIndented = true }), cancellationToken);

            var manifest = new JsonObject
            {
                ["format"] = "endgame-app-export/1",
                ["app"] = new JsonObject { ["id"] = appId.ToString(), ["scope"] = app.Path.ToString(), ["name"] = app.Node.Name },
                ["exportedAt"] = clock.GetUtcNow(),
                ["code"] = new JsonObject { ["file"] = "code.bundle", ["format"] = "git bundle (git clone code.bundle)", ["bytes"] = new FileInfo(bundle).Length },
                ["database"] = hasDatabase
                    ? new JsonObject { ["file"] = "database.dump", ["format"] = "pg_dump custom (pg_restore -d <database> database.dump)", ["bytes"] = new FileInfo(dump).Length }
                    : null,
                ["platform"] = new JsonObject { ["file"] = "platform.json", ["holds"] = "end users (no passkeys), shares, schedules, webhooks, custom events" },
                ["note"] = "The app expects the platform's services (identity, secrets, models, e-mail, schedules, telemetry); running it elsewhere needs replacements for them. Secrets are never exported.",
            };
            if (!hasDatabase)
            {
                manifest["databaseNote"] = "The app has no database yet: it has never been started.";
            }

            await using var gzip = new GZipStream(output, CompressionLevel.Fastest, leaveOpen: true);
            await using (var tar = new TarWriter(gzip, TarEntryFormat.Pax, leaveOpen: true))
            {
                var root = app.Node.Slug;
                await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.RegularFile, $"{root}/manifest.json") { DataStream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }))) }, cancellationToken);
                await tar.WriteEntryAsync(bundle, $"{root}/code.bundle", cancellationToken);
                if (hasDatabase)
                {
                    await tar.WriteEntryAsync(dump, $"{root}/database.dump", cancellationToken);
                }

                await tar.WriteEntryAsync(platform, $"{root}/platform.json", cancellationToken);
            }
        }
        finally
        {
            work.Delete(recursive: true);
        }
    }

    private async Task<JsonObject> PlatformDataAsync(ResolvedScope app, CancellationToken cancellationToken)
    {
        session.UseOrganisation(app.OrganisationId);
        var org = app.OrganisationId;
        var id = app.AppId!.Value;
        var users = await db.AppEndUsers.AsNoTracking().Where(u => u.OrganisationId == org && u.AppId == id)
            .Select(u => new { u.Id, u.Email, u.DisplayName, u.CreatedAt }).ToListAsync(cancellationToken);
        var shares = await db.AppShares.AsNoTracking().Where(s => s.OrganisationId == org && s.AppId == id).Select(s => new { s.Email, s.InvitedAt }).ToListAsync(cancellationToken);
        var schedules = await db.AppSchedules.AsNoTracking().Where(s => s.OrganisationId == org && s.AppId == id).Select(s => new { s.Name, s.Cron }).ToListAsync(cancellationToken);
        var webhooks = await db.AppWebhooks.AsNoTracking().Where(w => w.OrganisationId == org && w.AppId == id).Select(w => new { w.Name }).ToListAsync(cancellationToken);
        var events = await db.TelemetryEvents.AsNoTracking().Where(e => e.OrganisationId == org && e.AppId == id).OrderBy(e => e.At).Take(100_000)
            .Select(e => new { e.Name, e.At, e.UserId, e.PropertiesJson }).ToListAsync(cancellationToken);
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        return new JsonObject
        {
            ["endUsers"] = JsonSerializer.SerializeToNode(users, json),
            ["shares"] = JsonSerializer.SerializeToNode(shares, json),
            ["schedules"] = JsonSerializer.SerializeToNode(schedules, json),
            ["webhooks"] = JsonSerializer.SerializeToNode(webhooks, json),
            ["events"] = new JsonArray(events.Select(e => (JsonNode)new JsonObject
            {
                ["name"] = e.Name,
                ["at"] = e.At,
                ["userId"] = e.UserId,
                ["properties"] = JsonNode.Parse(e.PropertiesJson),
            }).ToArray()),
        };
    }

    private static bool IsLive(string commit, string? live) =>
        live is { Length: >= 7 } v && (commit.StartsWith(v, StringComparison.OrdinalIgnoreCase) || v.StartsWith(commit, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Who made each commit: an employee (the Runner commits as <c>&lt;employee id, 32 hex&gt;@…</c>),
    /// the factory itself (<c>factory@…</c>), or a person (by their e-mail).
    /// </summary>
    private async Task<Dictionary<string, VersionAuthor>> AuthorsAsync(Guid organisationId, IReadOnlyList<CommitInfo> commits, CancellationToken cancellationToken)
    {
        var employeeIds = commits.Select(c => EmployeeOf(c.AuthorEmail)).Where(e => e is not null).Select(e => e!.Value).Distinct().ToList();
        var employees = await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && employeeIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken);
        var emails = commits.Select(c => c.AuthorEmail.ToLowerInvariant()).Distinct().ToList();
        var people = (await db.Users.AsNoTracking().Where(u => u.Email != null && emails.Contains(u.Email.ToLower())).Select(u => new { u.Id, u.Email, u.DisplayName }).ToListAsync(cancellationToken))
            .GroupBy(u => u.Email!.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First());
        var result = new Dictionary<string, VersionAuthor>(StringComparer.Ordinal);
        foreach (var c in commits)
        {
            result[c.Id] = EmployeeOf(c.AuthorEmail) is { } employee
                ? new VersionAuthor("employee", employee, employees.GetValueOrDefault(employee, c.AuthorName))
                : c.AuthorEmail.StartsWith(FactoryAuthor, StringComparison.OrdinalIgnoreCase)
                    ? new VersionAuthor("factory", null, "The factory")
                    : people.TryGetValue(c.AuthorEmail.ToLowerInvariant(), out var person)
                        ? new VersionAuthor("person", person.Id, person.DisplayName)
                        : new VersionAuthor("person", null, c.AuthorName);
        }

        return result;
    }

    private static Guid? EmployeeOf(string email)
    {
        var at = email.IndexOf('@', StringComparison.Ordinal);
        return at == 32 && Guid.TryParseExact(email[..at], "N", out var id) ? id : null;
    }
}
