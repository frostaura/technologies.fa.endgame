# UC-202 — Research an idea to a verdict

| Field | Value |
| --- | --- |
| **ID** | UC-202 |
| **Title** | The factory researches an owner's idea and records a harsh, evidenced verdict |
| **Primary actor** | System (the research workflow), with contractor agents and a judge |
| **Scope** | Runner (`ResearchWorkflow`), control plane (`/internal/ideas/{id}/verdict`) |
| **Cascade level** | The idea's organisation or division |
| **Status** | Built (Runner side) |

## Goal

The owner learns whether an idea is worth building — who already does it, what gap is left, who wants it — from a
verdict that is not flattering.

## Main flow

1. `POST /api/ideas` queues a `research` run carrying the owner's text and constraints, and its `estimate.made`.
2. The Runner fans out three contractors in parallel, each with its own context, on the research route's
   server-side web search: existing products, the gap, demand.
3. A judge, given their reports, argues the case against the idea first and writes the verdict document.
4. Code applies the rules whatever the judge wrote: every product any contractor found is named; no evidence of
   demand turns a build into do not build; a red line (`CLAUDE.md`) is do not build with the line named.
5. The verdict (`outcome`, `headline`, `summary`, `against`, `existing`, `gap`, `demand`, `wouldChange`,
   `redLines`, `placement`, `method`) is posted to `POST /internal/ideas/{id}/verdict` and kept in the run's journal
   for the build to read its placement.

## Alternate and failure flows

- **A1 — do not build.** The message says nothing will be built unless the owner overrules it; the idea waits for
  the owner's decision.
- **A2 — no verdict document.** The run fails; no verdict is guessed.

## Acceptance

- `WorkflowTests`: research fans out, argues against first, names every product; missing demand and a red line both
  give do not build; no document fails the run.

## Links

- Spec, *the factory* and *Market research verdict*. `UC-104` (control-plane side).
