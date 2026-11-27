# ARCH-004 — Service contracts

The interfaces between Endgame's services, as built by the four control-plane passes, the Dock and
Edge lane, the Runner lane, the app kit and the wiring lane. A lane may add to its own service freely; it changes a contract here
only by editing this file first. The app-facing half is fixed field for field in
[`src/appkit/PLATFORM-API.md`](../../src/appkit/PLATFORM-API.md); the shared hosting types are in
`src/backend/Endgame.Hosting.Contracts`. What runs where is in `MEMORY.md`.

## Who may talk to whom

| Caller | Callee | How | Why |
| --- | --- | --- | --- |
| Browser | Edge | HTTPS | The only door. Edge routes `/api/*`, `/mcp` and `/mcp/*` to the control plane, apps at their addresses, the console otherwise. |
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
| App | `draft`, `building`, `running`, `sleeping`, `stopped`, `failed`, `archived` | `running`: `asleep`, `awake`, `always-on`, `starting`, `paused`; `health`: `healthy`, `degraded`, `down`, `unknown`, `paused` |
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

An app's `running` and `health` (`health.state` on its page) are `paused`, `paused` is
`{ reason: budget_exhausted|overdraft_limit, note }` and `health.summary` says why, whenever the routing table pauses
it — on the app page and the chart alike, never "healthy" while Edge serves the holding page. Otherwise health is `down`
for a failed app, or what its own telemetry measured over fifteen minutes (`degraded` when more than one response in twenty
failed). The chart's app row carries the app's `status`. An app (and the project holding it) whose latest build ended
`failed` or `cancelled` with nothing ever published carries `notBuilt { reason: cancelled|failed|budget|plan-declined, note,
runId, ideaId }`; its project's `stage` is `not-built`. A build run moves to the app it was placed in when its `placement`
step is logged, and the gateway charges a run's calls at the run's own scope when that is narrower than the call's.
`GET /api/credits` and the chart's organisation carry `neverToppedUp`; `POST /api/organisations` answers `balance` (0) and
`creditsNote`. `PublicRun` adds `detail` and `reason` from its `run.finished`; an idea's `tryAgain.why` adds `start-declined`.
An approval (and its needs-you item and notification) carries `technical` beside the plain `detail`; its `status` is
`pending`, `approved`, `rejected` or `expired` — closed by the platform, with `answeredBy` null and the comment "The work
ended before this was answered.", when its run ended first (R3-2). An evaluation event may carry `rechecked`, `stoppedEarly`
and, per requirement, `tests` (the screen tests code ran and saw pass). `task.claimed` carries
`holder` and `summary`. The data-flow graph has `app → service:data` for an app that has run or stores data.

## Control plane — public API (`/api`, member cookie)

