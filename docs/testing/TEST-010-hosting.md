# TEST-010 — Hosting: Dock, Edge and the egress proxy

| Field | Value |
| --- | --- |
| **ID** | TEST-010 |
| **Covers** | UC-010 · UC-011 · UC-012 · ARCH-004 (Dock's API, the routing table) · ARCH-005 |
| **Status** | Current |

## What must be true

| Statement | Test |
| --- | --- |
| Both address shapes serve one image, with the right base, prefix and host; visitor-sent forwarded and `X-Endgame-*` headers never reach an app | `EdgePipelineTests` (path form, subdomain prefix, subdomain root) · `HostingIntegrationTests.The_app_is_served_at_both_address_shapes_from_one_image` |
| An address without its trailing slash is answered `308` | `EdgePipelineTests.A_project_path_without_its_trailing_slash_is_redirected` · integration, both shapes |
| `/internal/*` is never routed from outside; the control listener proxies nothing and is unreachable from apps | `EdgePipelineTests.Internal_paths_…`, `…control_listener_requires_the_service_token_and_proxies_nothing` · `An_app_cannot_reach_the_edges_control_listener_or_dock` |
| `_platform/*` is never routed; `hooks/*` reach a private app; `_endgame/auth/*` is the edge's, with `returnTo` kept inside the app | `EdgePipelineTests` (three tests) · the template test |
| Private and shared apps: no session → sign-in; outsider → 403; check unavailable → closed; member → app-scoped `X-Endgame-Session`, never the cookie | `EdgePipelineTests` (five tests) |
| One wake per app however many requests; a crash fails every waiter at once; the sweeper never stops an app serving; each app sleeps by its own setting | `AppRuntimeTests` · `Concurrent_requests_to_a_sleeping_app_share_one_wake` · `An_idle_app_sleeps_by_its_own_setting…` |
| A crash gets the unavailable page within two seconds, is reported, and the app wakes again after the back-off | `A_crash_gets_the_unavailable_page_at_once_is_reported_and_recovers` |
| Unavailable pages name no infrastructure and carry the mark | `UnavailablePageTests` |
| Repositories keep every version; restore adds a commit; archive and export work | `A_repository_keeps_every_version…` |
| Workspaces: employee as author; a moved branch is a conflict, nothing lost; the path floor holds against `..`, `.git` and symbolic links; non-root, limits, no socket, zero capabilities; registries only; timeouts and head-and-tail output; lease lapse destroys | five workspace tests · `WorkspacePathsTests` · `OutputCaptureTests` |
| Apps run hardened on their own internal /28, Dock never on it | `App_containers_run_with_every_hardening_rule_of_ARCH_005` · `SubnetAllocatorTests` |
| Egress is default-deny, per app by subnet, changeable without a restart; apps reach the platform API only through it | `Egress_is_denied_by_default_and_allowed_per_app_by_subnet` · `EgressRulesTests` |
| Apps cannot open each other's databases or the platform's | `Apps_cannot_read_each_others_data_or_the_platforms` · `OpaqueNamesTests` |
| The app kit's template, written through a workspace, builds with its own publish path, runs, is served at both shapes, and resolves a member's session through the platform | `The_app_kit_template_is_committed_built_and_served_at_both_shapes_with_its_sessions` |

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/backend/Endgame.Tests/Hosting/DockPolicyTests.cs`, `EdgeRoutingTests.cs`, `AppRuntimeTests.cs` | Dock's pure policy (compiled in by file — no Docker client in the tests), route validation, proxy config, wake coordination. |
| Integration, in process | `EdgePipelineTests.cs` | The edge's whole pipeline on real sockets against a fake control plane, a fake Dock and an echo app. |
| Integration, real Docker | `HostingIntegrationTests.cs` (trait `Category=Docker`) | PostgreSQL, the egress proxy, Dock (with the socket) and Edge built from this repository and run as `test-endgame-*`; the control plane faked in the test process. |

`make test` runs all of them. The real-Docker tests are reported **SKIPPED with the reason** when no
engine answers or `ENDGAME_SKIP_DOCKER_TESTS=1`; the template test also when
`src/appkit/template/vendor/` is empty (`make -C src/appkit vendor`). Every resource is named
`test-endgame-*` and removed at the end; `ENDGAME_TEST_KEEP_DOCKER=1` keeps them for debugging.
Only the dedicated pool `10.214.0.0/16` is used for test subnets.

## Fixture variation

- Remove the platform cookie name from `Edge:PlatformCookies` → the cookie assertion in the path
  form test fails (the app sees `endgame_session`).
- Gate control endpoints by `Host` instead of the local port → the integration suite's route
  refreshes and crash pushes silently fall through to the console. This was a real defect, found
  by the real-Docker run (published ports rewrite `Host`) and fixed; the pipeline test now sends a
  rewritten `Host` to pin it.
- Join peers to app networks without a negative gateway priority, or leave the proxy IPv6-capable
  on Docker Desktop → platform calls through the proxy fail (`503`); both are now set.

## Against the running system

Measured on the development Mac (Docker Desktop, 10 CPUs, about 8 GB) on 2026-11-24, real Docker:

- **Wake, first byte through the edge, 10 wakes: median 226 ms, worst 239 ms** (best 201 ms) in
  the integration suite alone; **median 263 ms, worst 268 ms** inside the full `make test`, with the
  rest of the backend suite running alongside. ARCH-005's spike measured about 300 ms.
- First build of the fixture app 4.9 s (warm caches; image 182 MB); the app kit's template, written
  through a workspace and built with its own publish path, 23 s.
- Workspace image prepared by Dock in about 31 s with warm layer caches.

## States covered

Awake · asleep and woken · crashed and backed off · paused · unpublished · no capacity (unit) ·
access check unavailable · control plane unreachable for routes (last table kept).
