# Data

## Note — table `notes`

| Field | Type | Rules |
| --- | --- | --- |
| `Id` | uuid (v7) | Set by the server. |
| `Title` | text ≤ 200 | Required, trimmed. |
| `Body` | text ≤ 10 000 | Optional, trimmed; empty when not given. |
| `AuthorId` | text ≤ 64 | The writer's `EndgameUser.Id`. |
| `AuthorName` | text ≤ 200 | The writer's display name when they wrote it. |
| `CreatedAt` | timestamptz | Set by the server; indexed (lists sort by it). |

Who may: anyone reads; signed-in people write. Nobody edits or deletes yet.

## NoteFollow — table `note_follows`

A signed-in person following a note: their own record, one per person and note.

| Field | Type | Rules |
| --- | --- | --- |
| `Id` | uuid (v7) | Set by the server. |
| `NoteId` | uuid | The note; deleting the note deletes its follows. |
| `PersonId` | text ≤ 64 | The follower's `EndgameUser.Id` — stable across sign-ins. |
| `PersonName` | text ≤ 200 | Their display name when they followed. |
| `FollowedAt` | timestamptz | Set by the server. |

Unique: (`NoteId`, `PersonId`) — the database refuses a second follow by the same person. Following again answers the
follow they have.

Migrations: `InitialCreate`, `AddNoteFollows`.
