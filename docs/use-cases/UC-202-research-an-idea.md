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
2. The organisation's **researcher** is hired the first time research reaches the idea's scope (`POST /internal/hires`,
   trigger `stage`, need `stage:research:<scope>`; accepted at once in auto-mode within budget). It briefs one **contractor**
   per strand — existing products, the gap, demand — each registered (`POST /internal/contractors`, `briefedBy` the
   researcher) so its model calls carry its own id, and each a titled `subagent.started` ("Looked for existing products").
3. The strands work **in parallel**, each with its own context, on the research route's server-side web search. Each has a
   **search budget sized from the estimate**: `floor(estimate × 0.75 ÷ strands ÷ 1.7 credits a search)`, kept within 2 and 7
   (`Runner:ResearchSearchesPerStrand`), sent as `limits.maxSearches`, and a credit slice of the same share. Their sources
   (reported and cited) go into one deduplicated pool.
4. The researcher judges, with search off (`maxSearches: 0`), arguing the case against first; its curated memory is given
   as context below its rules.
5. Code turns the judgement into **the verdict document** (ARCH-004) — a strict parse-and-repair that invents nothing — and
   applies the rules whatever the judge wrote: every product any strand found is named; no evidence of demand turns a build
   into do not build; a red line is do not build with the line named; `method` states the searches actually made (from the
   provider's own count), the strands and the confidence, never above the strands' best.
6. The document is checked locally (`VerdictDocument.Validate`) and posted. A refusal (`400 verdict_invalid`, local or the
   control plane's) goes back to the judge **once** with its faults; a second refusal fails the run.
7. The owner reads one plain message per milestone: research started, the verdict (once). Each contractor's
   `subagent.finished` says in one sentence what it found; its raw report is technical-mode detail.
8. After a build or change verdict, auto-mode decides (`POST /internal/ideas/{id}/decision {decision: build, by: auto-mode}`):
   building starts, or `409 owner_decision_required` (checkpoints) is said as "waiting for your decision". A do-not-build
   always waits for the owner.

## Alternate and failure flows

- **A1 — do not build.** The message says nothing will be built unless the owner overrules it; the idea waits for
  the owner's decision.
- **A2 — no verdict document.** The run fails; no verdict is guessed.

## Acceptance

- `WorkflowTests`: research hires its researcher, fans out registered contractors with sized search budgets, records the one
  document; a refused verdict is corrected once; missing demand and a red line give do not build; checkpoints wait; no
  document fails the run. `IdeasAndConversationsTests.A_malformed_verdict_is_refused…` (the control plane's side).

## Links

- Spec, *the factory* and *Market research verdict*. `UC-104` (control-plane side).
