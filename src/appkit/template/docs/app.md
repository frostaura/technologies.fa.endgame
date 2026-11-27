# The app

**Notes** — people write short notes and read each other's.

## Who uses it

- **Anyone who can open the app** reads every note.
- **Signed-in people** (organisation members or registered end users) also write notes and follow them.

## Features

| Feature | Where | Signed in? |
| --- | --- | --- |
| List every note, newest first | `/` · `GET api/notes` (`listNotes`) | No |
| Read one note, and how many people follow it | `/notes/:id` · `GET api/notes/{id}` (`getNote`) | No |
| Write a note | `/notes/new` · `POST api/notes` (`createNote`) | Yes |
| Follow a note, see whether you do, stop | `/notes/:id` · `GET/PUT/DELETE api/notes/{id}/follow` (`getNoteFollow`, `followNote`, `unfollowNote`) | Yes |
| Who is signed in | header · `GET api/me` (`getCurrentUser`, from the kit) | No |

Every endpoint is in this table with whether calling it needs signing in, exactly as the code says: `make test` checks
it (`AppRulesTests`), so change the row with the endpoint.

Events recorded: `note.created`.
