# docs — the app's own memory

The builder keeps these files true **as the app changes**, in the same change as the code. The next
builder reads them before touching anything; a stale line here costs more than a missing one.

| File | Holds | Update when |
| --- | --- | --- |
| `app.md` | What the app is for, who uses it, and every feature it has today, each with its endpoints and whether they need signing in (`make test` checks the table against the code) | A feature or an endpoint is added, changed or removed, or its sign-in changes |
| `data.md` | Every entity, its fields and rules, and who may read or write it | An entity or migration changes |
| `decisions.md` | Choices that are not obvious from the code, each with its reason | A choice is made that someone might undo |

Rules: plain language; present tense; no plans, no "coming soon"; delete what stopped being true.
