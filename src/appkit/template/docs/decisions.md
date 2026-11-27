# Decisions

| Decision | Why |
| --- | --- |
| Notes are readable without signing in | The example shows both a public read and a signed-in write. |
| Authors are stored by `EndgameUser.Id`, with their name copied at write time | An email can change; the id cannot. The copied name keeps lists to one query. |
| Ids are UUID v7 | Sortable by creation and safe to show in an address. |
| Reading whether you follow a note requires sign-in; how many follow it is on the note | Anything that reads someone's own record requires sign-in (the security review's checklist), so one endpoint never answers two ways. What anyone may see is a field of the public resource. |
