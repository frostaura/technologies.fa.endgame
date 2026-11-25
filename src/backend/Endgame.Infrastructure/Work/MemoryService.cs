using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>One curated memory entry, as the console and the Runner read it.</summary>
public sealed record MemoryEntryView(
    Guid Id,
    Guid EmployeeId,
    string Scope,
    string Title,
    string Body,
    string Kind,
    Guid? SourceRunId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? LastReviewedAt,
    bool Archived);

/// <summary>One line of the memory's change log.</summary>
public sealed record MemoryChangeView(Guid Id, Guid? MemoryId, string Action, string By, Guid? UserId, Guid? RunId, JsonNode? Detail, DateTimeOffset At);

/// <param name="Scope">Optional: where in the cascade it is about. Default: the run's scope, or the employee's.</param>
public sealed record MemoryInput(string? Title, string? Body, string? Kind, string? Scope);

public sealed record MemoryCorrection(string? Title, string? Body, string? Kind);

public sealed record MemoryMerge(IReadOnlyList<Guid>? From, string? Title, string? Body, string? Kind);

public sealed record MemoryRemoval(Guid Id, string? Why);

public sealed record MemoryReviewCorrection(Guid Id, string? Title, string? Body, string? Kind, string? Why);

/// <summary>What a review did: the entries it merged into, removed and corrected, and how many it kept as they were.</summary>
public sealed record MemoryReviewResult(Guid EmployeeId, Guid? RunId, IReadOnlyList<MemoryEntryView> Merged, IReadOnlyList<Guid> Removed, IReadOnlyList<MemoryEntryView> Corrected, int Kept, DateTimeOffset ReviewedAt);

