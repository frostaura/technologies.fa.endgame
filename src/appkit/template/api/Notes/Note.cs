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
