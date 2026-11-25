# UC-203 — Build an app in the factory

| Field | Value |
| --- | --- |
| **ID** | UC-203 |
| **Title** | From a build decision to an app running privately, built and checked feature by feature |
| **Primary actor** | System (the build workflow), with planner, builder, evaluator and security-reviewer agents |
| **Scope** | Runner (`BuildWorkflow`), control plane (tree, approvals, estimates), Dock (repositories, workspaces, builds, start) |
| **Cascade level** | The division the idea was raised in; the app is created under it |
| **Status** | Built |

## Main flow

1. **Placement.** The verdict's proposed project and app (or the idea's own words) are created in the tree.
   **Hiring from the ontology:** a division created here raises a division lead (trigger `division`); the project entering
   its build and its evaluation raises a software engineer and a QA engineer (trigger `stage`, reporting to the lead). In
   auto-mode within budget each is hired at once; a hire that waits for the owner never stops the work (it goes ahead
   unattributed, and the owner is told). Each employee's curated memory for the project is read before its sessions and
   given as context below its rules; it may keep notes with `remember`, and work sent back becomes a `lesson`.
2. **Plan — a faithful contract.** The engineer, as planner in plan mode, lists the idea's requirements in its own words,
   explores the app kit's template read-only and calls `propose_plan`: items, each with plain text for the owner, the
   technical detail, how it will be checked and which requirements it covers; and any requirement deliberately left out,
   with a reason (`plan.proposed`). `propose_plan` refuses a plan that does not cover every requirement it lists, quote
   the idea, or keep its owner text plain, and the planner corrects it. Code accepts it only when valid (`plan.accepted`,
   then a plain `message` saying what will be built and what was left out and why), or asks the owner when a plan
   checkpoint is set.
3. **Estimate.** Refined by the plan's size (`estimate.made`, stage plan); in auto-mode a build over budget pauses.
4. **Build, one feature per session.** The engineer, on the cheapest tier, builds the item, verifies with `make build`,
   `make test`, `make lint`, and commits; code commits if it did not.
5. **Evaluate.** Dock builds the image and starts the app privately; the QA engineer, with its own context and no write
   tool, checks the item — build, tests, and each requirement it delivers in the RUNNING app, signed in as a test member
   (`call_app`: a session from `POST /internal/apps/{id}/test-session`, the call through Edge's
   `/internal/apps/{id}/call/{path}`), plus signed out through `POST /internal/apps/{id}/probe` — and answers
   `{passed, evidence, requirements: [{id, met, evidence}], faults}`. Code's gate fails the item unless every requirement
   is met with evidence naming a call that was made (`evaluation.passed` / `evaluation.failed`, with a plain `summary`).
6. **Repair.** A failed item goes back to a builder one tier up, with the faults, not billed; at most three rounds.
7. **Progress.** A passed item is recorded in `PROGRESS.md` and committed.
8. **Security review.** The organisation's standing security reviewer (its model calls carry that employee's id) checks the app against the checklist skill; a finding gets one unbilled repair,
   and a finding that remains blocks publishing.
9. **Publish.** Built and started privately through Dock. Only the owner can make it public. A recurring job the app now
   declares (a schedule, seen in the ontology) raises an operations hire (trigger `recurring`).

## Alternate and failure flows

- **A1 — the Runner dies part-way.** The journal (`message {kind: workflow.step}`) lets the resumed build skip
  placement, planning and every finished feature.
- **A2 — a build failure.** The image's build log is the failed evaluation; no evaluator is needed.

## Rules this use case must honour

- Go-public is a human act (rule 10); repair is not billed (rule 9); an estimate before work (rule 11).

## Acceptance

- `WorkflowTests`: the whole factory; repair on the next tier, not billed; the cap; a security finding blocks
  publishing; a killed build resumes without repeating finished stages; a plan missing a requirement is refused and
  corrected; a requirement left out is told to the owner; an evaluator that passes without calling the running app is
  overruled and the item repaired; the gate counts only evidence naming a call that was made.
- `make e2e-factory` (live): the reading-list idea's "see what everyone is reading now" is a requirement, delivered,
  evidenced by a signed-in call, and visible in the built app.
