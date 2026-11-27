using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace App.Notes;

/// <summary>A note someone wrote. The example entity: copy its shape for your own.</summary>
public sealed class Note
{
    public const int TitleMax = 200;
    public const int BodyMax = 10_000;

    public Guid Id { get; init; } = Guid.CreateVersion7();

    public required string Title { get; set; }

    public required string Body { get; set; }

    /// <summary>The <see cref="EndgameUser.Id"/> of whoever wrote it — never their email.</summary>
    public required string AuthorId { get; init; }

    public required string AuthorName { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>When what the note is about happens, if it says: optional, within <see cref="HappensFrom"/> to <see cref="HappensUntil"/>.</summary>
    public DateTimeOffset? HappensAt { get; set; }

    /// <summary>The years a note's date may name. A date field lets far more through (a six-digit year): both sides refuse it.</summary>
    public const string HappensFrom = "2000-01-01T00:00:00Z";

    public const string HappensUntil = "2099-12-31T23:59:59Z";
}

internal sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> note)
    {
        note.ToTable("notes");
        note.HasKey(n => n.Id);
        note.Property(n => n.Title).HasMaxLength(Note.TitleMax);
        note.Property(n => n.Body).HasMaxLength(Note.BodyMax);
        note.Property(n => n.AuthorId).HasMaxLength(64);
        note.Property(n => n.AuthorName).HasMaxLength(200);
        note.HasIndex(n => n.CreatedAt);
    }
}
