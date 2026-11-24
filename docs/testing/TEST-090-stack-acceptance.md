# TEST-090 — The merged stack, end to end

| Field | Value |
| --- | --- |
| **ID** | TEST-090 |
| **Covers** | UC-010 · UC-012 · UC-109 · UC-110 · UC-111 · ARCH-001 · ARCH-004 · ARCH-005 |
| **Status** | Current |

## What must be true

Every service, started together from a fresh database, does its part of one real story — through
the real Edge, with nothing mocked. `make e2e-stack` is the stack's acceptance test: it brings a
second stack up beside any `make up` stack (project `endgame-int`, its own host ports, subnet pool
and fresh volumes, `docker-compose.e2e.yml` on top), runs the story, runs the app kit's browser proof
against the same Edge, and always removes the stack and everything its Dock made.

| Step | Statement | Test (`src/frontend/tests-stack/acceptance.spec.ts`) |
| --- | --- | --- |
| 1 | The development sign-in works through the console. | `1. the development sign-in…` |
| 2 | An organisation (the first by its Owner; later ones by an operator), a division, a project and apps are created through the API. | `2. …` |
| 3 | Dock creates each app's repository from the kit's template; a probe is committed through a workspace (the Runner's way in); Dock builds and starts both apps. | `3. …` |
| 4 | Both address shapes serve the app through the real Edge. Private: signed out → the edge's sign-in page; a member gets in; a signed-in stranger gets 403; on the subdomain the member's session arrives by hand-off as a host-only `endgame.app.<id>` cookie. | `4. …` |
| 5 | A secret set at the organisation is read inside the app through the platform API (compared by hash), and never appears in a console read. | `5. …` |
| 6 | With a one-minute idle setting (time compressed) the app sleeps, and a request wakes it; the edge reports the wake. | `6. …` |
| 7 | An e-mail sent from the app arrives in the mail catcher, to the right address. | `7. …` |
| 8 | A schedule the app declared is called back, signed, through Edge's control listener. | `8. …` |
| 9 | A declared webhook reaches the private app with no session; a forged token is refused by the app; an undeclared hook is sent to sign in by the edge. | `9. …` |
| 10 | Telemetry from the app appears in `GET /api/apps/{id}`. | `10. …` |
| 11 | Hosting usage reported by Dock and Edge appears as credits (`month.hosting`), taking the balance below zero. | `11. …` (also screenshots the console's app and credits pages) |
| 12 | Made public by a person, the app opens signed out. | `12. …` |
| 13 | With the Owner's own overdraft narrowed to zero, the app is paused behind the holding page; an operator's top-up brings it back; the Owner reads the operator's actions. | `13. …` |
| — | The app kit's browser proof passes against the real Edge on an app built from the untouched template, desktop and phone. | `src/appkit/proof/edge.sh` (TEST-050) |

## Against the running system

Measured on the development Mac (Docker Desktop) on 2026-11-24, in the stack `endgame-int` beside
the running `endgame` stack:

- **Wake through the whole stack, edge-reported / client first byte (ms): 460/516, 431/487, 410/499**
  in one run and **427/511, 465/540, 448/510** in the next — about 0.15 s more than the Dock-and-Edge
  rig of TEST-010, because the request now also passes the real access check and the app kit's
  identity resolution.
- App builds from the template with warm caches: 11–14 s each; start 1 s.
- A schedule set to every minute was called back 30–46 s after the app started; e-mail reached the
  catcher within a second; telemetry for the first requests appeared within one 15 s metrics export.

## Defects it found in merged code, each now fixed and pinned by a unit test

| Defect | Fix | Test |
| --- | --- | --- |
| App addresses were fixed to `https://` with no port, so every local sign-in `returnTo` was refused and hand-off links pointed nowhere. | `Addresses:Scheme`, `Addresses:Port` | `PublicAddressTests` |
| `POST /api/apps/{id}/settings { idleMinutes }` was always refused (an `int` `JsonValue` read as not a number). | `CascadeService.NumberOf` | `AppSettingsTests` |
| The egress proxy cached peer addresses for hours: after a control-plane restart every app's platform calls went to another container. | `positive_dns_ttl 10 seconds` | `EgressConfigTests` |
| Edge propagated its own unsampled trace context, so apps recorded no server spans and telemetry stayed empty. | No trace context forwarded to apps | `EdgePipelineTests.No_trace_context_reaches_an_app…` |
| The console named a person's first organisation on another organisation's app, and showed "-0 credits". | App's own organisation; unsigned zero | `AppView.test`, `format.test` |

## Not covered here

Real passkeys in a browser (the identity pages are exercised with the development sign-in; passkey
ceremonies are covered against the real control plane by `AppAccessTests` and `SignInTests`); shared
apps with invitation codes end to end; a crash through the whole stack (TEST-010 covers it on the
Dock-and-Edge rig); HTTPS and the tunnel.
