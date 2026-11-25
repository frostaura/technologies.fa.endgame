# TEST-001 — The console

| Field | Value |
| --- | --- |
| **ID** | TEST-001 |
| **Covers** | UC-001 · ARCH-004 (public API, run log) |
| **Status** | Current |

## What must be true

- Every screen distinguishes loading, empty, loaded and failed; a failed read is never an empty list.
- The run stream resumes after a drop without losing or repeating a step, and stops once finished.
- Normal mode never names infrastructure; technical mode shows models, tools, rules and raw events.
- An estimate is shown before research can start; research cannot start without one.
- Overrule and go-public need an explicit human confirmation; an overrule is shown as one.
- A figure the app has not measured reads "not measured yet", never zero.
- A secret's value and an invitation code never enter the store, and a value is never shown.
- The conversation survives a reload without drawing a turn twice.
- The header is at most two rows on a phone (375 and 412 px) and keeps the toggle, balance and sign-out.
- Optimistic changes roll back on refusal with the reason on the page.
- No screen scrolls sideways at desktop or phone width; nothing animates under reduced motion.
- No raw colour outside the token layer; every icon in the sprite is typed.
- An answer in an unexpected shape is a failed read naming the field; a crash is a branded failure with a
  way back, never a blank page.
- The verdict page reads the agreed verdict document; overrule is never offered over a red line or a
  change verdict, and a change is sent with what should change.
- The run view in normal mode shows no payload, model, tool argument or rule; sub-agents are grouped under
  their titles; actions are tool calls plus contractors briefed.
- The workforce, hiring and autonomy screens show where every value was set, and roll back refused changes.

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/features/runs/runModel.test.ts` | Merging and deriving the run log; normal against technical wording. |
| Unit | `src/features/runs/useRunStream.test.ts` | Resume with `after=`, de-duplication, close on finish, giving up after six failures. |
| Component | `src/features/*/*View.test.tsx`, `src/App.test.tsx` | The four states of every screen; selection scoping; streamed replies and conversation history; optimistic rollback; confirmations; session routing; technical-mode gating; secrets (`secrets/SecretsView.test.tsx`), the operator log (`audit/OperatorAccessView.test.tsx`), sharing and unmeasured telemetry (`apps/AppView.test.tsx`). |
| Unit | `src/tokens.test.ts`, `src/components/iconNames.test.ts` | One token layer, contrast, the sprite and the typed names agree. |
| Unit | `src/lib/guards.test.ts` | Guards name the faulty path, keep unknown fields, default fields older stacks omit; every endpoint guard reads the control plane's real shapes. |
| Unit | `src/features/runs/timeline.test.ts` | The plain run view: messages as written, milestones once, sub-agents titled with outcomes, tool work summarised, refused actions not counted as done, accurate action counts; technical mode raw. |
| Unit | `src/features/home/OntologyView.test.tsx`, `src/features/credits/creditsModel.test.ts` | The graph layout ends on cycles; the four states of both graph views; the credits pace never says "about 0 months". |
| Component | `src/components/ErrorBoundary.test.tsx`, `src/features/verdict/VerdictView.test.tsx`, `src/features/workforce/*.test.tsx`, `src/features/autonomy/AutonomyView.test.tsx` | A crash's branded failure; the verdict document (old and agreed shapes), red line, change note; the employee, hire and autonomy screens' four states, optimistic changes and rollbacks, plain against technical wording. |
| End to end | `tests-e2e/workforce.spec.ts` against the mock | The verdict page, the plain run view, workers and needs-you on the chart, both graph views, the employee conversation, the employee screen (memory, review, pause, budget, let go, refusals), hire accept / edit / decline and a recurring role proposed, autonomy and rule sets with their origin, refusals and a read-only Viewer — on desktop and phone. |
| End to end | `tests-e2e/console.spec.ts` against `tests-e2e/mock-api/` (test only) | Sign-in (development and a real passkey via a virtual authenticator), home, first run to verdict to overrule, inline approval, pause and resume, app settings and rollback, go-public confirmation, sharing with a one-time code, an unmeasured app, secrets set / inherited / removed and refused, the operator log and its refusal, conversation history across a reload, the two-row phone header, credits, sideways scroll and reduced motion — on desktop and phone. |
| End to end | `tests-e2e/smoke.spec.ts` with `PW_BASE_URL` (`make e2e`) | The real stack through the edge. |

Commands: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test -- --run`,
`CI=1 PW_PORT=<free port> npm run test:e2e` (starts the mock on `PW_PORT + 1` and Vite on `PW_PORT`).

## Fixture variation

- `useRunStream`: an event repeated across a reconnect is dropped — remove the de-duplication in
  `mergeEvents` and the "resumes" test fails on `[1, 2, 2, 3]`.
- `parseEvent`: an empty `id:` line once parsed as sequence 0 — caught by the `"{}"` case.
- Home counts: the employee count is derived from the tree; set the fixture worker's `kind` to
  `contractor` and the org-chart test fails (the employee chip and the count both depend on it; checked).

- Conversation history: drop the filter that leaves out turns already drawn from a live run and the
  "does not draw a turn twice" component test fails (checked).
- Secrets: the refused-write test holds the request open, so it proves the name was listed before the
  answer and taken back after it.

## Against the running system

The shapes the mock serves were read from a running stack (`/api/me`, `/api/tree`, `/api/credits`,
`/api/ideas/{id}` with a real stored verdict, `/api/runs/{id}/events` of a finished research run) and,
where that stack was older than the branch, from the control plane's code (`Endgame.Infrastructure/Work/*`,
`FactoryEndpoints.cs`) and the agreed verdict document in ARCH-004. The workforce, hiring, autonomy and
ontology screens have not yet run against a live control plane that serves those endpoints.

## States covered

Loading · loaded · empty (organisation with no divisions; nothing needing you; no tasks; no top-ups;
no estimates scored) · failed read · stale after a failed refresh · refused write rolled back.
