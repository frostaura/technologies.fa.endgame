# UC-001 — Run the organisation from the console

| Field | Value |
| --- | --- |
| **ID** | UC-001 |
| **Title** | Sign in, see the organisation, start an idea, follow the work, decide on the verdict, run an app, read the credits |
| **Primary actor** | Owner |
| **Scope** | Console, through Edge to the Control plane's public API (ARCH-004) |
| **Cascade level** | Organisation, and any node beneath it the owner selects |
| **Status** | Built (console side, Phases 2 and 3, and the breadth surfaces) |

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
   answered inline, pause / resume / cancel. Normal mode speaks plainly: `message` events without a
   `kind` as written (each milestone once), each sub-agent as its title with a one-line outcome and its
   own steps folded beneath it, tool and model work summarised ("Read 4 files", "Ran the tests — 12
   passed"), and actions counted as ARCH-004 counts them (tool calls plus contractors briefed). It never
   shows a payload, a model, a tool's arguments or the rule that decided; technical mode (header toggle,
   remembered) shows every event raw, still grouped under its sub-agent. When a **research** run ends it
   links to its idea ("The verdict is ready" when it finished, "See what research found" otherwise); a
   build or any other run never offers a verdict, though a build started from an idea carries its `ideaId`.
5. **Verdict**: the agreed verdict document (ARCH-004, *The verdict document*): the case against, argued
   first; existing products with what each does and its source; the gap; demand and its signals; what to
   change; what would change the verdict; the red-line screen; the method (strands, searches, sources,
   confidence, rules applied). Decisions as the control plane allows them: build after build or change;
   overrule (confirmed, recorded) only over a "do not build"; change, with what should change, sent as the
   note for a new round of research; drop (confirmed). Over a breached red line neither build nor overrule
   is offered, and the page says why. Normal mode never names a repository.
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
12. **The workforce on the chart** (`GET /api/tree`): employees on every node in their own colour with
    role and what they are doing now, contractors as one spinning line, paused and idle marked; hire
    proposals and idle employees in "needs you". The org chart can also be read as a graph from
    `GET /api/ontology` — *who works on what* (owns, works-on, reports-to) and *how data flows* (depends-on,
    data-flows-to): a layered diagram that pans on a desktop, a readable list on a phone and for screen
    readers. Selecting an employee scopes the conversation to them and offers their screen.
13. **Employee** (`/employees/{id}`): header with reassign, change budget, pause / resume, let go (confirmed;
    never a standing hire) and rehire; track record (work accepted and sent back, repairs not charged,
    cost against budget, estimate accuracy); the job description in plain words (model tier as
    "thinking power", tools as what they let it do); recent work (its current and last runs and the tasks
    it held) linking to runs; contractors it briefed; a conversation with it; its memory — read, add,
    correct, remove (with why), the last review and what it merged, removed and corrected, and "review now".
14. **Hiring** (`/hires?scope=`, `/hires/{id}`): proposals waiting and decided; one proposal's drafted job,
    expected monthly cost and whether it fits the budget; accept (with a note), edit, or decline (confirmed).
    Contractor roles that keep recurring are proposed as permanent hires.
15. **Autonomy** (`/autonomy?scope=`, any level): auto-mode or checkpoints; the start, plan and hire
    checkpoints; a rule set per stage (may not, asks first, may do). Each value shows the level that set it,
    "inherited from …" otherwise, and "use the inherited setting" / "remove here". Admin and above change
    them; others read. Rules read in plain words in normal mode and as the harness reads them in technical.

16. **The app, completed** (`/apps/{id}`): *Ask about this app* shows the most a question can cost
    before it is asked (`ask/estimate`), then the answer with its chart (number, bars, line or table) and
    what it cost; a Builder keeps it on the *dashboard*, whose questions are re-run on every read and say
    why when one no longer runs; the query is shown in technical mode only. *History* lists every version
    with who made it (an employee, linked; a person; the factory) and which is live; a Builder brings one
    back after a confirmation that says a public app becomes private, and the result says whether it is
    running. *What it uses*: the services it depends on (from the ontology), its secrets by name, who it is
    shared with, and that AI assistants can use it (the per-app address in technical mode). *It is yours*:
    the Owner downloads the export; anyone else is told only the Owner can. Technical mode adds what the app
    is underneath: lifecycle, container state, version, addresses, ids.
17. **People** (`/people?scope=`, Admin): each person with their role and the level the grant was set at;
    invite by e-mail to a role at any level beneath — the one-time code is shown once and the page says
    whether it was e-mailed; change a role (to or from Admin, the Owner only) and remove a grant, both
    optimistic; what each of the four roles may do, in plain words.
