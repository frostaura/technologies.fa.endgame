# Apps, secrets, hosting and operations — every flow

The app page, asking about an app, versions and export, sharing, secrets, what a hosted app can use, sleep and wake, running the platform.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

Role names used throughout: Owner > Admin > Builder > Viewer. "Operator" means a FrostAura operator in God mode; on the app page the console treats an operator as an Admin.

## APP — the app page

### APP-01 Open an app's page
- **Who:** owner / admin / member (Builder or Viewer) / operator
- **Starts at:** console `/apps/<appId>`, reached by selecting an app in the org chart (another reader covers the org chart)
- **Needs:** at least the Viewer role at the app or above it
- **Level:** Foundation
- **Learn first:** signing in and the org chart (another reader's area)
- **What you learn:** an app has one page that holds its health, its cost, its settings and its history.
- **You know it worked when:** the app's name appears as the page heading, with its address beneath it and four tiles under that.
- **Steps:**
  1. The person opens the app. The page shows the "Loading the app" skeleton: one wide bar and four tiles.
  2. The page loads. The breadcrumb shows the app's own organisation (not necessarily the person's first one), then the division and project names, then the app.
  3. The heading is the app's name. Under it is the subdomain address followed by "· also at <path address>", or only the path address when there is no subdomain.
  4. A button reads "Open the app".
  5. The four tiles appear (APP-02), then "Ask about this app", "Dashboard", "History", the sharing card and the "Secrets" card.
  6. The side column shows "Running", "Who can open it", "What it may spend", "What it uses", "The app itself" and "It is yours". In technical mode it also shows "Underneath". The side column says one thing at a time: what a card's last action did is replaced by its next one, and cleared when another card acts.
  7. The page re-reads the app every 20 seconds, but only while the browser tab has focus.
- **Variations and refusals:**
  - An unknown id gives "This app could not be found" — with "This was not found, or you cannot see it." and "Back to the org chart" in place of "Try again" (a not-found is an answer, so it does not say "Nothing here is known until it loads.").
  - Any other failure gives "The app could not be loaded", with the reason and a retry.
  - A stale cached copy shows a stale notice above the page.
  - Each section has its own error boundary, so one broken section does not blank the page. The boundaries are named "The app's settings", "What it may spend", "What it uses", "The app itself", "The download", "Asking about this app", "The dashboard", "The history", "Sharing" and "The secrets".
  - A person with no role at the app or above it gets 404, exactly as for an app that does not exist, so nothing is learned about what they cannot see: the page shows "This app could not be found" with "This was not found, or you cannot see it." (technical mode: "The scope '<path>' was not found, or you cannot see it. (404)").
- **Where:** `features/apps/AppView.tsx`; `GET /api/apps/{id}` (WorkEndpoints, Viewer); `ReadModels.AppAsync`
- **Reachable from:** UI; API; MCP `app_get`
- **Covered by tests:** `AppView.test.tsx` ("names the app's own organisation…", "shows a skeleton while loading", "records a failed read and names a missing app"); `tests-e2e/console.spec.ts` "app and credits"; `McpTests`

### APP-02 Read the Health, Visits today, Typical response and Cost this month tiles
- **Who:** anyone who can open the page
- **Starts at:** the tile row on `/apps/<id>`
- **Needs:** APP-01
- **Level:** Foundation
- **Learn first:** APP-01
- **What you learn:** the figures come from what the app has actually measured, and something not yet measured is shown as unknown, never as zero.
- **You know it worked when:** each tile shows a value and a note under it, such as "Healthy" with "No errors today".
- **Steps:**
  1. **Health tile.** The value is "Healthy" (with a pulsing dot), "Struggling", "Down" or "Health unknown".
     - The note for a healthy app that has telemetry is "No errors today" or "<n> errors today".
     - Otherwise the note is the plain health summary, for example "Asleep; it wakes on the next visit.", "Paused: a monthly budget above it is spent. Raising the budget or the new month restores it.", "Paused: the organisation reached its overdraft limit. A top-up restores it at once.", "It stopped working and needs attention.", "Not published yet." or "Being built.".
     - When no plain summary exists, the note is "Running the version from <date>".
     - Technical mode shows the raw summary, which can include "Running version <v>.".
  2. **Visits today tile.** The value is a number. The note is one of "<n> errors in <m> requests", "Last visit <time ago>" or "No visits yet".
  3. **Typical response tile.** The value is the median response time, or "No traffic yet". The note is "Slowest 1 in 20: <time>" or "Measured once it has visitors".
  4. **Cost this month tile.** The value is the credits spent. The note says what holds it: "Its own cap: <n> credits a month", "No cap of its own; <Level>'s <n> credits applies", or "No cap on it or above it".
- **Variations and refusals:**
  - Before the app has measured anything, Visits and Typical response both read "Not measured yet". Their notes are "It reports its visits once it has run." and "Measured once it has visitors.".
  - Health is "degraded" when more than one response in twenty failed over the last 15 minutes. The summary then reads "Running, but X of the last Y responses failed.".
- **Where:** `AppView.tsx` (AppBody, Tile, healthNote); `home/treeModel.ts` healthChip; `ReadModels.AppAsync` / `AppHealth`
- **Reachable from:** UI; MCP `app_get`
- **Covered by tests:** `AppView.test.tsx` ("shows status, both addresses, telemetry…", "says when there is no traffic to measure…", "says an app that has measured nothing yet is not measured, never zero…"); `PlatformApiTests.Telemetry_is_stored_per_app_and_the_app_page_and_tree_show_what_was_measured`; `tests-stack/acceptance.spec.ts` test 10

### APP-03 Open the hosted app from its page
- **Who:** anyone who can open the page
- **Starts at:** the "Open the app" button
- **Needs:** APP-01
- **Level:** Foundation
- **Learn first:** APP-01
- **What you learn:** an app lives at its own address, outside the console.
- **You know it worked when:** a new tab opens on the app itself, or on its sign-in page (KIT-01).
- **Steps:**
  1. The person presses "Open the app".
  2. A new tab opens on the subdomain address if there is one, otherwise on the path address.
  3. What follows depends on who may open the app (KIT-01 to KIT-07) and whether it is awake (HOST-01).
- **Variations and refusals:** see HOST-01 to HOST-06 and KIT-07.
- **Where:** `AppView.tsx`; Edge `Routing/AppGate.cs`
- **Reachable from:** UI
- **Covered by tests:** `tests-stack/acceptance.spec.ts` test 4

### APP-04 Choose how the app runs: Sleeps when unused or Always on
- **Who:** Builder or above, or an operator
- **Starts at:** the "Running" fieldset in the side column
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01, APP-02
- **What you learn:** sleeping is cheaper, being always on is instant, and the page prices each choice from the app's own measured use.
- **You know it worked when:** the chosen radio has a dark border, the legend icon changes (asleep or always-on), and no "The change was not saved" alert appears.
- **Steps:**
  1. The person reads the two choices:
     - "Sleeps when unused": "Cheapest. The first visitor waits a few seconds. About <n> credits a month."
     - "Always on": "Instant for everyone. About <n> credits a month."
     - Each choice can carry a one-line basis, for example "Measured over the last 14 days: awake …".
  2. Under the choices sits a line built from the cost basis and "Today's prices: … credits an awake hour, … per GB of memory an awake hour, … per GB stored a month and … per million requests."
  3. The person picks the other radio. The choice shows at once (optimistic).
  4. The app is saved through `POST /api/apps/{id}/settings { running }`, stored as `sleep.mode` (`auto` or `always_on`) at the app. The edge is told the routes changed, and the org chart refreshes.
- **Variations and refusals:**
  - With fewer than 24 measured hours in 14 days, each choice reads "Not enough history yet to say what it costs a month." The footer reads "Not enough history yet. Nothing measured yet. An estimate needs at least 24 hours…", or "Only <h> hours measured so far…".
  - On refusal the radio rolls back and an alert reads "The change was not saved: <reason> The setting is back to what it was."
  - Below Builder the choices are shown, disabled, with "A Builder or above changes how it runs."
  - An unknown `running` value gets "running is 'sleep' or 'always-on'."
- **Where:** `AppView.tsx` (Settings); `api.ts` `updateAppSettings`; `POST /api/apps/{id}/settings` (Builder); `CascadeService.SetAsync`; `AppServices.RunningCostAsync`
- **Reachable from:** UI; API; MCP `app_settings` (`running`)
- **Covered by tests:** `AppView.test.tsx` ("switches running at once…", "rolls a refused change back…", "gives each running choice its monthly figure…"); `tests-e2e/console.spec.ts` "the app shows both addresses and telemetry, and its running setting changes" and "a refused setting is rolled back…"; `AppSettingsTests`; `FinalDefectsTests` (running cost)

### APP-05 Set how many idle minutes pass before the app sleeps
- **Who:** Builder or above.
- **Starts at:** the "Running" fieldset on the app page, while "Sleeps when unused" is chosen. Also `POST /api/apps/{id}/settings { idleMinutes }` and MCP `app_settings`.
- **Needs:** Builder.
- **Level:** Advanced · **Learn first:** APP-04 · **What you learn:** a sleeping app costs least, and how soon it sleeps is yours to choose.
- **Steps:**
  1. Under the running choices, **"Sleeps after this many idle minutes"** holds the current value, with "From 1 to 1,440 (a day)."
  2. Type a number and press **"Save"**. "It sleeps after <n> idle minutes now." appears under the field and its button, which keep their width at any size.
- **You know it worked when:** the message shows, and "Underneath" in technical mode reads the new value.
- **Variations and refusals:**
  - Locally: "A whole number of minutes, from 1 to 1,440." and the button stays disabled. The server: "sleep.idle_minutes is a whole number from 1 to 1440."
  - Refused: "It was not changed: <reason> It still sleeps after <n> idle minutes." and the value goes back.
  - Below Builder: "It sleeps after <n> idle minutes. A Builder or above changes it."
  - Always on: the field is not shown.
- **Where:** `features/apps/AppManage.tsx` (IdleMinutes); `WorkEndpoints` `/apps/{id}/settings`.
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `AppManage.test.tsx` ("changes the idle minutes at once…", "refuses idle minutes outside…"); `tests-e2e/manage.spec.ts`; `AppSettingsTests`.

