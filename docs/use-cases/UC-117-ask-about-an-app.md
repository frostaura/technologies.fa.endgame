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
3. The answer: `{ answer, chart: { kind, x, y, series }, sql, columns, rows, truncated, credits: { estimate, charged } }`.
   The console shows `sql` only in technical mode.
4. `POST /api/apps/{id}/dashboard { question, sql, chart, answer }` saves it; `GET …/dashboard` re-runs
   every saved query now, at no model cost; `DELETE …/dashboard/{questionId}` removes one.

## Alternate and failure flows

- **A1 — the model's query is refused.** One repair, recorded and not charged; a second refusal is `422 ask_unanswerable`, "try asking it another way".
- **A2 — too slow.** `422 query_timeout`.
- **A3 — no `ask` route configured.** `503 ask_unavailable`.
- **A4 — a saved query that no longer runs.** That question's `error` says why; the others still answer.

## Rules this use case must honour

- Telemetry belongs to the app's organisation and is used for nothing else (rule 2). An estimate first (rule 11). Repairs not billed (rule 9). Normal mode names no infrastructure (rule 12).

## Acceptance

- A table of hostile queries is refused by the guard; the same queries run without it still read only the app's rows or are refused by privilege, time out, or are cut at the row limit.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `TelemetrySqlGuardTests`, `AskTests`.

## Links

- Spec *Shared services* (telemetry) · ARCH-004 *Ask about this app*.
