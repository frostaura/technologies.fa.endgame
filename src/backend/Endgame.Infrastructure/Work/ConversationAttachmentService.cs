using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>A file attached to a conversation message, as the console reads it (<c>ConversationAttachment</c> in types.ts).</summary>
/// <param name="RunId">The conversation turn it was sent with; null while it waits to be sent.</param>
public sealed record ConversationAttachmentView(Guid Id, string Name, string ContentType, string Kind, long Bytes, int? Pages, int? Characters, Guid? RunId);

/// <summary>A file's bytes and how they are served.</summary>
public sealed record AttachmentContent(string Name, string ContentType, string Kind, byte[] Content);

/// <summary>
/// One file of a run, as the Runner reads it (<c>GET /internal/runs/{id}/attachments</c>): the text read from a PDF or a text
/// file, and an image's bytes as base64 (<paramref name="Data"/>, null for anything else).
/// </summary>
/// <param name="Truncated">The text stops at <see cref="ConversationAttachments.MaxTextCharacters"/>: there was more.</param>
public sealed record RunAttachmentView(Guid Id, string Name, string Kind, string ContentType, long Bytes, int? Pages, int? Characters, bool Truncated, string? Text, string? Data);

/// <summary><c>GET /internal/runs/{id}/attachments</c>: the run's files, and whether the route its answer is written on takes images.</summary>
public sealed record RunAttachmentsView(Guid RunId, bool ImagesAccepted, IReadOnlyList<RunAttachmentView> Attachments);

/// <summary>What a message's files add to what it reads: how many images, and how many characters of text.</summary>
public sealed record AttachmentLoad(int Files, int Images, long Characters, long Bytes)
{
    public static readonly AttachmentLoad None = new(0, 0, 0, 0);
}

