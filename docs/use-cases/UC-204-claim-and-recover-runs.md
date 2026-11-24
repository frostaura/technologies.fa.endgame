# UC-204 — Claim, hold and recover runs

| Field | Value |
| --- | --- |
| **ID** | UC-204 |
| **Title** | The Runner claims queued work, honours pause and cancel, and resumes what a dead Runner left |
| **Primary actor** | System (the Runner) |
| **Scope** | Runner (`RunnerService`, `RunExecutor`, `LeaseKeeper`) over `/internal/runs*` |
| **Cascade level** | Any |
| **Status** | Built |

## Main flow

1. The Runner asks for work (`POST /internal/runs/claim`) while it has a free slot (concurrency limit); the claim
   also returns runs whose lease lapsed — that is crash recovery.
2. It reads the run's whole log back, holds the lease (renewed every third of its length), and learns pause and
   cancel from each renewal's answer.
3. Before work: an estimate in the log (`estimate.made`) and the gate — in auto-mode, work whose estimate exceeds the
   budget's headroom does not begin (the run pauses, saying why); with a start checkpoint, the owner approves first.
4. The workflow for the run's kind runs (`task`, `research`, `build`, `conversation`, `review`).
5. At the end: `estimate.scored`, a plain-language `message`, `run.finished` — in one append.

## Alternate and failure flows

- **A1 — paused.** The run stops at the next step boundary and its lease is released; resume re-queues it and it is
  replayed.
- **A2 — graceful shutdown.** Runs suspend at a step boundary and their leases are released at once.
- **A3 — killed.** Nothing is written; the lease lapses; another Runner claims and replays.

## Acceptance

- `RunnerIntegrationTests` (real control plane, real PostgreSQL): kill-and-resume, pause-and-resume, graceful
  shutdown. `EstimateTests`: the estimate, the gate, the checkpoint, the score.
