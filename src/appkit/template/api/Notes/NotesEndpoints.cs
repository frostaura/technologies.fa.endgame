using System.ComponentModel.DataAnnotations;
using App.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace App.Notes;

/// <summary>A note in a list.</summary>
public sealed record NoteSummary(Guid Id, string Title, string AuthorName, DateTimeOffset CreatedAt);

/// <summary>A whole note.</summary>
public sealed record NoteDetail(Guid Id, string Title, string Body, string AuthorName, DateTimeOffset CreatedAt);

/// <summary>
/// Whether the signed-in person follows a note: their own record, read on every visit, so a person who comes back sees
/// "Following" — never "Follow" again. <c>Id</c> is their follow's id (null when they do not follow it); signed out, they
/// follow nothing.
/// </summary>
public sealed record NoteFollowView(Guid? Id, bool SignedIn, bool Following, DateTimeOffset? Since, int Followers);

/// <summary>What a person writes to make a note. Attributes here are checked before the handler runs.</summary>
public sealed record NewNote(
    [property: Required, StringLength(Note.TitleMax, MinimumLength = 1)] string Title,
    [property: StringLength(Note.BodyMax)] string? Body);

/// <summary>
/// The notes API, mapped on the api/ group from UseEndgameApp(). Every endpoint has an operation id
/// (WithName) and a description (WithDescription): the platform turns each one into an MCP tool.
/// </summary>
public static class NotesEndpoints
{
    public static void MapNotes(this RouteGroupBuilder api)
    {
        var notes = api.MapGroup("notes").WithTags("Notes");

        notes.MapGet("", ListAsync)
            .WithName("listNotes")
            .WithSummary("List notes")
            .WithDescription("Every note, newest first, as id, title, author and creation time. An empty list means there are no notes.");

        notes.MapGet("{id:guid}", GetAsync)
            .WithName("getNote")
            .WithSummary("Read a note")
            .WithDescription("The whole note with this id, including its body. 404 if there is no such note.");

        notes.MapPost("", CreateAsync)
            .RequireUser()
            .WithName("createNote")
            .WithSummary("Write a note")
            .WithDescription("Saves a new note by the signed-in person and returns it. Title is required (up to 200 characters); body is optional.");

        // A person's own record (AGENTS.md): found by their user id, made once, answered as it is every time after.
        notes.MapGet("{id:guid}/follow", GetFollowAsync)
            .WithName("getNoteFollow")
            .WithSummary("Whether you follow a note")
            .WithDescription("Whether the signed-in person follows this note (their follow's id and since when), and how many people follow it. Signed out: following is false. 404 if there is no such note.");

        notes.MapPut("{id:guid}/follow", FollowAsync)
            .RequireUser()
            .WithName("followNote")
            .WithSummary("Follow a note")
            .WithDescription("The signed-in person follows this note. Safe to repeat: someone who already follows it gets the follow they have (200), never a second one; the first time answers 201. 404 if there is no such note.");

        notes.MapDelete("{id:guid}/follow", UnfollowAsync)
            .RequireUser()
            .WithName("unfollowNote")
            .WithSummary("Stop following a note")
            .WithDescription("The signed-in person stops following this note; safe to repeat. Answers whether they follow it now (false). 404 if there is no such note.");
    }

    private static async Task<Results<Ok<NoteFollowView>, ProblemHttpResult>> GetFollowAsync(Guid id, EndgameUser? user, AppDb db, CancellationToken ct) =>
        await db.Notes.AnyAsync(n => n.Id == id, ct) ? TypedResults.Ok(await FollowViewAsync(db, id, user, ct)) : NoSuchNote(id);

    private static async Task<Results<Created<NoteFollowView>, Ok<NoteFollowView>, ProblemHttpResult>> FollowAsync(Guid id, EndgameUser user, AppDb db, TimeProvider clock, CancellationToken ct)
    {
        if (!await db.Notes.AnyAsync(n => n.Id == id, ct))
        {
            return NoSuchNote(id);
        }

        // Found again by who they are: a person coming back gets the follow they already have.
        if (await db.NoteFollows.AnyAsync(f => f.NoteId == id && f.PersonId == user.Id, ct))
        {
            return TypedResults.Ok(await FollowViewAsync(db, id, user, ct));
        }

        db.NoteFollows.Add(new NoteFollow { NoteId = id, PersonId = user.Id, PersonName = user.DisplayName, FollowedAt = clock.GetUtcNow() });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The same person, twice at once (two tabs): the unique index kept one, and that one is theirs.
            db.ChangeTracker.Clear();
            if (!await db.NoteFollows.AnyAsync(f => f.NoteId == id && f.PersonId == user.Id, ct))
            {
                throw;
            }

            return TypedResults.Ok(await FollowViewAsync(db, id, user, ct));
        }

        return TypedResults.Created($"{id}/follow", await FollowViewAsync(db, id, user, ct));
    }

    private static async Task<Results<Ok<NoteFollowView>, ProblemHttpResult>> UnfollowAsync(Guid id, EndgameUser user, AppDb db, CancellationToken ct)
    {
        if (!await db.Notes.AnyAsync(n => n.Id == id, ct))
        {
            return NoSuchNote(id);
        }

        await db.NoteFollows.Where(f => f.NoteId == id && f.PersonId == user.Id).ExecuteDeleteAsync(ct);
        return TypedResults.Ok(await FollowViewAsync(db, id, user, ct));
    }

    private static async Task<NoteFollowView> FollowViewAsync(AppDb db, Guid noteId, EndgameUser? user, CancellationToken ct)
    {
        var mine = user is null ? null : await db.NoteFollows.AsNoTracking().FirstOrDefaultAsync(f => f.NoteId == noteId && f.PersonId == user.Id, ct);
        var followers = await db.NoteFollows.CountAsync(f => f.NoteId == noteId, ct);
        return new NoteFollowView(mine?.Id, user is not null, mine is not null, mine?.FollowedAt, followers);
    }

    private static ProblemHttpResult NoSuchNote(Guid id) =>
        TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "No such note", detail: $"There is no note with id {id}.");

    private static async Task<Ok<List<NoteSummary>>> ListAsync(AppDb db, CancellationToken ct)
    {
        var notes = await db.Notes
            .OrderByDescending(n => n.CreatedAt)
            .Select(n => new NoteSummary(n.Id, n.Title, n.AuthorName, n.CreatedAt))
            .ToListAsync(ct);
        return TypedResults.Ok(notes);
    }

    private static async Task<Results<Ok<NoteDetail>, ProblemHttpResult>> GetAsync(Guid id, AppDb db, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        return note is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "No such note", detail: $"There is no note with id {id}.")
            : TypedResults.Ok(ToDetail(note));
    }

    private static async Task<Created<NoteDetail>> CreateAsync(NewNote input, EndgameUser user, AppDb db, IEndgameTelemetry telemetry, TimeProvider clock, CancellationToken ct)
    {
        var note = new Note
        {
            Title = input.Title.Trim(),
            Body = input.Body?.Trim() ?? "",
            AuthorId = user.Id,
            AuthorName = user.DisplayName,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Notes.Add(note);
        await db.SaveChangesAsync(ct);
        telemetry.Track("note.created", new Dictionary<string, object?> { ["length"] = note.Body.Length }, user.Id);

        // Relative to the request (…/api/notes), so it is right under any address prefix.
        return TypedResults.Created($"notes/{note.Id}", ToDetail(note));
    }

    private static NoteDetail ToDetail(Note n) => new(n.Id, n.Title, n.Body, n.AuthorName, n.CreatedAt);
}
