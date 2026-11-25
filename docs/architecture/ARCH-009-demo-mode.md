# ARCH-009 — The demo: the real console on an in-browser control plane

| Field | Value |
| --- | --- |
| **ID** | ARCH-009 |
| **Title** | The demo: the real console on an in-browser control plane |
| **Status** | Current |
| **Covers** | `src/frontend/src/demo/**`, the transport seam in `src/frontend/src/store/api.ts`, hash routing in `src/frontend/src/lib/router.ts`, `src/frontend/vite.config.ts` (demo mode), the `demo-*` Makefile targets |

## Context

Endgame is shown to clients, and taught by the academy (ARCH-010), without a stack behind it. The
demo is **the same React console**, not a replica: built with `VITE_DEMO=1`, it answers every
request from an in-browser fake of the control plane and plays runs from scripts, so research,
builds, approvals and conversations move as they do live. It is published as static files at
`https://frostaura.github.io/technologies.fa.endgame/demo/`, works from any sub-path and from
`file://`, and makes no network request at all.

## Components and boundaries

| Component | Where | Owns | Never |
| --- | --- | --- | --- |
| Transport seam | `store/api.ts` (`installTransport`, `apiFetch`) | Where requests go: by default the browser's own `fetch` against this origin, unchanged. | Knows the demo exists. The product build tree-shakes `installTransport` away. |
| Hash routing | `lib/router.ts` (`routeByHash`) | Console addresses after `#`, so a static host needs no rewrites. An address naming the page itself (its path and query, as code that reads `window.location` to come back later writes it) is the console's root. | Changes the product, which stays on the History API. |
| Entry | `demo/main.tsx` | Boot order: hash routing, the host, the device, the bridge, the first route. | Is imported by `src/main.tsx` — the product entry never imports `src/demo`. |
| Host | `demo/host.ts` | The world, the clock's 100 ms tick, sessionStorage, telling the console's cache what changed (`api.util.invalidateTags`), persona and scenario switches. | Holds console state: a reset makes a new Redux store. |
| Fake control plane | `demo/server/**` | One file per control-plane endpoint file in `routes/`, the same role rules (`access.ts`) and the same refusal words (`http.ts` problem bodies), and a fake `EventSource` for run logs. | Answers an address it has no handler for: that is a loud console error naming it, and a failing unit test. |
| Run engine | `demo/server/engine.ts`, `scripts.ts` | Scripts for research, build, conversation, memory review and suggestions; a clock (play, pause, speed, seek); approvals that stop a run until answered. | Saves scripts: a run saves only its script name, parameters and position, and its steps are rebuilt from them. |
| Story world | `demo/world/default.ts`, `story.ts`, `scenarios.ts` | Northwind and two more organisations, all invented, every address on `.example`. Scenarios and personas. | Names a real company or person. |
| Device | `demo/device.ts` | `navigator.credentials` answered by an in-page "your device" sheet (approve or cancel). Embedded, it approves itself after 0.7 s. | Is real WebAuthn. The development sign-in is never offered (`auth/options` says so, `auth/development` is 404) — except in the two scenarios that play a development deployment (`s1-development-sign-in`, `s1-development-apps`), for the Developer track. |
| Hosted apps | `demo/hosted/**` | The Edge's own pages, copied from `Endgame.Edge/Pages/*.cs` and `Access/*.cs` with their wording and CSS, the access gate's decisions, and a small reading-list app behind them, at both addresses. | Runs the Edge's scripts: their passkey ceremonies and control-plane calls are answered by the demo. |
| Bridge | `demo/bridge.ts`, `overlay.ts` | The academy's postMessage protocol and `window.endgameDemo`; the spotlight ring and the soft cursor, also on an Edge page drawn in its frame (it shares the origin). | Blocks a click: every overlay is `pointer-events: none`. |

A link that leaves the console (`https://…`) is caught before the browser follows it: a hosted
app's address opens its pages inside the demo; anything else shows a small notice. An in-page link
(`#main`, "Skip to the content") moves the focus there instead of changing the console's route.

