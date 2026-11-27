# TEST-050 — The app kit

| Field | Value |
| --- | --- |
| **ID** | TEST-050 |
| **Covers** | UC-050 · ARCH-004 (The app kit) · ARCH-005 (Addresses) |
| **Status** | Current |

## What must be true

1. One image serves the app under a path base and at a host root: deep-link reload, client routing, lazy chunks, API read and write, sign-in redirect.
2. The page's `<base href>` is rewritten per request from `X-Forwarded-Prefix`; the page is never served by default-file handling; a missing asset is a 404, never the page.
3. An endpoint without an operation id or description, or outside the `api` group, stops start-up with the fix.
4. Request bodies are validated before the handler, with field-by-field 400s.
5. Identity comes from the platform-validated session; signed-out API calls get 401 with `signInUrl`; browsers are redirected.
6. Models, secrets, email, schedules, webhooks and events behave per `src/appkit/PLATFORM-API.md`, including the error codes.
7. Traces, metrics and logs reach the platform collector; every platform call goes out through the egress proxy.
8. Front-end reads distinguish loading, failed, empty and loaded; a URL starting with "/" fails lint.
9. After a successful write through `api()`, every mounted read re-reads without flashing to loading; a failed re-read shows as failed; a read or a failed write re-reads nothing.
10. Reading the address from `window.location` fails lint (navigations away stay allowed); a click on a link between pages shows the page it routes to, under a path prefix too.
11. The template carries the test-id convention in `template/AGENTS.md`, and its tests select by those ids.
12. An app's own tests hold it to the security review's checklist and to its own document (`AppChecks`, run by the
    template's `AppRulesTests`): every endpoint that takes the signed-in person requires sign-in (only the kit's
    `getCurrentUser` takes an optional user), and `docs/app.md`'s table names every endpoint with "Signed in?" Yes or No
    exactly as the code has it. The template's own example — reading whether you follow a note — requires sign-in, and
    how many follow is on the note (R6-5, R6-6).
13. A page that throws while it renders never blanks the app: the kit's `AppErrorBoundary` (at the root and around the
    routed page in the template) shows "Something went wrong on this page" with "Try again" and "Back to the start" in
    the `FailedState` look, keeps the header, starts afresh when the address changes, and reports the error once to the
    console — the web side of the kit has no telemetry of its own (R7-1).
14. Dates and numbers never throw: `formatDate`, `formatDateTime` and `formatNumber` answer a stated fallback for an invalid
    or out-of-range value (a six-digit year, 31 February, NaN), `checkDateInput` / `checkNumberInput` give a field error for
    what a person typed past an input's `min` and `max`, and `endgame/no-unsafe-format` fails `toLocale*String` and `Intl`'s
    formatters in an app. The template's date field carries `min`/`max`, is checked on submit and again by the server.
15. `holdsUpAgainstBadInput` (`/testing`, titled with `BAD_INPUT_TEST`) fails a page that breaks on a bad value — the built
    app's fragile "Add a dive", which blanked on a six-digit year, inside the boundary too — and one that stays up but never
    refuses the value beside the field, and passes a page whose bounded fields are checked on submit. The template has one
    per form field; the factory's gate runs them (ARCH-006, "A form holds up against bad input").
16. A field marked wrong on a failed submit stops being marked wrong (no `aria-invalid`, no message, the field's own edge)
    as soon as the person changes it, while the fields they have not touched stay marked; a failed submit puts the focus on
    the first wrong field; the server's field errors match the field's `name` in any case (`useFormErrors`).
17. On a phone the app's header is two rows at most 112 px tall: the app's name (cut short if long) beside a 44 px avatar
    button that opens the person's name and "Sign out" (Escape closes it and returns the focus), then the places on one
    line, each at least 44 px; the page never scrolls sideways. A tablet or desktop keeps the one-row header.

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit + integration (.NET, 66) | `src/appkit/sdk-dotnet/Endgame.AppKit.Tests` | 2–7 and 12 (`AppChecksTests`), against a real PostgreSQL and the in-memory dev platform |
| Unit (web SDK, 163) | `src/appkit/sdk-web/src/**/*.test.ts(x)` | `api()`/errors, router base, sign-in URLs, hooks' three states, 9 (two reads re-read after one write), the ESLint rules (RuleTester), `renderApp` (10), token layer, 13 (`error-boundary.test.tsx`), 14 (`format.test.ts`, the `no-unsafe-format` RuleTester), 15 (`badInput.test.tsx`), 16 (`form.test.tsx`), 17's avatar menu and the long name cut short (`layout.test.tsx`) |
| Template (.NET, 21) | `src/appkit/template/api.tests` | Notes API end to end; a person's own record (`NoteFollowTests`); 12 (`AppRulesTests`); pages under a prefix; health; OpenAPI ids |
| Template (web, 37) | `src/appkit/template/web/src/**/*.test.ts(x)` | 8, 10, 11 — each page's states by test id; navigation by clicking through the real app (`App.test.tsx`); both lint rules are wired into the app's config; 13 on the real app (`PageErrors.test.tsx`); 14 on its date field (`NewNotePage.test.tsx`, the lint rule wired in `addresses.test.ts`), 15 on each of its form's fields, 16 on its form (`NewNotePage.test.tsx`) |
| Browser proof (14 + 2 skipped) | `src/appkit/proof` (`make -C src/appkit proof`) | 1 and 7 on the real image, desktop and phone, through the dev edge, at four-segment addresses (`/acme/labs/demo/notes/`, `acme.localhost/labs/demo/notes/`); 16 at both sizes and 17 on the phone (`look.spec.ts`), with the app named "Dive Club Lost and Found" by the edge. With `PW_SCREENSHOTS=<dir>` it saves the list, the corrected form and a note at 375, 768, 1512 and 1920 px. |
| Browser proof, real Edge (8 + 7 skipped) | `src/appkit/proof/edge.sh` (run by `make e2e-stack`) | 1 on an app Dock built from the untouched template, through the real stack's Edge: the edge's own sign-in page with the development sign-in, and on the subdomain the hand-off. 7 is the dev platform's state view, so it is skipped there, as is `look.spec.ts`, which signs in through the dev platform's page; `TEST-090` checks telemetry in the real control plane. |

## Fixture variation

- Contract checks: the same app with `.WithName` or `.WithDescription` removed fails start-up (ApiContractTests); with them it starts.
- App checks: the template's `AppRulesTests` failed on the template before R6-5 (its follow read took `EndgameUser?`, and
  its document said "To follow"); one endpoint changed from `EndgameUser` to `EndgameUser?`, or one "Yes" turned to "No"
  in `docs/app.md`, fails it again (AppChecksTests).
- Base rewrite: the same index served with prefix `null`, `/acme/labs/demo` and `/acme/labs/demo/` yields `/`, `/acme/labs/demo/`, `/acme/labs/demo/` (HostingTests).
- Signature: changing the key, the body or the clock by 6 minutes each fails verification.
- Reads after a write: the test that two mounted reads both re-read after one `PATCH` failed on the kit before the change (each read only once per mount); the same write answered `400` re-reads nothing.
- Proof: the first run failed on the path form because client navigation home writes the prefix without its trailing slash — the test caught it; the expectation now also reloads there through Edge's redirect.

## Against the running system

`proof/run.sh` builds the template with `dotnet publish /t:PublishContainer`, runs it read-only with
all capabilities dropped on an internal network with its own PostgreSQL and the dev platform, and
drives Chromium at both shapes. All Docker resources are `test-appkit-*` and removed on exit.
