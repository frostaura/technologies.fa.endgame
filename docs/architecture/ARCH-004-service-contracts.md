# ARCH-004 — Service contracts

The interfaces between Endgame's services, as built by the four control-plane passes, the Dock and
Edge lane, the Runner lane and the app kit. A lane may add to its own service freely; it changes a contract here
only by editing this file first. The app-facing half is fixed field for field in
[`src/appkit/PLATFORM-API.md`](../../src/appkit/PLATFORM-API.md); the shared hosting types are in
`src/backend/Endgame.Hosting.Contracts`. What runs where is in `MEMORY.md`.

## Who may talk to whom

| Caller | Callee | How | Why |
| --- | --- | --- | --- |
| Browser | Edge | HTTPS | The only door. |
| Edge | Control plane, Console, app containers | HTTP | Routing; Edge alone joins each app's network. |
| Edge | Control plane | `/internal/*`, service token | Routing table, access checks, session hand-offs, hosting usage (requests). |
| Edge | Dock | Internal API | Wake a sleeping app. |
| Console | Control plane (through Edge) | `/api/*`, cookie session | Everything a member does. |
| Identity pages | Control plane (through Edge) | `/api/app-auth/{appId}/*` | Sign-in and sign-up at an app. |
| Runner | Control plane | Internal API | Model calls, credits, tasks, tree context, run log. |
| Runner | Dock | Internal API | Workspaces, builds, app lifecycle, repositories. |
| Dock | Control plane | Internal API | App tokens, published versions, states, hosting usage. |
| Dock | Edge control listener (`:8081`) | Internal API | Crash reports. |
| Control plane | SMTP server (development: the `mailcatcher` service) | SMTP | Mail; in development every message stays in the catcher. |
| Control plane | Edge control listener | Internal API | Route refreshes; platform-to-app callbacks. |
| Control plane | OpenRouter | HTTPS | **The only component holding the OpenRouter key.** |
| Control plane | Dock | Internal API, service token | An app's version history, restore and republish, the code export and the data dump. |
| Control plane | Ops | Internal API, service token | Reserved organisation names (`GET /internal/ops/reserved-hosts`, `/health`); its health on the status view. |
| Control plane | Edge control listener | `/internal/apps/{id}/call/{**path}`, service token | The per-app MCP surface: an app's OpenAPI document and its operations, woken if asleep. |
| MCP client | Control plane (through Edge) | `/mcp`, `/mcp/apps/{appId}`, personal access token | Everything a member does, as tools (below). |
| Control plane | SMTP server | SMTP | **Only when `Smtp__Host` and `Smtp__From` are set**; otherwise mail waits in the outbox. |
| Dock | Docker Engine | Socket | **The only component holding the socket.** |
| App container | Control plane (via the egress proxy) | `/platform/v1/*`, app token | Identity, models, secrets, e-mail, schedules, webhooks, telemetry. |

Internal APIs live under `/internal/*`, are never routed by Edge's public side, and require the
service token (`ENDGAME_SERVICE_TOKEN`) as `Authorization: Bearer`. The platform API lives under
`/platform/v1/*`, requires an app token, and is not routed by Edge either; the control plane also
answers 404 to any platform call that carries `X-Forwarded-Host` (that is, came through Edge). Only
the control plane owns the database schema and migrations.

## Identifiers, addresses and the cascade

- Every row carries `organisation_id`. Foreign keys are composite with it. Row-level security is on for
  every organisation-scoped table, the platform API's included.
- A **scope** is a node in the tree, written as a path of slugs: `org`, `org/division`,
  `org/division/project`, `org/division/project/app`.
- **An app's address has four segments in both shapes**: the path form
  `<scheme>://<path host>[:port]/<org>/<division>/<project>/<app>/` and the organisation subdomain
  `<scheme>://<org>.<organisation domain>[:port]/<division>/<project>/<app>/` (PLATFORM-API §5). The
  control plane builds both from `Addresses:PathHost`, `Addresses:OrganisationDomain`,
  `Addresses:Scheme` (default `https`) and `Addresses:Port` (default none); a stack on a developer's
  machine is `http://localhost:<edge port>` and `http://<org>.localhost:<edge port>`. The routing
  table's `host` is the bare host name; Edge matches it on any port.
- The **cascade resolver** answers, for a scope and a kind (permission, secret, budget, rule set,
  context, setting): the effective value and which level set it. Nothing else implements inheritance.
- Slugs are lowercase letters, digits and hyphens, 2 to 40 characters, unique among siblings. Secret
  names are `UPPER_SNAKE_CASE`.

## Status vocabulary