A hosted app is opened at `#/__app/<appId>/path/<rest>` or `#/__app/<appId>/subdomain/<rest>` (in a
script, `/__app/{app}/path/`). Who the visitor is follows the persona: signed in to the console, a
member with a role there or without one; `end-user`, the app's first registered end user (signed
out, with their passkey still on the device, when the app is no longer shared with them);
`invited`, an address it was shared with. Signed out, "Sign in with a passkey" signs in the first
console account on the device with a role on the app. A member signing out at an app on the
platform's host ends the console session too. An app id Edge does not know shows "This app is
temporarily unavailable".

## Interfaces

### Build and run

| Command | What it does |
| --- | --- |
| `npm run build:demo` (in `src/frontend`) | `VITE_DEMO=1 vite build`: one self-contained `dist-demo/index.html` (script, styles, fonts and the icon sprite inlined, IIFE so `file://` runs it) plus `brand/`. About 1.4 MB, 0.56 MB gzipped. |
| `make demo-build` | The above, copied to `src/demo/dist/` (where the academy's `make site` looks); prints that path last. |
| `make demo-test` | Vitest for `src/demo`: the rules and refusals, live work, and endpoint coverage. |
| `make demo-e2e` | Playwright against the built demo from a static server under `/technologies.fa.endgame/demo/` and from `file://`, asserting no request leaves the page and no console error; the bridge driven from a parent frame; and every academy step script (`src/academy/scripts/*.json`) played against the demo (below). `PW_PORT` stays in 5500–5599. |
| `make demo-check` | Builds the product and fails if any demo string reached `dist/`. |

### Address

`index.html?persona=<persona>&scenario=<scenario>[&embed=1][&device=auto]#/<console route>`

- `embed=1`: no demo chrome inside the frame, and the device approves itself. Standalone, a slim
  "Demo — mock data" strip carries persona and scenario switchers, play/pause, speed and "Reset
  the demo".
- With no `#…`, the scenario's own route opens.

### Personas

| Persona | Who | Aliases |
| --- | --- | --- |
| `owner` | Mara Ellison, Owner of Northwind | `assistant`, `host-admin` |
| `admin` | Ada Lovelace, Admin | |
| `builder` | Lena Fischer, Builder | |
| `viewer` | Priya Shah, Viewer | |
| `division-admin` | Ines Duarte, Admin of Technologies only | |
| `operator` | Nell Avery, FrostAura operator (God mode), Owner of the organisation FrostAura, where top-up requests reach her | |
| `invited` | Tobi Adeyemi, invited with code `LARK-7Q4M-2PXD`, not yet registered (signed out) | |
| `end-user` | Signed out of the console; a registered end user of a shared app | |
| `signed-out` | Nobody | |
| `first-run` | Kit Marlow, signed in on a fresh install with no organisation | |
| `two-organisations` | Kai Moreno, a Builder at Northwind and an Admin at Quayside Bakery (the organisation switcher) | `two-orgs` |
| `no-role` | Sol Hart, signed in with a passkey, no role in any organisation once organisations exist | |

A persona switch keeps the world; a scenario switch builds a new one.

### Scenarios

One function each, editing the default world; `+` composes them left to right
(`?scenario=build-running+low-credits`). Each may name its route, a moment to jump to, a persona,
and what `{idea}`, `{run}`, `{app}`, `{employee}` and `{hire}` in a route stand for.

| Scenario | What | Aliases |
| --- | --- | --- |
| `default` | Northwind, busy: research on the tide board and the reading list's build playing live | `established` |
| `quiet` | Northwind with nothing running | |
| `fresh-install` | Nobody has registered | |
| `empty-organisation` | An organisation with nothing in it | `first-idea` |
| `research-running`, `research-verdict` | Research live; research at its verdict | `researching` |
| `verdict-build`, `verdict-change`, `verdict-do-not-build`, `verdict-red-line` | A verdict of each kind | |
| `build-running`, `build-plan`, `build-sent-back`, `build-security-finding`, `build-published` | A build live, or at a named moment | `building` |
| `build-waiting-on-plan` | A build stopped for the plan's sign-off | |
| `build-failed` | A build that did not succeed | |
| `app-busy`, `app-asleep`, `app-paused`, `app-crashed`, `app-never-measured` | Apps in every state | `app-live` |
| `employee-memory`, `hire-pending` | An employee with history; a hire waiting | |
| `low-credits`, `at-overdraft-limit`, `budget-spent` | Credits nearly gone; the overdraft limit reached; a division's budget spent | |
| `god-mode` | Every organisation, as an operator | |
| `manage-tree` | Manage: the archived division Events (with history, so it cannot be deleted) and the empty project Gift Cards (which can) | `archived-division` |
| `account` | Your account: passkeys and roles | |
| `employee-released` | An employee who was let go, memory archived | `employee-let-go` |
| `two-organisations` | A person in two organisations | |
| `screening-offline` | God mode with no model to screen a new organisation (it needs the operator's own decision) | |
| `operator-no-organisation` | A FrostAura operator who holds no role in any organisation: home is the God-mode panel | |
| `tree-unreachable`, `tree-refresh-fails` | Home cannot reach the control plane once (then "Try again" works); or it loads, then every refresh fails | |
| `ontology-unreachable` | The organisation graph cannot be read once | |
| `notifications-unreachable`, `notifications-refresh-fails` | The feed cannot be read once; or it loads, then every refresh fails | |
| `status-unhealthy`, `status-no-services`, `status-unreachable`, `status-refresh-fails` | System status with the Runner not answering; with no services at all; unreadable once; read once, then failing | |
| `session-unreachable` | The session check cannot reach the control plane once | |
| `s1-app-public`, `s1-app-private`, `s1-app-not-published` | Tutor Match, as a visitor meets it: public, private, or with no published version yet | |
| `s1-app-unshared`, `s1-app-made-private` | Court booking after an Admin stopped sharing it, or made it private (for the `end-user` persona) | |
| `s1-session-check-fails` | The first session check gets a bare 503, as from a gateway with no control plane behind it | |
| `s1-keys-at-limit` | Mara already holds 50 live assistant keys | |
| `s1-development-sign-in`, `s1-development-apps` | A development deployment (`ENDGAME_DEV_LOGIN=true`): on a fresh install, and with Northwind's apps | |
| `s4-hiring`, `s4-hires-all-decided`, `s4-hire-manager-gone` | Technologies' hiring with Lark waiting, Sol hired by auto-mode and Bea declined; every proposal decided; Lark drafted to report to Tomas, since let go | |
| `s4-contractor-working`, `s4-contractor-finishes` | Odile's data contractor at work; and finishing inside a playing run (`s4:contractor-finished`): its lesson to Odile, its role raised and hired | |
| `s4-employee-record`, `s4-employee-working`, `s4-employee-team`, `s4-employee-at-cap` | Kasper with his tasks; at work on a live run; with Mina reporting to him; at his monthly cap, told so | |
| `s4-idle-sweep`, `s4-released-with-memory`, `s4-memory-to-tidy` | Ruth idle under checkpoints and Ivo let go by the sweep; Tomas let go with his memory; Kasper's memory with a note learned twice and one removed | |
| `s4-credits-at-zero`, `s4-below-zero`, `s4-top-ups-waiting` | The balance at 0, at −120, and five top-up requests already waiting | |
| `s4-operator-log`, `s4-operator-log-empty` | Northwind's operator log with every kind of entry, and with none | |
| `app-private`, `app-public`, `app-shared-empty` | Court booking private, public, or shared with nobody yet (`scenarios.s5.ts`) | |
| `app-long-history`, `app-not-published` | Court booking with more versions than a page shows; Tutor Match with nothing published, nothing run (so it can be deleted) | |
| `app-restore-fails`, `app-rebuild-fails` | Bringing a version back, or "Rebuild and restart", cannot start the app | |
| `app-wake-slow`, `app-wake-busy`, `app-unreachable`, `wake-failures` | A wake the Edge cannot finish: over 30 seconds, no room, unreachable; `wake-failures` puts one of each (and an unpublished app) side by side | |
| `outage` | The host cannot be reached: Cloudflare's outage page at Court booking's address | |
| `ask-unavailable`, `dashboard-full` | No model route, so nothing about an app can be asked; Court booking's dashboard at its 30 questions | |
| `no-secrets` | No secret set anywhere in Northwind | |

Scenarios are kept one file per flow file, `world/scenarios.s<n>.ts`, each registered by one
side-effect import in `host.ts`. Not in `scenarios.ts`: a scenario file calls its `defineScenario`,
so importing it there is a cycle whose `const` map is not yet initialised.

The academy's organisation, tree, notification and system flows use `world/scenarios.s2.ts`. A
failed read there is `World.outages`: a request by method and route pattern, answered normally
`skip` times, then failing `times` times (always, when unset) — as a problem body with `status`, or,
with none, as a control plane that cannot be reached (the fetch rejects, so the console says "could
not be reached"). System status follows `World.systemStatus` (services unhealthy in their probe's
own words, or none), with the server's eight services in `StatusOptions.Probes` order.

### Named moments (`clock { seek }`)

`research:started`, `research:strand-existing|gap|demand`, `research:judging`, `research:verdict`,
`research:finished`; `build:placed`, `build:hired`, `build:plan`, `build:waiting-on-plan`,
`build:part-1…n`, `build:sent-back`, `build:repaired`, `build:security-review`,
`build:security-finding`, `build:security-passed`, `build:published`, `build:finished`,
`build:failed`; `conversation:approval`, `conversation:replied`. A number instead moves every live
run forward by that many script milliseconds (approvals on the way stop it). Seeking to a name
approves any approval on the way.

### The academy bridge

Envelope, both ways: `{ source: "endgame-academy" | "endgame-demo", id: string, op: string, args?: object }`.
The demo accepts only `source: "endgame-academy"` and, embedded, only from its parent window. Every
reply echoes the request's `id`. An `act` is acknowledged at once (`op: "act"`) and finished by
`{ op: "step-done", args: { id } }`; any failure is `{ op: "error", id, args: { message } }`.
Unprompted, the demo emits `{ op: "ready", args: { embed } }` once and `{ op: "route", args: { route } }`
on every change of address. The same operations are `window.endgameDemo.goto | highlight | act |
clock | reset` for tests.

| op | args | Does |
| --- | --- | --- |
| `goto` | `{ route?, persona?, scenario? }` | Switches persona and/or scenario (a new scenario is a new world), then opens the route (default: the scenario's). |
| `highlight` | `{ selector? \| testId? \| text? \| label?, note? }`; `{}` clears | Scrolls the control into view and rings it, with the note beside it; waits up to 5 s for it. |
| `act` | `{ actions: Action[], instant? }` | Performs the actions with a soft cursor and typed text; `instant` performs them with no motion. Each waits up to 6 s for its target. `press: "Tab"` moves the focus to the next control, as the browser does. |
| `clock` | `{ play?, pause?, speed?, seek? }` | Plays, pauses, sets the speed, or jumps (a moment's name or milliseconds). |
| `reset` | `{}` | Rebuilds the scenario's world from scratch and opens its route. |

A highlight that finds nothing replies `{ op: "highlight", args: { found: false } }` and draws
nothing, so a lesson never breaks in front of a learner; an action whose target is missing is an
`error`. Drift is caught at build instead: `tests-demo/academy-scripts.spec.ts` plays every academy
step script against the built demo and fails, naming flow and step, on any action that errors or
any highlight that finds nothing, unless `tests-demo/academy-allowlist.json` lists that step with
its reason (`{ flow, step, reason }`, with `variation: n` for a step of a script's n-th variation);
an allow-listed step that passes again fails too, so the list stays true. Each variation plays from
its own start, as its own persona and scenario. `ACADEMY_FLOWS=ID,PPL` plays only the scripts whose
flow id starts with one of those prefixes.

A target is a CSS `selector`, a `testId`, or visible `text` / accessible `label`, matched in that
order of preference: buttons, links and other controls by accessible name (exact, then prefix,
then contained), form fields by label, placeholder or aria-label, then the smallest element whose
text holds it.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://frostaura.github.io/technologies.fa.endgame/demo/bridge.schema.json",
  "title": "Endgame demo bridge message",
  "type": "object",
  "required": ["source", "id", "op"],
  "properties": {
    "source": { "enum": ["endgame-academy", "endgame-demo"] },
    "id": { "type": "string" },
    "op": { "enum": ["goto", "highlight", "act", "clock", "reset", "ready", "route", "step-done", "error"] },
    "args": { "type": "object" }
  },
  "allOf": [
    { "if": { "properties": { "op": { "const": "goto" } } }, "then": { "properties": { "args": { "type": "object", "properties": { "route": { "type": "string" }, "persona": { "type": "string" }, "scenario": { "type": "string" } }, "additionalProperties": false } } } },
    { "if": { "properties": { "op": { "const": "highlight" } } }, "then": { "properties": { "args": { "$ref": "#/$defs/targetWithNote" } } } },
    { "if": { "properties": { "op": { "const": "act" } } }, "then": { "properties": { "args": { "type": "object", "required": ["actions"], "properties": { "actions": { "type": "array", "items": { "$ref": "#/$defs/action" } }, "instant": { "type": "boolean" } } } } } },
    { "if": { "properties": { "op": { "const": "clock" } } }, "then": { "properties": { "args": { "$ref": "#/$defs/clock" } } } },
    { "if": { "properties": { "op": { "const": "step-done" } } }, "then": { "properties": { "args": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } } } } } },
    { "if": { "properties": { "op": { "const": "route" } } }, "then": { "properties": { "args": { "type": "object", "required": ["route"], "properties": { "route": { "type": "string" } } } } } },
    { "if": { "properties": { "op": { "const": "error" } } }, "then": { "properties": { "args": { "type": "object", "required": ["message"], "properties": { "message": { "type": "string" } } } } } }
  ],
  "$defs": {
    "target": {
      "oneOf": [
        { "type": "string" },
        { "type": "object", "properties": { "selector": { "type": "string" }, "testId": { "type": "string" }, "text": { "type": "string" }, "label": { "type": "string" } }, "minProperties": 1 }
      ]
    },
    "targetWithNote": { "type": "object", "properties": { "selector": { "type": "string" }, "testId": { "type": "string" }, "text": { "type": "string" }, "label": { "type": "string" }, "note": { "type": "string" } } },
    "clock": { "type": "object", "properties": { "play": { "type": "boolean" }, "pause": { "type": "boolean" }, "speed": { "type": "number", "exclusiveMinimum": 0 }, "seek": { "type": ["string", "number"] } } },
    "action": {
      "oneOf": [
        { "type": "object", "required": ["click"], "properties": { "click": { "$ref": "#/$defs/target" } }, "additionalProperties": false },
        { "type": "object", "required": ["type"], "properties": { "type": { "type": "object", "required": ["into", "text"], "properties": { "into": { "$ref": "#/$defs/target" }, "text": { "type": "string" } } } }, "additionalProperties": false },
        { "type": "object", "required": ["select"], "properties": { "select": { "type": "object", "required": ["into", "value"], "properties": { "into": { "$ref": "#/$defs/target" }, "value": { "type": "string" } } } }, "additionalProperties": false },
        { "type": "object", "required": ["press"], "properties": { "press": { "oneOf": [{ "type": "string" }, { "type": "object", "required": ["key"], "properties": { "key": { "type": "string" } } }] } }, "additionalProperties": false },
        { "type": "object", "required": ["wait"], "properties": { "wait": { "oneOf": [{ "type": "number", "minimum": 0 }, { "$ref": "#/$defs/target" }] } }, "additionalProperties": false },
        { "type": "object", "required": ["clock"], "properties": { "clock": { "$ref": "#/$defs/clock" } }, "additionalProperties": false }
      ]
    }
  }
}
```

### Adding a handler

A console endpoint with no handler fails `make demo-test` ("endpoint coverage", which reads
`store/api.ts` and `store/sensitive.ts`) and logs `[endgame demo] No handler for METHOD /api/path`
in the page. Add it to the route file named after its control-plane endpoint file:

```ts
// src/demo/server/routes/work.ts — inside area("WorkEndpoints", { … })
"POST apps/{id}/restart": (req, { world }) => {
  const a = world.apps.find((x) => x.id === req.params.id);
  if (!a) throw notFound("The app");            // 404 "The app was not found, or you cannot see it."
  requireRole(world, a.path, "builder");          // the control plane's own 403/404 words
  a.running = "awake";
  world.changed.push("App", "Tree");             // RTK Query tags to refresh on screen
  return ok(appView(world, a));
},
```

Copy refusal words from the control plane; `notFound`, `forbidden`, `conflict`, `invalid` and
`problem(status, code, title, detail)` write its ProblemDetails bodies.

A handler that changes something also gets its plain title in `server/operatorLog.ts`: an operator's
change inside an entered organisation is written to that organisation's operator log as
`admin.<METHOD-path>` with that title (`OperatorActionLog.cs`), and an untitled one reads "Changed
something as an Admin".

The cascade (`GET/PUT/DELETE /api/cascade`, `GET /api/cascade/below`) is `server/cascade.ts`: one
adapter per kind over the world's own stores — a budget is the same cap the credits page reads, a
secret the same name the secrets page lists, an app's idle minutes the app's own — so a value set on
one screen is the value every other screen shows. A new kind or key with no store of its own lands
in `world.settings` or `world.context`.

The coverage test reads `store/api.ts` (every endpoint block, `injectEndpoints` too) with
`server/consoleEndpoints.ts`, which resolves literals, nested templates, ternaries and lookups in
a constant map (`PLURAL[level]`) to every address they can make; it fails, naming the endpoint, only
when an address truly cannot be read.

### Adding a scenario

```ts
// src/demo/world/scenarios.ts
defineScenario({
  name: "court-booking-shared",
  title: "Court booking shared with a new address",
  apply: (w) => w.shares.push({ appId: IDS.tableBookings, email: "new@northwind.example", invitedAt: new Date().toISOString(), registered: false, code: "TB-NEW1" }),
  route: "/apps/{app}",
  featured: { app: IDS.tableBookings },
}, "an-alias");
```

A run that should play is a `DemoRun` with `playback: { script, params, elapsed: 0, cursor: 0 }`;
a new kind of work is a `defineScript(name, (world, run) => steps)` in `server/scripts.ts`, built
with `Script` (`wait`, `event`, `effect`, `approval`, `mark`).

## Data

The world (`server/world.ts`) is plain JSON — users, organisations, the tree's nodes, memberships,
apps, ideas, runs with their event logs and playback positions, approvals, the workforce with
memory and track records, hires, tasks, spending, budgets, overdrafts, secrets (names only),
shares, dashboard questions, versions, notifications, suggestions, tokens, settings, rule sets,
top-ups and requests, the operator log and prices. It lives in the page, is saved to
`sessionStorage` under `endgame-demo:world` while the tab is open (a blocked storage only means a
reload forgets), and is rebuilt by "Reset the demo" or the bridge's `reset`.

Asking about an app is played by keywords in the question (`routes/breadth.ts`), so each answer the
console can draw has a question that brings it: a number, bars, a line, a table cut short or empty, a
question the app does not record, one that still fails after the free repair, and one that times out.
The export is a real gzipped tar built in the page (`server/archive.ts`): `manifest.json` in the
control plane's shape, `code.bundle` (a git bundle of the app's versions that `git clone` reads) and
`platform.json`; the demo has no database to dump, and its manifest says so.

The run scripts were modelled on two real run logs read from a development stack (a research run
of 40 events and a build run of 1,457): the same event types, payload fields, milestones and
sentences. Every name, id and address in them was replaced; none of the captured data is in the
repository.

## Invariants

- The product build contains no demo code — `src/main.tsx` never imports `src/demo`; checked by
  `make demo-check`.
- No request leaves the demo page — asserted by the demo e2e, from a sub-path and from a file.
- Every endpoint in `store/api.ts` and `store/sensitive.ts` has a handler — the coverage test.
- A secret's value is never kept — the handler drops it; a unit test checks the world.
- The demo's refusals are the control plane's words — unit tests pin the key ones.

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| The real console with a fake behind a transport seam | It is the product a client buys; a replica drifts the day a screen changes. | A recorded click-through; a separate demo app. |
| One inlined IIFE page | A module script cannot load from `file://`, and a single file needs no host configuration. | ES modules with chunks (break `file://`). |
| Scripts rebuilt from name and parameters | The world stays JSON for sessionStorage, and a run's steps can be inspected by the academy. | Saving closures; replaying raw captured logs (real names, 1.9 MB). |
| `EventSource` and `navigator.credentials` replaced inside the demo only | The console's run stream and passkey code call the browser globals directly; the replacement is installed by the demo entry, never by product code. | Editing feature screens to take a transport (owned by other lanes). |
| Hash routing behind a runtime switch | A static host has no rewrites; the product keeps real addresses. | A 404.html redirect trick. |