/// <summary>
/// An employee's curated memory (spec: <i>curated, not accumulated</i>): written after a task, read
/// before the next, consolidated by a review that merges, prunes and corrects it, and open to the owner,
/// who may read, correct, add and remove entries. Keyed by employee and cascade scope, never by
/// directory (ARCH-002). Every change is in the append-only change log.
/// </summary>
public sealed class MemoryService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, TimeProvider clock)
{
    public async Task<EmployeeRecord> EmployeeAsync(Guid organisationId, Guid employeeId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        return await db.Employees.AsNoTracking().SingleOrDefaultAsync(e => e.OrganisationId == organisationId && e.Id == employeeId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The employee");
    }

    /// <summary>
    /// What an employee remembers that bears on a scope: entries about the scope, the levels above it and
    /// the levels beneath it. Entries about a sibling branch are left out. At most
    /// <see cref="WorkforceLimits.MaxMemoryPerRead"/>, most recently reviewed or written first.
    /// </summary>
    public async Task<IReadOnlyList<MemoryEntryView>> ForScopeAsync(Guid organisationId, Guid employeeId, ResolvedScope? scope, bool includeArchived, CancellationToken cancellationToken)
    {
        await EmployeeAsync(organisationId, employeeId, cancellationToken);
        var rows = await db.EmployeeMemories.AsNoTracking()
            .Where(m => m.OrganisationId == organisationId && m.EmployeeId == employeeId && (includeArchived || m.ArchivedAt == null))
            .OrderByDescending(m => m.LastReviewedAt ?? m.UpdatedAt)
            .ToListAsync(cancellationToken);
        if (scope is not null)
        {
            rows = rows.Where(m => scope.OnChain(m) || scope.Contains(m)).ToList();
        }

        var paths = await PathsAsync(organisationId, cancellationToken);
        return rows.Take(WorkforceLimits.MaxMemoryPerRead).Select(m => View(m, paths(m))).ToList();
    }

    public async Task<IReadOnlyList<MemoryChangeView>> ChangesAsync(Guid organisationId, Guid employeeId, int limit, CancellationToken cancellationToken)
    {
        await EmployeeAsync(organisationId, employeeId, cancellationToken);
        var rows = await db.EmployeeMemoryChanges.AsNoTracking()
            .Where(c => c.OrganisationId == organisationId && c.EmployeeId == employeeId)
            .OrderByDescending(c => c.At).ThenByDescending(c => c.Id)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync(cancellationToken);
        return rows.Select(c => new MemoryChangeView(c.Id, c.MemoryId, c.Action, c.By, c.UserId, c.RunId, JsonNode.Parse(c.DetailJson), c.At)).ToList();
    }

    /// <summary>The employee writes what it learned after a task (<paramref name="by"/> employee), or a person adds an entry.</summary>
    public async Task<IReadOnlyList<MemoryEntryView>> AddAsync(Guid organisationId, Guid employeeId, Guid? runId, IReadOnlyList<MemoryInput> entries, string by, Guid? userId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Count is 0 or > WorkforceLimits.MaxMemoryPerWrite)
        {
            throw EndgameProblem.Invalid($"Write 1 to {WorkforceLimits.MaxMemoryPerWrite} memory entries at a time.");
        }

        var employee = await EmployeeAsync(organisationId, employeeId, cancellationToken);
        if (employee.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict($"{employee.Name} has been released; their memory is archived until a rehire.");
        }

        if (employee.Kind == EmployeeKinds.Contractor)
        {
            throw EndgameProblem.Invalid("A contractor keeps no memory: what it learned goes to the employee who briefed it, when it finishes.");
        }

        var defaultScope = runId is { } run
            ? await RunScopeAsync(organisationId, run, cancellationToken)
            : await scopes.ForRowAsync(employee.OrganisationId, employee.DivisionId, employee.ProjectId, employee.AppId, cancellationToken);
        var now = clock.GetUtcNow();
        var added = new List<EmployeeMemoryRecord>();
        foreach (var entry in entries)
        {
            var (title, body, kind) = Validate(entry.Title, entry.Body, entry.Kind ?? MemoryKinds.Fact);
            var about = entry.Scope is { Length: > 0 } s ? await scopes.RequireAsync(s, cancellationToken) : defaultScope;
            if (about.OrganisationId != organisationId)
            {
                throw EndgameProblem.Invalid("A memory entry is about a place in the employee's own organisation.");
            }

            added.Add(new EmployeeMemoryRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = organisationId,
                DivisionId = about.DivisionId,
                ProjectId = about.ProjectId,
                AppId = about.AppId,
                EmployeeId = employeeId,
                Title = title,
                Body = body,
                Kind = kind,
                SourceRunId = runId,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        session.UseOrganisation(organisationId);
        db.EmployeeMemories.AddRange(added);
        db.EmployeeMemoryChanges.AddRange(added.Select(m => Change(m, MemoryActions.Added, by, userId, runId, new JsonObject { ["title"] = m.Title, ["kind"] = m.Kind }, now)));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        var paths = await PathsAsync(organisationId, cancellationToken);
        return added.Select(m => View(m, paths(m))).ToList();
    }

    /// <summary>A released employee's memory is archived and cannot be written until a rehire (UC-113 A1).</summary>
    private static void RequireWritable(EmployeeRecord employee)
    {
        if (employee.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict($"{employee.Name} has been released; their memory is archived until a rehire.");
        }
    }

    /// <summary>A person corrects an entry.</summary>
    public async Task<MemoryEntryView> CorrectAsync(Guid organisationId, Guid employeeId, Guid memoryId, MemoryCorrection correction, Guid userId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(correction);
        RequireWritable(await EmployeeAsync(organisationId, employeeId, cancellationToken));
        var row = await RequireEntryAsync(organisationId, employeeId, memoryId, cancellationToken);
        var now = clock.GetUtcNow();
        var detail = Apply(row, correction.Title, correction.Body, correction.Kind, now);
        db.EmployeeMemoryChanges.Add(Change(row, MemoryActions.Corrected, MemoryActors.Person, userId, null, detail, now));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(row, (await PathsAsync(organisationId, cancellationToken))(row));
    }

    /// <summary>A person removes an entry. Its history stays in the change log.</summary>
    public async Task RemoveAsync(Guid organisationId, Guid employeeId, Guid memoryId, string? why, Guid userId, CancellationToken cancellationToken)
    {
        RequireWritable(await EmployeeAsync(organisationId, employeeId, cancellationToken));
        var row = await RequireEntryAsync(organisationId, employeeId, memoryId, cancellationToken);
        db.EmployeeMemories.Remove(row);
        db.EmployeeMemoryChanges.Add(Change(row, MemoryActions.Removed, MemoryActors.Person, userId, null, new JsonObject { ["title"] = row.Title, ["body"] = row.Body, ["why"] = why }, clock.GetUtcNow()));
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// A review run's result, applied in one transaction: entries merged into one, entries removed as
    /// stale, entries corrected; every entry left is stamped as reviewed. Each change is logged with why.
    /// </summary>
    public async Task<MemoryReviewResult> ReviewAsync(Guid organisationId, Guid employeeId, Guid? runId, IReadOnlyList<MemoryMerge> merged, IReadOnlyList<MemoryRemoval> removed, IReadOnlyList<MemoryReviewCorrection> corrected, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(merged);
        ArgumentNullException.ThrowIfNull(removed);
        ArgumentNullException.ThrowIfNull(corrected);
        var employee = await EmployeeAsync(organisationId, employeeId, cancellationToken);
        if (employee.Status == EmployeeStatuses.Released)
        {
            throw EndgameProblem.Conflict($"{employee.Name} has been released; their memory is archived.");
        }

        var now = clock.GetUtcNow();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        var live = await db.EmployeeMemories
            .Where(m => m.OrganisationId == organisationId && m.EmployeeId == employeeId && m.ArchivedAt == null)
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var touched = new HashSet<Guid>();
        EmployeeMemoryRecord Take(Guid id) => touched.Add(id) && live.TryGetValue(id, out var row)
            ? row
            : throw EndgameProblem.Invalid($"Memory entry {id} is not one of this employee's live entries, or the review names it twice.");

        var mergedRows = new List<EmployeeMemoryRecord>();
        foreach (var merge in merged)
        {
            var from = (merge.From ?? []).Select(Take).ToList();
            if (from.Count < 2)
            {
                throw EndgameProblem.Invalid("A merge combines at least two entries into one.");
            }

            var (title, body, kind) = Validate(merge.Title, merge.Body, merge.Kind ?? from[0].Kind);
            // About the deepest place every merged entry shares.
            var shared = from.Aggregate((a, b) => new EmployeeMemoryRecord
            {
                DivisionId = a.DivisionId == b.DivisionId ? a.DivisionId : null,
                ProjectId = a.DivisionId == b.DivisionId && a.ProjectId == b.ProjectId ? a.ProjectId : null,
                AppId = a.DivisionId == b.DivisionId && a.ProjectId == b.ProjectId && a.AppId == b.AppId ? a.AppId : null,
            });
            var into = new EmployeeMemoryRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = organisationId,
                DivisionId = shared.DivisionId,
                ProjectId = shared.ProjectId,
                AppId = shared.AppId,
                EmployeeId = employeeId,
                Title = title,
                Body = body,
                Kind = kind,
                SourceRunId = runId,
                CreatedAt = now,
                UpdatedAt = now,
                LastReviewedAt = now,
            };
            db.EmployeeMemories.Add(into);
            db.EmployeeMemories.RemoveRange(from);
            db.EmployeeMemoryChanges.Add(Change(into, MemoryActions.Merged, MemoryActors.Review, null, runId, new JsonObject
            {
                ["from"] = new JsonArray(from.Select(f => (JsonNode)new JsonObject { ["id"] = f.Id.ToString(), ["title"] = f.Title, ["body"] = f.Body }).ToArray()),
                ["title"] = title,
            }, now));
            mergedRows.Add(into);
        }

        var removedIds = new List<Guid>();
        foreach (var removal in removed)
        {
            var row = Take(removal.Id);
            db.EmployeeMemories.Remove(row);
            db.EmployeeMemoryChanges.Add(Change(row, MemoryActions.Removed, MemoryActors.Review, null, runId, new JsonObject { ["title"] = row.Title, ["body"] = row.Body, ["why"] = Why(removal.Why) }, now));
            removedIds.Add(row.Id);
        }

        var correctedRows = new List<EmployeeMemoryRecord>();
        foreach (var correction in corrected)
        {
            var row = Take(correction.Id);
            var detail = Apply(row, correction.Title, correction.Body, correction.Kind, now);
            detail["why"] = Why(correction.Why);
            row.LastReviewedAt = now;
            db.EmployeeMemoryChanges.Add(Change(row, MemoryActions.Corrected, MemoryActors.Review, null, runId, detail, now));
            correctedRows.Add(row);
        }

        var kept = live.Values.Where(r => !touched.Contains(r.Id)).ToList();
        foreach (var row in kept)
        {
            row.LastReviewedAt = now;
        }

        db.EmployeeMemoryChanges.Add(new EmployeeMemoryChangeRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            EmployeeId = employeeId,
            Action = MemoryActions.Reviewed,
            By = MemoryActors.Review,
            RunId = runId,
            DetailJson = new JsonObject { ["merged"] = mergedRows.Count, ["removed"] = removedIds.Count, ["corrected"] = correctedRows.Count, ["kept"] = kept.Count }.ToJsonString(),
            At = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        var paths = await PathsAsync(organisationId, cancellationToken);
        return new MemoryReviewResult(employeeId, runId, mergedRows.Select(m => View(m, paths(m))).ToList(), removedIds, correctedRows.Select(m => View(m, paths(m))).ToList(), kept.Count, now);
    }

    /// <summary>Release archives the memory (kept, not read); a rehire restores it, so a rehire is not a cold start.</summary>
    internal async Task<int> ArchiveAsync(Guid organisationId, Guid employeeId, bool archive, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var changed = archive
            ? await db.EmployeeMemories.Where(m => m.OrganisationId == organisationId && m.EmployeeId == employeeId && m.ArchivedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.ArchivedAt, now), cancellationToken)
            : await db.EmployeeMemories.Where(m => m.OrganisationId == organisationId && m.EmployeeId == employeeId && m.ArchivedAt != null)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.ArchivedAt, (DateTimeOffset?)null), cancellationToken);
        db.EmployeeMemoryChanges.Add(new EmployeeMemoryChangeRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            EmployeeId = employeeId,
            Action = archive ? MemoryActions.Archived : MemoryActions.Restored,
            By = MemoryActors.Platform,
            DetailJson = new JsonObject { ["entries"] = changed }.ToJsonString(),
            At = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return changed;
    }

    /// <summary>Organisation-wide lookups that turn a row's path ids into its scope path without a query per row.</summary>
    internal async Task<Func<IScopedRecord, string>> PathsAsync(Guid organisationId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var org = await db.Organisations.AsNoTracking().Where(o => o.Id == organisationId).Select(o => o.Slug).SingleAsync(cancellationToken);
        var divisions = await db.Divisions.AsNoTracking().Where(d => d.OrganisationId == organisationId).ToDictionaryAsync(d => d.Id, d => d.Slug, cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(p => p.OrganisationId == organisationId).ToDictionaryAsync(p => p.Id, p => p.Slug, cancellationToken);
        var apps = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == organisationId).ToDictionaryAsync(a => a.Id, a => a.Slug, cancellationToken);
        return r => string.Join('/', new[]
        {
            org,
            r.DivisionId is { } d ? divisions[d] : null,
            r.ProjectId is { } p ? projects[p] : null,
            r.AppId is { } a ? apps[a] : null,
        }.OfType<string>());
    }

    private async Task<ResolvedScope> RunScopeAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        var run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(r => r.OrganisationId == organisationId && r.Id == runId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The run in this organisation");
        return await scopes.ForRowAsync(run.OrganisationId, run.DivisionId, run.ProjectId, run.AppId, cancellationToken);
    }

    private async Task<EmployeeMemoryRecord> RequireEntryAsync(Guid organisationId, Guid employeeId, Guid memoryId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        return await db.EmployeeMemories.SingleOrDefaultAsync(m => m.OrganisationId == organisationId && m.EmployeeId == employeeId && m.Id == memoryId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The memory entry");
    }

    private static JsonObject Apply(EmployeeMemoryRecord row, string? title, string? body, string? kind, DateTimeOffset now)
    {
        if (title is null && body is null && kind is null)
        {
            throw EndgameProblem.Invalid("Send a new title, body or kind.");
        }

        var (t, b, k) = Validate(title ?? row.Title, body ?? row.Body, kind ?? row.Kind);
        var detail = new JsonObject
        {
            ["before"] = new JsonObject { ["title"] = row.Title, ["body"] = row.Body, ["kind"] = row.Kind },
            ["after"] = new JsonObject { ["title"] = t, ["body"] = b, ["kind"] = k },
        };
        row.Title = t;
        row.Body = b;
        row.Kind = k;
        row.UpdatedAt = now;
        return detail;
    }

    private static (string Title, string Body, string Kind) Validate(string? title, string? body, string kind)
    {
        var t = title?.Trim() ?? "";
        var b = body?.Trim() ?? "";
        if (t.Length is 0 or > WorkforceLimits.MaxMemoryTitle || b.Length is 0 or > WorkforceLimits.MaxMemoryBody)
        {
            throw EndgameProblem.Invalid($"A memory entry has a title of 1 to {WorkforceLimits.MaxMemoryTitle} characters and a body of 1 to {WorkforceLimits.MaxMemoryBody}.");
        }

        if (!MemoryKinds.All.Contains(kind))
        {
            throw EndgameProblem.Invalid($"A memory entry's kind is one of {string.Join(", ", MemoryKinds.All)}.");
        }

        return (t, b, kind);
    }

    private static string Why(string? why) => string.IsNullOrWhiteSpace(why) ? "No reason given." : why.Trim();

    private static EmployeeMemoryChangeRecord Change(EmployeeMemoryRecord row, string action, string by, Guid? userId, Guid? runId, JsonObject detail, DateTimeOffset at) => new()
    {
        Id = Guid.NewGuid(),
        OrganisationId = row.OrganisationId,
        EmployeeId = row.EmployeeId,
        MemoryId = row.Id,
        Action = action,
        By = by,
        UserId = userId,
        RunId = runId,
        DetailJson = detail.ToJsonString(),
        At = at,
    };

    public static MemoryEntryView View(EmployeeMemoryRecord m, string scope) => new(
        m.Id, m.EmployeeId, scope, m.Title, m.Body, m.Kind, m.SourceRunId, m.CreatedAt, m.UpdatedAt, m.LastReviewedAt, m.ArchivedAt is not null);
}
