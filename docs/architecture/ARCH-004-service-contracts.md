# ARCH-004 — Service contracts for the thin slice

The interfaces between Endgame's services, written before the parallel build lanes start so they
cannot collide. A lane may add to its own service freely; it may change a contract here only by
editing this file first. Everything here describes the intended design for Phase 2 of the build
plan; what exists is in `MEMORY.md`.

## Who may talk to whom

| Caller | Callee | How | Why |
| --- | --- | --- | --- |
| Browser | Edge | HTTPS | The only door. |
| Edge | Control plane, Console, app containers | HTTP | Routing. |
| Edge | Dock | Internal API | Wake a sleeping app. |
| Console | Control plane (through Edge) | `/api/*`, cookie session | Everything the user does. |
| Runner | Control plane | Internal API | Model calls, credits, tasks, tree context, run log. |
| Runner | Dock | Internal API | Workspaces, builds, app lifecycle, repositories. |
| Control plane | OpenRouter | HTTPS | **The only component holding the OpenRouter key.** |
| Dock | Docker Engine | Socket | **The only component holding the socket.** |
| App container | Control plane (via egress proxy) | Platform API, app token | Identity, models, secrets, telemetry. |

Internal APIs live under `/internal/*`, are never routed by Edge, and require a service token
(`ENDGAME_SERVICE_TOKEN`) in the `Authorization` header. Only the control plane owns the database
schema and migrations; other services reach data through its internal API, never directly.

## Identifiers and the cascade

- Every row carries `organisation_id`. Foreign keys are composite with it. Row-level security is on.
- A **scope** is a node in the tree, written as a path of slugs: `org`, `org/division`,
  `org/division/project`, `org/division/project/app`.
- The **cascade resolver** answers, for a scope and a kind (permission, secret, budget, rule set,
  context, setting): the effective value and which level set it. Nothing else implements inheritance.
- Slugs are lowercase letters, digits and hyphens, 2 to 40 characters, unique among siblings.

## Control plane — public API (`/api`)

| Area | Endpoints |
| --- | --- |
| Session | `POST /api/auth/passkey/register/*`, `POST /api/auth/passkey/login/*`, `POST /api/auth/logout`, `GET /api/me` |
| Tree | `GET /api/tree` (the whole organisation as one document for the org chart), `POST/PATCH/DELETE` on `/api/organisations`, `/divisions`, `/projects`, `/apps` |
| Ideas | `POST /api/ideas` (text and constraints → starts research, returns the run), `GET /api/ideas/{id}`, `POST /api/ideas/{id}/decision` (`build`, `change`, `overrule`, `drop`) |
| Runs | `GET /api/runs/{id}`, `GET /api/runs/{id}/events` (server-sent events, resumable by sequence number), `POST /api/runs/{id}/pause`, `/resume`, `/cancel`, `POST /api/runs/{id}/approvals/{approvalId}` |
| Tasks | `GET /api/tasks?scope=` |
| Credits | `GET /api/credits?scope=` (balance, budgets down the cascade, spend, estimate accuracy) |
| Apps | `GET /api/apps/{id}` (status, addresses, telemetry summary), `POST /api/apps/{id}/settings` |
| Conversation | `POST /api/conversations` (`scope`, `message`) → a run; replies stream as run events |
| System | `GET /api/system/status` (technical mode only) |

Errors use problem-details. A failed read is distinguishable from an empty result everywhere.

## Control plane — internal API (`/internal`)

