# UC-117 — Ask about an app in plain language

| Field | Value |
| --- | --- |
| **ID** | UC-117 |
| **Title** | Ask a question of an app's telemetry, see an answer and a chart, and keep it on a dashboard |
| **Primary actor** | Builder (asks, saves) · Viewer (reads the dashboard) |
| **Scope** | Control plane (`/api/apps/{id}/ask*`, `/api/apps/{id}/dashboard`), the model gateway |
| **Cascade level** | App; charged to the app's chain of budgets |
| **Status** | Built |

## Goal

Natural-language dashboards on top of the telemetry every app collects (spec, *Shared services*):
"how many bookings failed this week?" answered from the app's own data, and only from it.

## Main flow

1. `POST /api/apps/{id}/ask/estimate { question }` → the most it can cost (three calls at their worst case).
2. `POST /api/apps/{id}/ask { question }`: the model writes one query over the views `requests`,
   `errors`, `events` and `metrics` (and a chart spec); the guard checks it; it runs as a role that
   sees only this app's telemetry, with a time and row limit; a second call puts the rows into one
   to three plain sentences.
   - The model is told each view's **exact columns and types, read from the database catalog**
     (`pg_catalog`, once per process), with a one-line hint per view; nothing in the prompt lists a
     column by hand. It is told there is no `id` column and to count rows with `count(*)`.
   - It is also told **what this app itself records**: the names of its custom events over the last 30
     days, how often and one example of their properties (read through the same fenced runner, at most
     30), so "how many books were added today?" becomes `name = 'book.created'`; that the slowest
     requests are rows ordered by `duration_ms`; and that people are `count(DISTINCT user_id)` over
     events. An answer the model leaves blank is replaced by a plain sentence about the rows.
   - **A visit** is a page someone opened: a `GET` that is not an API call (`/api`), a file (a path
     ending in an extension), a health check, a platform callback (`/_platform`, `/_endgame`), a
     webhook (`/hooks`) or the API description (`/openapi`). `requests.visit` carries that rule, the
     same one the app page's "visits today" counts by, so "how many visits today, by hour?" is
     `count(*) FILTER (WHERE visit)` grouped by `date_trunc('hour', at)` and agrees with the page.
     "Requests" is every row of `requests`.
3. The answer: `{ answer, chart: { kind, x, y, series }, sql, columns, rows, truncated, credits: { estimate, charged } }`.
   The console shows `sql` only in technical mode.
4. `POST /api/apps/{id}/dashboard { question, sql, chart, answer }` saves it; `GET …/dashboard` re-runs
   every saved query now, at no model cost; `DELETE …/dashboard/{questionId}` removes one.

## Alternate and failure flows

- **A1 — the model's query is refused, or the database cannot run it.** The model gets the failing
  query back with the guard's reason or the database's own message (`The database said: column "id"
  does not exist`) for exactly one repair, recorded and not charged. If the repaired query is refused
  or fails too: `422 ask_unanswerable`, a plain title and detail that name no query, column or
  database ("It could not be worked out from what this app records. Try asking it another way…"),
  and the last query and the message apart as `technical: { sql, error }`.
- **A1b — the model declines.** When the views cannot answer the question it may reply
  `{"sql": null, "unanswerable": "<plain reason>"}` (first call or repair): `422 ask_unanswerable`
  whose detail is that reason. Only the calls made are charged (the repair never is).
- **A2 — too slow.** `422 query_timeout`, plain words, with `technical` (no repair: a slow query is
  not a mistake to correct).
- **A3 — no `ask` route configured.** `503 ask_unavailable`.
- **A4 — a saved query that no longer runs.** That question's `error` says so in plain words, its
  `technical: { sql, error }` the guard's or the database's message; the others still answer.
- **The console**: normal mode shows only plain words for every failure code (`ask_unanswerable`,
  `query_failed`, `query_refused`, `query_timeout`, `ask_unavailable`); technical mode also shows
  "What failed underneath" — the last query tried and what refused it.

## Rules this use case must honour

- Telemetry belongs to the app's organisation and is used for nothing else (rule 2). An estimate first (rule 11). Repairs not billed (rule 9). Normal mode names no infrastructure (rule 12).

## Acceptance

- A table of hostile queries is refused by the guard; the same queries run without it still read only the app's rows or are refused by privilege, time out, or are cut at the row limit.
- The prompt lists every real column of every view and no other; a hint for a missing view fails.
- A wrong column is repaired from the database's message; a repair that still fails, or a declined
  question, is plain words in normal mode with the technical detail apart.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `TelemetrySqlGuardTests`, `AskTests`.

## Links

- Spec *Shared services* (telemetry) · ARCH-004 *Ask about this app*.
