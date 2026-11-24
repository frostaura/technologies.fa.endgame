# UC-107 — See an app and choose how it runs

| Field | Value |
| --- | --- |
| **ID** | UC-107 |
| **Title** | Read an app's health, addresses and cost; set it to sleep when idle or stay always on |
| **Primary actor** | Owner · Admin (access) · Builder (running) · Viewer (read); Dock and the edge report state |
| **Scope** | Control plane (`/api/apps/{id}`, `/api/apps/{id}/settings`, `/internal/apps/*`, `/internal/routes`) |
| **Cascade level** | `sleep.mode`, `sleep.idle_minutes` and `access` inherit down the cascade; set here, they apply to this app |
| **Status** | Built (control-plane side) |

## Main flow

1. `GET /api/apps/{id}` → `{ id, name, scope, health { state, summary }, running, addresses { path, subdomain }, telemetry, cost { monthCredits, capCredits }, settings { running: sleep|always-on, access }, runningCost, sharedWith, status, version, publishedAt, idleMinutes }`.
2. `POST /api/apps/{id}/settings { running?, access?, idleMinutes? }` → the updated app.
3. Dock reports `POST /internal/apps/{id}/published { version }` and `POST /internal/apps/{id}/state { status }`;
   the edge reads `GET /internal/routes` — every app's `pathBase` (`/<org>/<division>/<project>/<app>/`), `host`
   (`<org>.<domain>`), `hostPathBase`, `target` (`http://app-<id:N>:8080`), status, sleep setting and version.

## Alternate and failure flows

- **A1 — access.** `private`, `shared` or `public` need the Admin role; `public` is refused (403 `human_only`)
  to any agent or service — only a person signed in to the console can set it. The routing entry carries
  `access`, and Edge's access check enforces it ([UC-110](UC-110-app-access-and-end-users.md)).
- **A2 — telemetry and running cost.** Both come from measurements — the app's own telemetry and Dock's
  hosting samples — and are null until something was measured, never invented zeros.
- **A3 — paused.** When the organisation is past its overdraft limit, or a budget above the app is spent,
  `running` is `paused` and the summary says which ([UC-111](UC-111-metering-overdraft-and-god-mode.md)).

## Rules this use case must honour

- Go-public is a human act (rule 10). Sleep by default (spec).

## Acceptance

- Both addresses are absolute; a running choice made on the app shows in its routes entry with the level that set it.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `CascadeCreditsAndAppsTests`; [`TEST-102`](../testing/TEST-102-platform-api.md) — `AppAccessTests`, `PlatformApiTests`.
