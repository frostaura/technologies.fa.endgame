# UC-107 — See an app and choose how it runs

| Field | Value |
| --- | --- |
| **ID** | UC-107 |
| **Title** | Read an app's health, addresses and cost; set it to sleep when idle or stay always on |
| **Primary actor** | Owner · Admin (access) · Builder (running) · Viewer (read); Dock and the edge report state |
| **Scope** | Control plane (`/api/apps/{id}`, `/api/apps/{id}/settings`, `/internal/apps/*`, `/internal/routes`) |
| **Cascade level** | `sleep.mode`, `sleep.idle_minutes` and `access` inherit down the cascade; set here, they apply to this app |
| **Status** | Built (control-plane side) |

## Main flow

1. `GET /api/apps/{id}` → `{ id, name, scope, health { state, summary }, running, addresses { path, subdomain }, telemetry, cost { monthCredits, capCredits }, settings { running: sleep|always-on, access }, runningCost, sharedWith, endUsers, status, version, publishedAt, idleMinutes }` — `endUsers` counts the end users registered for the app (members who open it are not end users). The console shows each running choice with its monthly figure and what it assumes, today's prices beneath them, and "Not enough history yet" with the reason when there is no estimate; "what it uses" says how many people signed up.
2. `POST /api/apps/{id}/settings { running?, access?, idleMinutes? }` → the updated app.
3. Dock reports `POST /internal/apps/{id}/published { version }` and `POST /internal/apps/{id}/state { status }`;
   the edge reads `GET /internal/routes` — every app's `pathBase` (`/<org>/<division>/<project>/<app>/`), `host`
   (`<org>.<domain>`), `hostPathBase`, `target` (`http://app-<id:N>:8080`), status, sleep setting and version.

## Alternate and failure flows

- **A1 — access.** `private`, `shared` or `public` need the Admin role; `public` is refused (403 `human_only`)
  to any agent or service — only a person signed in to the console can set it. The routing entry carries
  `access`, and Edge's access check enforces it ([UC-110](UC-110-app-access-and-end-users.md)).
- **A2 — telemetry and running cost.** Both come from measurements, never invented zeros. Telemetry is null
  until the app measured something. `runningCost` is read from **this app's own** `hosting_samples` (Dock's awake
  time, memory and storage; Edge's requests) whose period starts in the last **14 days**, at the **current**
  pricing document's hosting rates and credit conversion:
  - *measured hours* `H` = the last sample's end − the first sample's start (gaps between samples count as asleep);
    with `H < 24` it is `state: not-enough-history`, `sleep` and `alwaysOn` null, and `basis` says how much was measured;
  - awake hours `A` = Σ awake seconds; memory `M` = Σ(awake seconds × memory) ÷ Σ awake seconds (the mean while
    awake); storage `S` = the latest sample's stored size; requests a month `R` = Σ requests ÷ `H` × 720;
  - per awake hour `u = usdPerAwakeHour + M(GB) × usdPerGbHourMemory`; fixed `f = S(GB) × usdPerGbMonthStorage + R ÷ 10⁶ × usdPerMillionRequests`;
  - **sleeps when unused** = credits(`A ÷ H × 720 × u + f`); **always on** = credits(`720 × u + f`); rounded to 0.01;
  - each choice carries a one-sentence `basis` (its awake hours, what was measured, memory, storage, requests), and
    `prices` states today's rates in credits.
- **A3 — paused.** When the organisation is past its overdraft limit, or a budget above the app is spent,
  `running` is `paused` and the summary says which ([UC-111](UC-111-metering-overdraft-and-god-mode.md)).

## Rules this use case must honour

- Go-public is a human act (rule 10). Sleep by default (spec).

## Acceptance

- Both addresses are absolute; a running choice made on the app shows in its routes entry with the level that set it.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `CascadeCreditsAndAppsTests`,
`FinalDefectsTests.The_running_cost_of_each_choice_comes_from_the_apps_own_measured_use_and_the_current_prices` (hand-computed
figures, the window, too little history, a price change), `FinalDefectsTests.An_app_counts_its_registered_end_users…`;
[`TEST-001`](../testing/TEST-001-console.md) — `AppView.test.tsx`; [`TEST-102`](../testing/TEST-102-platform-api.md) — `AppAccessTests`, `PlatformApiTests`.
