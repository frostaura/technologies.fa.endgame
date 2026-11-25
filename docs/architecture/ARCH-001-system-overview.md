# ARCH-001 — System overview: the services as built

| Field | Value |
| --- | --- |
| **ID** | ARCH-001 |
| **Title** | System overview |
| **Status** | Current — after the wiring lane (Dock's data dump, Edge's app calls, the Runner's suggest run, the evaluator's signed-in checks); the control plane after its fourth pass (MCP, asking about an app, versions and export, members, God mode, notifications, ideas from the portfolio, prices at runtime), with Dock, Edge, Ops and the app kit merged and integrated (the stack's acceptance test, `make e2e-stack`) |
| **Covers** | Every service in `docker-compose.yml` and `docker-compose.prod.yml`; the backend projects under `src/backend/`; the console under `src/frontend/`; the app kit under `src/appkit/` |

## Context

The build plan ([`../specs/endgame-build-plan.md`](../specs/endgame-build-plan.md), *What runs*)
names eight services. This document records what each one **is in the code**, and the boundaries
enforced. Contracts between them are in [`ARCH-004`](ARCH-004-service-contracts.md); hosting rules
in [`ARCH-005`](ARCH-005-hosting-apps.md); the model gateway in [`ARCH-003`](ARCH-003-model-gateway.md).
What is deployed is in `MEMORY.md`.

## The services

| # | Service | Built as | What it does | Boundary |
| --- | --- | --- | --- | --- |
| 1 | **Edge** | `Endgame.Edge` — ASP.NET Core + YARP | The single entry point. `/api/*` to the control plane, apps at both address shapes (four segments: `/<org>/<division>/<project>/<app>/` and `<org>.<domain>/<division>/<project>/<app>/`), the console otherwise. Wakes sleeping apps through Dock, asks the control plane who may open an app (and decides nothing itself), serves the holding page for paused apps, the organisation's identity pages and the session hand-off, and counts each app's requests as hosting usage. A control listener on `:8081` that apps cannot reach: route refreshes, crash reports, signed schedule callbacks forwarded to apps, the evaluator's probe, and the control plane's calls into an app's own API (per-app MCP and the evaluator's signed-in calls). | The only service published to the host. |
| 2 | **Control plane** | `Endgame.ControlPlane` over `Endgame.Application`, `Endgame.Infrastructure`, `Endgame.Domain` | The tree and cascade, passkey sign-in, members and invitations, the credit ledger with reservations and hosting charges, the model gateway, runs, events, tasks, ideas and verdicts, conversations, God mode with its audit log, and the **platform API for apps**: app tokens, identity (members and app end users, access checks, hand-offs), the vault, the e-mail outbox and SMTP sender, the scheduler, webhook declarations, telemetry intake and its read side. **MCP** at `/mcp` (the organisation's capabilities as tools) and `/mcp/apps/{id}` (each app's own API, derived from its OpenAPI document), by personal access token; **asking about an app** (a model-written, triple-fenced query over one app's telemetry views) and saved dashboards; an app's **version history, restore and export**, through Dock; members and role changes; God mode's overview, overdraft and top-up requests; the owner's **notifications**; **ideas from the portfolio** (the `suggest` run); **prices** as one runtime settings document. A sweep releases lapsed reservations, requeues lapsed runs and prunes telemetry; another derives notifications. | The only service with a database connection string, the OpenRouter key and the SMTP settings. |
| 3 | **Runner** | `Endgame.Runner` over `Endgame.Harness` | Claims runs from the control plane under a lease and works them with Endgame's own harness — research, build, review, conversation and suggest workflows — with tools that execute in Dock's workspaces ([`ARCH-006`](ARCH-006-the-harness.md)). | No database, no Docker: the control plane and Dock only, by their internal APIs. |
| 4 | **Dock** | `Endgame.Dock` + `Docker.DotNet.Enhanced` | Workspaces, repositories, builds, the app lifecycle (start, stop, wake), per-app networks, databases and egress rules; each app's token from the control plane at start; hosting usage (awake time, memory, storage); an app's data dump for the Owner's export (`pg_dump` 16 in its image). | **The only service given the Docker socket.** |
| 5 | **Console** | `src/frontend` — React, TypeScript, Redux Toolkit, Tailwind, shadcn/ui; unprivileged nginx | Sign-in, the org chart home with conversation history, start, run trace, verdict, app (with sharing), credits, secrets, the operator-access log. | Calls nothing except through Edge. |
| 6 | **PostgreSQL** | `postgres:16.16-alpine` | The platform database, and each app's own database and role. | Development only: `127.0.0.1:5446`. |
| 7 | **Egress proxy** | `src/egress` — squid | Every outbound call from apps and workspaces; default deny, per-app allow-lists from Dock. The platform API is reached through it. | Strips `X-Forwarded-For`; re-resolves peer names every 10 s. |
| 8 | **Tunnel** | `cloudflared` | Production compose only. Backups are the ops service's (row 10); there is no other backup service. | Pointed at the edge alone. |
| 10 | **Ops** | `Endgame.Ops` ([`ARCH-007`](ARCH-007-cloudflare-and-backups.md)) | Cloudflare management, the outage Worker, encrypted backups; tells the control plane which organisation names FrostAura's own subdomains take. | No socket, no OpenRouter key; reached by the control plane with the service token. |
| 9 | **Mail catcher** | `axllent/mailpit`, service `mailcatcher` | Development compose only: the control plane's SMTP server on `1025`; keeps every message, sends none. | Never in `docker-compose.prod.yml`. |

## Request paths

```
browser ──▶ edge :8080 ──/api/*──────────────▶ control-plane :8080 ──▶ postgres
mcp client ─▶ edge :8080 ──/mcp, /mcp/apps/{id}──▶ control-plane      (personal access token)
                │──<app address>/*──(access check)──▶ app-<id> :8080
                │──<app address>/_endgame/auth/*──▶ Edge's identity pages ──/api/app-auth/*──▶ control-plane
                │──<subdomain>/_endgame/auth/handoff──(/internal/access/handoff)──▶ host-only app cookie
                └──everything else──▶ console :8080
app-<id> ──▶ egress :3128 ──/platform/v1/*──▶ control-plane      (app token)
control-plane ──/internal/apps/{id}/platform/*──▶ edge :8081 ──▶ app-<id>/_platform/*   (signed)
dock ──unix socket──▶ Docker Engine
dock, edge ──/internal/usage/hosting──▶ control-plane                       (hosting usage)
control-plane ──/internal/repos/*, /internal/apps/{id}/{build,start,database/dump}──▶ dock   (versions, export)
control-plane ──/internal/apps/{id}/call/*──▶ edge :8081 ──▶ app-<id>/*        (per-app MCP, member session)
control-plane ──/internal/ops/reserved-hosts, /health──▶ ops                    (organisation names)
```

## Backend layering

| Project | References | Holds |
| --- | --- | --- |
| `Endgame.Domain` | nothing | The cascade tree, the resolver, roles, run vocabulary, credit kinds and the reservation formula, app access and actors, platform naming rules, the cron evaluator. |
| `Endgame.Application` | Domain | The model gateway and its ports (ledger, provider, context), credit options (the one cost-to-credits conversion), the e-mail port, the status use case. |
| `Endgame.Infrastructure` | Application, Domain, Hosting.Contracts | `EndgameDbContext`, tenancy (row-level security via `endgame_app` / `endgame_system`), the services above, the envelope vault, the OTLP decoder, the SMTP sender and the background workers. |
| `Endgame.ControlPlane` | Application, Infrastructure, `ModelContextProtocol.AspNetCore` | The HTTP surface: `/api`, `/api/app-auth`, `/internal`, `/platform/v1`, `/mcp`. |
| `Endgame.Hosting.Contracts` | nothing | The shapes Dock, Edge and the control plane exchange. |
| `Endgame.Edge`, `Endgame.Dock` | Contracts | Independent hosts. |
| `Endgame.Harness` | Domain, Hosting.Contracts | The agent loop, its tools, permissions, plans, memory and estimates. |
| `Endgame.Runner` | Harness | Independent host: run claims, leases, the factory's workflows. |
| `Endgame.Tests` | everything but Dock | Domain, control plane, hosting and architecture tests. |

## Data

The cascade tree (`organisations`, `divisions`, `projects`, `apps`); `memberships`; `cascade_entries`
(budgets, rule sets, context, settings, and secrets sealed with envelope encryption); the workforce
and the work (`employees`, `runs`, `run_events`, `tasks`, `approvals`, `ideas`, `conversations`); the
one ledger (`credit_entries`) and `operator_actions`; Identity's tables (members only) and the
data-protection key ring. The platform API adds `app_tokens`, `app_end_users`,
`app_end_user_passkeys`, `app_sessions`, `app_handoffs`, `app_shares`, `app_schedules`,
`app_webhooks`, `email_messages`, `telemetry_events`, `telemetry_spans`, `telemetry_metrics`,
`telemetry_logs` and `hosting_samples`. The fourth pass adds `access_tokens`, `notifications`,
`notification_reads`, `idea_suggestions`, `app_dashboard_questions` and `top_up_requests` (each under
row-level security), the global `platform_settings` and its append-only `platform_setting_changes`
(read-only to `endgame_app`), the schema `ask` (four telemetry views) and the role `endgame_ask`.
`email_messages.app_id` is null for the platform's own mail (urgent notifications, invitations).
Every organisation-scoped table carries `organisation_id` under row-level security.

## Invariants and where they are enforced

| Invariant | Enforced by |
| --- | --- |
| Every organisation's rows are visible only to it. | Row-level security on every tenant table (`TenancySql`); `DatabaseInvariantTests`. |
| The ledger, the run log, operator actions and hosting samples are append-only. | Grants plus a statement trigger, binding the superuser too. |
| Operators come from an explicit list; every entry into another organisation is logged for its Owner. | `AccessService` (`ENDGAME_OPERATORS`); `ControlPlaneDebtsTests`. |
| Credits are reserved before a model call; caps are exact. | `CreditLedger.AdmitAsync` under the organisation's lock; `DatabaseInvariantTests`, `ModelGatewayTests`, `PlatformApiTests`. |
| Overdraft carries no interest and no fees; at the limit work stops and apps pause. | Nothing accrues in the ledger; `TreeService.RoutesAsync`; `ControlPlaneDebtsTests`. |
| Go-public is a human act. | `CascadeService` refuses `access: public` from an agent or a service; no internal route sets it; `AppAccessTests`. |
| Secrets are never returned by a console read and are sealed at rest. | `EnvelopeVault`; `PlatformApiTests`. |
| An end user belongs to one app and never reaches the console. | Separate tables and a passkey store confined to one app; `AppAccessTests`. |
| Only Dock references the Docker client, and no project references Dock. | `ArchitectureTests`. |
| No mail leaves unless SMTP is configured. | `SmtpEmailSender.IsConfigured`; tests use an in-test sink. |
| An access token reaches one organisation, at the lower of its role and its person's, never as Owner and never in God mode; `/api` never accepts one and `/mcp` never accepts a cookie. | `CallerCeiling` in `AccessService`; the `mcp` policy; `McpTests`, `AuthorizationMatrixTests` |
| Every public endpoint and every MCP tool lets each role through or refuses it, inside its scope, and discloses nothing outside. | `AuthorizationMatrixTests` (every `/api` endpoint must have a row) |
| A dashboard query reads one app's telemetry and nothing else, however it is written. | `TelemetrySqlGuard`; `endgame_ask` with RLS pinned to the app, `set_config` revoked from it; `TelemetrySqlGuardTests` (the hostile table), `AskTests` |
| Making an app public, an organisation's overdraft, top-ups and the export stay with people. | `Actor.Mcp` is not human; no tool for them; `McpTests` |
| Prices change at runtime, audited, never below cost. | `PricingService`; `BreadthTests.Prices_change_at_runtime…` |

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| One Dockerfile for the .NET services, chosen by `PROJECT`. | One hardened recipe. | A Dockerfile per service. |
| The control plane probes its peers from explicit addresses. | The environment name must not decide where peers are. | Per-environment address lists. |
| App end users live in their own tables, verified by Identity's own passkey handler over a store confined to one app. | They are tenant data with no role, and must never become console users. | Rows in the members' `users` table. |
| App tokens are derived (HMAC of a stored salt under a vault-derived key) and stored as a hash. | The control plane must sign callbacks with the token; the database alone must not yield it. | Storing the token, or an encrypted copy. |
| A leased polling scheduler over `app_schedules`. | A page of code under the same row-level security; no second schema or package. | Quartz.NET with its PostgreSQL store. |
| A hand-written OTLP reader. | The messages are stable and small; no code generator or package in the control plane. | Google.Protobuf and generated OTLP classes. |
| MCP on the official C# SDK, stateless, with dynamic list and call handlers over the same services as `/api`. | One server library; the tools are a thin table over the services, so the role checks are the same calls. | Dispatching tools through the HTTP pipeline (loopback); attribute-declared tools (a second copy of every signature). |
| Personal access tokens, not OAuth, for MCP. | No authorization server exists in the stack, and adding one would be a third moving part; a token is made, capped and revoked in the console. | OAuth protected-resource metadata pointing at nothing. |
| Three fences on an asked query: a parser allow-list, a role confined by RLS to one app, and a timeout with a row limit. | Any one can be wrong; a model writes the text. | The parser alone; a per-app database copy of telemetry. |
| The export is built by the control plane from Dock's bundle and dump. | Dock alone holds code and app databases; the control plane adds the platform's records and the manifest. | Dock assembling it (it does not hold end users or schedules). |
| Telemetry pruned by age, not partitioned. | Simple; volume on one machine is small. | Native partitions. |

## Running it

`make up` runs the stack with the control plane in Development and the development sign-in on;
peers are found by compose name in every environment, so no override file is needed. A second stack
on the same engine takes its own `COMPOSE_PROJECT_NAME`, host ports and `DOCK_SUBNET_POOL`; its Dock
labels everything with its own instance name. `docker-compose.prod.yml` pins every service to
Production and the development sign-in to `"false"` (`make prod-config` checks both).
`make e2e-stack` brings such a second stack up from fresh volumes, runs the acceptance test
([`TEST-090`](../testing/TEST-090-stack-acceptance.md)) and the app kit's proof against its real Edge,
and removes it.

## Not built yet

The offsite copy runs once R2 is configured (ARCH-007). Builders work one plan item at a time in one workspace:
parallel builders are not built (ARCH-006, *Sub-agents*). The evaluator's test members write into the app's own
database, and their records stay in the published app: no separate preview database (ARCH-006, *Checking the work*).

## Links

- Spec: [`../specs/endgame-spec.md`](../specs/endgame-spec.md)
- Plan: [`../specs/endgame-build-plan.md`](../specs/endgame-build-plan.md)
- Contracts: [`ARCH-004`](ARCH-004-service-contracts.md), [`../../src/appkit/PLATFORM-API.md`](../../src/appkit/PLATFORM-API.md)
