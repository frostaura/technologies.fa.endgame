# UC-050 — Build an app on the app kit

| Field | Value |
| --- | --- |
| **ID** | UC-050 |
| **Title** | Start a new app from the template and run it at both addresses |
| **Primary actor** | employee (agent) building an app; app end user using it |
| **Scope** | Dock (repository, build, run) · Edge (routing, identity) · Control plane (platform API) |
| **Cascade level** | App — secrets, budgets and identity resolve from the app's place in the cascade |
| **Status** | Built (kit, template, dev platform); the real platform side is the Dock and control-plane lanes' |

## Goal

An agent starts every app from one template and writes code against one small library, so the
right thing is the easy thing and a wrong thing fails loudly at build or start with its fix.

## Preconditions

- The kit is vendored into the template (`make -C src/appkit vendor`).
- Dock injects the environment in `src/appkit/PLATFORM-API.md` §1.

## Main flow

1. Dock creates the app's repository from `src/appkit/template/` (with `vendor/`).
2. The builder reads `AGENTS.md`, adds features on the `api` group with operation ids and
   descriptions, pages that keep loading / failed / empty / loaded distinct and carry the kit's
   test ids (`page-<view>`, `<entity>-item`, `new-<entity>`, `save-<entity>`, …), a navigation test
   for each link between pages, and migrations.
3. `make lint` and `make test` pass with zero warnings.
4. Dock builds the image with `dotnet publish /t:PublishContainer` and runs it.
5. Edge serves the same container at `/<org>/<division>/<project>/` and at `<org>`'s subdomain.
6. An end user reads, signs in through the platform's pages under the app's address, and writes.

## Alternate and failure flows

- **A1 — endpoint without operation id or description:** the app does not start; the message names the endpoint and the line to add.
- **A2 — URL starting with "/" in the front end:** ESLint fails; `api("/x")` throws with the fix at runtime.
- **A3 — front end built with absolute asset URLs or a CDN:** the app does not start, naming the offending tag.
- **A4 — missing environment:** the app does not start; one message lists every missing variable.
- **A5 — credit budget spent:** model calls throw `EndgameBudgetExhaustedException`; unhandled, the API answers `402` with `code: budget_exhausted`.
- **A6 — failed read:** the front end shows a failure with "Try again", never the empty state.
- **A7 — a write changes what other reads on screen show:** every mounted `useApiQuery` re-reads after the write succeeds, keeping its data shown meanwhile; a failed re-read shows as failed.
- **A8 — page reads the address from `window.location`:** ESLint (`endgame/no-location-read`) fails, naming the router hook to use; such a page would not appear when a link routes to it.

## Postconditions

- The app's schema is migrated; its schedules and webhooks are declared to the platform; traces,
  metrics, logs and product events flow to the platform's intake through the egress proxy.

## Rules this use case must honour

- One token layer; no placeholders; no secret in code; only Dock touches Docker; apps reach the
  outside only through the egress proxy.

## Acceptance

- Each statement in `docs/testing/TEST-050-app-kit.md`.

## Links

- `docs/specs/endgame-spec.md` (Layer 3) · ARCH-004 (The app kit) · ARCH-005 (Addresses) · `src/appkit/PLATFORM-API.md`
