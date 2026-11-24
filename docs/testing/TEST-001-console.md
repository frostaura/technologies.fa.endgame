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

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/features/runs/runModel.test.ts` | Merging and deriving the run log; normal against technical wording. |
| Unit | `src/features/runs/useRunStream.test.ts` | Resume with `after=`, de-duplication, close on finish, giving up after six failures. |
| Component | `src/features/*/*View.test.tsx`, `src/App.test.tsx` | The four states of every screen; selection scoping; streamed replies and conversation history; optimistic rollback; confirmations; session routing; technical-mode gating; secrets (`secrets/SecretsView.test.tsx`), the operator log (`audit/OperatorAccessView.test.tsx`), sharing and unmeasured telemetry (`apps/AppView.test.tsx`). |
| Unit | `src/tokens.test.ts`, `src/components/iconNames.test.ts` | One token layer, contrast, the sprite and the typed names agree. |
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

Not yet run: the control-plane lane is implementing ARCH-004 alongside this lane. Every flow above
has run in a real browser against the mock, which implements the shapes in UC-001.

## States covered

Loading · loaded · empty (organisation with no divisions; nothing needing you; no tasks; no top-ups;
no estimates scored) · failed read · stale after a failed refresh · refused write rolled back.