| Thing | Stored | As the console reads it |
| --- | --- | --- |
| Organisation | `active`, `suspended` | — |
| Division, project | `active`, `archived` | Project stage: `idea`, `researching`, `verdict`, `planning`, `building`, `evaluating`, `reviewing`, `publishing`, `live`, `paused`, `dropped` |
| App | `draft`, `building`, `running`, `sleeping`, `stopped`, `failed`, `archived` | `running`: `asleep`, `awake`, `always-on`, `starting`, `paused`; `health`: `healthy`, `degraded`, `down`, `unknown` |
| Run | `queued`, `running`, `paused`, `waiting_approval`, `succeeded`, `failed`, `cancelled`; kind `research`, `conversation`, `build`, `task`, `review`, `suggest` | `queued`, `running`, `waiting`, `paused`, `finished`, `failed`, `cancelled` |
| Suggestion | `open`, `taken`, `dismissed` | same |
| Top-up request | `open`, `fulfilled`, `declined` | same |
| Notification | kind as under *Notifications*; severity `info`, `urgent` | same |
| Access token | role `admin`, `builder`, `viewer` (never `owner`) | `active` is derived |
| Task | `todo`, `in_progress`, `blocked`, `done`, `failed`, `cancelled` | same |
| Employee | `idle`, `working`, `paused`, `released`; kind `employee` or `contractor`; `standing` `security-reviewer` or null | same, plus `idle.flagged` (no work for longer than setting `workforce.idle_days`, default 14) |
| Hire proposal | `proposed`, `accepted`, `declined`; trigger `division`, `stage`, `recurring`, `promotion`, `owner` | same |
| Memory entry | kind `fact`, `practice`, `preference`, `lesson`; change actions `added`, `corrected`, `merged`, `removed`, `archived`, `restored`, `reviewed` by `employee`, `person`, `review`, `platform` | same |
| Idea | `researching`, `awaiting_decision`, `building`, `dropped`; a decision is `via` `person` or `auto-mode`; `red_line` names a breached red line | `researching`, `verdict`, `decided`, `failed` |
| App access | `private`, `shared`, `public` (setting `access`) | same |
| E-mail | `queued`, `sending`, `sent`, `failed` | — |

An app's `running` is `paused` and its `health.summary` says why whenever the routing table pauses
it. Health is `down` for a failed app, otherwise what its own telemetry measured over fifteen
minutes (`degraded` when more than one response in twenty failed).

## Control plane — public API (`/api`, member cookie)