| Endpoint | Contract |
| --- | --- |
| `POST /internal/model/chat` | Body: task type, scope, run id, employee id, messages, tools, limits. The control plane picks the model list for the task type, **reserves credits in the same transaction that admits the call**, sends the price ceiling, streams the reply back, and settles from the reply's own cost. Returns `402`-style refusal `budget_exhausted` (terminal — never retried) or `ceiling_unreachable`. |
| `POST /internal/runs`, `POST /internal/runs/{id}/events`, `POST /internal/runs/{id}/lease` | Create a run; append events (the control plane assigns sequence numbers); renew the run's lease. |
| `POST /internal/tasks/checkout` | One conditional update: claims a task only if its status and holder are what the caller expects. Returns the task or `conflict`. |
| `POST /internal/tasks`, `PATCH /internal/tasks/{id}` | Create and update tasks in the graph. |
| `GET /internal/context?scope=` | The resolved cascade for a scope: context files, rule sets, budgets, settings. |
| `POST /internal/approvals` | Raise a checkpoint; the run waits until the owner answers. |
| `GET /internal/routes` | The routing table for Edge: every app's addresses, container target and sleep state. |
| `POST /internal/apps/{id}/published` | Dock reports a new running version. |

## Dock — internal API

| Endpoint | Contract |
| --- | --- |
| `POST /internal/workspaces` | Create a workspace container for a run from an app's repository at a ref. No socket, own internal network, CPU, memory and process limits. Returns an id. |
| `POST /internal/workspaces/{id}/exec` | Run a command with a timeout; returns exit code and truncated output. |
| `GET/PUT /internal/workspaces/{id}/files` | Read and write files, with paging. Refuses paths outside the workspace root and inside `.git/`. |
| `POST /internal/workspaces/{id}/commit` | Commit the workspace to the app's repository with a message and author (the employee). Returns the commit id. |
| `DELETE /internal/workspaces/{id}` | Destroy it. A workspace is also destroyed when its run's lease lapses. |
| `POST /internal/repos` | Create an app's bare repository from the app-kit template. |
| `POST /internal/apps/{id}/build` | Build an image from a commit, with no per-app Dockerfile. |
| `POST /internal/apps/{id}/start`, `/stop`, `/wake`; `GET /internal/apps/{id}` | Lifecycle and status. Stop keeps the container. Start provisions the app's database and role on first use. |

## Run log — the event stream

One append-only table, `run_events (organisation_id, run_id, seq, type, at, payload)`. `seq` is
assigned by the control plane and gapless per run. A run is resumed by replaying its events.

| Type | Payload |
| --- | --- |
| `run.started`, `run.paused`, `run.resumed`, `run.finished` | Reason, outcome, totals. Finishing a run and updating its employee's state happen in one transaction. |
| `plan.proposed`, `plan.accepted` | The contract: what will be made and how it will be checked. |
| `task.created`, `task.claimed`, `task.done`, `task.failed` | Task id and summary. |
| `model.requested`, `model.replied` | Task type, model, tokens, reserved and settled credits. Never the prompt's secrets. |
| `tool.requested`, `tool.permitted`, `tool.denied`, `tool.result` | Tool name, arguments, the rule that decided, a truncated result. |
| `subagent.started`, `subagent.finished` | The brief and the returned summary. |
| `approval.requested`, `approval.answered` | The checkpoint and the answer. |
| `evaluation.passed`, `evaluation.failed` | The contract item, the evidence. |
| `estimate.made`, `estimate.scored` | Expected and actual credits. |
| `message` | Text for the owner, in plain language. |

## Credits

One ledger, `credit_entries`, append-only: top-ups, reservations, settlements, releases. Balance and
spend are derived from it; there are no spend counters on tree nodes. A reservation expires with
its run's lease. Repair work is recorded with `billable = false`.

## The app kit

A generated app is a .NET API that serves its own built front end, built against the kit:

- It must run correctly under **both** a path base (`/<org>/<division>/<project>/`) and the root of
  an organisation subdomain. The base comes from a forwarded header, never from a build-time constant.
- It exposes `/health` and its own interface description, from which its MCP tools are derived.
- It reaches platform services only through the kit, with an app token injected at start:
  identity, data (its own database and role), models, secrets, telemetry.
- It never reads another app's data and has no outbound access except through the egress proxy.

## Ports and names (inside the compose network)

Every service listens on `8080`. Service names: `edge`, `control-plane`, `runner`, `dock`,
`console`, `postgres`, `egress`. App containers are named `app-<app id>`, workspaces `ws-<run id>`.
