# UC-105 — Follow and control a run

| Field | Value |
| --- | --- |
| **ID** | UC-105 |
| **Title** | Watch a run's live log, pause, resume or cancel it, and answer its approvals |
| **Primary actor** | Owner · Builder (control) · Viewer (watch); the Runner writes the log |
| **Scope** | Control plane (`/api/runs/*`, `/api/tasks`, `/internal/runs*`, `/internal/tasks*`, `/internal/approvals`) |
| **Cascade level** | The run's scope; roles resolve there |
| **Status** | Built (control-plane side) |

## Goal

Everything an agent does is traceable as it happens, and a person can stop or redirect it at any time.

## Main flow

1. `GET /api/runs/{id}` → `Run { id, kind, title, scope, status (queued|running|waiting|paused|finished|failed|cancelled), startedAt, finishedAt, lastSeq, ideaId, estimateCredits, spentCredits, ... }`.
2. `GET /api/runs/{id}/events?after=<seq>` streams server-sent events: `id: <seq>`, `event: <type>`,
   `data: { seq, type, at, payload }`; `Last-Event-ID` resumes too. When the run has finished and the log
   is drained an `event: end` closes the stream.
3. `POST /api/runs/{id}/pause | resume | cancel` (optional `{ reason }`) → the updated `Run`. Resume puts it
   back in the queue with no lease, so the Runner claims it and replays its log. Cancel finishes it and
   releases its open reservations.
4. A run raises a checkpoint (`POST /internal/approvals`) and waits (`waiting`); the person answers
   `POST /api/runs/{id}/approvals/{approvalId} { decision: approve|reject, note? }` → 204, once.
5. `GET /api/tasks?scope=&status=&limit=` lists the task graph at and beneath a scope.

## For the Runner (internal)

`POST /internal/runs`, `POST /internal/runs/claim`, `POST /internal/runs/{id}/lease`, `GET|POST /internal/runs/{id}/events`,
`POST /internal/tasks`, `PATCH /internal/tasks/{id}`, `POST /internal/tasks/checkout`. A lease's first take of a
queued run appends `run.started`; `run.finished { outcome, summary, totals }` updates the employee and releases
reservations in the same transaction.

## Alternate and failure flows

- **A1 — two claimers of one task.** Exactly one wins; the other gets 409 with the task as it is.
- **A2 — a lock held by a dead run.** Taken over only when the holder finished or its lease lapsed.
- **A3 — appending to a finished run, or without the live lease.** 409. Unknown event types and payloads over 64 KiB: 400.
- **A4 — a second answer to an approval.** 409.
- **A5 — an answer with a note.** `{ decision, note }`; the note (at most 2000 characters) goes back to the waiting work.
  The approval's `onDecline` (`continues` or `stops`) says what a decline does, and the console says it after a decline.
- **A6 — try again.** For the latest failed or cancelled research, build or change (`canTryAgain`):
  `POST /api/runs/{id}/retry/estimate` shows what it costs and what is kept, then `POST /api/runs/{id}/retry` starts a new
  run that carries on from the earlier one's placement, agreed plan and finished parts (ARCH-006, *Trying again*). Anything
  else is `409 not_retryable`; trying the same run twice is `409`.
- **A7 — a budget stop.** `budgetExhausted` on the run; the run page says so with the way to more credits and, where it
  applies, "Try again". The cost panel shows what was not charged (`estimate.scored.nonBillableCredits`).

## Postconditions

- `run_events` only grows; sequence numbers are gapless per run (assigned by bumping `runs.last_seq` in the append's transaction).

## Rules this use case must honour

- ARCH-002: atomic checkout, run leases, finish-and-employee in one transaction, append-only log, bounded history reads (500 per page).

## Acceptance

- 25 concurrent two-event appends yield sequences 1..50 with no gap; SSE resumes after a given sequence.
- Pause → resume → cancel produces `run.started, run.paused, run.resumed, run.finished`.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `RunsAndTasksTests`.

## Links

- ARCH-002 · ARCH-004 *Runs*, *Run log* · UC-001 (console run view).
