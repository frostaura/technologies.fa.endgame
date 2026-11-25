# UC-118 — See an app's versions, restore one, and take the app away

| Field | Value |
| --- | --- |
| **ID** | UC-118 |
| **Title** | Read an app's history, restore an earlier version, and export code, history and data |
| **Primary actor** | Viewer (history) · Builder (restore) · Owner (export) |
| **Scope** | Control plane (`/api/apps/{id}/versions*`, `/api/apps/{id}/export`), proxied to Dock |
| **Cascade level** | App |
| **Status** | Built, the data dump included (Dock's `GET /internal/apps/{id}/database/dump`, `pg_dump` 16) |

## Goal

Code lives inside Endgame and can always leave (spec, *Layer 2*): every change attributable, any
version restorable, the whole app downloadable by its Owner at no cost.

## Main flow

1. `GET /api/apps/{id}/versions` → each change with its author (`employee`, `person` or `factory`, named),
   message and time, and which one is live.
2. `POST /api/apps/{id}/versions/{commit}/restore` → the earlier code becomes the newest version as a new
   commit by the person (history is never rewritten), is rebuilt and restarted. A public app becomes
   private (`madePrivate: true`): a person looks at a restored version before it is public again.
3. `GET /api/apps/{id}/export` → `<app>-export.tar.gz`: `manifest.json`, `code.bundle` (git, every
   version), `database.dump` (the app's own database) and `platform.json` (its end users without
   passkeys, shares, schedules, webhooks, custom events). Secrets are never exported.

## Alternate and failure flows

- **A1 — the rebuild fails.** The restore stands; `published: false` and `publishError` say why; publishing can be retried.
- **A2 — an app that never ran.** No `database.dump`; the manifest says so.
- **A3 — hosting does not answer.** `502 dock_unavailable`.
- **A4 — not the Owner.** Export is `403`, an operator in God mode included.

## Rules this use case must honour

- Go-public is a human act (rule 10). Normal mode names no infrastructure (rule 12): the console says "version", not "commit".

## Acceptance

- Authors are named; the live version is marked; a restore is the person's commit, then build, then start; the archive holds the four parts.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `VersionsAndExportTests`; [`TEST-010`](../testing/TEST-010-hosting.md) — `HostingIntegrationTests.The_control_plane_takes_an_apps_own_database_as_a_pg_dump_archive…` (the control plane's Dock client against a real Dock; `pg_restore` reads the archive back). The Owner's whole export of a factory-built app on a running stack is in the acceptance run (`TEST-201`).

## Links

- Spec *Layer 2 — code lives inside Endgame* · ARCH-004 *Versions and export*, *Dock*.
