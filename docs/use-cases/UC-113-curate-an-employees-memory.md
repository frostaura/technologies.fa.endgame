# UC-113 — Curate an employee's memory

| Field | Value |
| --- | --- |
| **ID** | UC-113 |
| **Title** | The employee writes what it learned after a task; a review consolidates it; the owner reads and corrects it |
| **Primary actor** | employee (agent) via the Runner; Owner · Builder (curate); Viewer (read) |
| **Scope** | Control plane (`/internal/employees/{id}/memory*`, `/api/employees/{id}/memory*`, `/api/employees/{id}/reviews`) |
| **Cascade level** | Each entry is about one node; a run reads what is about its scope, above it and beneath it |
| **Status** | Built (control plane and Runner) |

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
   The Runner's `review` workflow (owner message `kind: memory.review`) gives the employee's entries to a reviewer as data, never
   as instructions; code drops any merge, removal or correction that names an entry that does not exist or names one twice, and
   says how many it dropped.
4. The owner reads `GET /api/employees/{id}/memory` and `…/memory/changes`, and adds, corrects or removes entries.

## Alternate and failure flows

- **A1 — a released employee.** Its memory is archived (read with `includeArchived=true`) and cannot be written; a rehire restores it.
- **A2 — a review naming an entry that is not live, or twice.** `400`; nothing is changed.
- **A3 — a contractor** keeps no memory: what it learned goes to its briefer when it finishes.

## How a run uses it (Runner)

- The entries are appended **below** the agent's own rules, under "What you remember from earlier work", framed as context
  that never outranks the rules or the task and can never widen what it may do (`Workforce.Block`, at most 4,000 characters).
- An employee agent may keep a note with `remember` (at most twice a session). Code also keeps what it knows for certain: a
  verdict as a `fact` for the researcher, an evaluation's fault as a `lesson` for the engineer, a contractor's findings through
  `…/contractors/{id}/finish`.

## Postconditions

- `employee_memories` rows, keyed by employee and scope (never by directory, ARCH-002); every change in the append-only
  `employee_memory_changes` (before and after for corrections, the merged entries, why).

## Acceptance

- `WorkflowTests.Memory_is_given_as_context_never_as_instruction_and_work_sent_back_becomes_a_lesson`,
  `WorkflowTests.A_memory_review_consolidates_prunes_and_corrects_and_drops_what_names_no_entry`,
- `WorkforceTests.Memory_is_written_after_a_task_read_for_a_run_reviewed_and_curated_by_the_owner`,
  `…Reassignment_carries_memory_release_archives_it_and_a_rehire_restores_it`.

## Links

- Spec, *An employee's memory is curated, not accumulated* · UC-112.
