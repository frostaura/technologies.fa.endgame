using System.ComponentModel.DataAnnotations;
using App.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace App.Notes;

/// <summary>A note in a list.</summary>
public sealed record NoteSummary(Guid Id, string Title, string AuthorName, DateTimeOffset CreatedAt);

/// <summary>A whole note.</summary>
public sealed record NoteDetail(Guid Id, string Title, string Body, string AuthorName, DateTimeOffset CreatedAt);

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
    }

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
