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

## Alternate and failure flows

- **A1 — a conversation id from another scope.** 409; start one here.
- **A2 — nothing said yet.** `conversationId: null`, `messages: []` (genuinely empty).

## Acceptance

- Messages from both sides, across several runs, read back in order; another scope has its own conversation.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `IdeasAndConversationsTests`.
