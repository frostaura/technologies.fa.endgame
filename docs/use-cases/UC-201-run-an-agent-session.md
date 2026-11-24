# UC-201 — Run an agent session

| Field | Value |
| --- | --- |
| **ID** | UC-201 |
| **Title** | An agent works a piece of work through Endgame's own harness, every step in the run log |
| **Primary actor** | Employee (agent) · contractor (sub-agent) |
| **Scope** | Runner (`Endgame.Harness`, `Endgame.Runner`) over the control plane's `/internal/*` and Dock's workspace API |
| **Cascade level** | The run's scope: rule sets, settings and budgets resolve there (`GET /internal/context`) |
| **Status** | Built |

## Goal

An agent turns a task into a finished, verified change to an app, on a cheap model, without anything it
does escaping the run log, the permission check or the credit budget.

## Preconditions

- A run is claimed by the Runner (`POST /internal/runs/claim`) and its lease is held.
- For work on an app: Dock holds a workspace for the run (`POST /internal/workspaces`), created at the app's
  branch head.
- The routing table has a route for the agent's task type.

## Main flow

1. The loop appends `message {kind: agent.start, system, task}` and calls the model through
   `POST /internal/model/chat` (the gateway reserves credits, then logs `model.requested` / `model.replied`).
2. For each tool call: `tool.requested` (the first of a turn carries the assistant message verbatim, reasoning
   included), then the permission check — `tool.permitted` or `tool.denied`, naming the rule that decided — then
   the before-hooks, the tool in the workspace container, the after-hooks, and `tool.result`.
3. The result goes back to the model; the loop repeats until the model replies without a tool call.
4. Stop hooks run: verify-after-edit once, then the `make lint` gate, whose failure sends the agent back with the
   output and how to fix it. Then `message {kind: agent.reply, final: true}`.

## Alternate and failure flows

- **A1 — the permission pipeline.** Floor (`.git`, protected paths) → the run's deny rules → the cascade's rule
  sets for the stage → plan mode (read-only) → the run's and the cascade's allow rules → reads allowed by
  default, anything else asks. Unattended, an ask is denied (`unattended:<rule>`) unless a checkpoint is set
  there: then `POST /internal/approvals` and the run waits for `approval.answered`.
- **A2 — budget refused.** `402 budget_exhausted` is terminal: the agent stops, nothing retries it.
- **A3 — rate limit, server error, timeout, empty reply.** Retried up to four times with backoff; a bad request
  never is.
- **A4 — malformed calls.** Arguments as a string, an object or empty are accepted; a parse error, an unknown tool
  (with the list of real ones) and a tool call written as text (a nudge, at most three) all go back as results.
- **A5 — the same failing call three times.** The agent stops early (`repeated_failure`).
- **A6 — near the context limit.** The middle of the conversation becomes a model-written summary; the plan, the
  task list, the notes pointer and the most recent results are kept (`message {kind: compaction}`).
- **A7 — pause, cancel, lost lease.** Checked between steps; the session suspends and the run resumes later.
- **A8 — the Runner dies.** Another Runner claims the run when its lease lapses and folds the log back into the
  agent's state; a call that was in flight is answered as interrupted, never re-run blind.

## Postconditions

- Every step is in the run log; the run is resumable from it. Credits were reserved before every call and settled
  from each reply.

## Rules this use case must honour

- Tools run in the workspace container; the harness runs outside it (rule 6).
- A permission check before every tool call, with a protected-path floor nothing overrides (rule 7).
- Credits reserved before a model call (rule 8); repair of an agent's own failure not billed (rule 9).

## Acceptance

- Each rule above has a test in `docs/testing/TEST-201-harness-and-runner.md`.

## Links

- `docs/architecture/ARCH-006-the-harness.md` · `ARCH-004` (run log) · `ARCH-003` (gateway).
