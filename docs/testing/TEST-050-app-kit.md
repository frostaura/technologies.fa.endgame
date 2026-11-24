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

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit + integration (.NET, 48) | `src/appkit/sdk-dotnet/Endgame.AppKit.Tests` | 2–7, against a real PostgreSQL and the in-memory dev platform |
| Unit (web SDK, 54) | `src/appkit/sdk-web/src/**/*.test.ts(x)` | `api()`/errors, router base, sign-in URLs, hooks' three states, the ESLint rule (RuleTester), token layer |
| Template (.NET, 10) | `src/appkit/template/api.tests` | Notes API end to end; pages under a prefix; health; OpenAPI ids |
| Template (web, 13) | `src/appkit/template/web/src/**/*.test.ts(x)` | 8 — each page's states; the lint rule is wired into the app's config |
| Browser proof (10) | `src/appkit/proof` (`make -C src/appkit proof`) | 1 and 7 on the real image, desktop and phone, through the dev edge, at four-segment addresses (`/acme/labs/demo/notes/`, `acme.localhost/labs/demo/notes/`) |
| Browser proof, real Edge (8 + 1 skipped) | `src/appkit/proof/edge.sh` (run by `make e2e-stack`) | 1 on an app Dock built from the untouched template, through the real stack's Edge: the edge's own sign-in page with the development sign-in, and on the subdomain the hand-off. 7 is the dev platform's state view, so it is skipped there; `TEST-090` checks telemetry in the real control plane. |

## Fixture variation

- Contract checks: the same app with `.WithName` or `.WithDescription` removed fails start-up (ApiContractTests); with them it starts.
- Base rewrite: the same index served with prefix `null`, `/acme/labs/demo` and `/acme/labs/demo/` yields `/`, `/acme/labs/demo/`, `/acme/labs/demo/` (HostingTests).
- Signature: changing the key, the body or the clock by 6 minutes each fails verification.
- Proof: the first run failed on the path form because client navigation home writes the prefix without its trailing slash — the test caught it; the expectation now also reloads there through Edge's redirect.

## Against the running system

`proof/run.sh` builds the template with `dotnet publish /t:PublishContainer`, runs it read-only with
all capabilities dropped on an internal network with its own PostgreSQL and the dev platform, and
drives Chromium at both shapes. All Docker resources are `test-appkit-*` and removed on exit.