18. **AI assistants** (`/assistants`): "Let an AI assistant work with your organisation" in normal mode,
    "MCP access tokens" in technical. Make a key (name, a role no higher than yours — an Owner's is an
    Admin's — and when it stops working); the key is shown once with a copy button and never stored; the
    organisation's address and each app's; each key's role, last use and state; revoke after a confirmation.
19. **Notifications**: a bell in the header with the unread count (unknown is shown as nothing, not zero);
    on a desktop it opens the latest eight in place, on a phone it links to `/notifications`. Each item is a
    short title and one line, links to what needs the person, and can be marked read; all can be.
20. **Ideas from your portfolio** (`/suggestions?scope=`, the organisation or a division): the cost first,
    then the suggestions run; each suggestion's gap, why this organisation, and what it would reuse; taking
    one shows its research estimate first, then opens the new idea; setting one aside is optimistic.
21. **Credits, completed**: the Owner's own overdraft limit, checked against FrostAura's and refused deeper;
    a narrower limit for a division, project or app (Admin), and the list of those already set with who set
    them (Owner and Admin; the scope in technical mode); asking FrostAura for a top-up (Owner); the
    requests and what became of them.
22. **God mode** (`/operator`, operators only; a coral band on every screen says so): every organisation with
    balance, standing, overdraft, apps and last activity; enter one (the answer says where it is logged) and
    open its org chart (`/?organisation=`); top up, optionally answering a request; the top-ups made, each
    named by the organisation's display name (its address name added in technical mode); decline a request with
    a reason; set the deepest overdraft; the prices with confirmation and their change history; provision an
    organisation for an invited Owner, the Owner's code shown once.
23. **Normal mode in the run view** prints no `:`-separated key, id, model or file: plan items read their
    plain `text` (an older plan whose `text` names files reads as its place in the plan, the detail in
    technical mode), hires read from their people, and the factory's agents are named for what they did.
    It reads the wiring lane's shapes too: a plan's `requirements` ("What you asked for") and `leftOut`
    ("Left out, on purpose") are shown, items' `detail`, `check` and `covers` only in technical mode; an
    evaluation's plain `summary` is shown, its `evidence` technical; an approval's `title` is asked, its
    `detail` technical; a task's `title`; a technical `run.finished` summary gives way to the closing message.
    Workflow steps are bookkeeping and are left out, except a hire no plain message announced.
    Needs-you cards and notifications are a headline and one line; the verdict's hero is the headline and a
    short summary, the full reasoning behind a button.

## Alternate and failure flows

- **A1 — a read fails.** Every screen shows loading, empty, loaded and failed as distinct states. A
  failed read is recorded on the page with the reason and a retry; it is never drawn as an empty list.
  A failed refresh keeps the last good data, marked stale. **An answer in an unexpected shape** is
  refused at the boundary by that endpoint's guard (`src/store/guards.ts`) and drawn as a failed read
  naming the field, never passed to a component.
- **A7 — something crashes while drawing.** Every route and every major panel sits in an error boundary:
  the page says, in plain words, which part stopped working and what failed, and offers "try again" and
  "back to the org chart". Nothing outside the boundary is lost; a crash never leaves a blank screen.
- **A2 — a write is refused.** Optimistic changes (app settings, pause / resume / cancel, approvals,
  a secret set or removed, an invitation or a removed share, an employee paused or re-budgeted, a memory
  entry added, corrected or removed, a hire edited or decided, autonomy, a checkpoint or a rule set) roll
  back, and the reason stays on the page.
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
| `GET /api/apps/{id}` | `telemetry` is **null** until measured; `runningCost` is always an object — `state: not-enough-history` (no figures) until 24 hours are measured; also `status`, `version`, `publishedAt`, `idleMinutes`, `endUsers`. |
| `GET /api/credits?scope=` | Also `heldCredits` and `available`. A zero or negative balance has no "months left"; the page says what is left of the overdraft instead. |
| `GET /api/ideas/{id}` | `verdict` is the agreed verdict document (older runs' `{ evidence }` sections and products as text are read too); `redLine` names a breached red line by its code; `decision.via`. |
| `GET /api/tree` | Workers also carry `status`, `idle`, `standing`, `briefedBy`; `needsYou` adds `hire` and `idle`. Older answers without them still read. |
| `GET /api/employees/{id}`, `…/memory`, `…/memory/changes`, `/api/hires*`, `/api/employees/recurring-roles`, `/api/autonomy*`, `/api/ontology`, `/api/tasks` | As ARCH-004 *Workforce*, *Autonomy*, *Ontology*, field for field. An employee's recent work is read from `GET /api/tasks?scope=` filtered by `holderEmployeeId`, plus its `currentRun` and `lastRunId`. |
| `GET/PUT/DELETE /api/secrets` | `{ scope, effective[] { name, setAtLevel, setAtPath, setAt, inherited, overrides[] }, setBelow[] { name, setAtPath } }`; `PUT { scope, name, value }` is sent with `fetch`, never through the store. |
| `GET/POST/DELETE /api/apps/{id}/shares` | `[{ email, invitedAt, registered }]`; `POST { email }` → `{ email, invitationCode, expiresAt }`, sent with `fetch` so the code never reaches the store. |
| `GET /api/audit/operator-access?organisation=` | `[{ id, at, action, operator { id, email, displayName }, detail }]`; 403 for anyone but the Owner. |
| Breadth (ask, dashboard, versions, export, members, tokens, notifications, suggestions, top-up requests, overdraft, God mode) | As ARCH-004, field for field, read from a running stack on 2026-11-25. Differences: `POST …/enter` answers `logged` as **text** (where the entry is written), not a flag; `PATCH /api/members/{id}` answers the invitation shape, of which the console keeps only `member`; `POST /api/credits/top-ups` answers `{ id, amount, createdAt, organisation }`; a `suggest` run is a run kind. One-time values go through `store/sensitive.ts`. |

## Not built, because the contract has no backend for it

An employee's full run history reads its tasks and its current and last runs; `GET /api/runs?employeeId=`
now exists and is not used yet. An app's end-user count ("sign-in · 214 members" in the design) has no field
in `GET /api/apps/{id}`, so *what it uses* says "Sign-in" without a count. The per-node overdraft limits a
narrower limit sets are not in `GET /api/credits`, so the page confirms a change but cannot list them.

## Acceptance

Mapped to tests in [`../testing/TEST-001-console.md`](../testing/TEST-001-console.md).

## Links

- Spec *Experience*, *Credits*, *Layer 2 — the factory* · [ARCH-004](../architecture/ARCH-004-service-contracts.md) · [design source](../design/README.md)