| Area | Endpoints |
| --- | --- |
| Session | `GET /api/auth/options`; `POST /api/auth/passkey/register/{options,complete}`, `POST /api/auth/passkey/login/{options,complete}`; `POST /api/auth/logout` (also revokes every app session the member holds — at every app, on the platform's host and every organisation subdomain, from any browser — spends their unredeemed hand-offs, and ends every app end-user session the browser carries; a member's subdomain session lives `AppSessions:MemberSessionHours`, 12 by default); `POST /api/auth/development` (Development and `ENDGAME_DEV_LOGIN=true` only); `GET /api/me` |
| Tree | `GET /api/tree?organisation=` (an operator may name any organisation: logged once per visit, UC-111 step 4) — every node (`organisation`, `divisions[]`, `projects[]`, `apps[]`) carries `role`, the viewer's effective role there as `RoleResolver` decides it (null where they hold none), and divisions, projects and apps carry `archived`; with no organisation, `firstRun` says whether the person may name the first; `POST /api/organisations`, `POST /api/divisions`, `/projects`, `/apps`; `PATCH`/`DELETE` `…/{id}` (a status change recalculates the routes: an archived division or project is not served) |
| Cascade | `GET /api/cascade?scope=&kind=`, `PUT /api/cascade { scope, kind, key, value }`, `DELETE /api/cascade?scope=&kind=&key=` |
| Members | `GET /api/members?scope=` → `[{ membershipId, userId, email, displayName, scope (where the grant was set), role, hasPasskey, grantedAt, invitationExpiresAt }]` (Admin) — every grant that holds at the scope: set there, beneath, or above it on its chain; `POST /api/members { scope, email, displayName, role }` → `{ member, invitationCode, expiresAt, emailed }` (code once, 7 days; `emailed` when a mail server is configured); `PATCH /api/members/{membershipId} { role }` → the same shape, never a new code (Admin; to or from `admin`, the Owner); `POST /api/members/{membershipId}/invitation` → the same shape with a new code, once, the old one void (409 for someone with a passkey); `DELETE /api/members/{membershipId}` → `{ revoked, invitationCancelled }` (`invitationCancelled` when it was the last grant of someone with no passkey, whose pending invitation code is cancelled with it; MCP `member_revoke` answers the same) |
| Access tokens | `GET /api/tokens` → `[AccessToken]`; `POST /api/tokens { name, organisation, role?, expiresInDays? }` → `201 { token, accessToken }` (the token `egp_…` once; role at most the caller's highest in the organisation, never `owner`, default theirs and `admin` for an Owner; `expiresInDays` 1–366 or none); `DELETE /api/tokens/{id}` → `AccessToken` (revoked). `AccessToken { id, name, organisation, role, prefix, createdAt, expiresAt, lastUsedAt, revokedAt, active }` |
| Secrets | `GET /api/secrets?scope=` → `{ scope, effective: [{ name, setAtLevel, setAtPath, setAt, inherited, overrides }], setBelow: [{ name, setAtPath }] }` — never a value; `PUT /api/secrets { scope, name, value }`; `DELETE /api/secrets?scope=&name=` (Admin and above) |
| Credits | `GET /api/credits?scope=` (balance, month `{ spent, ai, hosting }`, budgets in tree order, estimates, not charged, overdraft `{ frostauraLimit, ownLimit, limits: [{ scope, name, level: division|project|app, credits, setAt, setBy, setByName }] }` — `limits` the narrower limits on the scope's chain above it and beneath it, in tree order, `[]` when none — top-ups, held, available); `POST /api/credits/top-ups { organisation, credits, note, idempotencyKey?, requestId? }` (operators; `requestId` marks that request fulfilled); `PUT /api/credits/overdraft { scope, credits }` → `CreditsView` (at the organisation its own limit, Owner; beneath it a narrower one, Admin; never deeper, 400); `POST /api/credits/top-up-requests { organisation?, credits, note? }` → `201 TopUpRequest` (Owner; at most five open); `GET /api/credits/top-up-requests?organisation=` → `[TopUpRequest]` (Admin). `TopUpRequest { id, organisation, organisationName, credits, note, status: open|fulfilled|declined, requestedBy, requestedByEmail, requestedAt, closedAt, closeNote, topUpEntryId }` |
| Ideas | `POST /api/ideas/estimate { text, constraints?, scope? }` → `{ credits, basis }` (with `scope`, an organisation the caller belongs to, the estimate uses its history), `POST /api/ideas`, `GET /api/ideas/{id}` (adds `history: [{ verdict, headline, choice: change|retry, note, by, at, runId }]` — the decisions taken on earlier rounds of research, read from the research runs, oldest first — and `tryAgain: { runId, what: research|build, why: failed|cancelled|budget|plan-declined } | null`), `POST /api/ideas/{id}/decision { choice, note?, applyChange? }` (`applyChange: true` with `build` on a `change` verdict builds research's `suggestedChange` in; `409` on any other verdict). A new verdict clears the decision that led to it, so the owner decides again; every change the owner asked for, and research's when accepted, goes to the build as the owner message's `changes[]`. *Estimates* below says how each figure is made. |
| Ideas from the portfolio | `POST /api/ideas/suggestions/estimate { scope }` → `{ credits, basis }`; `POST /api/ideas/suggestions { scope }` → `201 { run: PublicRun, estimate }` (Builder; a `suggest` run, its `estimate.made` in the log); `GET /api/ideas/suggestions?scope=` → `[Suggestion]` (Viewer); `POST /api/ideas/suggestions/{id}/take { constraints? }` → `201 PublicIdea` (research queued with its estimate); `POST /api/ideas/suggestions/{id}/dismiss` → `Suggestion` (Builder). `Suggestion { id, scope, runId, title, idea, gap, whyUs, reuses[], status: open|taken|dismissed, ideaId, createdAt }` |
| Runs | `GET /api/runs?scope=&employeeId=&kind=&status=&limit=` → `[PublicRun]` newest first, at most 100 (Viewer; with `employeeId`, the runs the employee **worked in** — it owns the run, claimed a task in it, or a model call in it was charged to it; `employeeId` alone: anywhere in its organisation, needing Viewer where the employee works and leaving out each run the caller may not see); `GET /api/runs/{id}`, `GET /api/runs/{id}/events` (server-sent events, resumable), `POST /api/runs/{id}/{pause,resume,cancel}`, `POST /api/runs/{id}/approvals/{approvalId} { decision: approve|reject, note? }` (the note, at most 2000 characters, goes back to the waiting work with the answer). **Try again** (CHG-03): `POST /api/runs/{id}/retry/estimate` → `{ runId, what: research|build|change, credits, basis, partsDone, parts }` (Builder; free; `partsDone`/`parts` null when no plan was agreed) and `POST /api/runs/{id}/retry` → `201 PublicRun` (Builder): a new run for the latest failed or cancelled research, build or change, its `estimate.made` first; a build or change carries on from what the earlier one placed, agreed and finished (ARCH-006, *Trying again*). `409 not_retryable` for anything else, `409` for an attempt already tried again. `PublicRun` adds `canTryAgain`; `GET /api/runs/{id}` also gives `firstEstimateCredits` (the estimate shown before the work began) and `planEstimateCredits` (the re-estimate from the plan, null until then) beside `estimateCredits` (the latest). |
| Tasks | `GET /api/tasks?scope=&status=&limit=&employeeId=` → `[Task]` (Viewer; with `employeeId`, the tasks that employee claimed). `Task { id, scope, runId, parentTaskId, title, description, status, holderRunId, holderEmployeeId, claimedAt, estimateCredits, actualCredits, dependsOn[], createdAt, updatedAt, employeeId }` — `holder*` only while it is in progress; `employeeId` is who claimed it last, kept once it is finished |
| Apps | `GET /api/apps/{id}` (health, running, addresses, `telemetry { visitsToday, requestsToday, errorsToday, latencyP50Ms, latencyP95Ms, lastVisitAt }` or null before anything was measured, cost, settings, `runningCost { state: estimated|not-enough-history, windowDays: 14, minimumHours: 24, measuredHours, basis, prices, sleep: { credits, awakeHoursPerMonth, basis } | null, alwaysOn: { credits, awakeHoursPerMonth: 720, basis } | null, measured: { awakeHours, memoryMb, storageMb, requestsPerMonth } | null }` (never null; from the app's own `hosting_samples` and the current pricing document, UC-107 A2), `sharedWith`, `endUsers` (registered end users; members are not counted)); `POST /api/apps/{id}/settings { running?, access?, idleMinutes? }` (access needs Admin; `public` only from a person). **Changing a built app** (CHG-01): `POST /api/apps/{id}/changes/estimate { request }` → `{ credits, basis }` (Builder; free) and `POST /api/apps/{id}/changes { request }` → `201 PublicRun` (Builder): a `task` run at the app (shown as `factory`), titled `Change: <first line>`, whose owner message is `{ from: owner, kind: change, text, userId, via }` and whose `estimate.made` comes first; `409 app_not_built` before the app was ever published, `409 app_busy` while another build or change of it is under way, `400` for an empty request. ARCH-006, *Changing a built app*. |
| Ask about this app | `POST /api/apps/{id}/ask/estimate { question }` → `{ credits, basis }` (Viewer); `POST /api/apps/{id}/ask { question }` → `{ question, answer, chart: { kind: line|bar|number|table, x, y[], series: [{ name, points: [{ x, y }] }] }, sql, columns[], rows[], truncated, credits: { estimate, charged } }` (Builder; charged to the app; `sql` is for technical mode); `422 ask_unanswerable` (a repaired query still refused or failing, or the model declined; title and detail plain, naming no query, column or database) / `422 query_timeout`, each with `technical: { sql, error }` (the last query tried and the guard's or database's message; technical mode only; absent when the model declined at once); `503 ask_unavailable` with no `ask` route or no views. Dashboard: `GET /api/apps/{id}/dashboard` → `[{ id, question, answer, sql, chart, columns, rows, truncated, askedAt, ranAt, error, technical: { sql, error } | null }]` re-run on read (Viewer; `error` is plain words, `technical` the message behind it); `POST /api/apps/{id}/dashboard { question, sql, chart?, answer? }` → `201` (Builder; the query is guarded again; at most 30); `DELETE /api/apps/{id}/dashboard/{questionId}` (Builder) |
| Versions and export | `GET /api/apps/{id}/versions?skip=&limit=` → `{ appId, live, versions: [{ commit, message, at, author: { kind: employee|person|factory, id, name }, live }], hasMore }` (Viewer); `POST /api/apps/{id}/versions/{commit}/restore` → `{ version, published, madePrivate, publishError }` (Builder; a new commit by the person, rebuilt and restarted; a public app becomes private); `GET /api/apps/{id}/export` → `application/gzip`, `<app slug>-export.tar.gz` holding `<slug>/manifest.json`, `code.bundle` (git bundle, whole history), `database.dump` (pg_dump custom, absent when the app never ran) and `platform.json` (end users without passkeys, shares, schedules, webhooks, custom events) (Owner only) |
| Sharing | `GET /api/apps/{id}/shares`, `POST /api/apps/{id}/shares { email }` → `201 { email, invitationCode, expiresAt, emailed }` (code shown once; `emailed` when a mail server is configured: the person gets the app's address and the code), `DELETE /api/apps/{id}/shares?email=` |
| Conversation | `POST /api/conversations/estimate { scope, employeeId? }` → `{ credits, ceiling, basis }` (Viewer; free; the most one message can cost — every call reserved at its worst case — and what it usually costs); `POST /api/conversations { scope, message, employeeId?, conversationId? }` → a run, whose log opens with the message and that estimate; `GET /api/conversations?scope=&employeeId=` → `{ scope, conversationId, employeeId, messages: [{ runId, seq, at, from, text, by, code }] }` — `by` is who said it by name (the person who sent it, or the employee who answered; null for Endgame's assistant), `code` a notice's reason (`budget_exhausted`); harness bookkeeping is left out. |
| Autonomy | `GET /api/autonomy?scope=` → `{ scope, autonomy: auto|checkpoints, autonomySetAtPath, checkpoints: { start, plan, hire: { on, setAtPath } }, ruleSets: [{ stage, deny[], ask[], allow[], checkpoints[], setAtPath, overrides[] }], stages[] }` (Viewer); `PUT /api/autonomy { scope, autonomy?, checkpoints?: { start?, plan?, hire? } }`, `DELETE /api/autonomy?scope=&key=`, `PUT /api/autonomy/rule-sets { scope, stage, deny?, ask?, allow?, checkpoints? }`, `DELETE /api/autonomy/rule-sets?scope=&stage=` (Admin and above; each answers the view) |
| Workforce | `GET /api/employees?scope=&includeReleased=&kind=` → `[Employee]`; `GET /api/employees/{id}` → `{ employee, trackRecord, contractors[], reports[] }`; `GET …/{id}/track-record`; `PATCH …/{id} { name?, role?, jobDescription?, reportsTo?, clearReportsTo?, clearMonthlyCreditLimit?, status?: paused|idle }`, `POST …/{id}/reassign { scope, reportsTo? }`, `POST …/{id}/release`, `POST …/{id}/rehire { scope? }` (Admin); `GET /api/employees/recurring-roles?scope=` |
| Memory | `GET /api/employees/{id}/memory?scope=&includeArchived=` → `[MemoryEntry]`; `GET …/memory/changes?limit=`; `POST …/memory { title, body, kind, scope? }`, `PATCH …/memory/{entryId} { title?, body?, kind? }`, `DELETE …/memory/{entryId}?why=`, `POST …/{id}/reviews` → the queued `review` run (Builder) |
| Hires | `GET /api/hires?scope=&status=`, `GET /api/hires/{id}` → `Hire`; `POST /api/hires { scope, name, role, jobDescription, reportsTo?, expectedMonthlyCredits, reason, needKey?, trigger? }`, `PATCH /api/hires/{id}`, `POST /api/hires/{id}/accept { note? }`, `POST /api/hires/{id}/decline { note? }` (Admin) |
| Ontology | `GET /api/ontology?scope=&view=all|org-chart|data-flow` → `{ scope, generatedAt, nodes: [{ id, type, name, scope, status, attributes }], edges: [{ from, to, type, label }], views }` |
| God mode (operators only; never by access token) | `GET /api/operator/organisations` → `[{ id, slug, name, status, createdAt, balance, standing: in-credit|overdrawn|at-limit, overdraft: { frostauraLimit, ownLimit, effective }, apps, lastActivityAt, openTopUpRequests }]`; `POST /api/operator/organisations/{slug}/enter` → `{ organisationId, organisation, role: admin, enteredAt, logged }` (logged for the Owner); `PUT /api/operator/organisations/{slug}/overdraft { credits }` → the organisation's summary (logged `overdraft.set`); every change an operator makes inside an organisation through the member API is logged `admin.<EndpointName>` with `detail { title, scope, method, path }` and nothing from the body; `GET /api/operator/top-ups?organisation=` → `[{ id, organisation, organisationName, credits, note, at, by, byEmail }]` (`organisation` is the address name, `organisationName` the display name the console shows; the address name only in technical mode); `GET /api/operator/top-up-requests?status=` → `[TopUpRequest]`; `POST /api/operator/top-up-requests/{id}/close { status: fulfilled|declined, note?, topUpEntryId? }` → `TopUpRequest` (logged); `GET /api/operator/pricing` → `{ pricing, source: defaults|stored, updatedAt, updatedBy, history: [{ at, by, byEmail, before, after }] }`; `PUT /api/operator/pricing { creditsPerUsd, margin, hosting: { usdPerAwakeHour, usdPerGbHourMemory, usdPerGbMonthStorage, usdPerMillionRequests }, defaultAppModelMonthlyCredits }` (audited; margin ≥ 1.0; logged `pricing.changed` in every organisation). `POST /api/organisations { name, slug, ownerEmail, ownerDisplayName?, description, screening?: { decision: clear|breach, reason } }` → `{ id, slug, name, ownerEmail, ownerInvitationCode, invitationExpiresAt, invitationEmailed, nameCheck: { slug, source: cloudflare|built-in, note }, screening: { method: model|manual, result: clear, reason } }` — `description` is screened against the red lines through the model gateway's platform path (cost in `platform_costs`, charged to no organisation) and the screening is logged `organisation.screened`; `422 red_line` (with `line`), `503 screening_unavailable` (no model, no manual decision), `400` (no description), `409 reserved_name`, `503 reserved_names_unavailable`. A top-up with `requestId` closes it with its note and logs `topup_request.fulfilled`. `GET /api/audit/operator-access?organisation=` (the Owner only) → `[{ id, at, action, operator { id, email, displayName }, detail }]` |
| Notifications | `GET /api/notifications?organisation=&unread=&limit=` → `{ organisation, unread, notifications: [{ id, kind, severity: info|urgent, title, detail, scope, subject: { kind, id } | null, createdAt, read, emailedAt, resolved }] }` (`resolved`: a `verdict`, `approval` or `hire` whose question is already answered — its `title` then says what happened, "You approved “…”", "Theo was hired as …", it is `read`, and it is not counted in `unread`) (Admin and above where the grant covers the node; others an empty feed); `POST /api/notifications/{id}/read` → 204; `POST /api/notifications/read-all?organisation=` → `{ marked }`. Kinds: `verdict`, `approval`, `hire`, `budget.80`, `budget.cap`, `credits.zero`, `overdraft.half`, `overdraft.limit`, `app.crashed`, `security.finding`; the urgent ones (`budget.cap`, `credits.zero`, `overdraft.*`, `app.crashed`, `security.finding`) are also queued as e-mail to the organisation's Owner and Admins when a mail server is configured |
| System | `GET /api/system/status` (signed out: `{ overall, checkedAt }` only; signed in: with `services[]`), `GET /api/openapi/v1.json` |

Errors are problem details with a stable `code`. A failed read is distinguishable from an empty one.

The workforce's shapes, field for field:

- **Employee** `{ id, kind, name, role, status, standing, scope, reportsTo: { id, name } | null, briefedBy: { id, name } | null,
  jobDescription: { mandate, scope, tools[], services[], monthlyCreditLimit, modelTier }, idle: { flagged, since, afterDays },
  currentRun: { id, title } | null, lastRunId, lastActiveAt, createdAt, releasedAt, memoryEntries, brief }`. `services` are
  `identity`, `models`, `secrets`, `email`, `schedules`, `webhooks`, `telemetry`; `modelTier` is a routing-table task type.
- **TrackRecord** `{ employeeId, work: { accepted, sentBack, acceptedPercent, judged }, runs: { finished, succeeded, failed, cancelled },
  repairsNotCharged: { credits, calls }, cost: { toDateCredits, monthCredits, ownToDateCredits, ownMonthCredits }, contractors: { engaged, working, toDateCredits, monthCredits },
  estimates: Estimates | null }` — derived on read, the work being the employee's wherever the run belongs: `accepted` is
  judgements of its work that passed (`evaluation.passed` whose `employeeId` is the employee; one without `employeeId`
  judges the run's owner), plus tasks it claimed and finished that no judgement names (`taskId`), plus succeeded runs of its
  own with neither; `sentBack` is judgements of its work that failed; `judged` the judgements it made (`judgedBy`); `runs`
  counts the runs it worked in (as `GET /api/runs?employeeId=`); cost is billable settlements and hosting with the
  employee's id **plus the contractors it briefs** (as its cap counts them; `own…` is its share alone); `estimates` are those
  of runs it owns, or — for a run nobody owns, such as a factory build or research — the employee its billable model calls
  were mostly charged to, a contractor's calls counting as its briefer's. `GET /api/employees/{id}` adds `recentRuns`
  `[{ id, title, kind, status, startedAt, finishedAt }]`: the runs it led, newest first (up to 12). A contractor is
  released, its activity cleared, when the run that briefed it ends in any way; the sweep closes one left open.
- **Estimates** (here and in `CreditsView`) `{ pieces, withinPercent, under, over, largestMissPercent, typicalGapPercent, typically }`
  from `estimate.scored`: `withinPercent` the share of pieces within 10% of their estimate, `under`/`over` the pieces more than
  10% below/above it, `largestMissPercent` the largest |cost − estimate| / estimate; `typicalGapPercent` the **median of
  (cost − estimate) / estimate** across pieces with an estimate above zero, in percent with its sign (−83.8: the work usually
  cost 84% less than estimated), null when there is none; `typically` `under`, `over`, or `within` when that median is within
  10% either way. The console says it as "Usually 84% under the estimate" / "Usually 20% over the estimate" / "Usually within 5%".
- **Hire** `{ id, status, trigger, needKey, scope, reason, name, role, jobDescription, reportsTo, expectedMonthlyCredits, withinBudget,
  headroomCredits, contractorRole, raisedBy: person|runner, raisedByRunId, decision: { via, by, at, note } | null, employeeId, createdAt, withdrawn }`.
  `expectedMonthlyCredits` is never above `jobDescription.monthlyCreditLimit` when that is set. `withdrawn` is a decline made by the
  platform (no person): a build that ended without publishing anything withdraws the open proposals it raised, and a need someone
  above now covers withdraws its open proposal; `decision.note` says why and `decision.by` is "Endgame".
- **MemoryEntry** `{ id, employeeId, scope, title, body, kind, sourceRunId, createdAt, updatedAt, lastReviewedAt, archived }`;
  **MemoryChange** `{ id, memoryId, action, by, userId, runId, detail, at }`.
- `GET /api/tree` workers are `{ id, name, role, kind, activity, status, idle, standing, briefedBy }` — employees and contractors
  while they work; `activity` is the title of the run under way (`running` or `waiting_approval`) that the employee works in — its
  own, or one it claimed a task in or had a model call charged to — and `status` reads `working` then; `GET /api/employees/{id}`'s
  `currentRun` and `status` say the same; `needsYou[]` adds `{ kind: "hire", id, hireId, title, detail, scope, expectedMonthlyCredits }` and
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
| `POST /internal/model/chat` | Task type, scope, run, employee, messages, tools, limits, `providerOrder[]` (sent as `provider.order`). Routes by task type, reserves in the transaction that admits, sends the price ceiling, settles from the reply. Optional parameters (reasoning, temperature, tool choice, parallel tool calls, response format) are sent only when every model on the route lists them in its catalogue `SupportedParameters`. `preferJson: true` (the harness, for an answer code reads) adds `response_format: json_object` when the call has no tools and every model takes it, and nothing otherwise; `structured: true` (an answer read as data) gives the model's reasoning a budget (`reasoning.max_tokens`, a quarter of the output cap) instead of the route's effort. `402 budget_exhausted` (terminal for the run) or `402 overdraft_limit` (terminal until a top-up), whose `detail` is the sentence people read (the level by its name, never its path) and whose `forAgent` is what an agent or client is told to do ("This is terminal for the run: do not retry it."), beside `bindingScope` (the path); `422 ceiling_unreachable`. Building tiers: `build`, `build-t1`, `build-t2`, `build-t3`. |
| `POST /internal/tree/nodes { parent, level, name, slug }` | Placement: `201 { id, level, slug, name, path, status, createdAt }`, or `200` with the node that already has that slug. |
| `GET /internal/credits/headroom?scope=&employeeId=` | `{ scope, headroomCredits, bindingScope, binding: budget|overdraft, balance, overdraftLimit }`: the tightest monthly cap on the chain (and the employee's, which covers its contractors), or the balance down to the overdraft limit. |
| `GET /internal/estimates/history?taskType=<run kind>&scope=&limit=` | `[{ runId, finishedAt, credits, steps }]`: billable actuals of succeeded runs of that kind in the scope's organisation, newest first. `scope` is required (`400 scope_required`): history never crosses organisations. |
| `GET /internal/estimates/accuracy?scope=&employeeId=` | `{ scope, employeeId, estimates }` from `estimate.scored`. |
| `GET /internal/tasks?scope=&status=&limit=`, `GET /internal/runs?scope=&kind=&status=&limit=`, `GET /internal/credits?scope=` | The conversation's reads: the same shapes as the public reads. |
| `POST /internal/ideas { scope, text, constraints[] }` | `201 { idea, run, estimate }`: research on the owner's confirmed word, proposed to the division (or organisation) the scope sits in. |
| `PUT /internal/cascade { scope, kind: "setting", key, value }` | An agent changes one allow-listed setting: `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`, `sleep.mode`, `sleep.idle_minutes`, `workforce.idle_days`; anything else `403 setting_not_allowed`. Never `access`. |
| `POST /internal/ideas/{id}/decision { decision: "build", by: "auto-mode" }` | Auto-mode builds after a build or change verdict where autonomy is auto → `{ idea, run }`. A do-not-build or checkpoints is `409 owner_decision_required`; any other decision `403`; a red line `403 red_line`. |
| `POST /internal/runs`, `POST /internal/runs/claim`, `GET /internal/runs/{id}`, `GET`/`POST /internal/runs/{id}/events`, `POST /internal/runs/{id}/lease` | Runs, their log (gapless sequence numbers) and leases. A refused lease is `409` with the run's status as `runStatus` (never `status`, which is the HTTP status; no extension may reuse a problem document's own member names). An append whose payload holds U+0000 anywhere (PostgreSQL's jsonb cannot store it) is `400 event_invalid` naming the first place (`events[1].payload.output.lines[1]: contains a NUL character …`), and nothing is appended. |
| `POST /internal/tasks`, `POST /internal/tasks/checkout`, `PATCH /internal/tasks/{id}` | The task graph; checkout is one conditional update. |
| `GET /internal/contents?scope=` | What is at the scope and beneath it, from the same tree document home counts (read as the Owner sees it): divisions, projects and apps, each app's state in words (`live`, `sleeping`, `building`, `never built`, `not built yet`, `paused`, `down`, `stopped`, `archived`) with its note, and `counts` (divisions, projects, apps, apps by state, employees, contractors working); at the organisation, home's own `summary` line. The conversation's `read_organisation` "contents", and the head of its "overview" (R5-1). |
| `GET /internal/context?scope=` | The resolved cascade: levels, context, rule sets, budgets, settings, secret names, roles; and `needsYou`, what waits on a person at the scope and beneath it, the same items home shows (verdicts, approvals, hire proposals, idle employees) — the organisation's conversation reads it. |
| `POST /internal/approvals { runId, title, detail, onDecline? }` | A checkpoint the run waits on. `onDecline` is `continues` (default: the step is not taken and the work goes on) or `stops` (the start and plan checkpoints): the console says which after a decline. |
| `POST /internal/apps/changes { scope, request }` | The conversation asks for a change to the app at `scope`, on the person's confirmed word → `201 { run, estimateCredits }`; `400` when the scope is not an app. |
| `POST /internal/runs/{id}/retry { scope }` | The conversation at `scope` tries stopped work in its own part of the tree again, on the person's word → `201` the new run; a run outside `scope` is `404`. |
| `POST /internal/ideas/{id}/verdict` | Research's verdict document, exactly as *The verdict document* below. Anything else is `400 verdict_invalid` with `errors[]`, one precise line per fault (`existing.products[0].name: required, a string of 1 to 120 characters`), and nothing is recorded. `409` when the idea is not being researched. |
| `POST /internal/employees { scope, name, role, mandate?, tools?, services?, monthlyCreditLimit?, modelTier?, reportsTo? }`, `GET /internal/employees?scope=&includeReleased=&kind=`, `GET /internal/employees/{id}` | The factory's direct hire; the workforce at and beneath a scope; one employee's detail (as the public shapes). |
| `POST /internal/hires { scope, trigger, needKey, reason, name, role, jobDescription, reportsTo?, expectedMonthlyCredits, contractorRole?, runId? }` | A need from the ontology → `201 { hire, created: true }`, or `200` with the accepted or live proposal for the same `needKey`. Accepted at once when within budget and the hire checkpoint is off. For a `stage`, `division` or `recurring` need, an employee with that role who works at the need's level or above it covers it: `200 { hire: { status: "covered", id, employeeId: <theirs> }, created: false, coveredBy: Employee }`, and nobody is proposed. |
| `GET /internal/employees/{id}/memory?scope=`, `POST …/memory { runId?, entries: [{ title, body, kind, scope? }] }`, `POST …/memory/review { runId?, merged: [{ from[], title, body, kind? }], removed: [{ id, why }], corrected: [{ id, title?, body?, kind?, why }] }` | Memory for a run (at, above or beneath the scope; at most 200); written after a task; a review's result. |
| `POST /internal/contractors { scope, briefedBy, role, name?, brief, runId?, monthlyCreditLimit? }`, `POST /internal/contractors/{id}/finish { runId?, learned[] }` | A contractor while it works; done → `{ contractor, learned, promotion }` (a hire raised when the role recurred). |
| `GET /internal/ontology?scope=&view=`, `GET /internal/employees/recurring-roles?scope=` | The graph, and recurring contractor roles, for the Runner's hiring triggers. |
| `GET /internal/routes` | `{ generatedAt, routes: [{ appId, organisationId, scope, pathBase, host, hostPathBase, target, status, sleeping, sleep { mode, idleMinutes, modeSetAt, idleSetAt }, version, access, paused, pausedReason, hooks }] }`. `access` is `private`/`shared`/`public`; `paused` is true when the organisation's settled balance is past its overdraft limit (`pausedReason: overdraft_limit`) or a monthly budget on the app's chain is spent (`budget_exhausted`); `hooks` lists declared webhook names. |
| `POST /internal/access/check { appId, cookie, path }` | → `{ decision: allow | sign-in | deny, sessionToken, signInUrl, reason }`. `cookie` is the request's whole `Cookie` header; `sessionToken` is app-scoped (`egs_…`, 15 minutes) and never a cookie value; `signInUrl` is null (Edge uses the app's own sign-in page). |
| `POST /internal/access/handoff { appId, code }` | → `{ cookieName, cookieValue, expiresAt, returnTo }` for Edge to set on the subdomain host, or `410 handoff_invalid` (unknown, used, or older than a minute). |
| `POST /internal/apps/{id}/test-session { persona, role }` | The factory's evaluator → `{ sessionToken, user: { id, email, displayName, kind: member, role }, expiresAt }`: an app-scoped session (`egs_…`, 15 minutes) for a **test member** who exists only in the token — `persona` a lowercase slug (1–30), `role` `admin`, `builder` or `viewer`, never `owner`; the same app and persona are the same person every time (`<persona>@test-members.endgame.invalid`, display name `Test member (<persona>)`), so ownership can be checked with two. `identity/resolve` answers it as a member with that role, for that app only. `400` for a bad persona or role, `404` for no such app. |
| `GET /internal/apps/{id}/emails?limit=` | The factory's evaluator → `[{ to[], subject, text, status, createdAt }]`: the e-mail the app asked the platform to send, newest first (text cut at 2000 characters; at most 50). |
| `POST /internal/apps/{id}/webhook-test { name, header, scheme: hmac-sha256\|shared-token, secretName, prefix?, body, preview? }` | The factory's evaluator → `{ status, contentType, body, truncated, secretCreated, secretName }`: a **declared** webhook called through Edge's call route (`hooks/<name>`; to the preview with `preview: true`, which the evaluator always sends) as its device would, the header computed here from the vault secret, which is never returned. A secret the app needs and nobody has set is made at the app's level (32 random bytes, by `Actor.Agent`), so the owner can hand it to the device. `404` for an undeclared webhook; `400` for a platform, forwarding, cookie or authorization header, a bad scheme or secret name. |
| `POST /internal/apps/{id}/token?preview=` | → `{ token }` (`egt_…`). Mints a fresh app token, stored only as a hash; the previous one keeps working for `AppSessions:TokenGraceSeconds`. With `preview=true`, the token of the app's preview (`app_tokens.preview`): it supersedes only an earlier preview's, never the app's, is never the callback key, and e-mail sent with it is held (`status: held`), never delivered. |
| `POST /internal/apps/{id}/published { version }`, `POST /internal/apps/{id}/state { status }` | Dock's reports. A `failed` state raises an `app.crashed` notification. |
| `GET /internal/runs/{id}/suggestion-context` | For a `suggest` run: `{ scope, organisation, products: [{ kind: division|project|app, scope, name, status }], ideas: [{ title, status, verdict }], context: ["key: value"], alreadySuggested: [title], maxSuggestions: 5 }`; `409` for another kind of run. |
| `POST /internal/runs/{id}/suggestions { suggestions: [{ title, idea, gap, whyUs, reuses[] }] }` | The run's result, 1 to 5, once per run → `201 [Suggestion]`; `400` outside those bounds, `409` twice or after the run finished. |
| `POST /internal/usage/hosting { samples: [{ sampleId, appId, from, to, awakeSeconds, memoryBytes, storageBytes, requests }] }` | → `{ recorded, duplicates, credits }`. One `hosting` ledger entry per sample; a `sampleId` is charged once. **Two reporters**, each sending its own samples: Dock (`dock:<instance>:<app>:<period start>` — awake seconds and mean memory from its memory sampler, the app database's size, `requests: 0`) and Edge (`edge:<process>:<app>:<period start>` — the requests it forwarded, nothing else), every `UsageReportSeconds` (300). Edge alone sees requests, so it reports them rather than handing counts to Dock. A sample not taken is resent under the same id; one refused for good (4xx) is dropped. |

## The verdict document

What research records (`POST /internal/ideas/{id}/verdict`) and what the console reads back, unchanged, as
`GET /api/ideas/{id}` → `verdict`. One shape, validated by the control plane on the way in
(`Endgame.Domain.Runs.VerdictDocument.Validate`, which the Runner also runs before it posts). **Every key below
is present, with exactly the type shown; no other key is accepted, at any depth.** Strings are trimmed and
non-empty unless the range starts at 0. Normal-mode copy: every string is plain language for the owner.

```text
{
  outcome:          "build" | "change" | "do-not-build",
  headline:         string 1–200          one line, the verdict in words
  summary:          string 1–4000         the case against first, then the verdict
  against:          string 1–2000         the strongest case against building it
  suggestedChange:  string 1–1000 | null  what to change; a string exactly when outcome is "change", else null
  existing: {
    evidence:       string 1–2000         who already does this
    products:       [ { name: string 1–120, what: string 1–300, url: string 0–500 | null } ]   0–40, names unique (case-insensitive)
    sources:        [ string 1–500 ]      0–60 addresses, unique; every source any strand reported, deduplicated
  },
  gap:     { evidence: string 1–2000 },
  demand:  { evidence: string 1–2000,  signals: [ string 1–300 ]  0–20 },
  wouldChange:      string 1–1000         what evidence would change this verdict
  redLines: {
    breached:       boolean,
    line:           "tobacco-gambling-finance" | "weapons" | "animal-harm" | "surveillance" | null   — null exactly when not breached
    reasoning:      string 1–1000
  },
  placement: { division: slug, project: slug, app: slug, name: string 1–60 },   slug: ARCH-004 slug rules
  method: {
    searches:       integer ≥ 0           web searches the strands made, in all
    strands:        [ { id: string 1–40, title: string 1–80, searches: integer ≥ 0, sources: integer ≥ 0,
                        confidence: "low" | "medium" | "high" } ]   1–6, ids unique
    confidence:     "low" | "medium" | "high"   the verdict's own, never above the strands' best
  },
  rulesApplied:     [ string 1–500 ]      0–10: each rule code applied over the judge, in plain language
}
```

Cross-field rules, also enforced: a breached red line has outcome `do-not-build`; `suggestedChange` is a string
exactly when the outcome is `change`. `method.searches` equals the sum of the strands' `searches`. An
`existing.products` entry with no address has `url: null`, never `""`.

The control plane answers a document that breaks any rule with `400` and `code: "verdict_invalid"`, `errors: [string]`
(at most 50, each `<path>: <what is wrong and what is expected>`), and records nothing. The Runner gives those errors
to the judge for **one** corrected attempt; a second refusal fails the research run (no verdict is guessed).

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
  `app_restore`, `conversation_post`, `ontology_get`, `notifications_list`, and for what a person can do on the
  factory's screens: `suggestion_dismiss`, `ideas_suggest_estimate`, `run_retry_estimate`, `run_retry`,
  `app_change_estimate`, `app_change`, `conversation_estimate`, `conversation_history` (`idea_decide` takes
  `applyChange`; `approval_answer` its `note`). The actor is `mcp`, not a
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

**What Edge serves for it** (control listener, service token, `Endgame.Edge.Control.AppCalls`):
`ANY /internal/apps/{appId}/call/{**path}` — wake the app if it sleeps, forward method, query, body (at most
1 MB), `Content-Type`, `Accept`, the `X-Endgame-Session` header and any header of the caller's own (a device's
signature on `hooks/<name>`) — never `Authorization`, `Cookie`, `X-Forwarded-*`, other `X-Endgame-*`, trace context
or hop-by-hop headers — to the app on its network at its path
address (`X-Forwarded-Prefix`, `-Host`, `-Proto` set as for any visitor), and return the app's status,
`Content-Type` and body. Edge's own refusals carry `X-Endgame-Refusal: <code>` so a caller never takes them for the
app's answer: `400 invalid_path` for a `_platform` or `_endgame` path or one that climbs out, `404 not_found` for an
app it does not route (after one refresh of its table), `409 app_paused` / `app_unpublished`, `503 app_unavailable`
when it cannot be woken, `502 app_unreachable` when it does not answer. `AppCalls__Transport=direct` posts
straight to the container instead.

## Ask about this app

Four views in schema `ask`, `security_invoker`, each one app's telemetry only:
`requests(at, method, route, path, status, duration_ms, failed, visit)`, `errors(at, source, status, route, message)`,
`events(at, name, user_id, properties)`, `metrics(at, name, unit, type, value, count, sum)`. None has an
`id`. `requests.visit` is the app page's visit rule (a page `GET`, not `/api`, a file, a health check,
`/_platform`, `/_endgame`, `/hooks` or `/openapi`), so an asked visit count is the page's.

**The prompt is generated from the views.** `AskViewCatalog` reads the views' columns and types from
`pg_catalog` (`pg_class` · `pg_namespace` · `pg_attribute`, `format_type`) — readable by any role,
unlike `information_schema`, which hides columns the role cannot select — once per process (a failed
or empty read is not kept; no views is `503 ask_unavailable`). Only a one-line hint per view is
written by hand, keyed by view name; a hint for a view the catalog lacks throws. The prompt also says
there is no `id` and to count with `count(*)`, what a visit is, the functions the guard allows (from
its own list), and that the model may reply `{"sql": null, "unanswerable": "<plain reason>"}`.

The model (route `ask`, two calls plus one uncharged repair) writes one query. A guard refusal or a
database error (`query_failed` / `query_refused`, PostgreSQL's message and hint) goes back to it with
the failing query for exactly one repair (`Repair = true`, recorded, not billed); the second failure
is `422 ask_unanswerable` with the plain words and `technical: { sql, error }`. Three fences hold it:

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

**A run's work stays on its own branch until it is published (R2-4).** `POST …/commit` takes a workspace's
commits onto `runs/<run id, 32 hex>`, never the app's line (`main`); a new workspace starts from its run's own
branch, else from the `ref` asked for (an earlier attempt's branch, for "Try again"), else from `main`.
`POST /internal/repos/{appId}/runs/{runId}/publish { title, authorName, authorEmail }` → `CommitInfo` makes the
run's work the next version: one commit on `main` whose tree is the run's newest, whose message is the title
(what the person asked for) with an `Endgame-Run: <run id>` trailer, and whose second parent is the run's own
commits; `409` when `main` moved since the run began. `…/log` is first-parent, so `main`'s history is exactly the
versions that were published (and restores). A failed or cancelled run leaves `main` untouched. Previews build
`runs/<run id>`; publishing builds the published commit.

`POST /internal/apps/{id}/preview` (`StartAppRequest`) → `AppStatus` with `target: http://app-<id:N>-pv:8080` — the
evaluator's preview: the image on the app's own network beside the app, replacing any earlier preview, with a database
made afresh (`p_…`, owned by the app's role, `ENDGAME_TELEMETRY_EXPORT=false`), labelled `endgame.kind=app-preview` so
it is never reported, published, sampled or charged as the app. Its token is the preview's own (`/token?preview=true`), so its e-mail is held. `DELETE /internal/apps/{id}/preview` → `204`: the
container and its database are destroyed (also part of `DELETE /internal/apps/{id}`).

`GET /internal/apps/{id}/database/dump` → `200 application/octet-stream`, a `pg_dump --format=custom --compress=6`
of the app's own database (Dock alone knows its opaque name; its image carries `pg_dump` 16, Ubuntu 24.04's
`postgresql-client-16`, matching the server's major version), written to a temporary file first so a dump that fails
half-way is `503 unavailable` rather than a truncated `200`, then streamed and deleted; `404 { code: "not_found" }`
when the app has no database yet. `start` asks the control plane for a fresh app token
(`POST /internal/apps/{id}/token`) unless one is given, and injects it as `ENDGAME_APP_TOKEN`.

## Edge — control listener (`:8081`, service token)

`POST /internal/routes/refresh` → `{ version, apps }`; `POST /internal/apps/{id}/state` (Dock's crash
reports); `POST /internal/apps/{id}/platform/schedules/{name}` (platform callbacks, above);
`POST /internal/usage/flush` (closes the hosting-usage period now);
`POST /internal/access/forget` → `204` (drops every access answer Edge reuses — 15 s per cookie and app — so the next
request on any host is asked again; the control plane calls it, waiting at most 5 s, whenever sessions end: the console's
sign-out, an app sign-out, an unshare, a revoked role; Edge's own sign-out page forgets them too);
`ANY /internal/apps/{id}/call/{**path}` (the per-app MCP surface's and the evaluator's signed-in calls, *MCP* above);
on these two routes `X-Endgame-Preview: 1` sends the request to the app's preview (`app-<id:N>-pv`) instead: never woken
or marked asleep, allowed before the app is published (a paused app is still refused); the header is never forwarded;
`POST /internal/apps/{id}/probe { method, path, body? }` → `{ status, contentType, body, truncated }` — the evaluator's
one request into a running (private) preview: woken if asleep, sent on the app's network at its path address as a
signed-out visitor (forwarded prefix and host set, no session, no platform cookie), a text body up to 48 KB returned
(anything else described, not returned); `400` for a method outside GET/POST/PUT/PATCH/DELETE or a path that is
absolute, climbs out, or enters `_platform`/`_endgame`; `404` unknown app; `409` paused; `503` not woken;
`GET /internal/apps`,
`GET /internal/routes`. The control plane calls `routes/refresh` when access, settings, budgets (set or
removed), the overdraft or the balance change, and when an app is created or placed; for a person's change it
waits for Edge's answer (at most 5 s) before answering, so the change is served at once. A failure never fails the change.

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
plan, tool, sub-agent, evaluation and estimate types the harness writes. The control plane writes the task events on the
task's run: `task.created { taskId, summary }` (the title), `task.claimed { taskId, employeeId, previousHolder }`,
`task.done` / `task.failed { taskId, summary, employeeId }` — `employeeId` who claimed it, or null. `model.requested` and
`model.replied` carry the `employeeId` the call is charged to, and every ledger line carries it too.
`estimate.scored` is `{ expectedCredits, actualCredits, nonBillableCredits, modelCalls }` (older `{ estimated, actual }` is read too).
`model.replied` also carries `searches`, the web searches the call made.

What the owner reads (normal mode) and what only technical mode shows:

| Event | Payload the console reads | Normal mode |
| --- | --- | --- |
| `message` **without** `kind` | `{ from, title, text, milestone? }` — `from` is who speaks (`owner`, `researcher`, `builder`, `evaluator`, `security-reviewer`, `assistant`, `runner`); `title` a heading of 1–60 characters; `text` one plain-language sentence or short paragraph, at most 600 characters, never JSON and never naming infrastructure. A `milestone` (e.g. `verdict`, `placed`, `published`) is written once per run. | Shown |
| `message` **with** `kind` | The harness's own bookkeeping for replay (`agent.start`, `agent.reply`, `agent.stopped`, `nudge`, `compaction`, `notes`, `plan.mark`, `workflow.step`). None carries `text`. | Hidden |
| `subagent.started` | `{ subagent, title, brief, role }` — `title` is what the contractor does, for people ("Looked for existing products"); `brief` its objective as a plain string. | Shown, counted as an action |
| `subagent.finished` | `{ subagent, title, summary, stopReason, searches, report }` — `summary` one plain sentence of what it found; `report` the raw report. | Shown (`summary`); `report` technical only |
| `tool.requested` | `{ name, arguments }` | Hidden, counted as an action |
| `plan.proposed`, `plan.accepted` | `{ summary, requirements: [{ id, text }], items: [{ id, text, detail, check, covers[], testIds[] }], leftOut: [{ requirement, text, reason }] }`; `plan.accepted` adds `by` (`auto-mode` or `owner`). `requirements` are what the idea asks for, quoted in its own words; each item `covers` requirement ids; `testIds` the `data-testid`s its screens carry, by the kit's convention (ARCH-006, *Checking the work*), empty for an item with nothing on screen; `leftOut` is a requirement deliberately not built, with the reason the owner reads. An older plan has items `{ id, text, check }` only. | `summary`, `requirements`, each item's `text`, `leftOut` shown; `detail`, `check` and `covers` technical only |
| `evaluation.passed`, `evaluation.failed` | `{ item, text, summary, round, tier, taskId, employeeId, judgedBy, checkTaskId, repairCharged?, final?, requirements: [{ id, text, met, evidence, calls[] }], evidence, faults[] }` — a **judgement**: `taskId` the item's task, `employeeId` whose work it judges (the engineer who claimed it), `judgedBy` the judge (the QA engineer), `checkTaskId` the judge's own task for this check (each null when unknown, e.g. a hire still waiting); a failed one carries `repairCharged: false` when a repair round follows (repairs are never billed) or `final: true` when none does; `text` is the item's plain text; `summary` one plain sentence ("Checked and working: … (2 of 2 of your requirements shown working in the running app)" / "Sent back for repair, at no charge: …"); `requirements` what code's gate found for each requirement the item delivers (`calls` the signed-in calls to the running preview its evidence names); `faults` leads with the promised test ids the screens lack, when any do. | `text`, `summary` shown; `tier`, `requirements`, `evidence`, `faults` technical only |
| `approval.requested` | `{ approvalId, title, detail, onDecline }` — `title` what will happen if it is approved, in words ("Start researching an idea: …?", "Change the app: …?", "Try again: …?", "Turn on the “Before the plan is carried out” checkpoint here?", "Let the agent change part of the app?", "Accept this plan?"), never a tool name or a setting's key; `detail` the tool, its command or files, the rule that asked; `onDecline` `continues` or `stops`. `approval.answered` is `{ approvalId, answer, comment, by }` — `comment` the person's note, given back to the agent with the answer. | `title` shown; `detail` technical |
| `message` `kind: plan.carried` | `{ items[], retryOf }` — on a try again, the plan items the earlier attempt built and checked, kept and not built or charged again. | Hidden; the plan shows those items as kept |
| `task.created`, `task.*` | The task's `title` (`summary`), which the `tasks` tool refuses unless it is plain words; the factory's tasks are the plan item's own `text`, "Check: <text>", "Review the app's security before it is published", "Check the security fixes before the app is published", "Fix what the security review found", "Correct what the app's documents say about its security". | Shown |
| `message` `kind: security.review` | `{ from: security-reviewer, kind, passed, findings[], blocking, employeeId, taskId }` — the reviewer's id and its review task; each finding `{ item, file, line, kind, problem, fix }`, `kind` `code` or `docs`; `blocking` how many block publishing (a finding only about a document that says less than the code does never does, ARCH-006 *The security review*). | Hidden |

**Actions**, as the console counts them, are `tool.requested` plus `subagent.started` events.

**The normal-mode rule (CLAUDE.md rule 12), for every owner-facing field the Runner writes** — a `message`
without `kind` (`title`, `text`), `plan.*` (`summary`, item `text`, `leftOut` reasons), `evaluation.*` (`text`,
`summary`), `approval.requested` (`title`), task titles, a sub-agent's `title`, and hire and contractor messages:
plain language for the owner, naming no file, path, endpoint, HTTP call, code, raw key (`stage:research:acme`),
or piece of infrastructure (containers, repositories, commits, servers, the API, migrations). Technical detail
travels in its own fields (`detail`, `check`, `evidence`, `faults`, `tier`, approval `detail`, `run.finished`'s
`summary`), which only technical mode shows. One check enforces it, `Endgame.Harness.Events.OwnerText`:
`propose_plan` refuses a plan whose item text or summary breaks it, the `tasks` tool refuses such a title, a
sub-agent's technical title becomes "Looked into part of the work", a run's closing message falls back to a plain
sentence when its summary is technical, and `WorkflowTests` runs every owner-facing field of research, build and
suggest runs through it. A `milestone` is a word from a closed set — `research.started`, `verdict`, `decided`,
`placed`, `planned`, `security.reviewed`, `security.rechecked`, `published`, `suggested`, `memory.reviewed`,
`finished` — never a key; hires are told as plain messages without one.

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

## The `suggest` run

A Builder's `POST /api/ideas/suggestions` queues a run of kind `suggest` at the organisation or a
division, its log opening with `estimate.made { credits, basis: "suggest" }` and a `message`
`{ from: owner, kind: ideas.suggest, text }`. The Runner claims it like any run
(`kinds` including `suggest`), reads `GET /internal/runs/{id}/suggestion-context` (and the ontology,
`GET /internal/ontology?scope=`), makes its model calls on the `research` route with the run id (so
they are reserved, attributed and capped as usual, within `Estimates:SuggestCalls`, 6), posts one to
five suggestions to `POST /internal/runs/{id}/suggestions`, then finishes the run (`run.finished`).
Each suggestion names the gap it fills, why this organisation is placed to build it (from its
products and ideas), and what it would reuse; none repeats `alreadySuggested` or an existing idea.
As built (`SuggestWorkflow`): the organisation's researcher (need `stage:research:<scope>`) makes at most two
attempts of three steps each, with no web search; code keeps only suggestions with every field within the control
plane's limits and a title that repeats nothing already suggested or researched (compared without case, spacing or
punctuation), gives one corrected attempt when none is left, records them once (a resumed run never records twice),
and says so in a plain `message` (milestone `suggested`); a run with nothing new fails with a plain sentence.

## Estimates

What the owner is shown before work starts (CLAUDE.md rule 11) is the **expected** cost; the **ceiling** is the
most the work could cost, since every model call is reserved at its worst case and a cap is exact.

| Run | Expected | Ceiling |
| --- | --- | --- |
| `research`, `suggest` (the control plane, `ResearchEstimator`) | The median of the organisation's own last 20 succeeded runs of that kind (billable settlements), once it has `Estimates:MinimumSamples` (3); before that the measured starting figure — `Estimates:ResearchStartingCredits` 12 (the live research runs of 2026-11-25 cost 9.0–12), `SuggestStartingCredits` 2. Never above the ceiling. | `ResearchCalls` (8) or `SuggestCalls` (6) calls at the route's reservation. |
| Trying again, a change, a conversation turn (the control plane, `FactoryEstimates`) | The median of the organisation's own succeeded runs of the kind (`build`; `task` for a change; `conversation`) once it has 3; before that `Estimates:Factory` — `BuildStartingCredits` 20, `ChangeStartingCredits` 10, `ConversationStartingCredits` 0.5. Work that resumes is priced for what is left: the figure × the parts left ÷ the parts of the agreed plan. | A conversation turn: `ConversationCalls` (12) calls at the route's reservation with a `ConversationPromptCharacters` (40,000) prompt and 4,000 output tokens. |
| `build`, `task`, `conversation`, `review` (the Runner, `Estimator`) | The median of past succeeded runs of the kind in the organisation once there are 3 (a build's then scaled by its plan, the median taken as a four-item plan); before that `Runner:EstimatePriors` (a build 20 credits until it has a plan). **A build with a plan and no history** is weighed item by item (`Runner:BuildEstimate`): 3 credits an item, +1.5 for an item that keeps data (an entity, migration, endpoints), +1 for a screen, +12 for each of webhooks, e-mail, schedules or models it reaches, +0.75 for each requirement it covers — fitted to TEST-201's live builds: the three-item reading list (13.35–23.9) weighs 18.5, the five-item club app with a webhook-and-e-mail item (59.1) weighs 53. The `basis` sentence names the plan's counts and the weights. | The gateway's reservation on every call. |

`estimate.made` is `{ credits, basis, samples?, stage?, source?, reason?, ceiling? }`: the control plane's carry
`basis: research|suggest`, `reason` (the sentence saying where the figure comes from) and `ceiling`; the Runner's carry
`basis` as that sentence. History never crosses organisations. Research sizes its search budget from the ceiling, never
from the expected cost (which history calibrates, and which the budget itself drives).

## Ports and names (inside the compose network)

Every service listens on `8080`; Edge's control listener on `8081`. Names: `edge`, `control-plane`,
`runner`, `dock`, `console`, `postgres`, `egress`, `ops`, and in development `mailcatcher` (SMTP `1025`).
App containers are `app-<app id>`, workspaces `ws-<run id>`. The control plane finds its peers through `Services__ControlPlane`, `__Edge`,
`__EdgeControl`, `__Runner`, `__Dock`, `__Console`, `__Ops`, `__Collector`, whose defaults are these names in
every environment (`__Ops` empty: no ops service, organisation names are checked against the built-in list).
