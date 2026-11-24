# UC-104 — Describe an idea and decide on its verdict

| Field | Value |
| --- | --- |
| **ID** | UC-104 |
| **Title** | See the research estimate, start research, and build, change, overrule or drop on the verdict |
| **Primary actor** | Owner · Builder; the Runner (employee) reports the verdict |
| **Scope** | Control plane (`/api/ideas*`, `/internal/ideas/{id}/verdict`); research itself runs in the Runner |
| **Cascade level** | Organisation or division |
| **Status** | Built (control-plane side) |

## Goal

An idea is researched before anything is built, at a cost shown first, and the owner — not the system —
decides what happens after a verdict that is allowed to say no.

## Main flow

1. `POST /api/ideas/estimate { text, constraints[] }` → `{ credits, basis }`. Free, and works before an
   organisation exists. It is the gateway's own reservation arithmetic on the `research` route for
   `Estimates:ResearchCalls` calls, so research cannot cost more.
2. `POST /api/ideas { text, constraints[], scope? }` → 201 `Idea`; the research run is queued with the owner's
   message and an `estimate.made { credits }` event. `scope` defaults to the caller's organisation.
3. The Runner researches and posts the verdict document to `/internal/ideas/{id}/verdict`
   (`outcome` build | change | do-not-build, `headline`, `summary`, `existing[]`, `gap[]`, `demand`, `wouldChange`, `method`).
4. The idea appears in `GET /api/tree` → `needsYou[]` as `{ kind: "verdict", ... }`.
5. `POST /api/ideas/{id}/decision { choice, note? }` → the updated `Idea`. `build` or `overrule` queues a build
   run (`decision.runId`); `change` runs the research again; `drop` ends it.

## Alternate and failure flows

- **A1 — build over a "do-not-build".** 409, saying it takes an explicit overrule; the overrule is recorded
  (`decision.overruled`) and counted in the organisation's `record.overruled[]`.
- **A2 — deciding before a verdict.** 409.
- **A3 — no research route configured.** 503 `estimate_unavailable`; research cannot start.
- **A4 — no organisation yet.** `POST /api/ideas` is 409 `no_organisation`.

## Postconditions

- `ideas` row with `research_estimate_credits`; research and build runs linked by `idea_id`.

## Rules this use case must honour

- An estimate is shown before work starts (rule 11). The verdict can stop a build; its "no" rate is measured (spec, *Layer 2*).

## Acceptance

- The idea → verdict → overrule path, its record and its `needsYou` entry, as above; `change` and `drop` as above.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `IdeasAndConversationsTests`.

## Links

- Spec *Layer 2 — the factory* · ARCH-004 *Ideas* · UC-001 (console) for the screens.