| Area | Endpoints |
| --- | --- |
| Session | `GET /api/auth/options`; `POST /api/auth/passkey/register/{options,complete}`, `POST /api/auth/passkey/login/{options,complete}`; `POST /api/auth/logout` (also ends every app session the browser carries); `POST /api/auth/development` (Development and `ENDGAME_DEV_LOGIN=true` only); `GET /api/me` |
| Tree | `GET /api/tree?organisation=` (an operator may name any organisation: entry is logged); `POST /api/organisations`, `POST /api/divisions`, `/projects`, `/apps`; `PATCH`/`DELETE` `…/{id}` |
| Cascade | `GET /api/cascade?scope=&kind=`, `PUT /api/cascade { scope, kind, key, value }`, `DELETE /api/cascade?scope=&kind=&key=` |
| Members | `GET /api/members?scope=` → `[{ membershipId, userId, email, displayName, scope (where the grant was set), role, hasPasskey, grantedAt }]` (Admin); `POST /api/members { scope, email, displayName, role }` → `{ member, invitationCode, expiresAt, emailed }` (code once; `emailed` when a mail server is configured); `PATCH /api/members/{membershipId} { role }` → the same shape (Admin; to or from `admin`, the Owner); `DELETE /api/members/{membershipId}` |
| Access tokens | `GET /api/tokens` → `[AccessToken]`; `POST /api/tokens { name, organisation, role?, expiresInDays? }` → `201 { token, accessToken }` (the token `egp_…` once; role at most the caller's highest in the organisation, never `owner`, default theirs and `admin` for an Owner; `expiresInDays` 1–366 or none); `DELETE /api/tokens/{id}` → `AccessToken` (revoked). `AccessToken { id, name, organisation, role, prefix, createdAt, expiresAt, lastUsedAt, revokedAt, active }` |
| Secrets | `GET /api/secrets?scope=` → `{ scope, effective: [{ name, setAtLevel, setAtPath, setAt, inherited, overrides }], setBelow: [{ name, setAtPath }] }` — never a value; `PUT /api/secrets { scope, name, value }`; `DELETE /api/secrets?scope=&name=` (Admin and above) |
| Credits | `GET /api/credits?scope=` (balance, month `{ spent, ai, hosting }`, budgets in tree order, estimates, not charged, overdraft `{ frostauraLimit, ownLimit }`, top-ups, held, available); `POST /api/credits/top-ups { organisation, credits, note, idempotencyKey?, requestId? }` (operators; `requestId` marks that request fulfilled); `PUT /api/credits/overdraft { scope, credits }` → `CreditsView` (at the organisation its own limit, Owner; beneath it a narrower one, Admin; never deeper, 400); `POST /api/credits/top-up-requests { organisation?, credits, note? }` → `201 TopUpRequest` (Owner; at most five open); `GET /api/credits/top-up-requests?organisation=` → `[TopUpRequest]` (Admin). `TopUpRequest { id, organisation, organisationName, credits, note, status: open|fulfilled|declined, requestedBy, requestedByEmail, requestedAt, closedAt, closeNote, topUpEntryId }` |
| Ideas | `POST /api/ideas/estimate`, `POST /api/ideas`, `GET /api/ideas/{id}`, `POST /api/ideas/{id}/decision` |
| Ideas from the portfolio | `POST /api/ideas/suggestions/estimate { scope }` → `{ credits, basis }`; `POST /api/ideas/suggestions { scope }` → `201 { run: PublicRun, estimate }` (Builder; a `suggest` run, its `estimate.made` in the log); `GET /api/ideas/suggestions?scope=` → `[Suggestion]` (Viewer); `POST /api/ideas/suggestions/{id}/take { constraints? }` → `201 PublicIdea` (research queued with its estimate); `POST /api/ideas/suggestions/{id}/dismiss` → `Suggestion` (Builder). `Suggestion { id, scope, runId, title, idea, gap, whyUs, reuses[], status: open|taken|dismissed, ideaId, createdAt }` |
| Runs | `GET /api/runs?scope=&employeeId=&kind=&status=&limit=` → `[PublicRun]` newest first, at most 100 (Viewer; `employeeId` alone: wherever the employee works); `GET /api/runs/{id}`, `GET /api/runs/{id}/events` (server-sent events, resumable), `POST /api/runs/{id}/{pause,resume,cancel}`, `POST /api/runs/{id}/approvals/{approvalId}` |
| Tasks | `GET /api/tasks?scope=&status=&limit=` |
| Apps | `GET /api/apps/{id}` (health, running, addresses, `telemetry { visitsToday, requestsToday, errorsToday, latencyP50Ms, latencyP95Ms, lastVisitAt }` or null before anything was measured, cost, settings, `runningCost { sleep, alwaysOn }` or null, `sharedWith`); `POST /api/apps/{id}/settings { running?, access?, idleMinutes? }` (access needs Admin; `public` only from a person) |
| Ask about this app | `POST /api/apps/{id}/ask/estimate { question }` → `{ credits, basis }` (Viewer); `POST /api/apps/{id}/ask { question }` → `{ question, answer, chart: { kind: line|bar|number|table, x, y[], series: [{ name, points: [{ x, y }] }] }, sql, columns[], rows[], truncated, credits: { estimate, charged } }` (Builder; charged to the app; `sql` is for technical mode); `422 ask_unanswerable` / `query_timeout` / `query_failed`; `503 ask_unavailable` with no `ask` route. Dashboard: `GET /api/apps/{id}/dashboard` → `[{ id, question, answer, sql, chart, columns, rows, truncated, askedAt, ranAt, error }]` re-run on read (Viewer); `POST /api/apps/{id}/dashboard { question, sql, chart?, answer? }` → `201` (Builder; the query is guarded again; at most 30); `DELETE /api/apps/{id}/dashboard/{questionId}` (Builder) |
| Versions and export | `GET /api/apps/{id}/versions?skip=&limit=` → `{ appId, live, versions: [{ commit, message, at, author: { kind: employee|person|factory, id, name }, live }], hasMore }` (Viewer); `POST /api/apps/{id}/versions/{commit}/restore` → `{ version, published, madePrivate, publishError }` (Builder; a new commit by the person, rebuilt and restarted; a public app becomes private); `GET /api/apps/{id}/export` → `application/gzip`, `<app slug>-export.tar.gz` holding `<slug>/manifest.json`, `code.bundle` (git bundle, whole history), `database.dump` (pg_dump custom, absent when the app never ran) and `platform.json` (end users without passkeys, shares, schedules, webhooks, custom events) (Owner only) |
| Sharing | `GET /api/apps/{id}/shares`, `POST /api/apps/{id}/shares { email }` → `{ email, invitationCode, expiresAt }` (code shown once), `DELETE /api/apps/{id}/shares?email=` |
| Conversation | `POST /api/conversations { scope, message, employeeId?, conversationId? }` → a run; `GET /api/conversations?scope=&employeeId=` |
| Autonomy | `GET /api/autonomy?scope=` → `{ scope, autonomy: auto|checkpoints, autonomySetAtPath, checkpoints: { start, plan, hire: { on, setAtPath } }, ruleSets: [{ stage, deny[], ask[], allow[], checkpoints[], setAtPath, overrides[] }], stages[] }` (Viewer); `PUT /api/autonomy { scope, autonomy?, checkpoints?: { start?, plan?, hire? } }`, `DELETE /api/autonomy?scope=&key=`, `PUT /api/autonomy/rule-sets { scope, stage, deny?, ask?, allow?, checkpoints? }`, `DELETE /api/autonomy/rule-sets?scope=&stage=` (Admin and above; each answers the view) |
| Workforce | `GET /api/employees?scope=&includeReleased=&kind=` → `[Employee]`; `GET /api/employees/{id}` → `{ employee, trackRecord, contractors[], reports[] }`; `GET …/{id}/track-record`; `PATCH …/{id} { name?, role?, jobDescription?, reportsTo?, clearReportsTo?, clearMonthlyCreditLimit?, status?: paused|idle }`, `POST …/{id}/reassign { scope, reportsTo? }`, `POST …/{id}/release`, `POST …/{id}/rehire { scope? }` (Admin); `GET /api/employees/recurring-roles?scope=` |
| Memory | `GET /api/employees/{id}/memory?scope=&includeArchived=` → `[MemoryEntry]`; `GET …/memory/changes?limit=`; `POST …/memory { title, body, kind, scope? }`, `PATCH …/memory/{entryId} { title?, body?, kind? }`, `DELETE …/memory/{entryId}?why=`, `POST …/{id}/reviews` → the queued `review` run (Builder) |
| Hires | `GET /api/hires?scope=&status=`, `GET /api/hires/{id}` → `Hire`; `POST /api/hires { scope, name, role, jobDescription, reportsTo?, expectedMonthlyCredits, reason, needKey?, trigger? }`, `PATCH /api/hires/{id}`, `POST /api/hires/{id}/accept { note? }`, `POST /api/hires/{id}/decline { note? }` (Admin) |
| Ontology | `GET /api/ontology?scope=&view=all|org-chart|data-flow` → `{ scope, generatedAt, nodes: [{ id, type, name, scope, status, attributes }], edges: [{ from, to, type, label }], views }` |
| God mode (operators only; never by access token) | `GET /api/operator/organisations` → `[{ id, slug, name, status, createdAt, balance, standing: in-credit|overdrawn|at-limit, overdraft: { frostauraLimit, ownLimit, effective }, apps, lastActivityAt, openTopUpRequests }]`; `POST /api/operator/organisations/{slug}/enter` → `{ organisationId, organisation, role: admin, enteredAt, logged }` (logged for the Owner); `PUT /api/operator/organisations/{slug}/overdraft { credits }` → the organisation's summary (logged `overdraft.set`); `GET /api/operator/top-ups?organisation=` → `[{ id, organisation, credits, note, at, by, byEmail }]`; `GET /api/operator/top-up-requests?status=` → `[TopUpRequest]`; `POST /api/operator/top-up-requests/{id}/close { status: fulfilled|declined, note?, topUpEntryId? }` → `TopUpRequest` (logged); `GET /api/operator/pricing` → `{ pricing, source: defaults|stored, updatedAt, updatedBy, history: [{ at, by, byEmail, before, after }] }`; `PUT /api/operator/pricing { creditsPerUsd, margin, hosting: { usdPerAwakeHour, usdPerGbHourMemory, usdPerGbMonthStorage, usdPerMillionRequests }, defaultAppModelMonthlyCredits }` (audited; margin ≥ 1.0). `POST /api/organisations { name, slug, ownerEmail, ownerDisplayName? }` → `{ id, slug, name, ownerEmail, ownerInvitationCode, invitationExpiresAt, invitationEmailed, nameCheck: { slug, source: cloudflare|built-in, note } }`; `409 reserved_name`, `503 reserved_names_unavailable`. `GET /api/audit/operator-access?organisation=` (the Owner only) → `[{ id, at, action, operator { id, email, displayName }, detail }]` |
| Notifications | `GET /api/notifications?organisation=&unread=&limit=` → `{ organisation, unread, notifications: [{ id, kind, severity: info|urgent, title, detail, scope, subject: { kind, id } | null, createdAt, read, emailedAt }] }` (Admin and above where the grant covers the node; others an empty feed); `POST /api/notifications/{id}/read` → 204; `POST /api/notifications/read-all?organisation=` → `{ marked }`. Kinds: `verdict`, `approval`, `hire`, `budget.80`, `budget.cap`, `credits.zero`, `overdraft.half`, `overdraft.limit`, `app.crashed`, `security.finding`; the urgent ones (`budget.cap`, `credits.zero`, `overdraft.*`, `app.crashed`, `security.finding`) are also queued as e-mail to the organisation's Owner and Admins when a mail server is configured |
| System | `GET /api/system/status`, `GET /api/openapi/v1.json` |

Errors are problem details with a stable `code`. A failed read is distinguishable from an empty one.

The workforce's shapes, field for field:

- **Employee** `{ id, kind, name, role, status, standing, scope, reportsTo: { id, name } | null, briefedBy: { id, name } | null,
  jobDescription: { mandate, scope, tools[], services[], monthlyCreditLimit, modelTier }, idle: { flagged, since, afterDays },
  currentRun: { id, title } | null, lastRunId, lastActiveAt, createdAt, releasedAt, memoryEntries, brief }`. `services` are
  `identity`, `models`, `secrets`, `email`, `schedules`, `webhooks`, `telemetry`; `modelTier` is a routing-table task type.
- **TrackRecord** `{ employeeId, work: { accepted, sentBack, acceptedPercent }, runs: { finished, succeeded, failed, cancelled },
  repairsNotCharged: { credits, calls }, cost: { toDateCredits, monthCredits }, contractors: { engaged, working, toDateCredits, monthCredits },
  estimates: { pieces, withinPercent, under, over, largestMissPercent } | null }` — derived on read: `accepted` is evaluations
  passed plus finished runs never evaluated, `sentBack` evaluations failed; cost is billable settlements and hosting with the
  employee's id.
- **Hire** `{ id, status, trigger, needKey, scope, reason, name, role, jobDescription, reportsTo, expectedMonthlyCredits, withinBudget,
  headroomCredits, contractorRole, raisedBy: person|runner, raisedByRunId, decision: { via, by, at, note } | null, employeeId, createdAt }`.
- **MemoryEntry** `{ id, employeeId, scope, title, body, kind, sourceRunId, createdAt, updatedAt, lastReviewedAt, archived }`;
  **MemoryChange** `{ id, memoryId, action, by, userId, runId, detail, at }`.
- `GET /api/tree` workers are `{ id, name, role, kind, activity, status, idle, standing, briefedBy }` — employees and contractors
  while they work; `needsYou[]` adds `{ kind: "hire", id, hireId, title, detail, scope, expectedMonthlyCredits }` and
  `{ kind: "idle", id, employeeId, title, detail }`.
- An idea's `GET /api/ideas/{id}` adds `redLine` and `decision.via`. Building or overruling over a breached red line is
  `403 red_line`, for a person too.

## Control plane — app identity pages (`/api/app-auth/{appId}`, no member auth)

| Endpoint | Contract |
| --- | --- |
| `GET` | `{ appId, appName, organisationName, access, signUp, invitationRequired, passkey, developmentSignIn, address }` |
| `POST /sign-up/options { email, displayName?, invitationCode?, returnTo? }` → `{ publicKey }` | Private apps refuse; shared apps need the shared address and its one-time code. |
| `POST /sign-up/complete { credential, invitationCode? }` → `{ user, returnTo }` | Creates the end user, sets the app-session cookie `endgame.app.<app id, 32 hex>`. |
| `POST /sign-in/options { email?, returnTo? }`, `POST /sign-in/complete { credential }` → `{ user, returnTo }` | A passkey registered at another app never signs anyone in here. |
| `POST /sign-out` | Revokes and clears this app's session. |
| `POST /handoff { returnTo? }` → `{ url }` | For a member (by their console cookie, with a role on the app) or an end user (by the app cookie): a one-time link to the subdomain host. |
| `POST /development { email, displayName?, returnTo? }` | Development sign-in for end users, under the same gate as members'. |

`returnTo` is an absolute address inside one of the app's two addresses, or a path inside its path
form; anything else is 400 `invalid_return_to`. When it points at the subdomain host, the answer's
`returnTo` is instead the hand-off link `https://<org>.<domain>/<division>/<project>/<app>/_endgame/auth/handoff?code=…&returnTo=…`.

## Control plane — internal API (`/internal`, service token)

| Endpoint | Contract |
| --- | --- |
| `POST /internal/model/chat` | Task type, scope, run, employee, messages, tools, limits, `providerOrder[]` (sent as `provider.order`). Routes by task type, reserves in the transaction that admits, sends the price ceiling, settles from the reply. Optional parameters (reasoning, temperature, tool choice, parallel tool calls, response format) are sent only when every model on the route lists them in its catalogue `SupportedParameters`. `402 budget_exhausted` (terminal for the run) or `402 overdraft_limit` (terminal until a top-up); `422 ceiling_unreachable`. Building tiers: `build`, `build-t1`, `build-t2`, `build-t3`. |
| `POST /internal/tree/nodes { parent, level, name, slug }` | Placement: `201 { id, level, slug, name, path, status, createdAt }`, or `200` with the node that already has that slug. |
| `GET /internal/credits/headroom?scope=&employeeId=` | `{ scope, headroomCredits, bindingScope, binding: budget|overdraft, balance, overdraftLimit }`: the tightest monthly cap on the chain (and the employee's, which covers its contractors), or the balance down to the overdraft limit. |
| `GET /internal/estimates/history?taskType=<run kind>&scope=&limit=` | `[{ runId, finishedAt, credits, steps }]`: billable actuals of succeeded runs of that kind in the scope's organisation, newest first. `scope` is required (`400 scope_required`): history never crosses organisations. |
| `GET /internal/estimates/accuracy?scope=&employeeId=` | `{ scope, employeeId, estimates }` from `estimate.scored`. |
| `GET /internal/tasks?scope=&status=&limit=`, `GET /internal/runs?scope=&kind=&status=&limit=`, `GET /internal/credits?scope=` | The conversation's reads: the same shapes as the public reads. |
| `POST /internal/ideas { scope, text, constraints[] }` | `201 { idea, run, estimate }`: research on the owner's confirmed word, proposed to the division (or organisation) the scope sits in. |
| `PUT /internal/cascade { scope, kind: "setting", key, value }` | An agent changes one allow-listed setting: `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`, `sleep.mode`, `sleep.idle_minutes`, `workforce.idle_days`; anything else `403 setting_not_allowed`. Never `access`. |
| `POST /internal/ideas/{id}/decision { decision: "build", by: "auto-mode" }` | Auto-mode builds after a build or change verdict where autonomy is auto → `{ idea, run }`. A do-not-build or checkpoints is `409 owner_decision_required`; any other decision `403`; a red line `403 red_line`. |
| `POST /internal/runs`, `POST /internal/runs/claim`, `GET /internal/runs/{id}`, `GET`/`POST /internal/runs/{id}/events`, `POST /internal/runs/{id}/lease` | Runs, their log (gapless sequence numbers) and leases. |
| `POST /internal/tasks`, `POST /internal/tasks/checkout`, `PATCH /internal/tasks/{id}` | The task graph; checkout is one conditional update. |
| `GET /internal/context?scope=` | The resolved cascade: levels, context, rule sets, budgets, settings, secret names, roles. |
| `POST /internal/approvals` | A checkpoint the run waits on. |
| `POST /internal/ideas/{id}/verdict` | Research's verdict document. |
| `POST /internal/employees { scope, name, role, mandate?, tools?, services?, monthlyCreditLimit?, modelTier?, reportsTo? }`, `GET /internal/employees?scope=&includeReleased=&kind=`, `GET /internal/employees/{id}` | The factory's direct hire; the workforce at and beneath a scope; one employee's detail (as the public shapes). |
| `POST /internal/hires { scope, trigger, needKey, reason, name, role, jobDescription, reportsTo?, expectedMonthlyCredits, contractorRole?, runId? }` | A need from the ontology → `201 { hire, created: true }`, or `200` with the live proposal for the same `needKey`. Accepted at once when within budget and the hire checkpoint is off. |
| `GET /internal/employees/{id}/memory?scope=`, `POST …/memory { runId?, entries: [{ title, body, kind, scope? }] }`, `POST …/memory/review { runId?, merged: [{ from[], title, body, kind? }], removed: [{ id, why }], corrected: [{ id, title?, body?, kind?, why }] }` | Memory for a run (at, above or beneath the scope; at most 200); written after a task; a review's result. |
| `POST /internal/contractors { scope, briefedBy, role, name?, brief, runId?, monthlyCreditLimit? }`, `POST /internal/contractors/{id}/finish { runId?, learned[] }` | A contractor while it works; done → `{ contractor, learned, promotion }` (a hire raised when the role recurred). |
| `GET /internal/ontology?scope=&view=`, `GET /internal/employees/recurring-roles?scope=` | The graph, and recurring contractor roles, for the Runner's hiring triggers. |
| `GET /internal/routes` | `{ generatedAt, routes: [{ appId, organisationId, scope, pathBase, host, hostPathBase, target, status, sleeping, sleep { mode, idleMinutes, modeSetAt, idleSetAt }, version, access, paused, pausedReason, hooks }] }`. `access` is `private`/`shared`/`public`; `paused` is true when the organisation's settled balance is past its overdraft limit (`pausedReason: overdraft_limit`) or a monthly budget on the app's chain is spent (`budget_exhausted`); `hooks` lists declared webhook names. |
| `POST /internal/access/check { appId, cookie, path }` | → `{ decision: allow | sign-in | deny, sessionToken, signInUrl, reason }`. `cookie` is the request's whole `Cookie` header; `sessionToken` is app-scoped (`egs_…`, 15 minutes) and never a cookie value; `signInUrl` is null (Edge uses the app's own sign-in page). |
| `POST /internal/access/handoff { appId, code }` | → `{ cookieName, cookieValue, expiresAt, returnTo }` for Edge to set on the subdomain host, or `410 handoff_invalid` (unknown, used, or older than a minute). |
| `POST /internal/apps/{id}/token` | → `{ token }` (`egt_…`). Mints a fresh app token, stored only as a hash; the previous one keeps working for `AppSessions:TokenGraceSeconds`. |
| `POST /internal/apps/{id}/published { version }`, `POST /internal/apps/{id}/state { status }` | Dock's reports. A `failed` state raises an `app.crashed` notification. |
| `GET /internal/runs/{id}/suggestion-context` | For a `suggest` run: `{ scope, organisation, products: [{ kind: division|project|app, scope, name, status }], ideas: [{ title, status, verdict }], context: ["key: value"], alreadySuggested: [title], maxSuggestions: 5 }`; `409` for another kind of run. |
| `POST /internal/runs/{id}/suggestions { suggestions: [{ title, idea, gap, whyUs, reuses[] }] }` | The run's result, 1 to 5, once per run → `201 [Suggestion]`; `400` outside those bounds, `409` twice or after the run finished. |
| `POST /internal/usage/hosting { samples: [{ sampleId, appId, from, to, awakeSeconds, memoryBytes, storageBytes, requests }] }` | → `{ recorded, duplicates, credits }`. One `hosting` ledger entry per sample; a `sampleId` is charged once. **Two reporters**, each sending its own samples: Dock (`dock:<instance>:<app>:<period start>` — awake seconds and mean memory from its memory sampler, the app database's size, `requests: 0`) and Edge (`edge:<process>:<app>:<period start>` — the requests it forwarded, nothing else), every `UsageReportSeconds` (300). Edge alone sees requests, so it reports them rather than handing counts to Dock. A sample not taken is resent under the same id; one refused for good (4xx) is dropped. |

## Control plane — platform API for apps (`/platform/v1`, app token)

Exactly PLATFORM-API §3: `identity/resolve`, `models/chat`, `secrets/{name}`, `email`, `schedules`,
`webhooks`, `telemetry/events`, `otlp/v1/{traces,metrics,logs}`. What it adds to that file:
`401 app_token_invalid` for a missing or superseded token; `models/chat` task types map to the
app-safe routes `app.chat`, `app.classify`, `app.summarise`, `app.extract`, and a call is also held to
the app's monthly model allowance (setting `app_models.monthly_credits`, default 500) —
`402 budget_exhausted` with `bindingScope: "app models"`; `402 overdraft_limit` at the overdraft
limit; OTLP accepts protobuf or JSON, optionally gzipped, and answers an empty response in the
request's encoding.

## MCP (`/mcp`, `/mcp/apps/{appId}`, personal access token)

The official C# SDK (`ModelContextProtocol.AspNetCore` 2.4.0), streamable HTTP, stateless. Both
endpoints accept only `Authorization: Bearer egp_…` (`/api` never accepts a token, `/mcp` never a
cookie); `401` otherwise. A token acts as its person, held to its organisation (any other is `404`)
and to the lower of its role and theirs; God mode is never available through one. No OAuth
authorization server exists (the token is made in the console), so no protected-resource metadata
is published.

- **`/mcp`** — the control plane's tools, each calling the service the public endpoint calls behind
  the same role check: `tree_get`, `node_create`, `node_update`, `cascade_get`, `cascade_set`,
  `cascade_remove`, `idea_estimate`, `idea_submit`, `idea_get`, `idea_decide`, `ideas_suggest`,
  `ideas_suggestions`, `suggestion_take`, `runs_list`, `run_get`, `run_events`, `run_control`,
  `approval_answer`, `tasks_list`, `credits_get`, `budget_set`, `employees_list`, `employee_get`,
  `employee_update`, `employee_release`, `hires_list`, `hire_raise`, `hire_decide`, `autonomy_get`,
  `autonomy_set`, `rule_set_set`, `members_list`, `member_invite`, `member_revoke`, `secrets_list`
  (names only), `secret_set`, `secret_remove`, `app_get`, `app_settings`, `app_ask`, `app_versions`,
  `app_restore`, `conversation_post`, `ontology_get`, `notifications_list`. The actor is `mcp`, not a
  person: `access: public`, an organisation's deepest or own overdraft, top-ups and the export are
  impossible; a red line refuses a build for everyone. A refusal is a tool result with `isError: true`
  and the problem `{ status, code, title, detail }` as its text and structured content.
- **`/mcp/apps/{appId}`** — one tool per operation of the app's OpenAPI document (`openapi/v1.json`,
  PLATFORM-API §2), fetched through Edge and cached per published version: name from `operationId`,
  description from the operation, input from its path and query parameters plus `body` (the JSON
  request body, `$ref`s inlined). `_platform`, `_endgame`, `hooks`, `health` and `openapi` paths are
  never offered. Listing needs a role on the app (Viewer); a call goes to the app with a fresh
  app-scoped member session (`X-Endgame-Session: egs_…`), so the app sees that person as at its door,
  and answers `{ status, body, truncated }` (an app's 4xx/5xx is an error result with its `code`).

**What Edge must serve for it** (control listener, service token): `ANY /internal/apps/{appId}/call/{**path}`
— wake the app if it sleeps, forward method, query, body, `Content-Type` and the `X-Endgame-Session`
header unchanged to `http://app-<id:N>:8080/{path}` with the path form's `X-Forwarded-Prefix`, return
the app's status, `Content-Type` and body; `400` for a `_platform/` path, `404` for an app it does not
route, `409` paused or unpublished, `503` when it cannot be woken. `AppCalls__Transport=direct` posts
straight to the container instead.

## Ask about this app

Four views in schema `ask`, `security_invoker`, each one app's telemetry only:
`requests(at, method, route, path, status, duration_ms, failed)`, `errors(at, source, status, route, message)`,
`events(at, name, user_id, properties)`, `metrics(at, name, unit, type, value, count, sum)`. The model
(route `ask`, two calls plus one uncharged repair) writes one query; three fences hold it:

1. **The guard** (`TelemetrySqlGuard`): one `SELECT` or `WITH … SELECT`; relations only the four views
   (or a CTE defined earlier); functions from an allow-list; casts to a list of types; no comments,
   quoted identifiers, dollar quoting, escapes, `INTO`, locks or session statements.
2. **The role**: the query runs in a read-only transaction as `endgame_ask` (no login, no inherit),
   which may read only the views and the four telemetry tables under them; the tenant policy pins
   the organisation and a restrictive policy for that role pins the app, from transaction-local
   settings. `set_config` is executable only by `endgame_app` and `endgame_system`, so a query cannot
   move its own pins.
3. **Limits**: `statement_timeout` (`Ask:StatementTimeoutMs`, 3000) and at most `Ask:MaxRows` (500) rows.

## Prices

One settings document (`platform_settings`, key `pricing`), its every change in
`platform_setting_changes` (append-only). Every scope resolves `CreditOptions`, the hosting rates and
the default per-app model allowance from it (cached 30 s, refreshed at once on a change); configuration
holds the defaults until the first save.

## Platform → app callbacks

A schedule run is `POST <app>/_platform/schedules/<name>` with body `{ "scheduledFor" }`, signed
`X-Endgame-Signature: t=<unix>,v1=<hex HMAC-SHA256(app token, "<t>." + body)>`. The control plane
sends it to **Edge's control listener** as `POST {EdgeControl}/internal/apps/{appId}/platform/schedules/<name>`
with the service token and the signature header; Edge wakes the app if it sleeps and forwards the
body and signature unchanged to `http://app-<id:N>:8080/_platform/schedules/<name>`, returning the
app's status (`400` without a signature, `404` for an app it does not route, `409` for a paused or
unpublished one, `503` when it cannot be woken). `204` is success. `Scheduler__Transport=direct`
posts straight to the container instead.

## Dock — internal API

`POST /internal/workspaces`, `GET`/`DELETE /internal/workspaces/{id}`, `PUT …/lease`,
`POST …/exec`, `GET`/`PUT …/files`, `POST …/commit`; `POST /internal/repos`,
`GET /internal/repos/{appId}` and `…/log`, `…/files`, `…/archive`, `…/export`, `POST …/restore`;
`POST /internal/apps/{id}/build`, `…/start`, `…/stop`, `…/wake`, `PUT …/egress`,
`GET /internal/apps` and `…/{id}`, `DELETE …/{id}`; `POST /internal/usage/flush`. Shapes are in
`Endgame.Hosting.Contracts`.

**Owed by Dock** (the control plane calls it; built and tested against a fake):
`GET /internal/apps/{id}/database/dump` → `200 application/octet-stream`, a `pg_dump --format=custom`
of the app's own database (Dock alone knows its opaque name; its image needs `pg_dump` 16), streamed;
`404 { code: "not_found" }` when the app has no database yet. Until it exists, the export answers `502`. `start` asks the control plane for a fresh app token
(`POST /internal/apps/{id}/token`) unless one is given, and injects it as `ENDGAME_APP_TOKEN`.

## Edge — control listener (`:8081`, service token)

`POST /internal/routes/refresh` → `{ version, apps }`; `POST /internal/apps/{id}/state` (Dock's crash
reports); `POST /internal/apps/{id}/platform/schedules/{name}` (platform callbacks, above);
`POST /internal/usage/flush` (closes the hosting-usage period now); `GET /internal/apps`,
`GET /internal/routes`. The control plane calls `routes/refresh` when access, settings, budgets,
webhooks or the balance change, best effort.

## Edge — the identity pages (`<app address>/_endgame/auth/*`, public side)

| Page | What |
| --- | --- |
| `sign-in`, `sign-up` | Pages served by Edge itself (strict CSP, per-response nonce) that drive `/api/app-auth/{appId}/*` and, for members, `/api/auth/passkey/login/*`; the development sign-in when `GET /api/app-auth/{appId}` advertises it. Served on the platform's host: on an organisation subdomain they redirect there (with an absolute `returnTo`) and come back through `handoff`. |
| `handoff?code=…` | `POST /internal/access/handoff`; on success sets the returned cookie host-only (`HttpOnly`, `SameSite=Lax`, `Secure` over https) and redirects to the returned `returnTo`, re-checked to be inside the app; `410` page otherwise. |
| `sign-out` | `POST /api/auth/logout` when the visitor carries the console session, otherwise `POST /api/app-auth/{appId}/sign-out`; the cleared cookies are passed back. |

`returnTo` must be a path inside the app's address on this host, or an absolute address inside either
of its two addresses (same scheme and port, no credentials); anything else is replaced by the app's
home. Before forwarding any request to an app Edge strips every `endgame.*` cookie and every
client-sent `X-Endgame-*` header.

## Run log — the event stream

One append-only table, `run_events (organisation_id, run_id, seq, type, at, payload)`. `seq` is
assigned by the control plane and gapless per run. Types: `run.started`, `run.paused`,
`run.resumed`, `run.finished`, `model.requested`, `model.replied`, `approval.requested`,
`approval.answered`, `task.created`, `task.claimed`, `task.done`, `task.failed`, `message`, plus the
plan, tool, sub-agent, evaluation and estimate types the harness writes. `model.requested` and
`model.replied` carry the `employeeId` the call is charged to, and every ledger line carries it too.
`estimate.scored` is `{ expectedCredits, actualCredits, nonBillableCredits, modelCalls }` (older `{ estimated, actual }` is read too).

## Credits

One ledger, `credit_entries`, append-only: `top_up`, `reservation`, `settlement`, `release` and
`hosting`. Balance and spend are derived from it: spend is settlements and hosting, both counted by
every budget. Cost becomes credits in one place, `CreditOptions.ToCredits`: US$ × `CreditsPerUsd` ×
`Margin` (a factor; 1.0 is no margin). A reservation expires with its run's lease and the sweep
writes its release. Repair work is recorded with `billable = false`. The overdraft is the
operator's limit for the organisation (`overdraft_limit` at the organisation), narrowed by the
organisation's own (`overdraft_own_limit`) and by any `overdraft_limit` lower on the chain; it never
carries interest or fees. An employee's own monthly cap counts what the contractors it briefs spend, and a
contractor is held to its own cap and its briefer's.

## The app kit

A generated app is a .NET API that serves its own built front end, built against the kit: it runs
under both address shapes, exposes `/health` and its OpenAPI description, reaches the platform only
through the kit with the token Dock injects, and has no outbound access except through the egress
proxy. PLATFORM-API.md is the contract.

## The `suggest` run (owed by the Runner)

A Builder's `POST /api/ideas/suggestions` queues a run of kind `suggest` at the organisation or a
division, its log opening with `estimate.made { credits, basis: "suggest" }` and a `message`
`{ from: owner, kind: ideas.suggest, text }`. The Runner claims it like any run
(`kinds` including `suggest`), reads `GET /internal/runs/{id}/suggestion-context` (and the ontology,
`GET /internal/ontology?scope=`), makes its model calls on the `research` route with the run id (so
they are reserved, attributed and capped as usual, within `Estimates:SuggestCalls`, 6), posts one to
five suggestions to `POST /internal/runs/{id}/suggestions`, then finishes the run (`run.finished`).
Each suggestion names the gap it fills, why this organisation is placed to build it (from its
products and ideas), and what it would reuse; none repeats `alreadySuggested` or an existing idea.

## Ports and names (inside the compose network)

Every service listens on `8080`; Edge's control listener on `8081`. Names: `edge`, `control-plane`,
`runner`, `dock`, `console`, `postgres`, `egress`, `ops`, and in development `mailcatcher` (SMTP `1025`).
App containers are `app-<app id>`, workspaces `ws-<run id>`. The control plane finds its peers through `Services__ControlPlane`, `__Edge`,
`__EdgeControl`, `__Runner`, `__Dock`, `__Console`, `__Ops`, `__Collector`, whose defaults are these names in
every environment (`__Ops` empty: no ops service, organisation names are checked against the built-in list).
