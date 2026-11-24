# UC-001 — Run the organisation from the console

| Field | Value |
| --- | --- |
| **ID** | UC-001 |
| **Title** | Sign in, see the organisation, start an idea, follow the work, decide on the verdict, run an app, read the credits |
| **Primary actor** | Owner |
| **Scope** | Console, through Edge to the Control plane's public API (ARCH-004) |
| **Cascade level** | Organisation, and any node beneath it the owner selects |
| **Status** | Built (console side, Phase 2) |

## Goal

The owner runs everything they own from one screen: the living org chart, with one conversation
docked beside it and scoped to whatever is selected, and from there every idea, run, verdict, app
and credit.

## Preconditions

- The console is served by Edge; `/api/*` reaches the control plane with a cookie session.
- For anything past sign-in, a passkey (or, in development only, the advertised development sign-in).

## Main flow

1. **Sign in** with a passkey; a first-time owner creates one. In development the API may advertise a
   development sign-in, which is shown only then.
2. **Home** shows the organisation band (name, divisions, apps, employees, credits this month), what
   needs the owner (verdicts waiting, approvals), and the org chart: divisions, projects, apps with
   health, running and access chips, spend and the employees on each. Selecting a node or an employee
   changes the breadcrumb and the conversation's scope. A message starts a run; its `message` events
   stream back as the reply.
3. **Start**: on first run the owner names the organisation; the idea and optional constraints are
   described; the research estimate is shown before anything is charged; research starts.
4. **Run view**: the live, resumable trace — plan, tasks, cost (estimate, spent, held), approvals
   answered inline, pause / resume / cancel. Normal mode speaks plainly and never names
   infrastructure; technical mode (header toggle, remembered) shows models, tools, rules and raw events.
5. **Verdict**: the verdict, who already does this, the gap, who would want it, what would change it,
   and the decision — change, overrule (confirmed, recorded as an overrule) or drop.
6. **App**: health, both addresses, today's telemetry, cost against cap; running (sleeps / always on)
   and who can open it, changed optimistically. Making an app public needs a person's confirmation.
7. **Credits**: balance, AI against hosting, budgets down the cascade, estimate accuracy, what was not
   charged, overdraft and top-ups.
8. **System status** is reachable only in technical mode.

## Alternate and failure flows

- **A1 — a read fails.** Every screen shows loading, empty, loaded and failed as distinct states. A
  failed read is recorded on the page with the reason and a retry; it is never drawn as an empty list.
  A failed refresh keeps the last good data, marked stale.
- **A2 — a write is refused.** Optimistic changes (app settings, pause / resume / cancel, approvals)
  roll back, and the reason stays on the page.
- **A3 — the event stream drops.** It reconnects with `after=<last sequence held>`; repeats are dropped.
  After six failed attempts the page says so and offers to reconnect.
- **A4 — the estimate cannot be worked out.** Research cannot start; the reason is shown.
- **A5 — signed out (401)** shows sign-in; any other failure of `/api/me` is shown as a failure, not as
  signed out.

## Postconditions

- Nothing is charged by the console itself; every charge is the control plane's, after an estimate.

## Rules this use case must honour

- Normal mode never names infrastructure (CLAUDE.md rule 12). An estimate is shown before work starts
  (rule 11). Go-public is a human act (rule 10). One token layer for the look (rule 13).

## The API the console expects — assumptions beyond ARCH-004

ARCH-004 names the endpoints; it does not give their JSON. The console's full reading is the typed
contract in [`src/frontend/src/store/types.ts`](../../src/frontend/src/store/types.ts) (camelCase JSON,
problem-details errors). These points are assumptions the control-plane lane must match or correct:

