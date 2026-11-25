# UC-203 — Build an app in the factory

| Field | Value |
| --- | --- |
| **ID** | UC-203 |
| **Title** | From a build decision to an app running privately, built and checked feature by feature |
| **Primary actor** | System (the build workflow), with planner, builder, evaluator and security-reviewer agents |
| **Scope** | Runner (`BuildWorkflow`), control plane (tree, approvals, estimates), Dock (repositories, workspaces, builds, start) |
| **Cascade level** | The division the idea was raised in; the app is created under it |
| **Status** | Built (Runner side); depends on the control-plane and Edge endpoints listed in the lane report |

## Main flow

1. **Placement.** The verdict's proposed project and app (or the idea's own words) are created in the tree.
   **Hiring from the ontology:** a division created here raises a division lead (trigger `division`); the project entering
   its build and its evaluation raises a software engineer and a QA engineer (trigger `stage`, reporting to the lead). In
   auto-mode within budget each is hired at once; a hire that waits for the owner never stops the work (it goes ahead
   unattributed, and the owner is told). Each employee's curated memory for the project is read before its sessions and
   given as context below its rules; it may keep notes with `remember`, and work sent back becomes a `lesson`.
2. **Plan.** The engineer, as planner in plan mode, explores the app kit's template read-only and calls `propose_plan`: items, each
   with what will be made and how it will be checked (`plan.proposed`). Code accepts it only when valid
   (`plan.accepted`), or asks the owner when a plan checkpoint is set.
3. **Estimate.** Refined by the plan's size (`estimate.made`, stage plan); in auto-mode a build over budget pauses.
4. **Build, one feature per session.** The engineer, on the cheapest tier, builds the item, verifies with `make build`,
   `make test`, `make lint`, and commits; code commits if it did not.
5. **Evaluate.** Dock builds the image and starts the app privately; the QA engineer, with its own context and no write
   tool, checks the item — build, tests, and the running preview through Edge's `POST /internal/apps/{id}/probe` (as a
   signed-out visitor) — and answers
   `{passed, evidence, faults}` (`evaluation.passed` / `evaluation.failed`).
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
  publishing; a killed build resumes without repeating finished stages.