/// <summary>
/// Stores, serves and links the files a conversation message carries (ARCH-011). An upload belongs to the person who made
/// it, at the scope and with the employee of the conversation it will be sent in, until it is sent; then it belongs to the
/// conversation and is read by whoever may read the conversation. Unsent uploads of a person older than
/// <see cref="ConversationAttachments.UnsentLifetime"/> are cleared when that person next uploads.
/// </summary>
public sealed class ConversationAttachmentService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, TimeProvider clock)
{
    public async Task<ConversationAttachmentView> UploadAsync(ResolvedScope scope, Guid? employeeId, Guid by, string? fileName, byte[] bytes, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(bytes);
        var file = ConversationAttachments.Inspect(fileName, bytes);
        session.UseOrganisation(scope.OrganisationId);
        if (employeeId is { } employee && !await db.Employees.AnyAsync(e => e.OrganisationId == scope.OrganisationId && e.Id == employee, cancellationToken))
        {
            throw EndgameProblem.NotFound("The employee");
        }

        var now = clock.GetUtcNow();
        var stale = now - ConversationAttachments.UnsentLifetime;
        await db.ConversationAttachments
            .Where(a => a.OrganisationId == scope.OrganisationId && a.UploadedBy == by && a.ConversationId == null && a.CreatedAt < stale)
            .ExecuteDeleteAsync(cancellationToken);
        var waiting = await db.ConversationAttachments.CountAsync(a => a.OrganisationId == scope.OrganisationId && a.UploadedBy == by && a.ConversationId == null, cancellationToken);
        if (waiting >= ConversationAttachments.MaxUnsentPerPerson)
        {
            throw new EndgameProblem(409, "attachments_waiting", "Too many files are waiting to be sent",
                $"You have {ConversationAttachments.MaxUnsentPerPerson} files attached that are not sent yet. Send them, or remove some, before attaching more.");
        }

        var record = new ConversationAttachmentRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            ProjectId = scope.ProjectId,
            AppId = scope.AppId,
            EmployeeId = employeeId,
            UploadedBy = by,
            Name = file.Name,
            ContentType = file.ContentType,
            Kind = file.Kind,
            Bytes = file.Bytes,
            Pages = file.Pages,
            Characters = file.Characters,
            ExtractedText = file.Text,
            Content = bytes,
            CreatedAt = now,
        };
        db.ConversationAttachments.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(record);
    }

    /// <summary>Where an attachment sits, read across organisations by its id alone; null when there is no such file.</summary>
    public async Task<(Guid OrganisationId, ResolvedScope Scope, Guid UploadedBy, Guid? ConversationId)?> LocateAsync(Guid id, CancellationToken cancellationToken)
    {
        var org = await scopes.OrganisationOfAsync(db.ConversationAttachments, q => q.Where(a => a.Id == id).Select(a => a.OrganisationId), cancellationToken);
        if (org is not { } organisationId)
        {
            return null;
        }

        var row = await db.ConversationAttachments.AsNoTracking().Where(a => a.OrganisationId == organisationId && a.Id == id)
            .Select(a => new { a.DivisionId, a.ProjectId, a.AppId, a.UploadedBy, a.ConversationId }).SingleAsync(cancellationToken);
        var scope = await scopes.ForRowAsync(organisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
        return (organisationId, scope, row.UploadedBy, row.ConversationId);
    }

    public async Task<AttachmentContent> ContentAsync(Guid organisationId, Guid id, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        return await db.ConversationAttachments.AsNoTracking().Where(a => a.OrganisationId == organisationId && a.Id == id)
            .Select(a => new AttachmentContent(a.Name, a.ContentType, a.Kind, a.Content)).SingleOrDefaultAsync(cancellationToken)
            ?? throw EndgameProblem.NotFound("The file");
    }

    /// <summary>Removes an upload that was not sent. Once sent it is part of what was said, and stays with its conversation.</summary>
    public async Task DeleteUnsentAsync(Guid organisationId, Guid id, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var removed = await db.ConversationAttachments.Where(a => a.OrganisationId == organisationId && a.Id == id && a.ConversationId == null).ExecuteDeleteAsync(cancellationToken);
        if (removed == 0)
        {
            throw new EndgameProblem(409, "attachment_sent", "That file was already sent", "A file that was sent is part of the conversation and stays with it.");
        }
    }

    /// <summary>
    /// The files a message is about to carry, checked: at most <see cref="ConversationAttachments.MaxFiles"/>, together at
    /// most <see cref="ConversationAttachments.MaxMessageBytes"/>, each one this person's, not sent yet, and uploaded at
    /// exactly this scope and with this employee; images only where whoever answers can look at them.
    /// </summary>
    public async Task<IReadOnlyList<ConversationAttachmentView>> ForSendAsync(ResolvedScope scope, Guid? employeeId, Guid by, IReadOnlyList<Guid>? ids, bool imagesAccepted, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var wanted = (ids ?? []).Distinct().ToList();
        if (wanted.Count == 0)
        {
            return [];
        }

        if (wanted.Count > ConversationAttachments.MaxFiles)
        {
            throw new EndgameProblem(400, "too_many_attachments", "Too many files",
                $"A message can carry at most {ConversationAttachments.MaxFiles} files; this one has {wanted.Count}. Send the rest in another message.");
        }

        session.UseOrganisation(scope.OrganisationId);
        var rows = await db.ConversationAttachments.AsNoTracking()
            .Where(a => a.OrganisationId == scope.OrganisationId && wanted.Contains(a.Id))
            .Select(a => new { View = new ConversationAttachmentView(a.Id, a.Name, a.ContentType, a.Kind, a.Bytes, a.Pages, a.Characters, a.RunId), a.UploadedBy, a.ConversationId, a.DivisionId, a.ProjectId, a.AppId, a.EmployeeId })
            .ToListAsync(cancellationToken);
        // Another person's upload is not one this person can name: it is "not found", never "someone else's".
        var found = rows.Where(r => r.UploadedBy == by).ToList();
        if (found.Count != wanted.Count)
        {
            throw EndgameProblem.NotFound("A file attached to this message");
        }

        if (found.FirstOrDefault(r => r.ConversationId is not null) is { } sent)
        {
            throw new EndgameProblem(409, "attachment_sent", "That file was already sent", $"{sent.View.Name} was already sent with an earlier message. Attach it again to send it again.");
        }

        if (found.FirstOrDefault(r => r.DivisionId != scope.DivisionId || r.ProjectId != scope.ProjectId || r.AppId != scope.AppId || r.EmployeeId != employeeId) is { } elsewhere)
        {
            throw new EndgameProblem(409, "attachment_elsewhere", "That file was attached in another conversation",
                $"{elsewhere.View.Name} was attached in a different conversation. Attach it again here.");
        }

        var total = found.Sum(r => r.View.Bytes);
        if (total > ConversationAttachments.MaxMessageBytes)
        {
            throw new EndgameProblem(413, "attachments_too_large", "These files are too large together",
                $"A message's files can be at most {ConversationAttachments.MaxMessageBytes / (1024 * 1024)} MB together; these are {decimal.Round(total / (1024m * 1024m), 1)} MB. Send some of them in another message.");
        }

        if (!imagesAccepted && found.FirstOrDefault(r => r.View.Kind == ConversationAttachments.Image) is { } image)
        {
            throw new EndgameProblem(422, "images_not_accepted", "Whoever answers here cannot look at images",
                $"{image.View.Name} is an image, and whoever answers here reads text only. Remove it, or describe what it shows in words.");
        }

        // In the order the person attached them.
        return wanted.Select(id => found.Single(r => r.View.Id == id).View).ToList();
    }

    /// <summary>
    /// Links checked files to the conversation and the run they were sent with. Conditional on each being unsent still, so
    /// two messages racing for one file cannot both carry it; false when another took one first.
    /// </summary>
    public async Task<bool> LinkAsync(Guid organisationId, Guid conversationId, Guid runId, IReadOnlyList<Guid> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);
        if (ids.Count == 0)
        {
            return true;
        }

        session.UseOrganisation(organisationId);
        var linked = await db.ConversationAttachments
            .Where(a => a.OrganisationId == organisationId && ids.Contains(a.Id) && a.ConversationId == null)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.ConversationId, conversationId).SetProperty(a => a.RunId, runId), cancellationToken);
        return linked == ids.Count;
    }

    /// <summary>The files sent in a conversation, by the run they were sent with, in the order they were attached.</summary>
    public async Task<IReadOnlyDictionary<Guid, IReadOnlyList<ConversationAttachmentView>>> ByRunAsync(Guid organisationId, Guid conversationId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var rows = await db.ConversationAttachments.AsNoTracking()
            .Where(a => a.OrganisationId == organisationId && a.ConversationId == conversationId && a.RunId != null)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .Select(a => new ConversationAttachmentView(a.Id, a.Name, a.ContentType, a.Kind, a.Bytes, a.Pages, a.Characters, a.RunId))
            .ToListAsync(cancellationToken);
        return rows.GroupBy(r => r.RunId!.Value).ToDictionary(g => g.Key, g => (IReadOnlyList<ConversationAttachmentView>)g.ToList());
    }

    /// <summary>A run's files for the Runner: the text read from each, and each image's bytes as base64.</summary>
    public async Task<IReadOnlyList<RunAttachmentView>> ForRunAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var rows = await db.ConversationAttachments.AsNoTracking()
            .Where(a => a.OrganisationId == organisationId && a.RunId == runId)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .Select(a => new { a.Id, a.Name, a.Kind, a.ContentType, a.Bytes, a.Pages, a.Characters, a.ExtractedText, Content = a.Kind == ConversationAttachments.Image ? a.Content : null })
            .ToListAsync(cancellationToken);
        return rows.Select(a => new RunAttachmentView(a.Id, a.Name, a.Kind, a.ContentType, a.Bytes, a.Pages, a.Characters,
            a.Characters >= ConversationAttachments.MaxTextCharacters, a.ExtractedText, a.Content is null ? null : Convert.ToBase64String(a.Content))).ToList();
    }

    /// <summary>What a message's files add to what each of its model calls reads.</summary>
    public static AttachmentLoad Load(IReadOnlyList<ConversationAttachmentView> files)
    {
        ArgumentNullException.ThrowIfNull(files);
        return new AttachmentLoad(files.Count, files.Count(f => f.Kind == ConversationAttachments.Image),
            files.Where(f => f.Kind != ConversationAttachments.Image).Sum(f => (long)(f.Characters ?? 0) + ConversationAttachments.FencePerFile),
            files.Sum(f => f.Bytes));
    }

    /// <summary>The owner message's own record of its files: id, name, kind, type and size.</summary>
    public static JsonArray Summary(IReadOnlyList<ConversationAttachmentView> files)
    {
        ArgumentNullException.ThrowIfNull(files);
        return new JsonArray(files.Select(f => (JsonNode)new JsonObject
        {
            ["id"] = f.Id.ToString(),
            ["name"] = f.Name,
            ["kind"] = f.Kind,
            ["contentType"] = f.ContentType,
            ["bytes"] = f.Bytes,
        }).ToArray());
    }

    private static ConversationAttachmentView View(ConversationAttachmentRecord a) => new(a.Id, a.Name, a.ContentType, a.Kind, a.Bytes, a.Pages, a.Characters, a.RunId);
}
