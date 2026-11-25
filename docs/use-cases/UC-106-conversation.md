# UC-106 — Talk to the organisation, a node or an employee

| Field | Value |
| --- | --- |
| **ID** | UC-106 |
| **Title** | Send a message in the docked conversation and read it back later |
| **Primary actor** | Owner · Builder (send) · Viewer (read) |
| **Scope** | Control plane (`/api/conversations`); the reply is written by the Runner |
| **Cascade level** | Any node; optionally one employee |
| **Status** | Built (control-plane side) |

## Main flow

1. `POST /api/conversations { scope, message, employeeId?, conversationId? }` → 201 `Run` (kind `conversation`,
   queued, carrying `conversationId`). The message is the run's first event `message { from: "owner", userId, text }`.
   Without a `conversationId`, the latest conversation at that scope (and employee) continues.
2. The Runner replies as `message { from, text }` events on that run; the console streams them.
3. `GET /api/conversations?scope=&employeeId=` → `{ scope, conversationId | null, employeeId, messages[] { runId, seq, at, from, text } }`, oldest first, at most the last 200.

4. What the assistant reads and does goes through the internal API: `GET /internal/context`, `/internal/employees`,
   `/internal/tasks`, `/internal/runs`, `/internal/credits` (each at the scope and beneath it), `POST /internal/ideas`,
   `POST /internal/apps/changes`, `POST /internal/runs/{id}/retry` and `PUT /internal/cascade` — the latter for an
   allow-list of settings only (UC-114), never who may open an app. Each action is a checkpoint answered in the
   conversation itself, titled in plain words.
5. Before a message is sent, `POST /api/conversations/estimate { scope, employeeId? }` → `{ credits, ceiling, basis }`; the
   same estimate opens the turn's run (CLAUDE.md rule 11).
6. Each message read back carries `by` (who sent it, or the employee who answered) and, for Endgame's own notices, `code`.
7. With an employee, the employee answers: its job, mandate, memory and model tier (ARCH-006, *The conversation*). An app
   scope (`org/division/project/app`) is a conversation about that app only.

## Alternate and failure flows

- **A1 — a conversation id from another scope.** 409; start one here.
- **A2 — nothing said yet.** `conversationId: null`, `messages: []` (genuinely empty).
- **A3 — the budget runs out.** The turn writes `message { from: runner, code: budget_exhausted, text }` and no reply; the
  dock shows it with "See credits".

## Acceptance

- Messages from both sides, across several runs, read back in order; another scope has its own conversation.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `IdeasAndConversationsTests`; the assistant's tools against the real endpoints in `RunnerContractTests`.
