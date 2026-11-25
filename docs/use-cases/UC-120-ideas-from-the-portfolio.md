# UC-120 — Get new ideas from what the organisation already holds

| Field | Value |
| --- | --- |
| **ID** | UC-120 |
| **Title** | Ask for suggested ideas, read them, and turn one into an idea |
| **Primary actor** | Builder; the Runner (an employee) proposes |
| **Scope** | Control plane (`/api/ideas/suggestions*`, `/internal/runs/{id}/suggestion-context`, `/internal/runs/{id}/suggestions`); the Runner |
| **Cascade level** | Organisation or division |
| **Status** | Built — the control plane and the Runner's `suggest` workflow |

## Goal

The system suggests new product ideas from what the organisation holds (spec, *Onboarding*) — one of
the four things the market research found nobody combines.

## Main flow

1. `POST /api/ideas/suggestions/estimate { scope }` → the most it can cost.
2. `POST /api/ideas/suggestions { scope }` → a `suggest` run, its estimate first in its log.
3. The Runner reads the suggestion context (products, ideas and their verdicts, the cascade's context,
   what was suggested before) and the ontology, and posts up to five suggestions, each with the gap it
   fills, why this organisation is placed to build it, and what it would reuse.
4. `GET /api/ideas/suggestions?scope=` lists them.
5. `POST /api/ideas/suggestions/{id}/take` turns one into an idea, which is researched like any other
   (its own estimate first); `POST …/dismiss` sets one aside.

## Alternate and failure flows

- **A1 — taken or dismissed already.** `409`.
- **A2 — more than five, or none.** The Runner's post is `400`; twice is `409`.

## Rules this use case must honour

- An estimate before work starts (rule 11). Tenant data is used within its organisation only (rule 2).

## Acceptance

- Start → context → record → list → take, with the estimate on the run and the idea's text carrying the gap, the reason and the reuse.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `BreadthTests.Ideas_are_suggested_from_the_portfolio…`; [`TEST-201`](../testing/TEST-201-harness-and-runner.md) — `WorkflowTests.A_suggest_run_…` (only new, complete ideas kept; one corrected attempt; recorded once) and `RunnerIntegrationTests.A_suggest_run_queued_by_the_owner_…` (the real control plane: queued, claimed, listed, taken).

## Links

- Spec *Layer 1 — Onboarding*, *Market research verdict* · ARCH-004 *The suggest run*.
