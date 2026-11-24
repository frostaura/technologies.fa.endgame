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

Migrations: `InitialCreate`.
