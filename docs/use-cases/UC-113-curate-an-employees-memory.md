# UC-113 — Curate an employee's memory

| Field | Value |
| --- | --- |
| **ID** | UC-113 |
| **Title** | The employee writes what it learned after a task; a review consolidates it; the owner reads and corrects it |
| **Primary actor** | employee (agent) via the Runner; Owner · Builder (curate); Viewer (read) |
| **Scope** | Control plane (`/internal/employees/{id}/memory*`, `/api/employees/{id}/memory*`, `/api/employees/{id}/reviews`) |
| **Cascade level** | Each entry is about one node; a run reads what is about its scope, above it and beneath it |
| **Status** | Built (control-plane side; the review run itself is the Runner's) |

## Goal

Each task runs fresh against a memory that stays small and right, so an employee's quality does not drift as its history grows.

## Main flow

1. Before a task the Runner reads `GET /internal/employees/{id}/memory?scope=<run scope>`: entries about that scope, the levels
   above it and the levels beneath it — never a sibling branch — at most 200.
2. After the task it writes `POST /internal/employees/{id}/memory { runId, entries: [{ title, body, kind, scope? }] }`;
   `kind` is `fact`, `practice`, `preference` or `lesson`; the scope defaults to the run's.
3. A review (`POST /api/employees/{id}/reviews` queues a `review` run) reports
   `POST /internal/employees/{id}/memory/review { merged, removed, corrected }`, each with why; it is applied in one
   transaction and every entry left is stamped `lastReviewedAt`.
4. The owner reads `GET /api/employees/{id}/memory` and `…/memory/changes`, and adds, corrects or removes entries.

## Alternate and failure flows

- **A1 — a released employee.** Its memory is archived (read with `includeArchived=true`) and cannot be written; a rehire restores it.
- **A2 — a review naming an entry that is not live, or twice.** `400`; nothing is changed.
- **A3 — a contractor** keeps no memory: what it learned goes to its briefer when it finishes.

## Postconditions

- `employee_memories` rows, keyed by employee and scope (never by directory, ARCH-002); every change in the append-only
  `employee_memory_changes` (before and after for corrections, the merged entries, why).

## Acceptance

- `WorkforceTests.Memory_is_written_after_a_task_read_for_a_run_reviewed_and_curated_by_the_owner`,
  `…Reassignment_carries_memory_release_archives_it_and_a_rehire_restores_it`.

## Links

- Spec, *An employee's memory is curated, not accumulated* · UC-112.
