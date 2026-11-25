# UC-119 — Be told what needs me

| Field | Value |
| --- | --- |
| **ID** | UC-119 |
| **Title** | Read the notification feed, mark it read, and get urgent ones by e-mail |
| **Primary actor** | Owner · Admin |
| **Scope** | Control plane (`/api/notifications*`, the notification sweep, the e-mail outbox) |
| **Cascade level** | Each notification sits at a node; an Admin sees those their grant covers |
| **Status** | Built |

## Goal

Owners are warned on the way down (spec, *Credits*), and anything waiting on a person reaches them.

## Main flow

1. Every 30 seconds the sweep derives, per organisation: a verdict waiting, an approval, a hire proposal,
   a budget at 80 % and at its cap (nodes and employees), the balance at zero, halfway to the overdraft
   limit and at it, a security review's finding. Dock's crash report raises "an app crashed" at once.
2. Each is raised once per episode (a key per organisation; a top-up starts a new balance episode).
3. Urgent ones — a cap reached, credits at zero, the overdraft, a crash, a security finding — are queued
   by e-mail to the Owner and the organisation's Admins, only when a mail server is configured.
4. `GET /api/notifications` → `{ organisation, unread, notifications[] }`; `POST …/{id}/read`; `POST …/read-all`.

## Alternate and failure flows

- **A1 — a Builder or Viewer.** An empty feed, not an error.
- **A2 — no mail server.** Nothing is queued; the feed is the record.

## Rules this use case must honour

- Overdraft carries no interest or fees (rule 3): the notices say what stops and that a top-up restores it.

## Acceptance

- Each kind appears once; urgent ones are e-mailed and others are not; read state is the reader's own; an Admin of one branch does not see another's.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `BreadthTests.The_owner_is_told_what_needs_them…`.

## Links

- Spec *Credits*, *Overdraft* · ARCH-004 *Notifications*.
