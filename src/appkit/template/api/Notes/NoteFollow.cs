using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace App.Notes;

/// <summary>
/// Someone following a note: a record that belongs to the signed-in person. The example of "a person's own record" (see
/// AGENTS.md): keyed by the platform's stable <see cref="EndgameUser.Id"/>, one per person and note — the unique index
/// enforces it — and found again when they come back, never made a second time. Copy its shape for a membership, a
/// sign-up, an RSVP or someone's own checklist.
/// </summary>
public sealed class NoteFollow
{
    public Guid Id { get; init; } = Guid.CreateVersion7();

    public required Guid NoteId { get; init; }

    /// <summary>The follower's <see cref="EndgameUser.Id"/>: stable across sign-ins, never their email.</summary>
    public required string PersonId { get; init; }

    public required string PersonName { get; init; }

    public DateTimeOffset FollowedAt { get; init; }
}

internal sealed class NoteFollowConfiguration : IEntityTypeConfiguration<NoteFollow>
{
    public void Configure(EntityTypeBuilder<NoteFollow> follow)
    {
        follow.ToTable("note_follows");
        follow.HasKey(f => f.Id);
        follow.Property(f => f.PersonId).HasMaxLength(64);
        follow.Property(f => f.PersonName).HasMaxLength(200);
        // One per person and note: the database refuses a second, whatever the code does.
        follow.HasIndex(f => new { f.NoteId, f.PersonId }).IsUnique();
        follow.HasOne<Note>().WithMany().HasForeignKey(f => f.NoteId).OnDelete(DeleteBehavior.Cascade);
    }
}