| Endpoint | Assumption |
| --- | --- |
| `GET /api/auth/options` | **Not in ARCH-004.** `{ passkey: bool, developmentSignIn: bool }`, readable signed out. |
| `POST /api/auth/development` | **Not in ARCH-004.** Development only; sets the session; returns `Me`. 404 otherwise. |
| `POST /api/auth/passkey/register/options` | Body `{ displayName, email }` → `{ publicKey: PublicKeyCredentialCreationOptionsJSON }` (base64url binary fields). |
| `POST /api/auth/passkey/register/complete` | Body `{ credential: RegistrationResponseJSON }` → `Me`, session set. |
| `POST /api/auth/passkey/login/options` | Body `{}` → `{ publicKey: PublicKeyCredentialRequestOptionsJSON }`. |
| `POST /api/auth/passkey/login/complete` | Body `{ credential: AuthenticationResponseJSON }` → `Me`. |
| `GET /api/me` | `{ user: { id, displayName, email }, organisation: { id, slug, name } \| null }`; **401** when signed out. |
| `GET /api/tree` | `Tree`: `organisation` (null on first run) with `summary`, `spend.monthCredits`, `workers`; `divisions[].projects[].apps[]`; each node has `spend.monthCredits` and `workers[] { id, name, role, kind: employee\|contractor, activity }`; projects carry `stage`, `ideaId`, `note`, `progress { runId, label, step, of, spentCredits, estimatedCredits }`; apps carry `health`, `running`, `access`, `sharedWith`, `visitsToday`, `lastVisitAt`; plus `needsYou[]` of `{ kind: "verdict", id, ideaId, title, verdict, detail }` or `{ kind: "approval", id, runId, approvalId, title, detail }`. |
| `POST /api/organisations` | Body `{ name, slug }` → `{ id, slug, name }`. |
| `POST /api/ideas/estimate` | **Not in ARCH-004.** Body `{ text, constraints[] }` → `{ credits, basis }`. Free; must work before an organisation exists. Needed because the estimate is shown before research starts. |
| `POST /api/ideas` | Body `{ text, constraints[] }` → `Idea` with `runId`. |
| `GET /api/ideas/{id}` | `Idea`: `status` (researching / verdict / decided / failed), `runId`, `scope`, `research { estimatedCredits, spentCredits, by }`, `verdict` (null until ready: `outcome` build\|change\|do-not-build, `headline`, `summary`, `existing[] { name, description, url }`, `gap[]`, `demand { paragraphs[], evidenceFound }`, `wouldChange { text, changeLabel, estimateCredits } \| null`, `method`), `decision { choice, at, by, overruled, runId } \| null`, and the organisation's `record { total, build, change, doNotBuild, overruled[] { ideaId, title, verdict, outcome } }`. |
| `POST /api/ideas/{id}/decision` | Body `{ choice: build\|change\|overrule\|drop }` → the updated `Idea`; `decision.runId` is the run that follows, if any. |
| `GET /api/runs/{id}` | `Run { id, kind, title, scope, status: queued\|running\|waiting\|paused\|finished\|failed\|cancelled, startedAt, finishedAt, lastSeq, ideaId, estimateCredits, spentCredits }`. |
| `GET /api/runs/{id}/events` | SSE. Resumes from `?after=<seq>` (the console always sends it, and closes on `run.finished`). Each message: `id: <seq>`, optional `event: <type>`, `data: { seq, type, at, payload }`. Payload keys the console reads: `run.paused { reason }`, `run.finished { outcome: succeeded\|failed\|cancelled, summary, totals { credits } }`, `plan.* { summary, items[] { id, text, check } }`, `task.* { taskId, summary, holder, reason }`, `model.requested { callId, taskType, model, reservedCredits }`, `model.replied { callId, model, tokens { input, output }, settledCredits }`, `tool.* { tool, arguments, rule, reason, result }`, `subagent.* { subagentId, brief, summary }`, `approval.requested { approvalId, question, detail }`, `approval.answered { approvalId, answer }`, `evaluation.* { item (plan item id), evidence }`, `estimate.made { credits }`, `estimate.scored { estimated, actual }`, `message { text, from }`. |
| `POST /api/runs/{id}/pause\|resume\|cancel` | No body → the updated `Run`. |
| `POST /api/runs/{id}/approvals/{approvalId}` | Body `{ decision: approve\|reject, note? }` → 204. |
| `POST /api/conversations` | Body `{ scope, message, employeeId? }` (`employeeId` when talking to one employee) → the `Run`. No conversation history endpoint exists, so history lasts the browser session. |
| `GET /api/apps/{id}` | `AppDetail { id, name, scope, health { state, summary }, running, addresses { path, subdomain \| null } (absolute URLs), telemetry { visitsToday, requestsToday, errorsToday, latencyP50Ms, latencyP95Ms, lastVisitAt }, cost { monthCredits, capCredits }, settings { running: sleep\|always-on, access: private\|shared\|public }, runningCost { sleep, alwaysOn } \| null, sharedWith }`. |
| `POST /api/apps/{id}/settings` | Body: a partial `settings` → the updated `AppDetail`. |
| `GET /api/credits?scope=<org slug>` | `Credits { scope, balance, month { spent, ai, hosting }, monthsLeftAtPace, budgets[] { scope, name, level, depth, spentCredits, capCredits, appId } (in tree order), estimates { pieces, withinPercent, under, over, largestMissPercent } \| null, notCharged { credits, repairs }, overdraft { frostauraLimit, ownLimit } \| null, topUps[] { at, credits, note } }`. |

## Not built, because the contract has no backend for it

The Employee screen (job, track record, memory), the app's "ask about this app", its version history
and download, hire proposals, sharing by email address, changing the overdraft limit and asking for a
top-up. Each appears in the approved design and returns when its endpoint exists.

## Acceptance

Mapped to tests in [`../testing/TEST-001-console.md`](../testing/TEST-001-console.md).

## Links

- Spec *Experience*, *Credits*, *Layer 2 — the factory* · [ARCH-004](../architecture/ARCH-004-service-contracts.md) · [design source](../design/README.md)
