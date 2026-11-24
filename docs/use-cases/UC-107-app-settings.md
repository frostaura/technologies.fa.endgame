# UC-107 — See an app and choose how it runs

| Field | Value |
| --- | --- |
| **ID** | UC-107 |
| **Title** | Read an app's health, addresses and cost; set it to sleep when idle or stay always on |
| **Primary actor** | Owner · Builder (change) · Viewer (read); Dock and the edge report state |
| **Scope** | Control plane (`/api/apps/{id}`, `/api/apps/{id}/settings`, `/internal/apps/*`, `/internal/routes`) |
| **Cascade level** | `sleep.mode` and `sleep.idle_minutes` inherit down the cascade; set here, they apply to this app |
| **Status** | Built (control-plane side) |

## Main flow

1. `GET /api/apps/{id}` → `{ id, name, scope, health { state, summary }, running, addresses { path, subdomain }, telemetry, cost { monthCredits, capCredits }, settings { running: sleep|always-on, access }, runningCost, sharedWith, status, version, publishedAt, idleMinutes }`.
2. `POST /api/apps/{id}/settings { running?, access?, idleMinutes? }` → the updated app.
3. Dock reports `POST /internal/apps/{id}/published { version }` and `POST /internal/apps/{id}/state { status }`;
   the edge reads `GET /internal/routes` — every app's `pathBase` (`/<org>/<division>/<project>/<app>/`), `host`
   (`<org>.<domain>`), `hostPathBase`, `target` (`http://app-<id:N>:8080`), status, sleep setting and version.

## Alternate and failure flows

- **A1 — shared or public access.** 422 `access_unavailable`: sharing and public apps are not enforced by this
  version, so they cannot be switched on (a setting nothing enforces would misstate who can open the app).
- **A2 — telemetry and running cost.** `telemetry` and `runningCost` are null — not measured by the control plane yet, never invented zeros.

## Rules this use case must honour

- Go-public is a human act (rule 10). Sleep by default (spec).

## Acceptance

- Both addresses are absolute; a running choice made on the app shows in its routes entry with the level that set it.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `CascadeCreditsAndAppsTests`.
