# UC-104 — Describe an idea and decide on its verdict

| Field | Value |
| --- | --- |
| **ID** | UC-104 |
| **Title** | See the research estimate, start research, and build, change, overrule or drop on the verdict |
| **Primary actor** | Owner · Builder; the Runner (employee) reports the verdict, and decides for auto-mode after a build verdict |
| **Scope** | Control plane (`/api/ideas*`, `/internal/ideas`, `/internal/ideas/{id}/verdict`, `/internal/ideas/{id}/decision`); research itself runs in the Runner |
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
   — exactly the document ARCH-004 defines (*The verdict document*); anything else is `400 verdict_invalid` with every fault.
4. The idea appears in `GET /api/tree` → `needsYou[]` as `{ kind: "verdict", ... }`.
5. `POST /api/ideas/{id}/decision { choice, note? }` → the updated `Idea`. `build` or `overrule` queues a build
   run (`decision.runId`); `change` runs the research again; `drop` ends it. `decision.via` is `person`.
6. **Auto-mode.** After a build or change verdict, where autonomy at the idea's scope is auto, the Runner calls
   `POST /internal/ideas/{id}/decision { decision: "build", by: "auto-mode" }` → `{ idea, run }`; `decision.via` and
   `decision.by` read `auto-mode`.
7. The conversation may start research on the owner's confirmed word: `POST /internal/ideas { scope, text, constraints[] }`
   → `{ idea, run, estimate }`, proposed to the division the scope sits in.

## Alternate and failure flows

- **A1 — build over a "do-not-build".** 409, saying it takes an explicit overrule; the overrule is recorded
  (`decision.overruled`) and counted in the organisation's `record.overruled[]`.
- **A2 — deciding before a verdict.** 409.
- **A3 — no research route configured.** 503 `estimate_unavailable`; research cannot start.
- **A4 — no organisation yet.** `POST /api/ideas` is 409 `no_organisation`.
- **A7 — a malformed verdict.** `400 verdict_invalid`, `errors[]` one line per fault; nothing is recorded and the idea stays
  under research.
- **A5 — a breached red line.** A verdict whose `redLines { breached: true, line }` is recorded as the idea's `redLine`;
  `build` and `overrule` are then `403 red_line` for everyone, a person included (CLAUDE.md rule 4); `change` and `drop`
  remain. A verdict that names a breached red line and says anything but do-not-build is `400`.
- **A6 — auto-mode on a do-not-build, or where checkpoints are on.** `409 owner_decision_required`: the owner decides.
- **A8 — a new verdict after "change".** The new verdict clears the decision that led to it, so the owner decides again;
  the earlier decision is kept in `history[]` (choice, the owner's note, who, when, the research that followed).
- **A9 — building with the agreed change.** Every change the owner asked for goes to the build as the owner message's
  `changes[]`, and the planner holds the app to the idea plus those changes. On a `change` verdict, `build` with
  `applyChange: true` adds research's `suggestedChange` too (`409` on any other verdict); auto-mode does so on its own and
  says so ("Auto-mode is building it now, with research's change applied: …").
- **A10 — research that did not finish, or a stopped build.** `tryAgain { runId, what, why }` names it; UC-105 A6 starts
  it again.

## Postconditions

- `ideas` row with `research_estimate_credits`, `decided_via` and `red_line`; research and build runs linked by `idea_id`.

## Rules this use case must honour

- An estimate is shown before work starts (rule 11). The verdict can stop a build; its "no" rate is measured (spec, *Layer 2*).

## Acceptance

- The idea → verdict → overrule path, its record and its `needsYou` entry, as above; `change` and `drop` as above.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `IdeasAndConversationsTests`, `RunnerContractTests` (auto-mode, red line, the conversation's idea).

## In the console

The start screen sends the chosen `scope` (the organisation or a division) with both `POST /api/ideas/estimate`
and `POST /api/ideas`, so the estimate shown is the one recorded; it refuses below Builder with the reason, and
says what the autonomy at that scope will do after the verdict.

## Links

- Spec *Layer 2 — the factory* · ARCH-004 *Ideas* · UC-001 (console) for the screens.
