# ARCH-002 — Lessons from Paperclip

Paperclip (`paperclipai/paperclip`, MIT) is the closest open-source prior art for Endgame's
organisation and workforce layer: companies staffed by agents, an org chart, a task model, budgets
and approvals. It was studied on 2026-11-24 by reading its schema, parts of its services and its
open issues. **No code is reused.** Its mechanics that work are adopted as rules; its recurring
failures are adopted as prohibitions. Parts of its largest files were read in part, not whole.

## What it gets right — adopt

| Mechanic | How it works there | Rule for Endgame |
| --- | --- | --- |
| Atomic task checkout | One conditional `UPDATE` sets the assignee and lock only where the status and current lock holder match what the claimer expected. A stale lock is taken over only when its holder run is provably finished. | Claim a task with one conditional update comparing expected status and expected holder. Take over a lock only from a holder that is provably dead. |
| Tenant-safe references | `company_id` on every row, and composite `(company_id, id)` foreign keys, so a cross-tenant reference cannot be written. | Every row carries its organisation id. Foreign keys are composite with it. |
| Full cost attribution | Each provider call is one event carrying agent, task, project, goal and run, with an idempotency key. | One cost event per model call, carrying the whole cascade path and the employee, idempotent. Roll-ups need no joins. |
| Wake coalescing | Only automatic wakes merge into an existing queued or running run; anything carrying human input keeps its own receipt. | Coalesce system wakes only. Human input always gets its own durable receipt. |
| Run leases | A run records who controls it and until when. | A run holds a lease; recovery reads the lease, never guesses from process ids. |

## Where it fails — prohibit

| Failure seen in its open issues | Rule for Endgame |
| --- | --- |
| Budgets are enforced after the spend is recorded; concurrent starts each see the whole remaining budget. | **Reserve credits in the same transaction that admits a model call**, and settle against the reservation. Never gate on recorded spend. |
| "Budget exhausted" is retried as a transient error and spent again. | Budget exhaustion is terminal for the run. Never retry it. |
| Tens of thousands of holds were never released. | Every reservation expires with its run's lease. A leaked hold releases itself. |
| Spend is kept twice — counters on companies and agents, and a policy ledger — and they disagree. | **One source of truth for spend:** the ledger. No denormalised spend counters on tree nodes. |
| Finishing a run and updating the agent's status are separate steps, patched by a repair sweep. | Finish a run and update the employee's state in one transaction. |
| Deferred wakes are never re-admitted. | Every wake has a deadline and a re-admission sweep. Deferred is never final. |
| Statuses are free text; the activity log can be edited. | Constrain every status in the database. The event log is append-only by database grant. |
| Tenancy is enforced only in application code. | Row-level security as well as application checks. |
| Agents sharing one working directory wiped each other's files; memory leaked between agents through the directory. | One workspace per run. Memory is keyed by employee and cascade scope, never by directory. |
| Stopping an agent loaded its whole history and exhausted memory. | Every history read has a limit. |
| Much of the pain traces to driving external harnesses through adapters. | Confirms the founder's decision: Endgame owns its harness. |

## Not verified

Whether Paperclip uses row-level security (none seen in the files read), how it encrypts secrets,
and its approval services. The issue lists were the first results of searches returning hundreds.