### APP-06 Make the app private or shared
- **Who:** Admin or above, or an operator
- **Starts at:** the "Who can open it" fieldset
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01, and roles (another reader's People area)
- **What you learn:** who may open an app is one setting, private by default, and it inherits down the cascade.
- **You know it worked when:** the chosen radio has a dark border and the sharing card changes. Shared shows "Shared with"; private shows the "Sharing" explanation.
- **Steps:**
  1. Three radios are shown:
     - "Private: only people in <org name>"
     - "Shared: people you invite, after they register (<n> so far)" (the count appears only when it is above zero)
     - "Public: anyone, no sign-in needed to open it"
  2. The person picks Private or Shared. The choice is saved at once through `POST /api/apps/{id}/settings { access }`.
  3. The edge's routes are refreshed. From the next request, Edge's access check applies the new setting (KIT-01 to KIT-07).
- **Variations and refusals:**
  - Below Admin the choices are shown, disabled, with "An Admin or the Owner chooses who can open it."
  - Picking the current value does nothing.
  - An unknown value gets "access is 'private', 'shared' or 'public'."
- **Where:** `AppView.tsx` (Settings, chooseAccess); `POST /api/apps/{id}/settings` (Admin when `access` is sent)
- **Reachable from:** UI; API; MCP `app_settings` (`access`)
- **Covered by tests:** `AppAccessTests.Only_a_person_can_make_an_app_public_and_only_an_admin_changes_who_may_open_it`; `AppView.test.tsx`

### APP-07 Make the app public, which only a person can do
- **Who:** Admin or above, signed in to the console as a person (a member or an operator)
- **Starts at:** the "Public: anyone, no sign-in needed to open it" radio
- **Needs:** APP-06
- **Level:** Core
- **Learn first:** APP-06
- **What you learn:** going public is a human act. No agent, token or service can do it.
- **You know it worked when:** the Public radio is selected, the sharing card reads "<App> is public, so anyone with the address can open it. To choose who can, set it to Shared.", and the app opens signed out.
- **Steps:**
  1. The person picks Public. Nothing is saved yet.
  2. An alert dialog takes focus: "Make <App> public?" and "Anyone with the address will be able to open it, without signing in. Only a person can make this choice."
  3. The person presses "Make it public". The setting is saved, and visitors are admitted with no session.
  4. Alternatively, "Keep it as it is" or the Escape key closes the dialog and nothing changes.
- **Variations and refusals:**
  - Through MCP (`app_settings access=public`) or the cascade MCP tool (`cascade_set`), the refusal is 403 `human_only` "Only a person can make an app public". The MCP description says so too.
  - Restoring a version makes a public app private again (VER-02).
- **Where:** `AppView.tsx` (ConfirmPublic); `CascadeService.ValidateWellKnownAsync`
- **Reachable from:** UI. The API accepts it only from a console session; MCP always refuses.
- **Covered by tests:** `AppView.test.tsx` ("makes an app public only after a person confirms it", "asks a person to confirm making it public, in a dialog that can be declined"); `tests-e2e/console.spec.ts` "making an app public waits for a person to confirm it"; `AppAccessTests`; `tests-stack/acceptance.spec.ts` test 12

### APP-08 Read "What it uses"
- **Who:** anyone who can open the page
- **Starts at:** the "What it uses" section in the side column
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01
- **What you learn:** every app leans on the same shared platform services.
- **You know it worked when:** a row of chips appears, ending with "Open to AI assistants".
- **Steps:**
  1. The section shows the "Loading what it uses" skeleton.
  2. Chips appear for each platform service the app depends on: "Sign-in", "Data", "AI", "E-mail", "Incoming data", "Schedules", "Visits and errors measured". "Data" is shown for every app that has been built, since each has a database of its own; the others come from the organisation graph. Technical mode shows the raw service names instead.
  3. Further chips follow:
     - "No one has signed up yet", or "<n> people signed up"
     - "Shared with <n> people", only when the app is shared
     - "<n> secrets", when any apply
     - "Open to AI assistants"
  4. A line follows: "Secrets it can read: A, B. Manage them", which links to the secrets page.
  5. Another line follows: "An AI assistant you let in can use this app the way a person does. Let an assistant in", which links to `/assistants`.
  6. Technical mode also shows "MCP: <origin>/mcp/apps/<id>".
- **Variations and refusals:**
  - A failed graph read gives "What it uses could not be loaded" with a retry.
  - A failed secrets read gives "Its secrets could not be read: <reason>" (an Admin only).
  - Below Admin, its secrets are not asked for: there is no secrets chip and no "Secrets it can read" line.
  - The service chips name only what the app has actually used: sign-in once anyone has signed in to it, registered or been invited; AI once it has called a model; e-mail once it has sent one; measured visits once it has reported telemetry; incoming data and schedules once it declares a webhook or a schedule.
- **Where:** `AppAside.tsx` (WhatItUses); `GET /api/ontology?scope&view=all`; `GET /api/secrets?scope`
- **Reachable from:** UI
- **Covered by tests:** `AppBreadth.test.tsx` "lists the services it leans on, its secrets by name, and that assistants can use it"; `AppView.test.tsx` "says how many people signed up to it…"; `tests-e2e/breadth.spec.ts` "the Owner downloads everything, and sees what the app uses"

### APP-09 See the secrets an app can read, from its page
- **Who:** Admin or above, to see the names
- **Starts at:** the "Secrets" card on the app page
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01
- **What you learn:** an app reads secrets by name, and each one may have been set on the app or above it.
- **You know it worked when:** each name appears with "Set on this app" or "Set at <level> level".
- **Steps:**
  1. The card shows the "Loading the secrets" skeleton, then lists each secret's name with "Set on this app" or "Set at organisation/division/project level".
  2. The person can follow "Manage secrets" to `/secrets?scope=<app scope>` (SEC-01).
- **Variations and refusals:**
  - When none apply: "No secrets apply to it. Add one, and the app can read it by name."
  - Below Admin the names are not asked for; the card reads "An Admin or the Owner sees which secrets it is given, and adds or changes them." "What it uses" leaves out its secrets the same way.
- **Where:** `AppView.tsx` (AppSecrets); `GET /api/secrets` (Admin)
- **Reachable from:** UI
- **Covered by tests:** `AppView.test.tsx` "lists the secrets the app can read by name, never a value…"

### APP-10 Read "Underneath" in technical mode
- **Who:** anyone who can open the page, with the console in technical mode (the mode switch is another reader's area)
- **Starts at:** the side column, which shows "Underneath" only in technical mode
- **Needs:** APP-01
- **Level:** Advanced
- **Learn first:** APP-01, switching modes (another reader's area)
- **What you learn:** normal mode never names infrastructure; technical mode shows the ids and the lifecycle underneath.
- **You know it worked when:** the "Underneath" table lists "App id", "Scope", "Lifecycle", "Container", "Version", "Published", "Sleeps after", "Path address" and "Subdomain address".
- **Steps:**
  1. The person switches to technical mode.
  2. "Underneath" appears in the side column. The rest of the page gains extras: raw health summaries, version ids in History, and the "The query" panel when asking.
- **Variations and refusals:** "Version" reads "none published", "Published" reads "never" and "Subdomain address" reads "none" where they apply.
- **Where:** `AppAside.tsx` (TechnicalDetails)
- **Reachable from:** UI
- **Covered by tests:** `AppBreadth.test.tsx` "shows what the app is underneath only in technical mode…"

### APP-11 Set an app's own monthly credit cap
- **Who:** Admin or above. Anyone reads it.
- **Starts at:** the app page's side panel **"What it may spend"**, card **"Its monthly cap"** ("All it spends a month, hosting and AI together. Work and visits stop at it until it is raised or the month turns."). Also its row on `/credits` (CRED-03).
- **Needs:** Admin.
- **Level:** Advanced · **Learn first:** CRED-03 · **What you learn:** an app can be held to its own cap, inside whatever holds the levels above it.
- **Steps:**
  1. The card says what holds it: "<n> credits a month, set on <App>", "<n> credits a month, from <Level>", or "No cap on it or above it: only the organisation's balance and overdraft hold it."
  2. Press **"Set one for <App>"** (or **"Change it"**), type into "Credits a month", press **"Save"**: "<App> may spend <n> credits a month here."
  3. **"Remove it"** removes its own; the card then says which cap applies.
- **You know it worked when:** the card and the "Cost this month" tile ("Its own cap: <n> credits a month", "No cap of its own; <Level>'s <n> credits applies", or "No cap on it or above it") agree.
- **Variations and refusals:** "Type a number of credits." · refused: "It was not saved: <reason> It is as it was." · failed read: "Its cap could not be loaded". Below Admin: "An Admin or the Owner sets these."
- **Where:** `AppManage.tsx` (AppSpending), `appModel.ts` (`capNote`); `PUT/DELETE /api/cascade` (budget `monthly_credits`).
- **Reachable from:** UI; API; MCP `budget_set`.
- **Covered by tests:** `AppManage.test.tsx` ("the cap note…", "says where its cap comes from…"); `tests-e2e/manage.spec.ts`.

### APP-12 Set an app's own AI allowance
- **Who:** Admin or above. Anyone reads it.
- **Starts at:** "What it may spend", card **"Its AI allowance"** ("What the app's own AI may spend a month. Once used, its AI answers stop until the month turns; the rest of the app keeps working.").
- **Needs:** Admin.
- **Level:** Advanced · **Learn first:** APP-11, KIT-13 · **What you learn:** an app's own AI has a limit of its own, apart from the work done on it.
- **Steps:** as APP-11, for the setting `app_models.monthly_credits`. With none set: "None is set on it or above it, so FrostAura's standard allowance applies."
- **You know it worked when:** the card reads "<n> credits a month, set on <App>".
- **Variations and refusals:** as APP-11; failed read: "Its AI allowance could not be loaded".
- **Where:** `AppManage.tsx`; `PUT/DELETE /api/cascade` (setting `app_models.monthly_credits`).
- **Reachable from:** UI; API; MCP `cascade_set`.
- **Covered by tests:** `AppManage.test.tsx` ("lets an Admin set the app's own AI allowance"); `tests-e2e/manage.spec.ts`; `ModelGatewayTests` (the allowance).

### APP-13 Rename or archive an app
- **Who:** Builder or above.
- **Starts at:** the app page's side panel **"The app itself"**, or `/tree` (TREE-06, TREE-08).
- **Needs:** Builder.
- **Level:** Advanced · **Learn first:** TREE-06 · **What you learn:** an app's name can change; its addresses do not; archiving keeps everything.
- **Steps:** "Name" and **"Save the name"** as TREE-06; **"Archive <App>"** and **"Reactivate <App>"** as TREE-08. **"Manage it with the rest of the organisation"** opens `/tree` at the app.
- **You know it worked when:** the heading shows the new name, or the app reads archived.
- **Variations and refusals:** below Builder: "A Builder or above renames or archives it."
- **Where:** `AppManage.tsx` (AppItself), `features/tree/NodeControls.tsx`.
- **Reachable from:** UI; API `PATCH /api/apps/{id}`; MCP `node_update`.
- **Covered by tests:** `ManageView.test.tsx`; `AppManage.test.tsx`.

### APP-14 Delete an app
- **Who:** Admin or above.
- **Starts at:** "The app itself", **"Delete <App>"**; or `/tree` (TREE-09).
- **Needs:** Admin; nothing attached (no work, spend or history).
- **Level:** Advanced · **Learn first:** TREE-09 · **What you learn:** an app that has run is archived, not deleted.
- **Steps:** as TREE-09. Once deleted the org chart opens.
- **You know it worked when:** the app is gone from the chart.
- **Variations and refusals:** the 409 is shown with **"Archive it instead"**. MCP has no delete tool.
- **Where:** `AppManage.tsx`, `NodeControls.tsx` (DeleteNode); `DELETE /api/apps/{id}`.
- **Reachable from:** UI; API.
- **Covered by tests:** `ManageView.test.tsx` ("shows the refusal to delete what has history, and archives it instead", "asks before deleting an app in plain English: an app, not a app").

### APP-15 Rebuild and restart an app
- **Who:** Builder or above.
- **Starts at:** the app page when it has stopped — "<App> stopped working." or "<App> is stopped." with "Rebuilding builds its newest version again and starts it. Nothing in its history changes." — or after a restore whose rebuild failed (VER-02). **"Rebuild and restart"**.
- **Needs:** Builder; at least one version.
- **Level:** Core · **Learn first:** VER-01 · **What you learn:** a stopped or failed app is brought back by building its newest version again, not by changing it.
- **Steps:**
  1. Press **"Rebuild and restart"**. "Building its newest version again, then starting it. It is unavailable for a moment." shows while it works.
  2. "<App> is rebuilt and running again." The history and who may open it are unchanged.
- **You know it worked when:** the message shows and the health tile reads running.
- **Variations and refusals:**
  - It could not be built or started: "<App> could not be rebuilt. Its last version stays as it is; ask the builder to look." (technical mode shows the build error).
  - Nothing ever built: 409 "Nothing has been built for this app yet, so there is no version to publish again."
  - Below Builder the panel is not shown; the API refuses with 403.
- **Where:** `AppManage.tsx` (RebuildAndRestart), `AppView.tsx`, `History.tsx`; `POST /api/apps/{id}/republish`; `AppVersionService.RepublishAsync`.
- **Reachable from:** UI; API. No MCP tool.
- **Covered by tests:** `AppManage.test.tsx` ("is offered when the app stopped working…", "says plainly when it could not be rebuilt"); `tests-e2e/manage.spec.ts`; `VersionsAndExportTests.Rebuild_and_restart_publishes_the_newest_version_again_without_touching_history_or_access`; `AuthorizationMatrixTests`.

## ASK — asking about an app, and the dashboard

### ASK-01 See what a question will cost before asking it
- **Who:** Viewer or above
- **Starts at:** the "Ask about this app" panel on the app page
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-02
- **What you learn:** the most a piece of work can cost is shown before it starts.
- **You know it worked when:** a box reads "At most <n> credits." followed by the basis.
- **Steps:**
  1. The person reads "Ask in plain words about its visits, errors and what its people do in it. It answers from this app's own records only."
  2. They type a question (at most 500 characters; the placeholder is "Which days are busiest?") and press "See what it costs". The button reads "Working it out…" while it waits.
  3. The box appears: "At most <n> credits. Up to 3 model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost. It is charged at what it actually costs."
  4. A Builder sees "Ask it". A Viewer sees "Asking spends credits, so it needs the Builder role here. You can read the dashboard below."
- **Variations and refusals:**
  - An empty question leaves the button disabled.
  - Editing the question after an estimate hides the estimate, because it was for different text.
  - Fewer than 3 characters: "No estimate could be made: Ask a question of 3 to 500 characters."
  - No model route configured: "No estimate could be made: Questions about apps cannot be answered on this installation yet."
- **Where:** `AskPanel.tsx`; `POST /api/apps/{id}/ask/estimate` (Viewer); `AskService.EstimateAsync`
- **Reachable from:** UI and API. There is no MCP estimate tool; `app_ask` charges without showing one first.
- **Covered by tests:** `AppBreadth.test.tsx` "shows what it costs before anything is asked…", "offers estimates but not asking to a Viewer"; `tests-e2e/breadth.spec.ts` "asks about the app with the cost first…"

### ASK-02 Ask the question and read the answer and its chart
- **Who:** Builder or above, or an operator
- **Starts at:** "Ask it" in the estimate box
- **Needs:** ASK-01, and credits
- **Level:** Core
- **Learn first:** ASK-01
- **What you learn:** plain questions are answered from the app's own telemetry, charged at the real cost, and a failed attempt is repaired once at no charge.
- **You know it worked when:** the question appears as a heading with "Cost <n> of at most <m>", one to three plain sentences, and a chart.
- **Steps:**
  1. The person presses "Ask it". The button reads "Asking…", and under it "Writing the query, then reading the records. It usually takes up to half a minute."
  2. A model writes one read-only query, which is guarded and run against the app's telemetry views. If it is refused or fails, the model is shown why and tries once more, and that repair is not charged. A second call puts the rows into words.
  3. The answer appears: the question as a heading, "Cost <charged> of at most <estimate>", the answer text, and the chart, which is a single number, bars (up to 24, three series at most), a line (up to 120 points) or a table (first 50 rows). Bars and lines start at zero, so a small change looks small.
  4. If there were more rows than shown: "Only the first rows are shown; there were more."
  5. The credit balance is refreshed.
- **Variations and refusals:**
  - The model declines, because the app does not record what is asked: the alert shows the model's own plain reason.
  - It still fails after the repair: the control plane's own words, "It could not be worked out from what this app records. Try asking it another way, or about its visits, requests, errors, events or measurements." (The console says "That question could not be answered from what the app records. Try asking it another way." only when no reason comes back.)
  - It times out: "That question took too long to answer. Try a narrower one, such as a shorter period."
  - No route configured: "Questions about apps cannot be answered on this installation yet."
  - 403: "Asking needs the Builder role here. <reason>"
  - A budget refusal (402) is shown through the generic error text.
  - A table with no rows reads "No rows came back."
- **Where:** `AskPanel.tsx`, `AskChart.tsx`; `POST /api/apps/{id}/ask` (Builder); `AskService.AskAsync`
- **Reachable from:** UI; API; MCP `app_ask`
- **Covered by tests:** `AskTests` (all of them); `AppBreadth.test.tsx` ("names a question it cannot answer…", "says a query that could not run in plain words…", "shows a declined question's own plain reason"); `tests-e2e/breadth.spec.ts` "an unanswerable question is said in words"

### ASK-03 Keep an answer on the dashboard
- **Who:** Builder or above
- **Starts at:** "Keep this on the dashboard" under an answer
- **Needs:** ASK-02
- **Level:** Core
- **Learn first:** ASK-02
- **What you learn:** a kept question is stored as its query and is worked out afresh, at no cost, every time the page opens.
- **You know it worked when:** "It is on the dashboard, and is worked out afresh each time you open this page." appears and a new card shows under "Dashboard".
- **Steps:**
  1. The person presses the button. It reads "Keeping it…", and a card appears at once in the dashboard reading "Keeping it…".
  2. The server re-guards the query, stores the question, query, chart and answer, and runs it.
  3. The card is swapped for the stored one, and the button becomes disabled.
- **Variations and refusals:**
  - On refusal the card is removed and the message reads "It was not kept: <reason>".
  - The dashboard already holds 30 questions: 409 "A dashboard holds at most 30 questions; remove one first."
  - A query the guard refuses: 400 "That query cannot be saved".
- **Where:** `AskPanel.tsx`; `api.ts` `saveQuestion`; `POST /api/apps/{id}/dashboard` (Builder)
- **Reachable from:** UI and API. There is no MCP tool for the dashboard.
- **Covered by tests:** `AppBreadth.test.tsx` "keeps an answer on the dashboard at once, and takes it off again when the control plane refuses"; `AskTests.Saved_questions_rerun_on_read…`

### ASK-04 Ask something else
- **Who:** anyone who has an answer on screen
- **Starts at:** "Ask something else"
- **Needs:** ASK-02
- **Level:** Foundation
- **Learn first:** ASK-02
- **What you learn:** each question is asked fresh, with its own estimate.
- **You know it worked when:** the question box is empty and no answer is shown.
- **Steps:** the person presses it, and the answer, the estimate, the typed question and any "kept" message are cleared.
- **Variations and refusals:** none.
- **Where:** `AskPanel.tsx`
- **Reachable from:** UI
- **Covered by tests:** none found specifically

### ASK-05 Read the dashboard
- **Who:** Viewer or above
- **Starts at:** the "Dashboard" section of the app page
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** ASK-03
- **What you learn:** kept questions are re-run against the latest records every time they are read, without calling a model.
- **You know it worked when:** each card shows its answer and chart with "Worked out <time ago>", and the heading reads "Worked out afresh each time you open it, at no cost."
- **Steps:**
  1. The section shows the "Loading the dashboard" skeleton.
  2. Each kept question is re-run and shown as a card: the question, the stored answer, a fresh chart, "Only the first rows are shown." when cut short, and "Worked out <time ago>".
- **Variations and refusals:**
  - With nothing kept: "Nothing is kept on the dashboard yet" with "Ask a question above, then keep the answer here. It is worked out again from the latest records whenever this page opens."
  - A failed read: "The dashboard could not be loaded" with a retry.
  - A broken question reads "This question no longer runs: It can no longer be worked out from what the app records. Ask it again, and keep the new answer."
  - A timed-out question reads "…It took too long to work out this time. It is tried again each time this page opens."
  - Technical mode adds "The query" and "What failed underneath".
  - The dashboard is read when the page mounts. It is not polled.
- **Where:** `AskPanel.tsx` (Dashboard, SavedCard); `GET /api/apps/{id}/dashboard` (Viewer)
- **Reachable from:** UI and API
- **Covered by tests:** `AppBreadth.test.tsx` ("shows a skeleton, then each kept question re-run…", "records a failed read on the page", "says why a kept question no longer works out…", "shows each saved query only in technical mode"); `AskTests.A_saved_question_that_no_longer_runs…`

### ASK-06 Take a question off the dashboard
- **Who:** Builder or above
- **Starts at:** "Take off" on a dashboard card
- **Needs:** ASK-05
- **Level:** Core
- **Learn first:** ASK-05
- **What you learn:** taking a question off is immediate and needs no confirmation.
- **You know it worked when:** the card disappears and no alert appears.
- **Steps:** the person presses "Take off". The card leaves at once and `DELETE /api/apps/{id}/dashboard/{questionId}` is sent.
- **Variations and refusals:**
  - On refusal the card comes back and an alert reads "“<question>” was not taken off the dashboard: <reason> It is back."
  - A card still being kept shows no "Take off".
  - A Viewer never sees the button.
  - An unknown id gets 404 "The saved question".
- **Where:** `AskPanel.tsx` (SavedCard); BreadthEndpoints
- **Reachable from:** UI and API
- **Covered by tests:** none found that removes a card specifically; `AppBreadth.test.tsx` covers keeping and the rollback on refusal.

### ASK-07 See the query and what failed, in technical mode
- **Who:** anyone in technical mode
- **Starts at:** under an answer, an error or a dashboard card
- **Needs:** ASK-02 or ASK-05
- **Level:** Advanced
- **Learn first:** ASK-02, APP-10
- **What you learn:** normal mode never repeats a query or a database message; technical mode shows them apart from the answer.
- **You know it worked when:** a "The query" disclosure, or an open "What failed underneath" panel, appears.
- **Steps:**
  1. The person expands "The query" to read the read-only SQL.
  2. On a failure, "What failed underneath" opens on its own, showing "The last query tried" and "What refused it".
- **Variations and refusals:** none.
- **Where:** `AskPanel.tsx` (Query, Underneath)
- **Reachable from:** UI
- **Covered by tests:** `AppBreadth.test.tsx` "shows an unanswerable question's plain reason, and the query and the database's message only in technical mode"

## VER — versions, restore and export

### VER-01 Read an app's version history
- **Who:** Viewer or above
- **Starts at:** the "History" section on the app page
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01
- **What you learn:** every change is recorded with who made it (an employee, a person or the factory), and one version is live.
- **You know it worked when:** a list of versions appears, one of them marked "Live now".
- **Steps:**
  1. The section reads "Any version can be brought back." and shows a skeleton.
  2. Up to 10 versions are listed, newest first. Each shows a plain title (the first line, without its plan-id prefix), the author (an employee's name links to their page; otherwise "The factory" or the person's name), the time ago, and "Live now" on the live one.
  3. The factory's own bookkeeping (its progress records, and notes about checking or repairing its work) is folded away in normal mode: **"Show every saved step (<n> more)"** lists it too, titled "The factory recorded its progress" for the factory's own commits; **"Show only the changes"** folds it again. The live version is never folded. A restore is titled "An earlier version, brought back". A title that names files falls back to "A change by <name>".
  4. "Show earlier versions" loads 10 more. It reads "Loading…" while it waits.
- **Variations and refusals:**
  - With no versions: "No versions yet" with "The first version appears here once it is built."
  - A failed read: "The history could not be loaded" with a retry.
  - Technical mode shows the first 12 characters of the commit id and the rest of the message.
- **Where:** `History.tsx`, `appModel.ts`; `GET /api/apps/{id}/versions?limit` (Viewer)
- **Reachable from:** UI; API; MCP `app_versions`
- **Covered by tests:** `AppBreadth.test.tsx` ("lists versions with who made each…", "records a failed read and an empty history distinctly", "names a version by its first line…", "names a restore for what it is, not by its commit id"); `VersionsAndExportTests.The_history_names_…`; `tests-e2e/breadth.spec.ts` "history names who made each version…"

### VER-02 Bring an earlier version back
- **Who:** Builder or above, or an operator
- **Starts at:** "Bring back" on a version that is not live
- **Needs:** VER-01
- **Level:** Core
- **Learn first:** VER-01, APP-07
- **What you learn:** a restore adds a new version and never rewrites history, and a public app returns to private until a person looks at it.
- **You know it worked when:** "The earlier version is back and running." appears, and the restored version is the newest one, marked "Live now".
- **Steps:**
  1. The person presses "Bring back". A dialog takes focus: "Bring this version of <App> back?" with "It becomes the newest version, made by you; nothing in the history is lost. The app is rebuilt and restarted, so it is briefly unavailable."
  2. If the app is public, the dialog adds "It is public now, so it becomes private: look at the restored version before you make it public again."
  3. The person presses "Bring it back". "Keep the live version" or the Escape key cancels instead.
  4. While it works, the page reads "Bringing it back: it becomes the newest version, then it is rebuilt and restarted."
  5. Dock makes a new commit by the person. A public app is set to private, then the app is rebuilt, given a fresh token and started.
  6. The result reads "The earlier version is back and running.", plus "It was public, so it is private now. Make it public again once you have looked at it." when that applies. "Done" closes it. The restored version heads the history as "An earlier version, brought back", by the person, marked "Live now".
- **Variations and refusals:**
  - The rebuild fails: "The earlier version is back, but it is not running yet." with "It could not be rebuilt and started. Rebuild it again below, or ask the builder to look." (technical mode shows the build error) and **"Rebuild and restart"** (APP-15).
  - The restore is refused: "That version was not brought back: <reason> Nothing changed."
  - A bad commit id: "Name the version by its commit id."
  - A Viewer sees no "Bring back".
- **Where:** `History.tsx`; `POST /api/apps/{id}/versions/{commit}/restore` (Builder); `AppVersionService.RestoreAsync`
- **Reachable from:** UI; API; MCP `app_restore`, recorded as made over MCP
- **Covered by tests:** `AppBreadth.test.tsx` ("asks before bringing a version back…", "keeps the live version when a restore is refused…"); `VersionsAndExportTests.A_restore_is_a_new_change_by_the_person_republished_and_a_public_app_turns_private`; `tests-e2e/breadth.spec.ts`

### VER-03 Download everything (the export)
- **Who:** Owner only
- **Starts at:** "It is yours" in the side column
- **Needs:** APP-01
- **Level:** Core
- **Learn first:** APP-01
- **What you learn:** an app's code, its whole history and its data can always leave Endgame, at no cost, and secrets never do.
- **You know it worked when:** the browser saves `<slug>-export.tar.gz` and the page reads "Saved as <file name>."
- **Steps:**
  1. The person reads "Download the code, its full history and all its data whenever you like, at no cost. Secrets are never included."
  2. They press "Download everything". It reads "Preparing the download…".
  3. The archive is streamed and saved. It holds `manifest.json`, `code.bundle` (every version), `database.dump` and `platform.json` (end users without passkeys, shares, schedules, webhooks, custom events).
- **Variations and refusals:**
  - Anyone but the Owner sees "Only the Owner can download it." A direct call returns 403, an operator in God mode included (per UC-118).
  - A failure reads "The download could not be made: <reason>".
  - An app that has never started has no `database.dump`, and the manifest reads "The app has no database yet: it has never been started."
- **Where:** `AppAside.tsx` (ItIsYours); `store/sensitive.ts` `downloadExport`; `GET /api/apps/{id}/export` (Owner)
- **Reachable from:** UI and API. There is no MCP tool.
- **Covered by tests:** `AppBreadth.test.tsx` ("lets the Owner download everything…", "tells anyone but the Owner…"); `VersionsAndExportTests.Only_the_owner_exports…`; `HostingIntegrationTests.The_control_plane_takes_an_apps_own_database_as_a_pg_dump_archive…`

## SHR — sharing, from the owner's side

### SHR-01 Read how to start sharing when an app is private or public
- **Who:** anyone who can open the page
- **Starts at:** the "Sharing" card, shown when access is not Shared
- **Needs:** APP-01
- **Level:** Foundation
- **Learn first:** APP-06
- **What you learn:** only a shared app has a list of people.
- **You know it worked when:** the card explains the current state.
- **Steps:** the card reads either "<App> is private to your organisation. Set it to Shared to invite people by e-mail." or "<App> is public, so anyone with the address can open it. To choose who can, set it to Shared."
- **Variations and refusals:** none.
- **Where:** `AppView.tsx` (SharingOff)
- **Reachable from:** UI
- **Covered by tests:** `AppView.test.tsx` "tells a private app how to share it…"

### SHR-02 See who a shared app is shared with
- **Who:** Admin or above
- **Starts at:** the "Shared with" card, shown when access is Shared
- **Needs:** APP-06 set to Shared
- **Level:** Core
- **Learn first:** APP-06
- **What you learn:** a share is an address with a one-time code, and it shows whether the person has registered.
- **You know it worked when:** each address appears with "Registered", or "Invited <time ago>".
- **Steps:** the card shows the "Loading who it is shared with" skeleton, then lists each address with its badge and a "Stop sharing" button.
- **Variations and refusals:**
  - An empty list: "Not shared with anyone yet. Invite someone below; they register at the app with the code you give them."
  - A failed read: "Who it is shared with could not be loaded" with a retry.
  - Below Admin the list is not asked for: the card reads "<App> is shared with <n> people." (or "…is shared, with nobody yet.") and "An Admin or the Owner sees who, invites people and stops sharing."
- **Where:** `AppView.tsx` (Sharing); `GET /api/apps/{id}/shares` (Admin)
- **Reachable from:** UI and API. There is no MCP tool.
- **Covered by tests:** `AppView.test.tsx` ("…lists who a shared app is shared with", "shows a refused share list as a failure…", "says plainly when a shared app has nobody on its list yet")

### SHR-03 Invite an e-mail address
- **Who:** Admin or above
- **Starts at:** "Invite by e-mail" on the "Shared with" card
- **Needs:** SHR-02
- **Level:** Core
- **Learn first:** SHR-02
- **What you learn:** the invitation code is shown once and never stored; only its hash is kept.
- **You know it worked when:** a green box reads "<email> is invited…" with the code, and the address appears in the list as "Invited just now".
- **Steps:**
  1. The person types an address and presses "Invite". It reads "Inviting…". The address joins the list at once.
  2. The server makes a 32-character code valid for 14 days, keeps only its hash, and, when a mail server is configured, e-mails it: the subject is "<Org> shared <App> with you", and the message gives the app's address, says to choose "Create your sign-in" with this e-mail address and the code, and that the code works once, until a time in UTC.
  3. The page shows "<email> is invited, and the code was e-mailed to them. If it does not arrive, give them this code; they register with it at <App>’s sign-up page within 14 days, before <date>.", the code, "Copy the code" (which then reads "Copied") and "It will not be shown again.".
  4. "Done" closes the box. The invited person then registers (KIT-03).
- **Variations and refusals:**
  - A badly formed address: "That does not look like an e-mail address." and the button stays disabled.
  - A refusal: "<email> was not invited: <reason> Nothing changed." and the address is removed from the list.
  - The copy fails: "The code could not be copied; select it and copy it by hand."
  - Inviting an address again issues a fresh code. The old one stops working and the list is not duplicated.
  - With no mail server, nothing is e-mailed and the note reads "<email> is invited. No e-mail was sent, so give them this code; they register with it at <App>’s sign-up page within 14 days, before <date>.".
  - The share endpoint does not check that access is Shared. Not verified what an invitation does on a private app; KIT-03 refuses sign-up there.
- **Where:** `AppView.tsx` (Sharing, InvitationCode); `store/sensitive.ts` `shareApp`; `POST /api/apps/{id}/shares` (Admin); `AppIdentityService.ShareAsync`; `InvitationMailer`
- **Reachable from:** UI and API
- **Covered by tests:** `AppView.test.tsx` ("invites by e-mail and shows the one-time code once…", "takes a refused invitation back off the list…"); `PlatformApiTests.Sharing_an_app_e_mails_the_person…`; `tests-e2e/console.spec.ts` "a shared app lists its people…"

### SHR-04 Stop sharing with someone
- **Who:** Admin or above
- **Starts at:** "Stop sharing" on a row
- **Needs:** SHR-02
- **Level:** Core
- **Learn first:** SHR-03
- **What you learn:** removing a share ends that person's sessions at once.
- **You know it worked when:** the row is gone and no alert appears.
- **Steps:**
  1. The person presses "Stop sharing". An inline box reads "They lose access at once, and are signed out of <App>." with "Stop sharing" and "Keep it".
  2. On confirming, the row leaves at once. The share is deleted, the end user's sessions there are revoked, and the app's count and the org chart refresh.
- **Variations and refusals:**
  - A refusal: "Sharing with <email> did not stop: <reason> They still have access." and the row returns.
  - An unknown address: 404.
- **Where:** `AppView.tsx`; `DELETE /api/apps/{id}/shares?email=` (Admin); `AppIdentityService.UnshareAsync`
- **Reachable from:** UI and API
- **Covered by tests:** `AppView.test.tsx` "stops sharing only after it is confirmed"; `AppAccessTests.A_shared_app_admits…and_unsharing_ends_it`

## SEC — secrets

### SEC-01 Open the secrets that apply at a level
- **Who:** Admin or above, or an operator
- **Starts at:** `/secrets?scope=<path>`, reached from "Manage secrets" on an app or from the navigation (another reader's area)
- **Needs:** an organisation
- **Level:** Core
- **Learn first:** the organisation tree (another reader's area)
- **What you learn:** secrets cascade down the tree like everything else, and a value is never shown.
- **You know it worked when:** the heading reads "Secrets for <level name>" with an "Applies here" list and a "Set beneath" list.
- **Steps:**
  1. The page reads the scope from `?scope`. With none, it uses the person's organisation.
  2. The heading reads "Secrets for <name>". The explanation reads "What applies here, and where each was set. A secret set higher up applies beneath unless a lower level sets its own. A value is never shown, not even to you: to change one, replace it."
  3. The breadcrumb's levels each link to that level's secrets.
  4. The side column shows "Add a secret" (SEC-03).
- **Variations and refusals:**
  - With no organisation yet: "There are no secrets until your organisation is named" with a "Start" link.
  - 403: "You cannot see the secrets here".
  - Any other failure: "The secrets could not be loaded" with a retry.
- **Where:** `features/secrets/SecretsView.tsx`; `GET /api/secrets?scope` (Admin)
- **Reachable from:** UI; API; MCP `secrets_list`
- **Covered by tests:** `SecretsView.test.tsx` ("shows a skeleton…", "records a refusal as a failure…", "uses the organisation when no scope is named"); `tests-e2e/console.spec.ts` "secrets and operator access"

### SEC-02 Read what applies here and where it was set
- **Who:** Admin or above
- **Starts at:** "Applies here" and "Set beneath"
- **Needs:** SEC-01
- **Level:** Core
- **Learn first:** SEC-01
- **What you learn:** the deepest level that sets a name wins, and you can see where each one came from.
- **You know it worked when:** each row shows "Set here" or "Inherited from <name>", with "<Level> level · set <time ago>".
- **Steps:**
  1. Each row shows the name, a "Set here" or "Inherited from <link>" badge, and "<Level> level · set <time ago>".
  2. A row that overrides one above adds "Replaces the one set at <names>.".
  3. "Set beneath" lists names set on lower levels, each linking to that level.
- **Variations and refusals:**
  - Nothing applies: "No secrets apply to <where>" with "Add one, and everything here and beneath it can read it by name."
  - Nothing set beneath: "Nothing beneath <where> sets a secret of its own."
- **Where:** `SecretsView.tsx` (SecretsBody, SecretRow)
- **Reachable from:** UI and API
- **Covered by tests:** `SecretsView.test.tsx` "says plainly when nothing applies", "names each secret, the level that set it and what it overrides…"

### SEC-03 Add a secret
- **Who:** Admin or above
- **Starts at:** "Add a secret" in the side column
- **Needs:** SEC-01
- **Level:** Core
- **Learn first:** SEC-02
- **What you learn:** a secret value is write-only: typed, sent, sealed and gone.
- **You know it worked when:** "<NAME> is saved. Its value is sealed and will not be shown." appears and the name is listed with "Set here".
- **Steps:**
  1. The person reads "It applies to <where> and everything beneath it. Saving a name that already applies here replaces it."
  2. They type a Name (placeholder "STRIPE_API_KEY"). The field upper-cases as they type and turns spaces and hyphens into underscores.
  3. They type a Value in a password field.
  4. They press "Save the secret". The button reads "Replace the secret" if that name is already set here, and "Saving…" while it waits.
  5. The value field is cleared at once. The name joins the list (optimistic). The value is sealed with envelope encryption.
  6. The confirmation appears and the Name field is cleared.
- **Variations and refusals:**
  - Name empty: "Give it a name."
  - Name invalid: "Use capital letters, digits and underscores, starting with a letter, for example STRIPE_API_KEY."
  - Value empty: "Type the value to store."
  - The server refuses an empty value ("A secret's value is a non-empty string.") or one over 16,384 characters.
  - Any refusal: "<NAME> was not saved: <reason> Nothing changed; type the value again to retry." and the row is removed again.
- **Where:** `SecretsView.tsx` (AddSecret, SecretForm); `store/sensitive.ts` `setSecret`; `PUT /api/secrets` (Admin); `CascadeService.SetAsync`
- **Reachable from:** UI; API; MCP `secret_set`. `PUT /api/cascade` with kind secret also works; MCP `cascade_set` refuses secrets and points at `secret_set`.
- **Covered by tests:** `SecretsView.test.tsx` ("checks the name, sends the value once, clears it…", "takes a refused secret back off the list…"); `PlatformApiTests.Secrets_cascade_are_sealed_at_rest…`

### SEC-04 Replace a secret set at this level
- **Who:** Admin or above
- **Starts at:** "Replace" on a row marked "Set here"
- **Needs:** SEC-02
- **Level:** Core
- **Learn first:** SEC-03
- **What you learn:** to change a secret, you replace it; you never read it.
- **You know it worked when:** "<NAME> is saved. Its value is sealed and will not be shown." appears and "set just now" shows.
- **Steps:** the person presses "Replace" and a form opens with "New value for <NAME>". They type the value and press "Replace the secret". Once it is saved the form closes and the row keeps the saved message; pressing "Replace" again also closes the form. Any later action on the page (another save, a removal, opening a form) clears the last message.
- **Variations and refusals:** as SEC-03.
- **Where:** `SecretsView.tsx`
- **Reachable from:** UI, API and MCP
- **Covered by tests:** `SecretsView.test.tsx` "replaces a secret set here with a new value, naming it"

### SEC-05 Override an inherited secret at a lower level
- **Who:** Admin or above at the lower level
- **Starts at:** "Set its own here" on a row marked "Inherited from …"
- **Needs:** SEC-02 at a level below where the secret was set
- **Level:** Advanced
- **Learn first:** SEC-04
- **What you learn:** a lower level can set its own value under the same name, and it wins for everything beneath it.
- **You know it worked when:** the row's badge becomes "Set here" with "Replaces the one set at <higher level>."
- **Steps:**
  1. The person presses "Set its own here" and types a new value.
  2. The secret is saved at this level. The row shows "Set here" with the override line.
  3. Apps beneath now read this value instead of the inherited one (KIT-14).
- **Variations and refusals:** as SEC-03.
- **Where:** `SecretsView.tsx`; `store/sensitive.ts` (the optimistic override list)
- **Reachable from:** UI, API and MCP
- **Covered by tests:** `SecretsView.test.tsx` (overrides naming); `CascadeResolutionTests`

### SEC-06 Remove a secret
- **Who:** Admin or above
- **Starts at:** "Remove" on a row marked "Set here"
- **Needs:** SEC-02
- **Level:** Core
- **Learn first:** SEC-05
- **What you learn:** removing an override brings back the inherited value; removing the only one removes it for everything beneath.
- **You know it worked when:** the row disappears, or switches to "Inherited from …".
- **Steps:**
  1. The person presses "Remove". A box reads either "Remove <NAME> here? The one set at <name> applies again." or "Remove <NAME>? Nothing here or beneath will have it, unless it sets its own.".
  2. They press "Remove it" ("Keep it" cancels).
  3. The row leaves, and every scope's list is refreshed.
- **Variations and refusals:**
  - A refusal: "<NAME> was not removed: <reason> It still applies." and the row returns.
  - Nothing set at this scope under that name: 404.
  - Inherited rows have no "Remove". They must be removed at the level that set them.
- **Where:** `SecretsView.tsx`; `api.ts` `removeSecret`; `DELETE /api/secrets?scope&name` (Admin)
- **Reachable from:** UI; API; MCP `secret_remove`
- **Covered by tests:** `SecretsView.test.tsx` "removes a secret only after it is confirmed…", "puts a refused removal back…"

### SEC-07 Move between levels on the secrets page
- **Who:** Admin or above
- **Starts at:** the breadcrumb, an "Inherited from" link, or a "Set beneath" link
- **Needs:** SEC-01
- **Level:** Foundation
- **Learn first:** SEC-01
- **What you learn:** every level has its own view of what applies there.
- **You know it worked when:** the heading changes to "Secrets for <other level>".
- **Steps:** the person follows a link and the page reloads with the new `?scope`.
- **Variations and refusals:** at a level where the person holds a role below Admin: 403, "You cannot see the secrets here"; at a level where they hold no role at all: 404, "The secrets could not be loaded" with "The scope '<path>' was not found, or you cannot see it.".
- **Where:** `SecretsView.tsx`
- **Reachable from:** UI
- **Covered by tests:** none found specifically

## KIT — what a hosted app uses, and building on the kit

### KIT-01 A member signs in to a private app (path address)
- **Who:** an organisation member with a role on the app
- **Starts at:** the app's address, signed out
- **Needs:** a private app (the default)
- **Level:** Foundation
- **Learn first:** APP-03
- **What you learn:** a private app admits only organisation members, using their Endgame passkey.
- **You know it worked when:** the app itself loads after the passkey prompt.
- **Steps:**
  1. Edge's access check answers "sign in". A GET request is redirected to `<app>/_endgame/auth/sign-in?returnTo=…`.
  2. The page reads "Sign in to <App>" and "<App> belongs to <Org>.", with a "Members of <Org>" section: "Sign in with the passkey you use for Endgame." and the button "Sign in with a passkey".
  3. A private app does not show the "Using this app" section.
  4. The person completes the passkey prompt and is returned to the address they asked for.
  5. Edge gives the app a short-lived (15-minute) app-scoped token in `X-Endgame-Session`, never the browser's own cookie.
- **Variations and refusals:**
  - The prompt is closed: "The passkey prompt was closed or timed out. Nothing was changed."
  - The page cannot load: "Sign-in is unavailable just now."
  - A non-GET request without a session gets 401 with a Location header.
  - A `returnTo` outside the app's addresses is refused.
- **Where:** Edge `Routing/AppGate.cs`, `Access/AccessGate.cs`, `Pages/AuthPage.cs`; `POST /internal/access/check`; `/api/auth/passkey/login/*`
- **Reachable from:** UI (the hosted app)
- **Covered by tests:** `AppAccessTests.A_private_app_admits_members…`; `EdgePipelineTests.The_sign_in_page_is_the_edges_own…`; `tests-stack/acceptance.spec.ts` test 4

### KIT-02 Sign in on the organisation subdomain, through a hand-off
- **Who:** a member or an end user
- **Starts at:** `https://<org>.<zone>/<division>/<project>/<app>/`
- **Needs:** a subdomain address
- **Level:** Core
- **Learn first:** KIT-01, HOST-06
- **What you learn:** the subdomain cannot read the platform host's cookie, so the session is handed across with a one-minute, single-use code.
- **You know it worked when:** the person lands back on the subdomain, signed in.
- **Steps:**
  1. Sign-in moves to the path form on the platform's host.
  2. If the person is already signed in there, the hand-off happens at once. Otherwise they sign in (KIT-01 or KIT-04).
  3. They return through `_endgame/auth/handoff`. Edge redeems the code once and sets the subdomain's own app-session cookie.
- **Variations and refusals:**
  - An expired or reused link: "This sign-in link has expired" with "Sign-in links work once, for a minute. Sign in again to continue." and a "Sign in again" link.
  - A failure: "Sign-in is unavailable just now" with "Endgame could not finish signing you in. Please try again in a moment."
  - No session to hand off: 401 "There is no session at this app to hand off; sign in first."
- **Where:** Edge `Access/AuthPages.cs`; `POST /api/app-auth/{appId}/handoff`; `POST /internal/access/handoff`
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.A_session_on_the_path_host_is_handed_off_once…`; `EdgePipelineTests` (hand-off tests)

### KIT-03 An invited person registers at a shared app with their code
- **Who:** an invited person
- **Starts at:** the app's address, then "Create your sign-in", or `_endgame/auth/sign-up`
- **Needs:** SHR-03 (an address and a code within 14 days)
- **Level:** Foundation
- **Learn first:** SHR-03
- **What you learn:** a shared app admits only the addresses it was shared with, each registering once with its code and a passkey.
- **You know it worked when:** the browser lands in the app, and the owner's list shows "Registered".
- **Steps:**
  1. The page reads "Create your sign-in for <App>" and "<App> is shared with chosen people. Use the address it was shared with and the invitation code you were given."
  2. The person fills "E-mail address", "Your name" and "Invitation code", and presses "Create a passkey".
  3. A passkey is created for this app only. The code is used up. A 14-day session starts and they are returned into the app.
- **Variations and refusals:**
  - A wrong address, a wrong or expired code, or a used code: 403 "This app is shared with chosen people: register with the address it was shared with and the invitation code you were given."
  - Already registered: 409 "That address is already registered with this app; sign in instead."
  - A rejected passkey: "The passkey was not accepted".
  - An expired ceremony: "The passkey ceremony has expired or is not valid; start again."
  - The link "Already registered? Sign in" goes to the sign-in page.
- **Where:** Edge `Pages/AuthPage.cs`; `POST /api/app-auth/{appId}/sign-up/options|complete`; `AppIdentityService.RequireMaySignUpAsync`
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.A_shared_app_admits_the_people_it_was_shared_with…`

### KIT-04 A returning end user signs in with their passkey
- **Who:** an app end user
- **Starts at:** `_endgame/auth/sign-in`, in the "Using this app" section
- **Needs:** KIT-03 or KIT-05 done earlier
- **Level:** Foundation
- **Learn first:** KIT-03
- **What you learn:** an end user's sign-in belongs to one app only.
- **You know it worked when:** the person is returned into the app.
- **Steps:** the person presses "Sign in with your passkey", completes the prompt, and is returned. "New here? Create your sign-in" links to sign-up.
- **Variations and refusals:**
  - A passkey that cannot be verified: 401 "Sign-in failed" / "That passkey could not be verified for this app."
  - The share was removed: "This app is not shared with that address."
  - The app is now private: "This app is private: only members of the organisation with rights over it can open it."
- **Where:** `POST /api/app-auth/{appId}/sign-in/options|complete`
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.An_end_user_belongs_to_one_app_and_can_never_reach_the_console_or_another_app`

### KIT-05 Anyone signs up to a public app
- **Who:** an anonymous visitor
- **Starts at:** the app's "Create your sign-in" page
- **Needs:** APP-07
- **Level:** Core
- **Learn first:** APP-07
- **What you learn:** a public app lets anyone make a sign-in, with no password.
- **You know it worked when:** the person is returned into the app, signed in.
- **Steps:** the page reads "Anyone may use <App>. A passkey on this device signs you in — there is no password." The visitor enters an e-mail address and a name and presses "Create a passkey".
- **Variations and refusals:** a private app's sign-up page reads "<App> is private: only members of <Org> can open it." and shows no form.
- **Where:** `Pages/AuthPage.cs`
- **Reachable from:** UI
- **Covered by tests:** not found specifically. Public admission is in `tests-stack/acceptance.spec.ts` test 12.

### KIT-06 A visitor opens a public app signed out
- **Who:** an anonymous visitor
- **Starts at:** the app's address
- **Needs:** APP-07
- **Level:** Foundation
- **Learn first:** APP-07
- **What you learn:** a public app needs no sign-in.
- **You know it worked when:** the app loads, with no sign-in page.
- **Steps:** Edge admits the request with no session token, and the app sees no user.
- **Variations and refusals:** see HOST-01 to HOST-05.
- **Where:** `AppIdentityService.CheckAsync`
- **Reachable from:** UI
- **Covered by tests:** `tests-stack/acceptance.spec.ts` test 12

### KIT-07 A signed-in person without access is refused
- **Who:** a member with no role on the app, or an end user it is not shared with
- **Starts at:** the app's address
- **Needs:** nothing
- **Level:** Foundation
- **Learn first:** KIT-01
- **What you learn:** being signed in is not the same as having access.
- **You know it worked when:** the refusal page below appears.
- **Steps:** Edge answers 403 with "You don't have access to this app" and "You are signed in, but your account has no access to this app. Ask its owner for access."
- **Variations and refusals:** none.
- **Where:** `Pages/UnavailablePage.cs` (Forbidden)
- **Reachable from:** UI
- **Covered by tests:** `AppAccessTests.A_private_app_admits_members…refuses_the_rest`

### KIT-08 Sign out of an app
- **Who:** an end user or a member
- **Starts at:** the app's own sign-out link (`IEndgameIdentity.SignOutUrl()` / `signOutUrl()`), which goes to `_endgame/auth/sign-out`
- **Needs:** a session
- **Level:** Foundation
- **Learn first:** KIT-04
- **What you learn:** signing out ends the session at this app.
- **You know it worked when:** the person is back at the app's home, signed out.
- **Steps:**
  1. Edge calls `POST /api/app-auth/{appId}/sign-out`, which revokes the session and clears the cookie.
  2. If the person was a member, the console session is logged out too.
  3. They return inside the app.
  4. Signing out of the console also revokes every app session the person holds as a member, on every address, and every app session the browser holds.
- **Variations and refusals:** a failure is only logged; not verified what the person sees.
- **Where:** `Access/AuthPages.cs`; `AppIdentityService.SignOutAsync` / `SignOutEverywhereAsync`
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests.Signing_out_ends_the_session_through_the_control_plane_and_comes_back_inside_the_app`

### KIT-09 Use the development sign-in (development stacks only)
- **Who:** a developer or tester
- **Starts at:** the sign-in or sign-up page, when the deployment allows it
- **Needs:** `ENDGAME_DEV_LOGIN=true`, a development environment
- **Level:** Developer
- **Learn first:** KIT-01
- **What you learn:** a test stack can skip passkeys, and production can never turn this on.
- **You know it worked when:** the person is in the app without a passkey prompt.
- **Steps:**
  1. A "Development sign-in" box reads "This deployment allows signing in without a passkey, for testing only.", with an "E-mail address" field and "As a member" / "As a visitor".
  2. On sign-up, the button is "Continue without a passkey". It is not offered when an invitation code is required.
- **Variations and refusals:** the `/development` endpoint is not mapped when the feature is off. `make prod-config` proves production pins it off.
- **Where:** `AppAuthEndpoints.cs` `/development`; `Pages/AuthPage.cs`
- **Reachable from:** UI (development only)
- **Covered by tests:** `DevelopmentSignInTests`; `tests-stack/acceptance.spec.ts` test 1

### KIT-10 An app knows who is signed in, and their role
- **Who:** the app, and its developer
- **Starts at:** app code
- **Needs:** the kit
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** an app never handles passwords; it is told who the person is.
- **You know it worked when:** `GET api/me` returns `{"user": {...}}` for a signed-in person.
- **Steps:**
  1. Edge forwards `X-Endgame-Session`. The kit resolves it with `POST /platform/v1/identity/resolve` and caches the result for 30 seconds at most, and never past its `expiresAt`.
  2. The user has a kind (`member` or `endUser`) and a role (`owner`, `admin`, `builder`, `viewer`, or null for an end user).
  3. `IEndgameIdentity.CurrentUser`, `.RequireUser()` (a browser is redirected to sign in), and the web hooks `useCurrentUser()`, `signInUrl()` and `signUpUrl()` expose it.
- **Variations and refusals:**
  - An invalid session: 401 `session_invalid` "The session is unknown, has expired, or is not a session for this app."; the kit treats the person as signed out.
  - An API call to a `.RequireUser()` endpoint with nobody signed in: 401 "Sign in required" with a `signInUrl`; the web kit throws `NotSignedInError`.
  - A missing or wrong app token: 401 `app_token_invalid` "The platform API needs the app's token (ENDGAME_APP_TOKEN) as a bearer token; this one is missing, unknown or superseded."; the kit throws `EndgamePlatformException` "The platform refused this app's token (ENDGAME_APP_TOKEN) on <method> <path>: <the platform's detail, as one sentence> The token is injected when the app starts; a restarted app gets a fresh one."
  - A call that came through Edge's public side: 404 `not_found` "There is nothing at this address."
  - A handler that takes a non-nullable `EndgameUser` without `.RequireUser()` stops the app at start.
- **Where:** `appkit/sdk-dotnet/Endgame.AppKit/Identity/*`; `sdk-web/src/hooks.ts`, `router.ts`; `PlatformEndpoints.cs`; `AppTokenFilter`
- **Reachable from:** inside the app (API only)
- **Covered by tests:** `PlatformApiTests.Identity_resolves_a_member_and_an_end_user…`; `IdentityTests` (kit); `PlatformApiTests.The_app_token_is_required…`; `ApiContractTests.A_required_user_without_RequireUser_stops_start_up`; `PlatformServiceTests.A_superseded_app_token_is_named_in_one_sentence` (kit)

### KIT-11 An app keeps its own data
- **Who:** the app, and its developer
- **Starts at:** `builder.AddEndgameApp<TDb>()`
- **Needs:** `ENDGAME_DATABASE`, injected by Dock
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** each app has its own database and role that no other app can read.
- **You know it worked when:** the app starts, and `GET health` reports `"database":"reachable"`.
- **Steps:**
  1. The developer adds an entity and runs `make migration name=AddThing`.
  2. Migrations run at start. A first start takes an empty database to the latest schema.
- **Variations and refusals:**
  - Missing environment variables stop the app with one message naming all of them: "Endgame app kit: missing environment variable(s) …".
  - A database that cannot be migrated stops the app: "Endgame app kit: could not migrate the database at … (ENDGAME_DATABASE): …", naming the host and database, never the password.
  - A database that cannot be reached makes `GET health` answer 503 with `"database":"unreachable"`.
  - `make migration` with no name prints "usage: make migration name=AddSomething".
- **Where:** `EndgameApp.cs`; `EndgameSettings.cs`; `Hosting/EndgameStartup.cs`; `template/Makefile`
- **Reachable from:** command line / app code
- **Covered by tests:** `HostingIntegrationTests.Apps_cannot_read_each_others_data_or_the_platforms`; `HostingTests.Health_reports_the_database`, `Missing_environment_is_named_in_one_message` (kit); `template/api.tests`

### KIT-12 An app sends e-mail
- **Who:** the app, on behalf of a user
- **Starts at:** `IEndgameEmail.SendAsync(new EmailMessage(to, subject, text, html?, replyTo?))`
- **Needs:** the kit
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** an app sends mail through the platform and holds no mail credentials.
- **You know it worked when:** the call returns an id (`eml_…`) and the mail arrives, where SMTP is configured.
- **Steps:**
  1. The kit checks the message: at least one recipient, every recipient an address, a subject and a plain-text body.
  2. It sends `POST /platform/v1/email`, which answers 202 with an id.
  3. The message is queued in the outbox and the dispatcher delivers it through SMTP.
- **Variations and refusals:**
  - The kit refuses no recipients or a bad address ("An email needs at least one recipient, and every recipient must be an address.") and a missing subject or text ("An email needs a subject and a plain-text body.") before anything is sent.
  - The server answers 400 `invalid_request`: "to is a list of 1 to 50 addresses.", "subject is one line of 1 to 300 characters.", "text is required, at most 256 KB." or "html is at most 512 KB."; the kit throws `EndgamePlatformException` with that code.
  - Without SMTP configured, nothing is sent.
  - Sent by the app's preview — an unpublished build the factory is checking, which carries a token of its own (`POST /internal/apps/{id}/token?preview=true`) that never replaces the app's — the message is checked the same way and answered 202, then **held**: kept with the status `held`, never delivered. The evaluator's `sent_emails` reads it as "held (sent by the preview, kept here and never delivered)", so an e-mail requirement can still be shown working.
- **Where:** `Services/PlatformServices.cs`; `AppEmailService` (`EmailStatuses.Held`); `AppTokenService.IssueAsync` (preview tokens); `EmailDispatcher`; `SmtpEmailSender`; `RunnerTools.SentEmailsTool`
- **Reachable from:** API only (inside the app)
- **Covered by tests:** `PlatformApiTests.Email_is_queued_and_delivered_through_smtp_and_bad_mail_is_refused`, `…A_previews_email_is_held_and_shown_as_held_and_its_token_leaves_the_apps_own_alone`; `PlatformServiceTests.Email_is_handed_to_the_platform` (kit); `tests-stack/acceptance.spec.ts` test 7

### KIT-13 An app calls a model within its AI allowance
- **Who:** the app
- **Starts at:** `IEndgameModels.CompleteAsync(new ChatRequest(messages, taskType, maxTokens?, temperature?))`
- **Needs:** credits, and allowance left
- **Level:** Developer
- **Learn first:** KIT-21, APP-12
- **What you learn:** an app never holds a provider key. Every call is reserved before it is sent and charged to the app's cascade.
- **You know it worked when:** a reply returns with its content, model, usage and credits, and the app's Cost this month tile rises.
- **Steps:**
  1. The app sends `POST /platform/v1/models/chat` with a task type of `chat`, `classify`, `summarise` or `extract`, which picks a cheap, tool-less route.
  2. The gateway reserves the most the call could cost, checked against the budgets above the app and the app's own model allowance.
  3. The call is made and settled at its real cost.
- **Variations and refusals:**
  - The budget is spent: 402 `budget_exhausted` "The monthly budget at <scope> has <n> credits left; this call needs up to <m>. This is terminal for the run: do not retry it."; the kit throws `EndgameBudgetExhaustedException` and never retries, and an unhandled one reaches the app's caller as 402 "The credit budget is spent".
  - The overdraft limit is reached: 402 `overdraft_limit` "The organisation has <n> credits available including its overdraft of <o>; this call needs up to <m>. Work stops until the organisation is topped up; do not retry it." The kit throws `EndgameOverdraftLimitException` (code `overdraft_limit`), whose message is the platform's own title and detail, "The overdraft limit is reached: …", and never retries it. An unhandled one reaches the app's caller as 402 "The overdraft limit is reached" / "This feature is paused until the organisation tops up its credits." with code `overdraft_limit`, and the web kit throws `BudgetExhaustedError`.
  - The allowance is exceeded: 402 `budget_exhausted` with `bindingScope` "app models": "The app's own model calls have <n> credits left of their <cap> this month; this call needs up to <m>. This is terminal for the run: do not retry it."
  - No model fits the price ceiling: 422 `ceiling_unreachable` "At the route's price ceiling this call could cost US$<x>, above the US$<y> allowed for one '<task type>' call. Send a shorter prompt or a lower max_tokens."
  - No model provider key on the control plane: 503 `model_provider_unconfigured`.
  - Bad input: 400 `invalid_request` "taskType is one of chat, classify, summarise, extract.", "messages is a list of 1 to 100 messages.", "Each message has a role (system, user or assistant) and non-empty content.", "maxTokens is a positive number."; the kit itself refuses an empty message list with "A chat request needs at least one message."
- **Where:** `PlatformServices.cs`; `AppModelService`; `ModelGateway`; `CreditLedger`
- **Reachable from:** API only
- **Covered by tests:** `PlatformApiTests.Models_go_through_the_same_gateway…held_to_its_cap`; `PlatformServiceTests.Models_answer_through_the_platform_and_a_spent_budget_is_terminal`, `At_the_overdraft_limit_a_model_call_is_a_typed_terminal_refusal_in_the_platforms_words` (kit)

### KIT-14 An app reads a secret by name
- **Who:** the app
- **Starts at:** `IEndgameSecrets.GetAsync("STRIPE_API_KEY")`
- **Needs:** SEC-03 at the app or above it
- **Level:** Developer
- **Learn first:** SEC-03, SEC-05
- **What you learn:** the deepest level that sets a name wins, and no secret is ever written into code.
- **You know it worked when:** the value comes back. The platform's reply also names the level that set it.
- **Steps:**
  1. The kit checks the name format and sends `GET /platform/v1/secrets/{name}`.
  2. The reply is `{name, value, scope}`, resolved from the app upwards.
- **Variations and refusals:**
  - A bad name: the kit refuses it before sending, "Secret name '<name>' must be UPPER_SNAKE_CASE (e.g. 'STRIPE_API_KEY')."; the platform's own check answers 400 "A secret name is UPPER_SNAKE_CASE, for example STRIPE_API_KEY."
  - Not set anywhere: 404 `secret_not_found` "No secret named X is set at any level searched: app …, project …, division …, organisation …."; the kit throws `EndgameSecretNotFoundException`, whose `Name` is the name asked for.
- **Where:** `PlatformServices.cs`; `AppSecretService`; `CascadeService.RevealSecretAsync`
- **Reachable from:** API only
- **Covered by tests:** `PlatformApiTests.Secrets_cascade…`; `PlatformServiceTests.Secrets_resolve_by_name_and_a_missing_one_says_where_it_looked` (kit); `tests-stack/acceptance.spec.ts` test 5

### KIT-15 An app records telemetry, automatic and custom
- **Who:** the app
- **Starts at:** automatic from `AddEndgameApp`; custom events through `IEndgameTelemetry.Track("note.created", props, userId)`
- **Needs:** the kit
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** health, traffic, errors and latency are measured with no code; custom events describe what the app itself means.
- **You know it worked when:** the app page's Visits and Typical response tiles show figures, and ASK-02 can answer questions about the events.
- **Steps:**
  1. Traces, metrics (every 15 seconds) and logs go to `POST /platform/v1/otlp/v1/{signal}` as OTLP, in protobuf or JSON.
  2. `Track` never blocks, and never throws once the name is valid. Events are batched (at most 100, about once a second) to `POST /platform/v1/telemetry/events`, which answers 202.
  3. The intake attributes everything to the app by its token.
- **Variations and refusals:**
  - A bad event name throws at once, in the app: "Event name '<name>' must be lowercase dot-separated words (e.g. 'note.created')."
  - A batch the platform refuses (for example properties over 8 KB: "An event's properties are at most 8192 bytes.") is dropped and logged: "Endgame telemetry: <n> custom event(s) could not be sent and were dropped: …".
  - An OTLP body over the limit: 413 `too_large` "An export is at most 4194304 bytes."
  - `ENDGAME_TELEMETRY_EXPORT=false` records and drops the OTLP signals. On the evaluator's preview (`ENDGAME_PREVIEW=true`) nothing is exported and `Track` records nothing.
- **Where:** `Services/EndgameTelemetry.cs`; `PlatformEndpoints.cs`; `TelemetryService`
- **Reachable from:** API only
- **Covered by tests:** `PlatformApiTests.Telemetry_is_stored_per_app…`, `Otlp_json_is_accepted_too`; `PlatformServiceTests.Custom_events_arrive_in_batches_without_blocking`, `A_preview_records_no_custom_events_and_exports_nothing` (kit); `tests-stack/acceptance.spec.ts` test 10

### KIT-16 An app runs a recurring job on a schedule
- **Who:** the app; the platform calls it
- **Starts at:** `app.MapSchedule("nightly-digest", "0 7 * * *", handler, timeZone)`
- **Needs:** the kit, and an app that has started once (so it has a token)
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** the platform calls the app on a cron, signed, and wakes it if it is asleep.
- **You know it worked when:** the handler runs at the cron time and the platform records the call as answered 204.
- **Steps:**
  1. Once the app has started, the kit declares every schedule with `PUT /platform/v1/schedules`, replacing the whole set; the platform answers with each schedule's `nextRunAt`.
  2. A leased scheduler finds due rows and posts a signed body, `{"scheduledFor": …}`, to Edge's control listener.
  3. Edge wakes the app and forwards the call to `_platform/schedules/<name>`.
  4. The kit checks the signature and runs the handler. The app answers 204, and the schedule moves to its next time.
- **Variations and refusals:**
  - A bad cron fails where `MapSchedule` is written: "Schedule '<n>' has cron '<c>'. Use five fields — minute hour day-of-month month day-of-week — with digits, *, /, ',' and '-' only, e.g. '0 7 * * *'."
  - The server answers 400 to more than 50 schedules ("An app declares at most 50 schedules."), duplicate names ("Two schedules have the same name."), a cron it cannot read, or an unknown time zone ("'<zone>' is not a time zone this platform knows (use an IANA name such as UTC or Europe/London)."). The kit retries the declaration five times, then logs "Endgame app kit: the platform never accepted this app's …; they will not run until the app restarts: …".
  - An unsigned or stale call (over 5 minutes): 401 "Unsigned schedule call", "Only the platform may run schedules."
  - A run while the app has never started: "The app has no platform token yet (it has not been started)."
  - A paused app is not called: Edge answers 409, recorded as "The app answered 409."
  - A non-204 answer is recorded as "The app answered <status>."; a handler that throws makes the run fail.
  - Runs missed during downtime run once, not once per miss.
  - The public side never routes `_platform/*`; it returns 404.
- **Where:** `Services/CallbackEndpoints.cs`; `AppDeclarationService`; `Workers.cs` Scheduler; Edge `Control/PlatformCallbacks.cs`
- **Reachable from:** API only. Schedules are not listed in the console beyond the "Schedules" chip.
- **Covered by tests:** `PlatformApiTests.Schedules_are_declared_called_back_signed_through_edge…`; `EdgePipelineTests.A_schedule_callback_on_the_control_listener_wakes_the_app…`; `PlatformServiceTests.Schedules_are_declared_at_start_and_only_signed_runs_execute`, `A_bad_cron_is_refused_where_it_is_written`, `Callback_signatures_verify_only_fresh_matching_bodies` (kit); `tests-stack/acceptance.spec.ts` test 8

### KIT-17 An outside device posts to a signed (HMAC) webhook
- **Who:** an outside device or service
- **Starts at:** `POST <app address>/hooks/<name>`
- **Needs:** the app maps `app.MapWebhook("court-sensor", WebhookVerification.HmacSha256("X-Signature", "SENSOR_SECRET"), handler)`, and the secret is set (SEC-03)
- **Level:** Developer
- **Learn first:** KIT-14
- **What you learn:** a declared webhook reaches even a private app, and the app proves the caller with a vault secret.
- **You know it worked when:** the device gets the handler's answer, for example 202.
- **Steps:**
  1. The kit declares the hook at start with `PUT /platform/v1/webhooks`.
  2. Edge admits POSTs to `hooks/<name>` with no session, even on a private app.
  3. The kit computes HMAC-SHA256 of the raw body with the secret, compares it with the header (after the optional `sha256=` prefix) in constant time, and runs the handler.
  4. The handler can read the body with `ReadJson<T>()` or `ReadText()`.
- **Variations and refusals:**
  - A missing or wrong header: 401 "Webhook verification failed" / "The <header> header did not verify."
  - The secret is not set (and the call carries the header): the kit throws `EndgameSecretNotFoundException`, and its error handler answers the caller 502 "A platform service failed" with `code` `secret_not_found`.
  - More than 50 webhooks ("An app declares at most 50 webhooks."), a path other than `hooks/<name>` ("A webhook's path is hooks/<name>."), or duplicate names ("Two webhooks have the same name.") are refused at declaration with 400.
- **Where:** `CallbackEndpoints.cs`; `AppDeclarationService`; Edge `AppGate.cs`
- **Reachable from:** API only
- **Covered by tests:** `EdgePipelineTests.Declared_webhooks_and_only_those_reach_a_private_app_without_a_session`; `PlatformApiTests.The_evaluator_…calls_its_declared_webhook_signed_with_the_vaults_secret`; `PlatformServiceTests.Webhooks_are_declared_and_only_verified_calls_reach_the_handler` (kit); `tests-stack/acceptance.spec.ts` test 9

### KIT-18 A simple device posts to a shared-token webhook
- **Who:** an outside device
- **Starts at:** `POST <app>/hooks/<name>` with the secret itself in a header
- **Needs:** `WebhookVerification.SharedToken(header, secretName)`
- **Level:** Developer
- **Learn first:** KIT-17
- **What you learn:** a device that cannot sign can prove itself with a shared token from the vault.
- **You know it worked when:** the handler's answer comes back.
- **Steps:** as KIT-17, but the header value is compared with the secret in constant time.
- **Variations and refusals:** a mismatch or a missing header gets 401 "Webhook verification failed", "The <header> header did not verify."
- **Where:** `CallbackEndpoints.cs`
- **Reachable from:** API only
- **Covered by tests:** `PlatformServiceTests.Webhooks_are_declared_and_only_verified_calls_reach_the_handler` (kit; its `door` hook posts the right token and gets 204; the wrong-token case is not tested)

### KIT-19 Unsigned or undeclared webhook calls are refused
- **Who:** an outside caller
- **Starts at:** `POST <app>/hooks/<name>`
- **Needs:** nothing
- **Level:** Developer
- **Learn first:** KIT-17
- **What you learn:** there is deliberately no "no verification" option.
- **You know it worked when:** the caller gets 401.
- **Steps:**
  1. If the hook is declared but the call is unsigned, the kit refuses it with 401 "Webhook verification failed", before the handler runs.
  2. If the hook is undeclared on a private app, Edge treats the call as needing sign-in: a signed-out POST gets 401 with a `Location` header pointing at the app's `_endgame/auth/sign-in?returnTo=…`.
- **Variations and refusals:** an undeclared hook on a public app passes through to the app. Not verified what the app answers.
- **Where:** `CallbackEndpoints.cs` (`WebhookVerification` has no "none"); `AppGate.cs`
- **Reachable from:** API only
- **Covered by tests:** `EdgePipelineTests.Declared_webhooks_and_only_those_reach_a_private_app_without_a_session`; `tests-stack/acceptance.spec.ts` test 9 ("…an undeclared one does not")

### KIT-20 An AI assistant uses an app's own derived MCP tools
- **Who:** an AI assistant, using a person's access token (tokens are another reader's area)
- **Starts at:** the MCP server at `<origin>/mcp/apps/<appId>`. Technical mode shows this address in "What it uses".
- **Needs:** a token whose person has at least the Viewer role on the app; the app's OpenAPI document
- **Level:** Advanced
- **Learn first:** APP-08, and making an access token (another reader's area)
- **What you learn:** every app's own API becomes MCP tools, and the app sees the assistant as the person who owns the token.
- **You know it worked when:** listing the tools returns one tool per app operation, and a call returns `{status, body, truncated}`.
- **Steps:**
  1. The assistant lists the tools. One tool is derived per OpenAPI operation, named by its `operationId` and described by its `description`, and cached with the published version. GET operations are marked read-only.
  2. The assistant calls a tool. The control plane mints an app-scoped member session and calls the app through Edge.
- **Variations and refusals:**
  - The app answers 400 or worse: the tool result is an error (`isError: true`) with the app's status, "The app refused the call", and the app's `code` (or `app_error`) and `detail`.
  - An unknown tool: a JSON-RPC error, "There is no tool '<name>'."
  - No role on the app: a call fails with 404 `not_found` "The scope '<path>' was not found, or you cannot see it."
  - The app's OpenAPI document cannot be read: 502 `app_openapi_unavailable` "Its OpenAPI document (openapi/v1.json) answered <status>."
- **Where:** `Mcp/AppTools.cs`, `McpSetup.cs`; `AppGateway`; the kit's `ApiContract.cs` (operationId and description are required at start)
- **Reachable from:** MCP only
- **Covered by tests:** `McpTests.An_apps_own_api_is_derived_from_its_openapi_and_called_through_edge_with_a_member_session`

### KIT-21 A developer builds an app on the kit by hand
- **Who:** an app developer
- **Starts at:** a copy of `src/appkit/template/`, including `vendor/`
- **Needs:** .NET 10, Node 22.12 or later, and `ENDGAME_TEST_DATABASE` for the tests
- **Level:** Developer
- **Learn first:** reading `src/appkit/PLATFORM-API.md` and `template/AGENTS.md`
- **What you learn:** the template's `make build`, `lint`, `test`, `image` and `migration` targets are the contract, and a wrong thing fails loudly with its fix.
- **You know it worked when:** `make lint` and `make test` pass with zero warnings, and `make image` produces the container.
- **Steps:**
  1. Run `make -C src/appkit vendor`, which packs the SDKs into `template/vendor/`.
  2. Copy the template. Add endpoints on the `api` group from `UseEndgameApp()`, each with an operationId and a description.
  3. Add pages built on `@endgame/appkit` (`api()`, `useApiQuery()`, `routerBasename()`), and update `docs/app.md`, `docs/data.md` and `docs/decisions.md`.
  4. Run `make build`: the front end goes into `api/wwwroot`, then the API is built, with warnings as errors.
  5. Run `make lint`: ESLint, tsc and `dotnet format --verify-no-changes`.
  6. Run `make test`: web tests, then .NET tests against a throwaway database.
  7. Run `make image`: the container image the platform runs.
  8. Run `make migration name=…` for each schema change.
- **Variations and refusals:**
  - An endpoint with no operationId or description stops the app at start.
  - A URL starting with "/" fails ESLint (`endgame/no-root-relative-url`).
  - Reading `window.location` fails ESLint (`endgame/no-location-read`).
  - Absolute asset URLs stop the app at start.
  - Missing environment variables stop the app with one message.
- **Where:** `src/appkit/template/Makefile`; `src/appkit/README.md`; UC-050
- **Reachable from:** command line only
- **Covered by tests:** `template/api.tests/*`; `sdk-web/src/*.test.ts`; `Endgame.AppKit.Tests`
- **Note:** no make target runs a template app locally against the dev platform for hand use. The dev platform host is used only by the tests and `make proof`.

### KIT-22 A developer works on the kit itself
- **Who:** a platform developer
- **Starts at:** `make -C src/appkit build|lint|test|proof|vendor`, or the root `make appkit-*`
- **Needs:** Docker, for the test database and the proof
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** the kit, its template and the both-addresses proof are tested together.
- **You know it worked when:** every target exits 0. The proof passes under both a path base and a host root in a real browser.
- **Steps:**
  1. `build`: SDKs, then vendor, then the template.
  2. `lint`.
  3. `test`: starts `test-appkit-pg` on port 55471, then always removes it.
  4. `proof`: `proof/run.sh`, in a browser.
  5. `vendor`: drops the stale NuGet cache entries first.
- **Variations and refusals:** the test database not becoming ready gives "test database did not become ready".
- **Where:** `src/appkit/Makefile`
- **Reachable from:** command line only
- **Covered by tests:** CI `appkit` job

### KIT-23 An app's API refuses bad input, and its front end tells each failure apart
- **Who:** the app, and its developer
- **Starts at:** a request record with DataAnnotations, mapped on the `api` group from `UseEndgameApp()`; `api()` and `useApiQuery()` in `@endgame/appkit`
- **Needs:** the kit
- **Level:** Developer
- **Learn first:** KIT-21
- **What you learn:** a handler only ever sees valid input, every failure is a problem document, and the front end branches on the error's type, never on its message.
- **You know it worked when:** a bad form gets 400 with one entry per field, and the page shows each field's message.
- **Steps:**
  1. The developer puts `[Required]`, `[StringLength]` or `[Range]` on the request record's properties.
  2. Before the handler runs, the kit checks every such body and answers 400 "Some fields need fixing" with `errors` mapping each field to what is wrong.
  3. A platform failure the app does not catch becomes a problem with a `code`: 402 "The credit budget is spent", 503 "A platform service is unavailable", or 502 "A platform service failed". Every problem carries a `traceId`.
  4. In the browser, `api()` throws the matching error: `ValidationError` (with `errors`), `NotSignedInError` (with `signInUrl`), `ForbiddenError`, `NotFoundError`, `BudgetExhaustedError`, or `NetworkError` when nothing answered.
  5. `useApiQuery()` reports `loading`, `loaded` or `failed`, so a failed read is never shown as an empty one.
- **Variations and refusals:**
  - A 402 from the kit says "This feature is paused until the organisation tops up its credits."
  - `api("/notes")` throws at once: "drop the leading slash"; `api("api/notes")` throws "paths are already inside api/"; an absolute URL throws "api() calls this app's own API only."
  - Nothing answers: `NetworkError` "The app could not be reached. Check the connection and try again."
- **Where:** `Hosting/InputValidation.cs`; `Hosting/EndgameErrors.cs`; `EndgameApp.cs`; `sdk-web/src/api.ts`, `errors.ts`, `hooks.ts`
- **Reachable from:** API only (inside the app)
- **Covered by tests:** `ApiContractTests.Input_is_validated_before_the_handler_runs_with_one_entry_per_field`; `HostingTests.Errors_are_problem_details_with_a_trace_id` (kit); `sdk-web/src/api.test.ts`, `hooks.test.tsx`

## HOST — sleep, wake, pause and crash, as a person meets them

### HOST-01 A sleeping app wakes on a visit
- **Who:** any visitor allowed in
- **Starts at:** the app's address, while the app is asleep
- **Needs:** "Sleeps when unused" (APP-04)
- **Level:** Foundation
- **Learn first:** APP-04
- **What you learn:** a sleeping app costs less, and the first visitor waits a moment.
- **You know it worked when:** the app loads after a short wait. The response carries a wake-time header.
- **Steps:**
  1. Edge counts the request in and starts one wake that all concurrent visitors share.
  2. Once the app answers, Edge forwards the request.
- **Variations and refusals:** see HOST-02. A visitor who gives up does not cancel the wake for the others.
- **Where:** Edge `Runtime/AppRuntime.cs`, `AppGate.cs`
- **Reachable from:** UI
- **Covered by tests:** `AppRuntimeTests.Concurrent_requests_to_a_sleeping_app_share_one_wake`; `HostingIntegrationTests.A_sleeping_app_wakes_in_well_under_a_second…`; `tests-stack/acceptance.spec.ts` test 6

### HOST-02 A wake that cannot complete
- **Who:** a visitor
- **Starts at:** as HOST-01
- **Needs:** nothing
- **Level:** Core
- **Learn first:** HOST-01
- **What you learn:** Edge answers with a plain page that never names machinery.
- **You know it worked when:** one of the pages below appears, with status 503.
- **Steps:** Edge serves one of these pages:
  - Took over 30 seconds: "This app is taking longer than usual" / "It is still starting. Please try again in a few seconds." (Retry-After 3)
  - No room to start it: "This app could not start just now" / "Endgame is very busy at the moment. Please try again in a minute."
  - Nothing published: "This app isn't ready yet" / "It has an address, but its first version has not been published. Please check back soon."
  - Anything else: "This app is temporarily unavailable" / "Endgame could not reach it just now. Please try again in a moment."
- **Variations and refusals:** an archived or unknown app is denied, which serves the Forbidden page.
- **Where:** `Pages/UnavailablePage.cs`; `AppGate.ReasonFor`
- **Reachable from:** UI
- **Covered by tests:** `AppRuntimeTests.An_app_that_never_answers_times_out`

### HOST-03 An app paused because a budget is spent
- **Who:** a visitor; the owner sees it on the app page
- **Starts at:** the app's address
- **Needs:** a monthly budget at or above the app that has been reached
- **Level:** Core
- **Learn first:** APP-11
- **What you learn:** a cap holds for everything beneath it; nothing is lost, and the app returns when the budget is raised or the month turns.
- **You know it worked when:** visitors see the page below, and the app page's Health note reads "Paused: a monthly budget above it is spent…".
- **Steps:**
  1. Edge serves "This app is paused" / "It has used this month's budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns." It never wakes the app.
  2. The app page shows the paused summary.
  3. Raising the budget (APP-11) or the month turning restores the app.
- **Variations and refusals:** none.
- **Where:** `AppGate.cs`; `ReadModels.AppAsync`
- **Reachable from:** UI. The budget is raised on the app page (APP-11) or the credits page, or by API or MCP.
- **Covered by tests:** `EdgePipelineTests.An_app_paused_by_a_spent_budget_says_so`, `A_paused_app_gets_its_holding_page_and_is_never_woken`

### HOST-04 An app paused at the overdraft limit
- **Who:** a visitor; the owner
- **Starts at:** the app's address
- **Needs:** the organisation's balance is at its overdraft limit
- **Level:** Core
- **Learn first:** HOST-03, overdraft and top-ups (another reader's area)
- **What you learn:** a top-up restores paused apps at once.
- **You know it worked when:** visitors see "This app is paused" / "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up."
- **Steps:**
  1. Edge serves the paused page.
  2. The app page reads "Paused: the organisation reached its overdraft limit. A top-up restores it at once."
  3. An operator's top-up refreshes the routes and the app is available again.
- **Variations and refusals:** none.
- **Where:** `AppGate.cs`; `TreeEndpoints.cs` top-ups
- **Reachable from:** UI
- **Covered by tests:** `tests-stack/acceptance.spec.ts` test 13

### HOST-05 A crashed app
- **Who:** a visitor; the owner gets a notification
- **Starts at:** the app's address
- **Needs:** the app crashes
- **Level:** Core
- **Learn first:** HOST-01, VER-02
- **What you learn:** a crash is caught, shown in plain words, retried after a pause, and reported to a person.
- **You know it worked when:** visitors see the page below, and a notification titled "<App> stopped working" appears.
- **Steps:**
  1. Edge serves "This app has stopped for a moment" / "Something went wrong inside it. It will be started again shortly — please try again in a moment." (Retry-After 15) and makes no wake for 15 seconds.
  2. Dock reports the app as failed. The notification reads "<App> stopped working" / "It crashed and visitors see an unavailable page. Its last good version can be restored from its history." (at most once a minute per app).
  3. The app page shows Health "Down" with "It stopped working and needs attention.".
  4. The owner may restore an earlier version (VER-02).
- **Variations and refusals:** a crash during a wake fails every waiting visitor at once. A crash report that was lost is caught by asking Dock.
- **Where:** `AppGate.cs`; `AppRuntime.MarkCrashed`; `InternalEndpoints.cs` `/apps/{id}/state`
- **Reachable from:** UI
- **Covered by tests:** `AppRuntimeTests` (crash tests); `HostingIntegrationTests.A_crash_gets_the_unavailable_page_at_once_is_reported_and_recovers`

### HOST-06 Reach an app at either of its two addresses
- **Who:** any visitor
- **Starts at:** `https://<platform host>/<org>/<division>/<project>/<app>/`, or `https://<org>.<zone>/<division>/<project>/<app>/`
- **Needs:** a published app
- **Level:** Foundation
- **Learn first:** APP-01
- **What you learn:** one app is served at two addresses from one container.
- **You know it worked when:** both addresses load the same app.
- **Steps:**
  1. An address without its trailing slash is redirected (308) to the same address with it.
  2. Edge strips the prefix, sets the forwarded headers, removes any `X-Endgame-*` headers the client sent, and strips platform cookies.
  3. An app given its whole subdomain is served at the root with no prefix.
- **Variations and refusals:** `_platform/*` is never reachable from the public side.
- **Where:** Edge `Routing/*`; `PLATFORM-API.md` §5
- **Reachable from:** UI
- **Covered by tests:** `EdgePipelineTests` (address tests); `HostingIntegrationTests.The_app_is_served_at_both_address_shapes_from_one_image`; `make appkit-proof`

### HOST-07 An idle app goes to sleep
- **Who:** the system
- **Starts at:** the idle sweeper
- **Needs:** the app is set to "Sleeps when unused"
- **Level:** Core
- **Learn first:** APP-04, APP-05
- **What you learn:** an app sleeps after its idle minutes, never while it is serving someone, and never if it is set to always on.
- **You know it worked when:** the app page's "Running" legend shows it asleep, and in technical mode its Health note reads "Asleep; it wakes on the next visit." (In normal mode an app that has measured anything keeps its errors-today note while it sleeps.)
- **Steps:** the sweeper checks each app's own setting (default 15 minutes) and stops apps with no request in flight.
- **Variations and refusals:** none.
- **Where:** `Runtime/IdleSweeper.cs`
- **Reachable from:** system
- **Covered by tests:** `AppRuntimeTests.The_idle_sweeper_honours_each_apps_own_setting`, `The_sweeper_never_stops_an_app_with_a_request_in_flight`; `HostingIntegrationTests.An_idle_app_sleeps…`

### HOST-08 A visitor sees the outage page when the machine is unreachable
- **Who:** any visitor
- **Starts at:** the console or any app host
- **Needs:** OPS-22 applied, and the origin is down
- **Level:** Operator
- **Learn first:** OPS-22
- **What you learn:** Cloudflare shows a plain page when the host cannot be reached.
- **You know it worked when:** "Endgame is temporarily unavailable" with "It can't be reached right now. Nothing you have made has been lost — please try again in a few minutes." appears.
- **Steps:** the Worker replaces 502, 504, 52x and 530 answers and network failures, and passes everything else through.
- **Variations and refusals:** non-Endgame hosts on the zone are excluded by routes with no Worker.
- **Where:** `src/ops/outage-worker/worker.js`
- **Reachable from:** UI (at Cloudflare's edge)
- **Covered by tests:** `outage-worker.test.mjs` (`make ops-test-worker`)

## OPS — running the platform (host administrator, command line)

### OPS-01 Start the local stack
- **Who:** host administrator / developer
- **Starts at:** `make up`
- **Needs:** Docker
- **Level:** Operator
- **Learn first:** nothing
- **What you learn:** one command builds and starts every service.
- **You know it worked when:** `docker compose up --wait` returns, and `http://localhost:8095/` serves the console.
- **Steps:**
  1. If there is no `.env`, it is copied from `.env.example`.
  2. The app kit is vendored, because Dock's image carries the template.
  3. `docker compose up -d --build --wait` runs.
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** CI `stack-smoke` and `e2e` jobs

### OPS-02 Stop the local stack, keeping or wiping its data
- **Who:** host administrator / developer
- **Starts at:** `make down` (keeps the data); `make docker-down` (deletes the database and the app repositories, keeps the local backup archives; local only); or `make docker-wipe CONFIRM=yes` (deletes every volume, the local backup archives too)
- **Needs:** OPS-01
- **Level:** Operator
- **Learn first:** OPS-01
- **What you learn:** `down` keeps the data, `docker-down` wipes it but keeps the local backups so a restore can bring it back, and only `docker-wipe` deletes the backups as well.
- **You know it worked when:** `docker compose ps` lists nothing; after `docker-down`, it ends with "docker-down: kept endgame_backup, the local backup archives (make docker-wipe CONFIRM=yes deletes them too)." and one "docker-down: removed <volume>" line for each other volume.
- **Steps:** run the target.
- **Variations and refusals:**
  - `make docker-down` runs `docker compose down --remove-orphans`, then removes every volume of the stack's compose project except the `backup` volume. An archive in a bucket is not touched.
  - `make docker-wipe` without `CONFIRM=yes`: "docker-wipe deletes every volume of the stack: the database, the app repositories and the local backup archives (an archive in a bucket is not touched). Run make docker-wipe CONFIRM=yes." (exit 2); nothing is stopped or deleted.
  - `make docker-wipe CONFIRM=yes` runs `docker compose down -v --remove-orphans`: the `backup` volume goes too.
  - Both take `OPS_COMPOSE` to name another stack, as the backup targets do.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** `Endgame.Ops.Tests/Rehearsal/RehearsalTests.cs` (destroys the stack with `make docker-down`, checks only the backup volume is left, then `make docker-wipe`)

### OPS-03 Build the images without starting them
- **Who:** developer
- **Starts at:** `make docker-build`
- **Needs:** Docker
- **Level:** Operator
- **Learn first:** OPS-01
- **What you learn:** the images can be built on their own.
- **You know it worked when:** the build exits 0.
- **Steps:** the kit is vendored, then `docker compose build` runs.
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** none found

### OPS-04 Lint everything
- **Who:** developer
- **Starts at:** `make lint` (or `lint-backend`, `lint-frontend`, `appkit-lint`)
- **Needs:** the .NET SDK and npm dependencies
- **Level:** Developer
- **Learn first:** nothing
- **What you learn:** the backend, the console and the kit all lint with zero warnings.
- **You know it worked when:** it exits 0.
- **Steps:** `dotnet format --verify-no-changes`, then ESLint (zero warnings allowed) and tsc for the console, then the kit's lint, which packs the kit before it lints the template.
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** CI

### OPS-05 Build everything
- **Who:** developer
- **Starts at:** `make build` (or `build-backend`, `build-frontend`, `appkit-build`)
- **Needs:** as OPS-04
- **Level:** Developer
- **Learn first:** OPS-04
- **What you learn:** the whole solution builds from one command.
- **You know it worked when:** it exits 0.
- **Steps:** run the target.
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** CI

### OPS-06 Run the test suites
- **Who:** developer
- **Starts at:** `make test` (or `test-backend`, `test-frontend`, `appkit-test`, `ops-test`)
- **Needs:** Docker, for the test databases and the rehearsal
- **Level:** Developer
- **Learn first:** OPS-05
- **What you learn:** the backend, console, kit and ops tests, including the backup rehearsal, run together.
- **You know it worked when:** every suite passes.
- **Steps:** run the target. It runs the backend tests, the console's unit tests, the kit's tests against a throwaway PostgreSQL, then `ops-test` (OPS-27).
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** this target is the test run itself

### OPS-07 The smoke test through the edge
- **Who:** developer
- **Starts at:** `make e2e` (needs `make up` first), or `make smoke`, which brings the stack up itself
- **Needs:** OPS-01
- **Level:** Operator
- **Learn first:** OPS-01
- **What you learn:** the stack is deployable only when every service reports healthy through the edge.
- **You know it worked when:** `make smoke` prints "smoke: every service healthy through the edge; console served."
- **Steps:**
  1. `make smoke` runs `make up`, prints "Probing the stack through the edge on :8095...", then probes `/api/system/status` for `"overall":"healthy"`, the console's `<div id="root">` and `/health`, up to 40 times, 3 seconds apart. On success it prints the status body, then its last line.
  2. `make e2e` runs Playwright with `PW_BASE_URL`, which **runs only `smoke.spec.ts`**: its two tests in the desktop and phone projects.
- **Variations and refusals:** on failure, `make smoke` prints "smoke: the stack did not report healthy through the edge in time." with the status, `docker compose ps` and the last 80 log lines, and exits 1.
- **Where:** Makefile; `src/frontend/playwright.config.ts`
- **Reachable from:** command line only
- **Covered by tests:** `tests-e2e/smoke.spec.ts`
- **Finding:** the mock-API console specs (`console.spec.ts`, `breadth.spec.ts`, `workforce.spec.ts`) run only by hand, with `CI=1 PW_PORT=<port> npm run test:e2e`. Neither a make target nor CI runs them, yet they are the specs cited for many app-page flows above.

### OPS-08 Check the production stack file
- **Who:** host administrator
- **Starts at:** `make prod-config`
- **Needs:** Docker Compose
- **Level:** Operator
- **Learn first:** OPS-01
- **What you learn:** production can never turn on the development sign-in, always runs as Production, and refuses to start without the backup key.
- **You know it worked when:** it prints "prod-config: parses; development sign-in pinned off; every service Production; backup key required."
- **Steps:** the stack file is parsed with throwaway values for its seven required variables, and the three properties are checked. Every check is silent, so a pass prints only the last line.
- **Variations and refusals:** each failed property prints its own message and exits 1: "prod-config: the production control plane could enable the development sign-in", "prod-config: a production service does not run as Production" or "prod-config: the production stack does not refuse a missing ENDGAME_BACKUP_KEY".
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** CI `stack-smoke`

### OPS-09 Run the merged-stack acceptance test
- **Who:** developer
- **Starts at:** `make e2e-stack` (always tears down); or `make stack-up`, then `make e2e-stack-run`, then `make stack-down`
- **Needs:** Docker
- **Level:** Developer
- **Learn first:** OPS-01
- **What you learn:** a second, separate stack is driven end to end through its real Edge, with no mocks.
- **You know it worked when:** all 13 tests in `tests-stack/acceptance.spec.ts` pass, followed by the kit's edge proof.
- **Steps:** the stack is project `endgame-int` on edge port 18095. `stack-down` removes everything that stack's Dock made.
- **Variations and refusals:** none.
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** this target is the test run itself (CI `stack-acceptance`)

### OPS-10 Run the factory proof with live models (opt-in, spends money)
- **Who:** developer
- **Starts at:** `make e2e-factory`, or `fac-up`, `e2e-factory-run`, `fac-down`
- **Needs:** `OPENROUTER_API_KEY` in `.env`
- **Level:** Developer
- **Learn first:** OPS-09
- **What you learn:** an idea is taken all the way to a running private app, for real, with a spending stop.
- **You know it worked when:** the Playwright run passes.
- **Steps:** the run stops itself once the ledger shows `FAC_SPEND_STOP_USD` (default 8.50) spent.
- **Variations and refusals:** with no key set: "fac-up: set OPENROUTER_API_KEY in .env (the factory calls live models)".
- **Where:** Makefile
- **Reachable from:** command line only
- **Covered by tests:** this target is the test run itself

### OPS-11 Run the first version's acceptance tests with live models (opt-in)
- **Who:** developer
- **Starts at:** `make e2e-acceptance`, or `acc-up`, `e2e-acceptance-run`, `acc-down`; `ACC_CLUB_APP=<path>` replays against an existing app
- **Needs:** `OPENROUTER_API_KEY`
- **Level:** Developer
- **Learn first:** OPS-10
- **What you learn:** tenant zero, the club app and an invited organisation are each proven end to end.
- **You know it worked when:** the Playwright run passes.
- **Steps:** the run stops at `ACC_SPEND_STOP_USD` (default 5).
- **Variations and refusals:** with no key set: "acc-up: set OPENROUTER_API_KEY in .env (the factory calls live models)".
- **Where:** Makefile; `Endgame.Harness.Bench/acceptance`
- **Reachable from:** command line only
- **Covered by tests:** this target is the test run itself

### OPS-12 Take a backup now
- **Who:** host administrator
- **Starts at:** `make backup`; production adds `OPS_COMPOSE="docker compose -f docker-compose.prod.yml"`
- **Needs:** `ENDGAME_BACKUP_KEY`
- **Level:** Operator
- **Learn first:** OPS-01 or OPS-24
- **What you learn:** one sealed archive holds every database and the app repositories.
- **You know it worked when:** it prints "BACKUP_ID=<id>".
- **Steps:**
  1. PostgreSQL is started and waited on; the ops service is started without waiting for its health check.
  2. It prints "Backing up to <store>...", then "Backup <id>: <n> bytes sealed (<m> before encryption) in <s> s.", the databases, each volume, any pruned archives, `BACKUP_ID=<id>`, and a storage usage line.
- **Variations and refusals:**
  - Another backup or restore is running: "Another backup or restore is running; try again when it has finished." (exit 1).
  - A key that is set but is not a key: "ENDGAME_BACKUP_KEY is set but is not a backup key, so no backup runs. It must be 32 random bytes written as 64 hex characters (or as 44 characters of base64); make one with `openssl rand -hex 32`. An archive opens only with the key that sealed it, so keep the one you have used before." (exit 1). No key: "ENDGAME_BACKUP_KEY is not set, so nothing can be encrypted and no backup runs. It must be 32 random bytes written as 64 hex characters (or as 44 characters of base64); make one with `openssl rand -hex 32`." Either is said before anything else runs; the value is never printed.
  - Usage near or over the free allowance prefixes the usage line with "WARNING: ".
  - With no S3 bucket configured, the archive goes to a local volume and is reported as not offsite.
- **Where:** Makefile; `Endgame.Ops/Program.cs` (OpsCli backup); `BackupService`
- **Reachable from:** command line; also `POST /internal/ops/backups` with the service token
- **Covered by tests:** `Endgame.Ops.Tests/Rehearsal` (including `make backup` with a malformed key); `BackupPolicyTests.A_bad_backup_key_names_the_variable_and_the_shape_it_needs_never_the_value`

### OPS-13 Nightly backups (automatic)
- **Who:** the system
- **Starts at:** the ops service's timer
- **Needs:** the backup key, and the schedule on (the default)
- **Level:** Operator
- **Learn first:** OPS-12
- **What you learn:** one archive is made per day after the set hour, and old ones are pruned on a daily and weekly rule.
- **You know it worked when:** `make ops-backups` lists an archive for today.
- **Steps:**
  1. The first check is 30 seconds after the service starts, then one every 5 minutes. Once the hour has passed (01:00 UTC by default), the service runs a backup if today has none; an empty store is due at once, whatever the hour.
  2. It skips a server that is still empty, and logs "The nightly backup is due but every database is empty (a stack waiting for a restore?); skipped."
  3. Retention keeps the newest archive of each of the last 7 days and the last 4 ISO weeks, and always keeps the newest. It runs only after a backup succeeds, and logs each archive it prunes.
- **Variations and refusals:** a failure is logged ("The nightly backup failed; it will try again at the next check: …") and retried at the next check. Nothing notifies a person (per ARCH-007). With `ENDGAME_BACKUP_SCHEDULE=false` it logs "The nightly backup schedule is switched off (Ops__Backup__ScheduleEnabled=false)." and never runs.
- **Where:** `Backups/BackupScheduler.cs`, `Retention.cs`
- **Reachable from:** system
- **Covered by tests:** `BackupPolicyTests`

### OPS-14 List the backups
- **Who:** host administrator
- **Starts at:** `make ops-backups`
- **Needs:** the ops service running
- **Level:** Operator
- **Learn first:** OPS-12
- **What you learn:** where the archives are, and how much of the allowance they use.
- **You know it worked when:** "Backups in <store>:" is printed, followed by ids and sizes.
- **Steps:** run the target.
- **Variations and refusals:** with none: "(none yet)".
- **Where:** OpsCli backups
- **Reachable from:** command line; also `GET /internal/ops/backups`
- **Covered by tests:** `OpsApiTests.Backups_list_reports_the_local_destination_and_usage`

### OPS-15 Verify a backup
- **Who:** host administrator
- **Starts at:** `make ops-verify BACKUP=<id>`
- **Needs:** an archive
- **Level:** Operator
- **Learn first:** OPS-14
- **What you learn:** an archive can be checked end to end without touching anything.
- **You know it worked when:** "Backup <id> is intact: <n> database(s), <m> file(s), every chunk authenticated against the manifest." is printed.
- **Steps:** run the target.
- **Variations and refusals:**
  - No id given: "ops-verify: make ops-verify BACKUP=<id>" (exit 2).
  - No archive with that id: "There is no backup endgame-<id>.egbk in /backups." from the local store.
  - Damaged archives give messages such as "The backup is damaged: it has entries after its manifest.", "The backup has no manifest: it is incomplete." or "The backup's manifest is format X; this version reads Y.".
  - A wrong key is named as such.
- **Where:** OpsCli verify
- **Reachable from:** command line only
- **Covered by tests:** `SealedStreamTests`; Rehearsal

### OPS-16 Restore a backup
- **Who:** host administrator
- **Starts at:** `make restore BACKUP=<id> [OVERWRITE=1]`
- **Needs:** an archive and the same backup key
- **Level:** Operator
- **Learn first:** OPS-15
- **What you learn:** a restore verifies the whole archive first and never overwrites data unless told to.
- **You know it worked when:** it prints `RESTORE_VERIFY_SECONDS=` and `RESTORE_SECONDS=`, and the stack comes back up.
- **Steps:**
  1. The services that are running are noted; then Edge, the console, the Runner, Dock and the control plane are stopped.
  2. PostgreSQL is started and waited on, and the ops service is started.
  3. It prints "Verifying <name> from <store>...", then "Verified: …".
  4. It restores, then starts the whole stack again.
- **Variations and refusals:**
  - No id given: "restore: name the archive: make restore BACKUP=<id> (make ops-backups lists them)" (exit 2).
  - Data is already present: "Refusing to restore over data that is already here: … Restore onto an empty stack, or pass OVERWRITE=1 to replace it."
  - With `OVERWRITE=1`: "Replacing what is already here (OVERWRITE): …".
  - Not configured: "Backups are not configured." or the specific reason, such as a missing key (as OPS-12).
  - No archive with that id: "There is no backup endgame-<id>.egbk in /backups." from the local store.
  - Busy: as OPS-12.
  - After any refusal (data present, wrong or missing key, damaged or missing archive, busy) it prints "restore: nothing was restored; starting again what was running before.", starts again every service that was running before step 1, stops the database and ops service again if they were not running, and exits 1. The stack is as it was.
  - A failure after the restore began writing: "The restore of <name> failed part-way, so the databases and volumes may hold part of it: <reason>. Run it again with OVERWRITE=1 once the cause is fixed.", then "restore: it failed part-way, so the stack stays stopped. Fix the cause, then run make restore BACKUP=<id> OVERWRITE=1 again." (exit 4). Only this case leaves the services stopped, so nothing starts on half-restored data.
  - There is no confirmation question: `BACKUP=` and `OVERWRITE=1` are the whole of the operator's say.
  - Restore exists only on the command line; it is never on the HTTP API.
- **Where:** Makefile; OpsCli restore; `BackupService.RestoreAsync`
- **Reachable from:** command line only
- **Covered by tests:** `Endgame.Ops.Tests/Rehearsal/RehearsalTests.cs` (TEST-301: the restore, then a refused `make restore` over the live data after which every service is running again); `BackupPolicyTests.A_restore_that_failed_part_way_says_so_in_one_sentence_and_how_to_finish_it`

### OPS-17 Rehearse a restore
- **Who:** host administrator
- **Starts at:** automatic in `make ops-test`; by hand, per ARCH-007 step 9, on another Docker host
- **Needs:** OPS-12
- **Level:** Operator
- **Learn first:** OPS-16
- **What you learn:** a backup is only proven once it has been restored onto an empty host.
- **You know it worked when:** the rehearsal test passes; or, by hand, the restored stack opens with its data.
- **Steps:**
  1. Automatic: the test backs up, destroys the stack, restores, checks that no plaintext is in the upload, and checks that a second restore is refused without overwrite.
  2. By hand, per ARCH-007 step 9: copy the compose file and `.env` to the other host, with the same `ENDGAME_VAULT_MASTER_KEY`, `DOCK_SECRET_KEY` and `ENDGAME_BACKUP_KEY` (and the bucket keys, or the archive itself when it is local), then run `make restore BACKUP=<id> OPS_COMPOSE="docker compose -f docker-compose.prod.yml"`.
- **Variations and refusals:** none.
- **Where:** `Endgame.Ops.Tests/Rehearsal`; ARCH-007
- **Reachable from:** command line only
- **Covered by tests:** RehearsalTests

### OPS-18 Check the ops service's health
- **Who:** host administrator
- **Starts at:** `make ops-health`
- **Needs:** the ops service running
- **Level:** Operator
- **Learn first:** OPS-12
- **What you learn:** the ops service says in plain words what it is, and is not, doing.
- **You know it worked when:** a one-line JSON report is printed. It answers 503 when unhealthy, for example with a backup key that is missing or not 32 bytes.
- **Steps:** run the target.
- **Variations and refusals:**
  - With no Cloudflare token, the report says Cloudflare is idle; with a token but not every key, misconfigured.
  - With no S3 bucket, it says backups are local.
  - Unhealthy, the answer is 503 but `make ops-health` still exits 0 (curl prints the body); the container's own health check fails.
  - `last` counts every archive in the store however it was made: when the newest archive is newer than this service's own last attempt (a `make backup`, which runs in its own process), `last` is that archive, with the trigger "found in the store (made outside this service, e.g. make backup)" and no finish time. A failed attempt of the service's own that is newer than every archive stays `last`. `GET /internal/ops/backups` reports the same `last`.
  - `running` is only the service's own run in progress; a `make backup` in progress shows once its archive is in the store.
- **Where:** `Api/OpsEndpoints.cs` `/health`
- **Reachable from:** command line / HTTP
- **Covered by tests:** `OpsApiTests.With_no_token_health_says…`, `Without_a_backup_key_health_is_unhealthy_and_says_why`, `Health_counts_an_archive_this_service_did_not_make_as_the_latest_backup`, `The_last_attempt_this_service_made_wins_over_an_older_archive_and_loses_to_a_newer_one`; the rehearsal reads `/health` after its `make backup`

### OPS-19 List the reserved host names
- **Who:** host administrator; the control plane uses the same list
- **Starts at:** `make ops-reserved-hosts`
- **Needs:** a Cloudflare token, for the complete list
- **Level:** Operator
- **Learn first:** OPS-20
- **What you learn:** an organisation may not take a name the zone already uses, or a fixed label such as www, mail, api, admin or status.
- **You know it worked when:** a JSON list prints each label with its reason.
- **Steps:** run the target. The control plane refuses new organisation names on the list; that refusal is another reader's area.
- **Variations and refusals:** with no token, the list is marked incomplete, and the control plane pauses new names until it is complete.
- **Where:** `Cloudflare/ReservedHosts.cs`; `Infrastructure/Platform/ReservedNames.cs`
- **Reachable from:** command line; `GET /internal/ops/reserved-hosts`
- **Covered by tests:** `ReconcilerTests.Reserved_hosts_…`; `BreadthTests.Organisation_names_that_frostaura_uses_are_refused…`

### OPS-20 Plan the Cloudflare changes (dry run)
- **Who:** host administrator
- **Starts at:** `make ops-cloudflare-plan`
- **Needs:** `CLOUDFLARE_API_TOKEN`, account, zone and tunnel ids, `ENDGAME_ZONE` and `ENDGAME_CONSOLE_HOST`
- **Level:** Operator
- **Learn first:** OPS-24
- **What you learn:** every change to the live account is shown before it is made, and records Endgame did not create are never touched.
- **You know it worked when:** each change prints, ending with "In sync: apply would change nothing." or "<n> change(s) to apply".
- **Steps:**
  1. Ops reads the DNS records, Worker routes, tunnel ingress and the outage Worker.
  2. It prints each change as keep, create, update, delete or conflict.
- **Variations and refusals:**
  - Conflicts end the line with "; conflicts must be resolved first" (exit 3).
  - No token: "No Cloudflare API token is configured (CLOUDFLARE_API_TOKEN), so nothing is managed." (exit 1)
  - Half configured: "Cloudflare is half configured; also needed: …" (exit 1)
  - Console host two labels deep: "ENDGAME_CONSOLE_HOST (…) must be one label directly under ENDGAME_ZONE (…): the free certificate covers one level only."
- **Where:** `Cloudflare/CloudflareReconciler.cs`
- **Reachable from:** command line; `GET /internal/ops/cloudflare/plan`
- **Covered by tests:** `ReconcilerTests` (all); `OpsApiTests`

### OPS-21 Apply the Cloudflare plan
- **Who:** host administrator
- **Starts at:** `make ops-cloudflare-apply CONFIRM=yes`
- **Needs:** OPS-20 read, with no conflicts
- **Level:** Operator
- **Learn first:** OPS-20
- **What you learn:** applying needs an explicit confirmation and is refused outright when there is any conflict.
- **You know it worked when:** "Applied <n> change(s):" is printed, then "Read back: in sync.".
- **Steps:** Ops plans again, applies each step, then reads the account back.
- **Variations and refusals:**
  - Without `CONFIRM=yes`: "ops-cloudflare-apply changes the live Cloudflare account. Read make ops-cloudflare-plan, then run make ops-cloudflare-apply CONFIRM=yes." (exit 2)
  - Conflicts: "The plan has conflicts, so nothing was applied: …"
  - Drift after applying: "Read back: NOT in sync — run the plan again."
- **Where:** OpsCli `cloudflare-apply`
- **Reachable from:** command line; `POST /internal/ops/cloudflare/apply?confirm=true`
- **Covered by tests:** `ReconcilerTests.Apply_reaches_the_desired_state_and_a_second_apply_is_a_no_op`; `OpsApiTests.Apply_refuses_without_explicit_confirmation…`

### OPS-22 Finish the Cloudflare setup in the dashboard by hand
- **Who:** host administrator
- **Starts at:** the Cloudflare dashboard, per ARCH-007 step 8
- **Needs:** OPS-21
- **Level:** Operator
- **Learn first:** OPS-21
- **What you learn:** two settings are not done through the API.
- **You know it worked when:** both settings are in place.
- **Steps:** set the outage routes' request-limit behaviour so visitors get the outage page rather than error 1027, and add a Tunnel Health Alert.
- **Variations and refusals:** none.
- **Where:** ARCH-007
- **Reachable from:** outside Endgame
- **Covered by tests:** none

### OPS-23 CI publishes the images
- **Who:** CI, on every push to `main`
- **Starts at:** a push to `main`
- **Needs:** the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets (and the optional `DOCKERHUB_NAMESPACE` variable)
- **Level:** Operator
- **Learn first:** OPS-06
- **What you learn:** nothing is built on the host; every release is seven images for two architectures.
- **You know it worked when:** every "Tag <image> (multi-arch)" job is green and each image has `sha-<commit>` and `latest` tags. Not yet seen: this has not run with real credentials (ARCH-008).
- **Steps:**
  1. After the Backend, Hosting (real Docker), App kit, Ops (with the restore rehearsal), Frontend, Security, Stack smoke, E2E smoke and Stack acceptance (make e2e-stack) jobs pass, `publish` runs 14 jobs named "Publish <image> (<arch>)": the seven images, each for amd64 and arm64.
  2. `publish-manifest` runs "Tag <image> (multi-arch)" for each image, joining both architectures under `sha-<commit>` and `latest`.
- **Variations and refusals:** without the Docker Hub secrets, each `publish` job fails at "Log in to Docker Hub", after its image has built.
- **Where:** `.github/workflows/ci.yml`; ARCH-008
- **Reachable from:** CI
- **Covered by tests:** not verified. ARCH-008 says nothing has been pushed with credentials yet.

### OPS-24 First deploy on Portainer
- **Who:** host administrator
- **Starts at:** Portainer, Stacks, Add stack
- **Needs:** OPS-23 green
- **Level:** Operator
- **Learn first:** OPS-23, OPS-08
- **What you learn:** the stack's name and its never-change keys matter, and the edge is the only published port.
- **You know it worked when:** every service is healthy within about a minute, `http://<host>:8095/health` answers, and `https://endgame.<zone>/` opens. Not yet seen: no deploy has run with real credentials (ARCH-008).
- **Steps:**
  1. In Portainer, Stacks, Add stack: name it `endgame`, choose the web editor and paste `docker-compose.prod.yml`.
  2. Under Environment variables, Advanced mode, paste a filled `.env.production.example`. Save `DOCK_SECRET_KEY`, `ENDGAME_VAULT_MASTER_KEY` and `ENDGAME_BACKUP_KEY` off the machine.
  3. Deploy.
  4. Route the tunnel, either on the host or with `COMPOSE_PROFILES=tunnel` and `CLOUDFLARE_TUNNEL_TOKEN`.
  5. Register a passkey with an operator address and top the organisation up (OP-05).
- **Variations and refusals:**
  - The stack refuses to start without each required variable: compose says "required variable <KEY> is missing a value: <KEY> is required".
  - Without SMTP, no mail is sent and codes are handed over by hand.
  - Without S3, backups are local.
- **Where:** ARCH-008; `docker-compose.prod.yml`
- **Reachable from:** outside Endgame (Portainer)
- **Covered by tests:** none. "Not verified" per ARCH-008.

### OPS-25 Redeploy automatically or by hand
- **Who:** CI or the host administrator
- **Starts at:** a green push with `DEPLOY_ENABLED=true`; or Portainer's "Pull and redeploy"
- **Needs:** `PORTAINER_URL`, `PORTAINER_TOKEN`, `PORTAINER_ENDPOINT_ID` and `PORTAINER_STACK_ID`
- **Level:** Operator
- **Learn first:** OPS-24
- **What you learn:** a redeploy moves images and nothing else; a changed stack file must be pasted in by hand.
- **You know it worked when:** the "Redeploy on Portainer" job is green and prints "Portainer accepted the redeploy.", or the stack shows the new images. Not yet seen: this job has not run with real credentials (ARCH-008).
- **Steps:** the job reads the stack file and environment Portainer holds and sends them back with `pullImage: true`.
- **Variations and refusals:**
  - With the variable unset, the job is skipped, not failed.
  - A missing secret fails the job with "secret X is required".
  - An empty stack file fails with "Portainer returned an empty stack file".
  - A non-200 answer fails the job with "Portainer refused the redeploy (HTTP <status>): <Portainer's message>".
  - A changed `docker-compose.prod.yml` is not delivered: paste it into the stack's editor by hand.
- **Where:** `ci.yml` `deploy`
- **Reachable from:** CI / Portainer
- **Covered by tests:** none

### OPS-26 Go back to an earlier release
- **Who:** host administrator
- **Starts at:** Portainer stack environment
- **Needs:** an earlier `sha-` tag
- **Level:** Operator
- **Learn first:** OPS-25, OPS-16
- **What you learn:** a rollback is an image tag, but database migrations only go forward.
- **You know it worked when:** the services run the older tag, and the edge's `/health` names that commit as its `revision`. Not yet seen: no release has been deployed with real credentials (ARCH-008).
- **Steps:** set `ENDGAME_IMAGE_TAG=sha-<commit>` and update the stack.
- **Variations and refusals:** going back across a migration needs a restore (OPS-16).
- **Where:** ARCH-008
- **Reachable from:** Portainer
- **Covered by tests:** none

### OPS-27 Run the ops service's tests and the outage Worker's
- **Who:** developer
- **Starts at:** `make ops-test-worker` (the outage Worker alone), or `make ops-test` (the Worker, then the ops service)
- **Needs:** Node for the Worker; the .NET SDK and Docker for the ops tests and the rehearsal
- **Level:** Developer
- **Learn first:** OPS-06
- **What you learn:** the outage page's Worker is tested on its own under Node, with no dependencies and no build step; the ops tests add the fake-Cloudflare reconciler and the restore rehearsal.
- **You know it worked when:** `node --test` ends with "ℹ fail 0", and the ops test run has no failures.
- **Steps:**
  1. `make ops-test-worker` runs `node --test` in `src/ops/outage-worker`: 26 tests, from a healthy origin passing through to the page being self-contained.
  2. `make ops-test` runs the Worker's tests first, then `dotnet test` on `Endgame.Ops.Tests`, including the backup, destroy and restore rehearsal on its own throwaway stack.
- **Variations and refusals:** with `ENDGAME_SKIP_DOCKER_TESTS=1` (or `true`) the rehearsal returns at once and writes "Skipped: ENDGAME_SKIP_DOCKER_TESTS is set." to its test output.
- **Where:** Makefile; `src/ops/outage-worker/outage-worker.test.mjs`; `Endgame.Ops.Tests`
- **Reachable from:** command line only
- **Covered by tests:** this target is the test run itself (CI "Ops (with the restore rehearsal)")

## Gaps and oddities found

1. Fixed: an app's own monthly cap is set on its page (APP-11), as well as by API or MCP (`budget_set`).
2. Fixed: an app's own AI allowance (`app_models.monthly_credits`) is shown and set on its page (APP-12).
3. Fixed: idle minutes are set on the app page (APP-05).
4. Fixed: an app is renamed, archived and deleted on its page (APP-13, APP-14). There is still no MCP delete.
5. **No user-facing way to pause or stop an app.** Paused, stopped and failed are set only by the system or by hosting.
6. Fixed: a failed restore offers "Rebuild and restart" (APP-15).
7. Fixed: the invitation note says whether the code was e-mailed (SHR-03).
8. Fixed: the app page's controls follow the role (APP-04, APP-06, APP-09, SHR-02).
9. Fixed: the cap note says whose cap applies, or that none does (APP-02, APP-11).
10. **Sharing has no MCP tools** (no list, invite or remove). The dashboard has no MCP tools. Asking over MCP (`app_ask`) has no estimate step, although rule 11 says an estimate is shown first.
11. **The MCP `app_settings` schema offers `public`**, which is always refused (`human_only`). Its own description says "private or shared".
12. **The share endpoint accepts invitations whatever the access setting.** The console shows the invite form only when the app is Shared. Not verified what such a share does once the app is switched to Shared.
13. **The console's mock-API end-to-end specs** (`tests-e2e/console.spec.ts`, `breadth.spec.ts`, `workforce.spec.ts`) **are run by nothing in the Makefile or CI.** `make e2e` sets `PW_BASE_URL`, which limits the run to `smoke.spec.ts`.
14. **ARCH-008 says the publish and Portainer redeploy have never run with credentials**, so OPS-23 to OPS-26 are unverified in practice.
15. **No local run target for a hand-built app** against the kit's dev platform. The dev platform host is used only by the tests and `make proof`.
16. **Backup failures and outages notify no one inside Endgame** (stated in ARCH-007). Only the log and `/health` carry them.
17. **The doc comment on Edge's `Unavailable.Paused` says "overdraft"** while the shared paused copy talks about credits. They are consistent in substance, but the overdraft and budget cases depend on `PausedReason` being set correctly. Not verified beyond the Edge tests.
18. Fixed: a refused `make restore` puts back what was running (OPS-16); only a restore that failed part-way leaves the stack stopped, on purpose.
19. Fixed: `/health` counts a command-line backup as the latest (OPS-18). `running` still shows only the service's own run.
20. Fixed: a bad or missing backup key is named, with the shape it needs, before anything else (OPS-12).
21. Fixed: `make docker-down` keeps the local backup archives; `make docker-wipe CONFIRM=yes` deletes everything (OPS-02).
22. Fixed: the kit has `EndgameOverdraftLimitException`, a 402 for the app's caller (KIT-13), and `PLATFORM-API.md` §3.2 lists `overdraft_limit`.
23. Fixed: the kit's 401 message ends its sentence once (KIT-10).
24. **An app's outbound calls may be blocked by default**: Dock accepts an egress allow-list (`AllowedHosts`, `Endgame.Hosting.Contracts/DockApi.cs`), but nothing in the control plane was found to send one. Not traced end to end.
