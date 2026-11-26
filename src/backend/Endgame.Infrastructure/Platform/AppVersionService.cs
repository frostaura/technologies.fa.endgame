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

/// <summary>One version of an app, as History lists it (R2-4).</summary>
/// <param name="Commit">The commit it was built from.</param>
/// <param name="Message">The commit's own message, for technical mode.</param>
/// <param name="Title">What it is in plain words, for normal mode: what the person asked for when the change or build that
/// published it was started; "Brought back an earlier version" for a restore.</param>
/// <param name="RunId">The build or change that published it, when one did.</param>
/// <param name="Live">The running app was built from it.</param>
/// <param name="Current">It is the app's newest version (published or not, after a failed publish of a restore).</param>
public sealed record AppVersionView(string Commit, string Message, DateTimeOffset At, VersionAuthor Author, bool Live, string Title = "", Guid? RunId = null, bool Current = false);

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

    /// <summary>
    /// The app's versions, newest first (R2-4): only those that were live — each build or change that published, each
    /// restore — and the newest one. A run's own commits, its progress bookkeeping and a failed or cancelled change's work
    /// are not versions of the app: they are never listed, and never marked "Live now" (that is the published version, by
    /// its plain title). Versions published before run branches existed are recognised from the publish their run recorded.
    /// </summary>
    public async Task<AppVersionsView> ListAsync(ResolvedScope app, int skip, int limit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var appId = app.AppId!.Value;
        skip = Math.Max(0, skip);
        limit = Math.Clamp(limit, 1, 200);
        session.UseOrganisation(app.OrganisationId);
        var live = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == app.OrganisationId && a.Id == app.AppId).Select(a => a.CurrentVersion).SingleOrDefaultAsync(cancellationToken);
        var runs = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == app.OrganisationId && r.AppId == appId).Select(r => new { r.Id, r.Title }).ToListAsync(cancellationToken);
        var titles = runs.ToDictionary(r => r.Id, r => r.Title);
        var ids = runs.Select(r => r.Id).ToArray();
        var published = (await db.Database.SqlQuery<PublishedCommit>($"""
                SELECT run_id AS "RunId", payload->'data'->>'commit' AS "Commit"
                FROM run_events
                WHERE organisation_id = {app.OrganisationId} AND run_id = ANY({ids}) AND type = 'message'
                  AND payload->>'kind' = 'workflow.step' AND payload->>'step' = 'publish' AND (payload->'data'->>'started')::boolean
                """).ToListAsync(cancellationToken))
            .Where(p => p.Commit is { Length: >= 7 })
            .GroupBy(p => p.Commit!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().RunId, StringComparer.OrdinalIgnoreCase);

        var kept = new List<CommitInfo>();
        var newest = (string?)null;
        var more = true;
        for (int page = 0, from = 0; page < MaxLogPages && kept.Count <= skip + limit; page++, from += 200)
        {
            var log = await dock.LogAsync(appId, from, 200, cancellationToken);
            newest ??= log.Commits.FirstOrDefault()?.Id;
            kept.AddRange(log.Commits.Where(c => IsLive(c.Id, live) || WasPublished(c, published)));
            if (!log.HasMore)
            {
                more = kept.Count > skip + limit;
                break;
            }
        }

        var shown = kept.Skip(skip).Take(limit).ToList();
        session.UseOrganisation(app.OrganisationId);
        var authors = await AuthorsAsync(app.OrganisationId, shown, cancellationToken);
        return new AppVersionsView(appId, live, shown.Select(c =>
        {
            var run = RunBranches.RunOf(c.Message) ?? (published.TryGetValue(c.Id, out var r) ? r : null);
            var title = run is { } id && titles.TryGetValue(id, out var t) ? VersionTitles.FromRun(t)
                : IsRestore(c.Message) ? VersionTitles.Restored
                : VersionTitles.FromMessage(c.Message);
            return new AppVersionView(c.Id, c.Message.Trim(), c.At, authors[c.Id], IsLive(c.Id, live), title, run, c.Id == newest);
        }).ToList(), more);
    }

    /// <summary>The most of the line read for one page of History: 2,000 commits.</summary>
    private const int MaxLogPages = 10;

    private sealed record PublishedCommit(Guid RunId, string? Commit);

    private static bool WasPublished(CommitInfo commit, IReadOnlyDictionary<string, Guid> published) =>
        RunBranches.RunOf(commit.Message) is not null || IsRestore(commit.Message) || published.ContainsKey(commit.Id);

    private static bool IsRestore(string message) => message.StartsWith(RestorePrefix, StringComparison.Ordinal);

    /// <summary>How a restore's commit message begins (Dock's default, and the message this service sends).</summary>
    public const string RestorePrefix = "Restore the version ";

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
        var restored = await dock.RestoreAsync(appId, new RestoreRequest(commit, by.DisplayName, by.Email ?? "", $"{RestorePrefix}{commit[..Math.Min(12, commit.Length)]}"), cancellationToken);

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
        return new RestoreResult(new AppVersionView(restored.Id, restored.Message.Trim(), restored.At, authors[restored.Id], published, VersionTitles.Restored, null, true), published, madePrivate, error);
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
        var title = RunBranches.RunOf(newest.Message) is { } run && await db.Runs.AsNoTracking().Where(r => r.OrganisationId == app.OrganisationId && r.Id == run).Select(r => r.Title).SingleOrDefaultAsync(cancellationToken) is { } t
            ? VersionTitles.FromRun(t)
            : IsRestore(newest.Message) ? VersionTitles.Restored : VersionTitles.FromMessage(newest.Message);
        return new RestoreResult(new AppVersionView(newest.Id, newest.Message.Trim(), newest.At, authors[newest.Id], published || IsLive(newest.Id, live), title, RunBranches.RunOf(newest.Message), true), published, false, error);
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

/// <summary>A version's plain title (R2-4): what the person asked for, never a commit message in normal mode.</summary>
public static class VersionTitles
{
    public const string Restored = "Brought back an earlier version";

    private static readonly string[] RunPrefixes = ["Change: ", "Build: "];

    /// <summary>The run's title without its kind ("Change: Show how many books…" → "Show how many books…").</summary>
    public static string FromRun(string title)
    {
        var text = (title ?? "").Trim();
        foreach (var prefix in RunPrefixes)
        {
            if (text.StartsWith(prefix, StringComparison.Ordinal))
            {
                text = text[prefix.Length..].Trim();
            }
        }

        return Clip(text.Length > 0 ? text : "A new version");
    }

    /// <summary>A version no run names (the first one, or one made by hand): its message's first line.</summary>
    public static string FromMessage(string message)
    {
        var first = (message ?? "").Split('\n')[0].Trim();
        return Clip(first.Length > 0 ? first : "A new version");
    }

    private static string Clip(string text) => text.Length <= 200 ? text : text[..197].TrimEnd() + "...";
}
