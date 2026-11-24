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
   changes the breadcrumb and the conversation's scope. What was said before at that scope is read back
   from the control plane, so the conversation survives a reload; a new message starts a run, and its
   `message` events (other than the owner's own, which the run's log also carries) stream back as the
   reply, appended below. An Admin or the Owner is offered the selected level's secrets; the Owner,
   the operator log.
3. **Start**: on first run the owner names the organisation; the idea and optional constraints are
   described; the research estimate is shown before anything is charged; research starts.
4. **Run view**: the live, resumable trace — plan, tasks, cost (estimate, spent, held), approvals
   answered inline, pause / resume / cancel. Normal mode speaks plainly and never names
   infrastructure; technical mode (header toggle, remembered) shows models, tools, rules and raw events.
5. **Verdict**: the verdict, who already does this, the gap, who would want it, what would change it,
   and the decision — change, overrule (confirmed, recorded as an overrule) or drop.
6. **App**: health, both addresses, today's telemetry, cost against cap; running (sleeps / always on)
   and who can open it, changed optimistically. Making an app public waits on an explicit confirmation
   dialog. Telemetry and running cost the app has not measured yet read "not measured yet", never zero.
   A shared app lists who it is shared with (registered or invited), invites by e-mail — the one-time
   code is shown once, with a copy button, and never stored — and stops sharing after a confirmation.
   The secrets it can read are listed by name, with a way to manage them.
7. **Secrets** (`/secrets?scope=`): at any level, the names that apply, the level that set each
   (inherited, or set here and what it replaces) and those set beneath. Set, replace and remove; names
   are UPPER_SNAKE_CASE, checked before sending. A value is write-only: typed, sent once outside the
   store, cleared, and never shown.
8. **Operator access** (`/operator-access`, the Owner): every FrostAura entry into the organisation and
   every operator action, newest first, in plain words; technical mode adds the raw action and detail.
9. **Credits**: balance, AI against hosting, budgets down the cascade, estimate accuracy, what was not
   charged, overdraft and top-ups.
10. **System status** is reachable only in technical mode.
11. **The header** is one row on a desktop and at most two on a phone (375–412 px): the mark, where you
    are (its last two steps) and sign-out; then the mode toggle and the balance.

## Alternate and failure flows

- **A1 — a read fails.** Every screen shows loading, empty, loaded and failed as distinct states. A
  failed read is recorded on the page with the reason and a retry; it is never drawn as an empty list.
  A failed refresh keeps the last good data, marked stale.
- **A2 — a write is refused.** Optimistic changes (app settings, pause / resume / cancel, approvals,
  a secret set or removed, an invitation or a removed share) roll back, and the reason stays on the page.
- **A6 — a role is missing.** A 403 (secrets below Admin, the operator log for anyone but the Owner,
  sharing below Admin) is drawn as a failed read with the control plane's reason, never as an empty list.
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

## The API the console reads — as built

The console's typed contract is [`src/frontend/src/store/types.ts`](../../src/frontend/src/store/types.ts),
checked field by field against the control plane (`Endgame.Infrastructure/Tree/ConsoleViews.cs` and the
console endpoints); [ARCH-004](../architecture/ARCH-004-service-contracts.md) is the endpoint list. JSON
is camelCase, errors are problem details. What the console relies on beyond ARCH-004's table:

| Endpoint | The console reads |
| --- | --- |
| `GET /api/me` | `{ user { id, displayName, email \| null }, organisation \| null, isOperator, passkeys, memberships[] { id, scope, level, role, organisationId, organisationSlug, organisationName } }`; **401** signed out. |
| `GET /api/tree` | `{ generatedAt, viewerRole: owner\|admin\|builder\|viewer\|none, organisation \| null, divisions[], needsYou[] }`; app `visitsToday` is null until measured. `viewerRole` gates the secrets and operator-log links. |
| `GET /api/runs/{id}` | Also `employeeId`, `conversationId`, `budgetExhausted`, `outcome`, `summary`, `createdAt`. A conversation run's log opens with the owner's own `message { from: "owner", text }`. |
| `GET /api/conversations?scope=&employeeId=` | `{ scope, conversationId \| null, employeeId \| null, messages[] { runId, seq, at, from, text } }`, oldest first, at most 200. |
| `GET /api/apps/{id}` | `telemetry` and `runningCost` are **null** until measured; also `status`, `version`, `publishedAt`, `idleMinutes`. |
| `GET /api/credits?scope=` | Also `heldCredits` and `available`. |
| `GET/PUT/DELETE /api/secrets` | `{ scope, effective[] { name, setAtLevel, setAtPath, setAt, inherited, overrides[] }, setBelow[] { name, setAtPath } }`; `PUT { scope, name, value }` is sent with `fetch`, never through the store. |
| `GET/POST/DELETE /api/apps/{id}/shares` | `[{ email, invitedAt, registered }]`; `POST { email }` → `{ email, invitationCode, expiresAt }`, sent with `fetch` so the code never reaches the store. |
| `GET /api/audit/operator-access?organisation=` | `[{ id, at, action, operator { id, email, displayName }, detail }]`; 403 for anyone but the Owner. |

## Not built, because the contract has no backend for it

The Employee screen (job, track record, memory), the app's "ask about this app", its version history
and download, hire proposals, changing the overdraft limit and asking for a
top-up. Each appears in the approved design and returns when its endpoint exists.

## Acceptance

Mapped to tests in [`../testing/TEST-001-console.md`](../testing/TEST-001-console.md).

## Links

- Spec *Experience*, *Credits*, *Layer 2 — the factory* · [ARCH-004](../architecture/ARCH-004-service-contracts.md) · [design source](../design/README.md)
