# The organisation, home and conversations — every flow

The home screen, the tree of divisions, projects and apps, the two graph views, conversations, notifications, system status.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

**What most needs your attention**

1. **The tree is managed on "Manage"** (`/tree`): create, rename, describe, archive, reactivate and delete divisions, projects and apps (TREE-02 to TREE-13). Moving is not possible by any route (TREE-10). The factory still places each built idea, creating its division when needed (TREE-01).
2. **Talking to an employee is not answered by that employee.** The reply comes from the same general assistant, with no access to the employee's memory. The only difference is that the cost is charged to the employee. The page still says "answers from what it knows".
3. **A conversation at a level is shared.** Everyone who talks at the same level and with the same employee writes into one conversation, and every person's message is drawn as "your" bubble.

Throughout, "the dock" means the conversation panel. It is in `ConversationDock.tsx`, sits beside the org chart and is scoped to whatever is selected.

---

## ORG: the organisation and the home screen

### ORG-01 Arrive with no organisation (first run)
- **Who:** the first person signed in to a fresh Endgame (owner-to-be).
- **Starts at:** `/` (home).
- **Needs:** signed in. No organisation exists anywhere on the platform, and this person has no membership.
- **Level:** Foundation · **Learn first:** ID-01 · **What you learn:** everything you make lives under one organisation, and you name it first.
- **Steps:**
  1. The person opens `/`. While the tree loads, home shows skeletons (screen-reader label "Loading the organisation").
  2. `GET /api/tree` answers 200 with `organisation: null`, empty `divisions` and `needsYou`, and `firstRun: true`. That is a real empty answer, not an error.
  3. Home shows a dark band with the Endgame mark:
     - the heading "Name your organisation, then describe your first idea.";
     - the text "Everything you make lives under it. Endgame researches the idea first, tells you plainly whether it is worth building, then builds and runs it.";
     - a white button, "Start".
  4. The header shows only the "Endgame" wordmark, the "Normal" / "Technical" toggle, your account and "Sign out". There is no breadcrumb, conversation, bell or credits pill: those appear only once the person has an organisation.
  5. Pressing "Start" goes to `/start` (ORG-02).
- **You know it worked when:** you see the heading "Name your organisation, then describe your first idea." and a "Start" button.
- **Variations and refusals:** a FrostAura operator with no organisation sees the God-mode panel instead (ORG-17).
- **Where:** `features/home/HomeView.tsx` (`FirstRun`); `GET /api/tree` (`TreeEndpoints.cs`, `ReadModels.FirstRun`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `HomeView.test.tsx`: "leads a first run to Start"
  - `TreeEndpointTests.First_run_tree_is_empty_not_an_error_and_naming_the_organisation_makes_the_caller_its_owner`
  - `console.spec.ts`: "first run: name the organisation…"

### ORG-02 Name the first organisation, together with the first idea
- **Who:** the first person on a fresh platform.
- **Starts at:** `/start`, reached from "Start" in ORG-01.
- **Needs:** no organisation exists anywhere on the platform (`AccountService.IsFirstRunAsync`).
- **Level:** Foundation · **Learn first:** ORG-01 · **What you learn:** the organisation's name becomes its address, and naming it makes you its Owner.
- **Steps:**
  1. The breadcrumb reads "Start". The heading is "What do you want to build?" with "Describe it the way you would to a friend. Endgame researches it first, tells you plainly whether it is worth building, then builds and runs it."
  2. Because this is a first run, a field labelled "Your organisation" appears. Its hint reads "Everything you make lives under this name. Its apps appear at {host}/{slug}.", where the host is the address the console is open at. The slug is worked out from the name as you type; before anything is typed it shows "your-name".
  3. The person types the organisation's name, then fills in "The idea" (a text area). They can toggle any of the constraint chips ("Members sign in", "Works on a phone", "Sends email", "Uses AI inside the app", "Receives data from a device") and add "Anything else, in your own words".
  4. Once the idea reaches 12 characters, the panel "Research comes first" fetches an estimate (`POST /api/ideas/estimate`, free) and shows "Estimated {credits}".
  5. The person presses "Research this idea". While it works, the button reads "Starting research…".
  6. The console first calls `POST /api/organisations {name, slug}`. The control plane validates the slug, checks it against reserved names, creates the organisation, makes the caller its Owner, and adds the standing Security reviewer employee. It then calls `POST /api/ideas`.
  7. The browser goes to the research run at `/runs/{id}`. From here on it is the ideas and runs flows (RUN-01).
- **You know it worked when:** you land on the research run's page, and the header gains the organisation's name and the credits pill.
- **Variations and refusals:**
  - Name hint in red: "Use at least two letters or digits." The button stays disabled.
  - A reserved name (for example `www`, `api`, `admin`, `operator`) is not checked in the browser. The server refuses it with "'{slug}' is reserved and cannot name an organisation." The page shows "Research did not start: {reason} Nothing was charged."
  - The estimate fails: "The estimate could not be worked out: {reason} Research cannot start until it is shown." The button stays disabled.
  - The slug is already taken: 409 "An organisation is already called '{slug}'."
  - If the organisation is created but the idea then fails, the organisation is kept. On the next attempt the session already has an organisation, so only the idea is sent (inferred from `firstRun` being derived from `me`).
  - There is no separate "just name the organisation" form. An organisation can only be named together with a first idea.
- **Where:** `features/start/StartView.tsx`; `POST /api/organisations`, `POST /api/ideas/estimate`, `POST /api/ideas`; `TreeService.CreateOrganisationAsync`; `SlugRules`.
- **Reachable from:** UI.
- **Covered by tests:**
  - `console.spec.ts`: "first run: name the organisation, see the estimate, research…"
  - `TreeEndpointTests` (first run)
  - `BreadthTests.Organisation_names_that_frostaura_uses_are_refused_and_an_incomplete_zone_pauses_new_names`

### ORG-03 Arrive with no organisation once one already exists (refused self-sign-up)
- **Who:** a signed-in person with no role anywhere, after the platform's first organisation exists.
- **Starts at:** `/`.
- **Needs:** at least one organisation exists; this person holds no membership.
- **Level:** Foundation · **Learn first:** ORG-01 · **What you learn:** organisations are provisioned by FrostAura; there is no self-sign-up.
- **Steps:**
  1. `GET /api/tree` answers `organisation: null` with `firstRun: false`: an organisation already exists, so this person may not name one.
  2. Home shows **"Organisations are set up by FrostAura"** and "You are signed in as {email}, but you hold no role in any organisation yet, and an organisation cannot be started here. FrostAura sets one up for each person it invites. If you were invited, sign in with the invitation code you were sent; if someone already works here, ask them to give you a role." There is no "Start".
- **You know it worked when:** the panel above appears instead of the first-run band.
- **Variations and refusals:**
  - Typing `/start` gives the same answer: "Organisations are set up by FrostAura" and "An idea lives in an organisation, and you hold no role in one yet. FrostAura sets one up for each person it invites; if someone already works here, ask them to give you a role.", with "Back to the org chart". There is no form.
  - Naming an organisation through the API is refused with 403 "Organisations are provisioned by FrostAura; there is no self-serve sign-up."
  - An older control plane that sends no `firstRun` is read as a first run, as before.
- **Where:** `HomeView.tsx` (`NotInvited`), `StartView.tsx`; `GET /api/tree` (`ReadModels.FirstRun`, `AccountService.IsFirstRunAsync`), `POST /api/organisations`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` "does not offer a first organisation to someone who can never name one"; `StartView.test.tsx` "says organisations are set up by FrostAura, instead of a form that can never start"; `ScreensAndRolesTests.Someone_with_no_role_is_offered_the_first_organisation_only_on_a_first_run`; `AuthorizationMatrixTests` covers the endpoint's refusal.

### ORG-04 Read the organisation band and the header
- **Who:** any member (Owner, Admin, Builder, Viewer); an operator who has entered the organisation.
- **Starts at:** `/`.
- **Needs:** an organisation exists and the person holds a role in it.
- **Level:** Foundation · **Learn first:** ORG-02 · **What you learn:** the band totals the whole organisation and is live.
- **Steps:**
  1. The header shows:
     - the mark and "Endgame";
     - the breadcrumb "{organisation} / Whole organisation";
     - the "Normal" / "Technical" toggle;
     - the organisation switcher, for someone in two or more organisations (ID-09);
     - the credits pill "{n} credits left", which links to `/credits` and polls every 30 seconds;
     - the bell (NOTE-01);
     - "Your account" (a person icon, ID-09);
     - "Sign out".

     There is also a hidden "Skip to the content" link for keyboard users.
  2. The band shows:
     - the eyebrow "Organisation";
     - the organisation's name as a large button (selects the whole organisation, ORG-07);
     - a summary line built by the server, "{n} divisions · {n} projects · {n} apps · {n} employees";
     - chips for any employee placed at organisation level (for example the standing Security reviewer), each "{Name} · {Role}" and "— {activity}" when it is working;
     - four figures: "{n} division(s)", "{n} app(s)", "{n} employee(s)", "{n} credits this month";
     - a white "New idea" button, which goes to `/start`.
  3. Every 15 seconds the tree is fetched again while the tab is in focus, so status, spend and who is working stay live.
- **You know it worked when:** the band shows your organisation's name and its four figures.
- **Variations and refusals:**
  - The credits pill turns amber when the balance is at or below zero.
  - "Balance unavailable" appears if the credits read fails, as it does for someone with no role at the organisation itself.
  - Someone whose role is only on part of the tree sees no organisation-level worker chips, and spend summed from the divisions they can see (ORG-19).
  - The summary line's employee count is for the whole organisation, but the "employees" figure counts only the employees visible in the tree. For a person who sees only part of the tree, the two can disagree.
- **Where:** `HomeView.tsx` (`Organisation`), `shell/AppShell.tsx`, `treeModel.ts` (`orgFigures`, `countTree`); `GET /api/tree`, `GET /api/credits`.
- **Reachable from:** UI.
- **Covered by tests:**
  - `HomeView.test.tsx`: "draws the org chart with live status, spend and people from the API"
  - `console.spec.ts`: "shows the tree from the API…", "the header is at most two rows…"
  - `TreeEndpointTests.The_tree_document_carries_every_level_with_real_zero_spend_and_workers`

### ORG-05 Read "needs you" and follow a card to its subject
- **Who:** any member. Items are limited to what the person's role covers.
- **Starts at:** `/`, the strip under the band.
- **Needs:** an organisation exists.
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** anything waiting on a person surfaces here, and each card leads to where you act on it.
- **Steps:**
  1. Under the band, a grid of cards appears. Each card has a badge, a headline and one line. There are four kinds:

     | Kind | Badge | Headline | Line | Goes to |
     | --- | --- | --- | --- | --- |
     | Verdict | "Verdict waiting" | "Research says build \| change \| do not build “{title}”" | first meaningful sentence of the verdict summary, or else "Read it, then decide." (for do-not-build, "Read it, or overrule.") | `/ideas/{id}` |
     | Approval | "Approval needed" | the approval's title, for example "Start researching an idea: …?" | the detail, or "It waits until you answer." | `/runs/{runId}` |
     | Hire | "Hire proposed" | "Hire {Name} as {Role}?" | "About {credits} a month. {reason}" | `/hires/{id}` |
     | Idle employee | "Nothing to do" | "{Name} has had no work for {n} days" | "Keep them on, give them work, or release them; released employees keep their memory archived." | `/employees/{id}` |

  2. The person selects a card and is taken to that page (other areas).
- **You know it worked when:** the card's subject page opens.
- **Variations and refusals:**
  - With nothing waiting, the strip shows "Nothing needs you right now: no verdict, approval or hire is waiting, and no one is idle." — exactly the four kinds it checks. Budgets are told in notifications (NOTE).
  - Someone with a role on only part of the tree sees only items on the nodes they can see.
- **Where:** `HomeView.tsx` (`NeedsYouStrip`, `needHref`), `needsYouModel.ts`; `GET /api/tree` (`needsYou`; `ReadModels.NeedsYouAsync`, `WorkforceNeedsAsync`).
- **Reachable from:** UI. MCP `tree_get` returns the same list.
- **Covered by tests:**
  - `HomeView.test.tsx`: "says a verdict waiting in a headline and one line…", "claims only what it checks when nothing needs you"
  - `breadth.spec.ts`: "a needs-you card is a headline and one line"
  - `workforce.spec.ts`: "employees and contractors on their nodes, hires and idle employees in needs you…", "a proposal is read from needs you and accepted…"

### ORG-06 Use the shortcut row for the selected level
- **Who:** depends on the link (below).
- **Starts at:** `/`, the row of soft buttons below "needs you" (`nav` "Manage").
- **Needs:** an organisation exists.
- **Level:** Core · **Learn first:** ORG-07 · **What you learn:** the links follow the selection, so each one opens that screen for the level you chose.
- **Steps:** the person selects a level (ORG-07); the row rebuilds for it. Possible links:
  - "Manage": always. Goes to `/tree?scope={path}` (TREE-13).
  - "Autonomy for {level name}": always. Goes to `/autonomy?scope={path}`.
  - "Hiring": always. Goes to `/hires?scope={path}`.
  - "Ideas from your portfolio": only when the whole organisation or a division is selected. Goes to `/suggestions?scope={path}`.
  - "People": Admin, Owner or operator. Goes to `/people?scope={path}`.
  - "AI assistants" (reads "MCP access" in technical mode): always. Goes to `/assistants`, which is not scoped to the level.
  - "Secrets for {level name}": Admin, Owner or operator. Goes to `/secrets?scope={path}`.
  - "Operator access": Owner only. Goes to `/operator-access`.
  - "{employee}’s record and memory": only when an employee is selected, and then first in the row. Goes to `/employees/{id}`. The other links use the level the employee sits on.
- **You know it worked when:** the destination opens, already scoped to the level you chose (its own heading names it).
- **Variations and refusals:** Viewers and Builders still see "Manage", "Autonomy" and "Hiring". Whether they can change anything there is decided on those screens.
- **Where:** `HomeView.tsx` (`ManageLinks`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "offers the Owner the selection's secrets and the operator log", "shows an Admin the secrets but not the operator log, and a Builder neither".

### ORG-07 Select a level, and go back up with the breadcrumb
- **Who:** any member.
- **Starts at:** `/`.
- **Needs:** at least one division exists (otherwise there is nothing to select and no conversation).
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** the selection is "where you are": the breadcrumb, the conversation and the shortcuts all follow it.
- **Steps:**
  1. On load, the selection is the whole organisation. The breadcrumb reads "{organisation} / Whole organisation" and the conversation "Talking to {organisation}".
  2. The person selects one of:
     - a division header (the letter badge and name);
     - a project card's name;
     - an employee chip (on the band, a division or a project).

     The selected card gains a blue ring; an employee chip gains a violet ring.
  3. The breadcrumb becomes the trail, for example "Northwind / Technologies / Court booking". Every step except the last is a button that selects that level in place.
  4. The conversation re-scopes and fetches that level's history (TALK-01 to TALK-05). The shortcut row rebuilds (ORG-06).
  5. To return to everything, the person selects the organisation name in the band or the first breadcrumb step. The conversation's hint says "Select the organisation band to talk to everything again."
- **You know it worked when:** the breadcrumb's last step and the conversation heading "Talking to {name}" both show what you selected.
- **Variations and refusals:**
  - **An app cannot be selected.** App rows are links to the app page (ORG-10), so the conversation is never scoped to an app from home. **Spec mismatch:** the spec says the conversation can be scoped to "an app" and that "Selecting a node opens it". Selecting a division or project only re-scopes; each has its "Manage" link instead (TREE-13).
  - On a phone, the breadcrumb shows only its last two steps after "…".
  - A selection that no longer exists in the tree resets to where home starts.
  - An employee chip shown on a project card can belong to one of its apps, but the selection made is the project plus that employee.
- **Where:** `HomeView.tsx` (`crumbsFor`), `OrgChart.tsx`, `shell/AppShell.tsx` (`Breadcrumb`), `store/uiSlice.ts` (`selected`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `HomeView.test.tsx`: "scopes the breadcrumb and the conversation to the selected node, and streams the reply"
  - `console.spec.ts`: "shows the tree from the API, and selection scopes the breadcrumb and the conversation"

### ORG-08 Read a division on the chart
- **Who:** any member who can see the division.
- **Starts at:** `/`, the "The organisation" tab.
- **Needs:** at least one division.
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** a division groups projects, and its spend is the sum beneath it.
- **Steps:** each division is a column. It shows:
  - a letter badge in that division's colour (blue, then violet, then teal, repeating);
  - "Division" and its name; divisions are ordered by name;
  - this month's spend as a badge, and "Manage" (TREE-13);
  - its own employees as chips;
  - a wire down to its projects. When anything beneath it is working, a dot travels down the wire. A lone division takes the full width, with its projects side by side.

  After the last division, Admins and the Owner see the tile "Add a division" (TREE-02).
- **You know it worked when:** the column shows its name and spend.
- **Variations and refusals:**
  - With no projects: "No projects in {division} yet."
  - An archived division is drawn with a dashed header and the badge "Archived" (TREE-07).
  - A division the person holds no role in, shown only on the way to their own level, cannot be selected and has no "Manage" (ORG-19).
- **Where:** `OrgChart.tsx` (`DivisionColumn`); `ReadModels.TreeAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` ("draws the org chart…"); `OrgChart.test.tsx`.

### ORG-09 Read a project card and watch its work
- **Who:** any member who can see the project.
- **Starts at:** `/`.
- **Needs:** a project exists.
- **Level:** Foundation · **Learn first:** ORG-08 · **What you learn:** a project shows what stage its work is at and how far through it is, against the estimate.
- **Steps:**
  1. The card shows its name (a selection button) and "Manage".
  2. A stage chip appears unless the project is live with apps. The stages the server sends are "Researching", "Reviewing", "Building", "Planning", "Live" and "Paused".
  3. The card shows "{credits} this month" and an optional note: "Waiting for your approval.", "Work here is paused.", "The last piece of work failed." or "Archived.". A live project with apps has no chip at all.
  4. If work is under way: "{stage}, step {x} of {y}", then "{spent} of an estimated {estimate}" (or "{spent} so far" when there is no estimate), a moving progress bar, and the link "Watch the work", which goes to `/runs/{id}`.
  5. Below that: its apps (ORG-10) and its people (ORG-11).
- **You know it worked when:** "Watch the work" opens the live run.
- **Variations and refusals:**
  - An archived project is a dashed card with the badge "Archived" in place of its stage.
  - Dead branches in the UI: the "verdict" stage (a dashed amber card, "Idea · paused at verdict", "Read the verdict") is never sent by `ReadModels.ProjectStage`, and neither are "idea", "evaluating", "publishing" or "dropped". Research does not make a project at all: an idea is placed in the tree only when it is built (TREE-01).
- **Where:** `OrgChart.tsx` (`ProjectCard`), `treeModel.ts` (`stageChip`); `ReadModels.ProjectStage`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` ("draws the org chart…").

### ORG-10 Read an app row and open the app
- **Who:** any member who can see the app.
- **Starts at:** `/`, inside a project card.
- **Needs:** an app exists.
- **Level:** Foundation · **Learn first:** ORG-09 · **What you learn:** each app shows its health, whether it is awake, who may open it, and what it costs.
- **Steps:**
  1. The row shows:
     - the app's name with an app icon (a link);
     - a health chip: "Healthy", "Struggling", "Down" or "Health unknown";
     - a running chip: "Always on", "Awake", "Asleep", "Waking" or "Paused";
     - an access chip: "Public", "Shared with {n}", "Shared" or "Private";
     - "{n} visits today" (or "{time ago} last visit", or "Not measured yet" when nothing has been measured);
     - "{n} credits this month".
  2. Selecting the name opens `/apps/{id}` (APP-01).
- **You know it worked when:** the app page opens.
- **Variations and refusals:** an app paused by overdraft or an exhausted budget shows "Paused" and "Health unknown". An archived app shows the single chip "Archived" (TREE-08).
- **Where:** `OrgChart.tsx` (`AppRow`), `treeModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`; `OrgChart.test.tsx`; `console.spec.ts` ("an app that has measured nothing yet says so, never zero").

### ORG-11 Read the workforce on the chart
- **Who:** any member.
- **Starts at:** `/`.
- **Needs:** employees or contractors exist.
- **Level:** Foundation · **Learn first:** ORG-08 · **What you learn:** employees are named and lasting; contractors are a passing burst.
- **Steps:**
  1. Each employee appears as a chip, "{Name} · {Role}" (or just the name when the name is the role), with these badges where they apply:
     - "Paused";
     - "Nothing to do" (idle past `workforce.idle_days`).

     Hovering shows the activity.
  2. Under the chips, working employees get a typing line, "{Name}: {activity}".
  3. Contractors appear as one dashed spinning line: "{n} contractor(s) · {activity}".
  4. Selecting an employee chip scopes the conversation to that employee (TALK-05).
- **You know it worked when:** a working employee shows animated dots and their activity.
- **Variations and refusals:** none further.
- **Where:** `OrgChart.tsx` (`Workers`, `WorkerChip`), `treeModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts`: "employees and contractors on their nodes…".

### ORG-12 An empty organisation (no divisions yet)
- **Who:** the Owner after naming the organisation, before anything is placed.
- **Starts at:** `/`.
- **Needs:** an organisation with zero divisions.
- **Level:** Foundation · **Learn first:** ORG-02 · **What you learn:** the tree fills itself from ideas, or from Manage; you never have to draw it.
- **Steps:**
  1. Home shows the band and "needs you". In place of the chart, a dashed panel shows "{organisation} has nothing in it yet", "Describe an idea and Endgame researches it, suggests a division and a name for it, and builds it once you agree.", and the button "Describe your first idea", which goes to `/start`.
  2. No conversation is shown: it needs at least one division.
- **You know it worked when:** you see "{organisation} has nothing in it yet".
- **Variations and refusals:**
  - An Admin can also add the first division by hand from "Manage" in the shortcut row (TREE-02).
  - **Finding:** with no divisions, there is no conversation even at organisation level, though the conversation could start an idea there.
- **Where:** `HomeView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "says plainly when an organisation is genuinely empty"; `console.spec.ts`: "an empty organisation says so and leads to a first idea".

### ORG-13 Home keeps itself live, and says when a refresh fails
- **Who:** any member.
- **Starts at:** `/`.
- **Needs:** the tree loaded once.
- **Level:** Core · **Learn first:** ORG-04 · **What you learn:** a failed refresh keeps the last good picture and says so.
- **Steps:**
  1. While the tab is in focus, the tree is read again every 15 seconds.
  2. If a refresh fails after a good load, a notice appears above the chart: "The latest refresh failed: {reason} What you see is from the last one that worked." The chart below stays.
- **You know it worked when:** the amber notice appears while the chart stays drawn.
- **Variations and refusals:** see SYS-10 for a failed first load.
- **Where:** `HomeView.tsx`, `components/states.tsx` (`Stale`), `lib/queryState.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` covers the failed first load; no home-specific stale test found.

### ORG-14 Rename the organisation
- **Who:** the Owner.
- **Starts at:** "Manage" on the shortcut row with the whole organisation selected, which opens `/tree?scope={organisation}`. Also `PATCH /api/organisations/{id} {name}`.
- **Needs:** Owner.
- **Level:** Core · **Learn first:** TREE-13 · **What you learn:** the organisation's name can change; its address (and every app's) does not.
- **Steps:**
  1. "Manage" opens with the organisation chosen. Under **"Its name"**, the field **"Name"** holds the current name, with the hint "Its address stays {slug}: an address never changes once it is made."
  2. Type the new name and press **"Save the name"**: "It is called {name} now."
  3. The band, the breadcrumb and the header follow the new name.
- **You know it worked when:** the organisation band shows the new name.
- **Variations and refusals:**
  - Anyone but the Owner reads "The Owner renames the organisation." in place of the field.
  - Empty: "A name cannot be empty."; over 200 characters: "A name is at most 200 characters." Either way "Save the name" stays disabled.
  - MCP `node_update` refuses organisations with "An organisation is renamed by its Owner, through PATCH /api/organisations/{id} with a signed-in session; not with an assistant's key."
  - Suspending or reinstating is FrostAura's (ORG-15).
- **Where:** `features/tree/ManageView.tsx`, `NodeControls.tsx` (`RenameNode`, level organisation); `TreeEndpoints.MapNodeChanges`, `TreeService.UpdateAsync`.
- **Reachable from:** UI; API.
- **Covered by tests:** `ManageView.test.tsx` ("tells a Viewer who may change each thing…"); `AuthorizationMatrixTests`.

### ORG-15 Suspend or reinstate an organisation
- **Who:** FrostAura operator.
- **Starts at:** API only: `PATCH /api/organisations/{id} {status: "suspended" | "active"}`.
- **Needs:** operator; Owner-level access to the organisation's scope (operator entry).
- **Level:** Operator · **Learn first:** ORG-17 · **What you learn:** suspension is FrostAura's act; a suspended organisation's apps drop out of the routing table.
- **Steps:**
  1. Send the request. The organisation's status changes and the answer is the organisation as a node, with `status: "suspended"`. The routing table only includes apps in active organisations, so its apps stop being served at once.
- **You know it worked when:** the answer's `status` reads "suspended". (No console view shows this; not verified on God-mode screens.)
- **Variations and refusals:**
  - A non-operator, the Owner included: 403 "An organisation is suspended or reinstated by FrostAura."
  - Any other status: "'x' is not a status a organisation can have: use active, suspended."
- **Where:** `TreeEndpoints.MapNodeChanges`, `NodeStatuses`, `TreeService.RoutesAsync`.
- **Reachable from:** API only.
- **Covered by tests:** none found for suspension specifically.

### ORG-16 Delete the organisation
- **Who:** Owner.
- **Starts at:** API only: `DELETE /api/organisations/{id}`.
- **Needs:** Owner.
- **Level:** Developer · **Learn first:** ORG-14 · **What you learn:** anything with history attached cannot be deleted.
- **Steps:**
  1. Send the request. An organisation with anything attached is refused with 409; one with nothing attached is deleted with the cascade entries and grants set on it, and the answer is 204.
- **You know it worked when:** a 204 answer.
- **Variations and refusals:** any children, work or credit history gives 409 "'{path}' still has children, work or credit history attached. Archive it instead (status: archived)." An organisation archive status does not exist. **Not verified from code:** whether the standing Security reviewer, created with every organisation, always blocks this.
- **Where:** `TreeService.DeleteAsync`.
- **Reachable from:** API only.
- **Covered by tests:** none found for organisations.

### ORG-17 An operator with no organisation of their own lands in God mode
- **Who:** FrostAura operator.
- **Starts at:** `/`.
- **Needs:** operator; no membership.
- **Level:** Operator · **Learn first:** ID-02 · **What you learn:** an operator works across organisations, and every entry is logged where that organisation's Owner can read it.
- **Steps:**
  1. A coral band "God mode" sits above the header on every screen: "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it." with the link "Every organisation".
  2. Home shows the panel "God mode", "You run Endgame for FrostAura. Every organisation is one step away.", and "List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation’s Owner can read it."
  3. The button "Every organisation" goes to `/operator` (OP-01).
- **You know it worked when:** the coral "God mode" band is visible.
- **Variations and refusals:** an operator who holds a role in an organisation (FrostAura's own, where top-up requests reach them) lands on that organisation's home instead, under the same band.
- **Where:** `HomeView.tsx` (`OperatorHome`), `shell/GodModeBand.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `breadth.spec.ts`: "is marked on every screen, lists every organisation, enters one and says it is logged".

### ORG-18 An operator reads an entered organisation's home
- **Who:** FrostAura operator.
- **Starts at:** `/?organisation={slug}`, reached from the God-mode screen.
- **Needs:** operator.
- **Level:** Operator · **Learn first:** ORG-17 · **What you learn:** reading another organisation's tree is itself a logged entry.
- **Steps:**
  1. `GET /api/tree?organisation={slug}`. The control plane records an operator entry (as Admin) and returns that organisation's tree.
  2. The band reads "You are inside {Name} as a FrostAura operator, acting as an Admin. Your entry and everything you change here are logged where its Owner can read them.", with "Leave {Name}" (SHL-05).
  3. Everything else is as ORG-04 to ORG-11, with Admin shortcuts ("People", "Secrets for …"). The header's balance and bell are the entered organisation's.
  4. The organisation is remembered for the tab: home without `?organisation=`, and every other screen, keep showing it until the operator leaves.
- **You know it worked when:** the coral band names the organisation you are inside.
- **Variations and refusals:**
  - An unknown slug: 404 "The organisation '{slug}' was not found, or you cannot see it.", shown once as "The organisation could not be loaded".
  - A non-operator who adds `?organisation=` is ignored: they read their own organisation.
- **Where:** `HomeView.tsx`, `GodModeBand.tsx`, `AppShell.tsx`, `lib/useActiveOrganisation.ts`; `GET /api/tree` (`AccessService.OperatorEntryAsync`).
- **Reachable from:** UI.
- **Covered by tests:** `FinalDefectsTests.Entering_an_organisation_and_then_reading_it_is_one_logged_entry`; `GodModeBand.test.tsx`; `HomeView.test.tsx` "tells an operator once that an organisation named in the address does not exist, never asking again and again"; `breadth.spec.ts` "is marked on every screen, lists every organisation, enters one and says it is logged".

### ORG-19 A person granted only part of the tree uses home
- **Who:** an Admin, Builder or Viewer whose grant is on a division, project or app, not the organisation.
- **Starts at:** `/`.
- **Needs:** such a grant.
- **Level:** Advanced · **Learn first:** ORG-07 · **What you learn:** you see your branch and the path to it, nothing else.
- **Steps:**
  1. The tree shows only their branch and its ancestors. The band shows no organisation-level workers, its spend is summed from what they can see, and "needs you" holds only what their grant covers. Each node carries their role there; the organisation's is null.
  2. Home starts at the highest level they hold a role at — their division, else their project, else their app — so the conversation asks there (`GET /api/conversations?scope={their level}`) and the breadcrumb starts "{organisation} / {their level}".
  3. The levels above their grant are names on the way down: the organisation in the breadcrumb is not a button, and the organisation's name in the band takes them back to their own level.
  4. "Who works on what" and "How data flows" ask at the level selected (`GET /api/ontology?scope={selection}`), never at the organisation.
- **You know it worked when:** the conversation heading reads "Talking to {their level}" with no error, and both graph tabs draw.
- **Variations and refusals:** someone with grants in two divisions starts at the first; selecting the other works too. The credits pill reads "Balance unavailable": the balance is the organisation's, read at a level they hold no role at.
- **Where:** `HomeView.tsx` (`homeSelection`, `selectable`), `lib/roles.ts` (`roleInTree`), `ConversationDock.tsx`, `OntologyView.tsx`; `GET /api/tree` (each node's `role`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` "starts someone granted only a division at that division, and asks the conversation and the graphs there"; `ScreensAndRolesTests.The_tree_carries_each_nodes_effective_role_and_archived_levels_are_marked_and_not_served`; `TreeEndpointTests` / `AuthorizationMatrixTests`.

---

## TREE: divisions, projects and apps as nodes

**What is and is not possible.** The console reads nodes on the org chart (ORG-08 to ORG-10) and manages them on **"Manage"** (`/tree?scope=`): create, rename, describe, archive, reactivate and delete. The factory also creates them when it places a built idea (TREE-01). Moving is not possible by any route (TREE-10). Other screens set autonomy, rule sets, budgets, secrets and app settings.

The cascade carries six kinds of value: `permission`, `secret`, `budget`, `rule_set`, `context`, `setting`.
- A value set at a node applies to everything beneath it unless something lower narrows or overrides it.
- Reading a value returns it with the level that set it.
- Removing a value lets the inherited one apply again.
- To set one you need: Builder for `context` and `sleep.*`; Owner for `overdraft_own_limit`; Admin for everything else.

### TREE-01 Create a division by letting the factory place an idea
- **Who:** Owner, Admin or Builder (whoever can start an idea and decide to build).
- **Starts at:** `/start` ("New idea" on home), the conversation at organisation level (TALK-07), or "Ideas from your portfolio".
- **Needs:** an organisation; a "build" decision on a verdict (VERD-03).
- **Level:** Core · **Learn first:** ORG-02, VERD-03 · **What you learn:** you need not draw divisions; Endgame places each built idea into one, creating the division if needed.
- **Steps:**
  1. On `/start`, "Where it goes" is left at "The whole of {organisation}" (its hint: "Endgame suggests a division for it once it is researched."). The person describes the idea and presses "Research this idea".
  2. Research reaches its verdict. A build verdict proposes a placement — division, project and app — shown as "Suggested home: {name}".
  3. The build starts ("Build it", or on its own in auto mode). Its placement step (`BuildWorkflow.PlaceAsync`) works out where it goes:
     - if the idea was raised at a division, it uses that division;
     - otherwise it uses research's proposed division slug, defaulting to `labs`;
     - it creates the division if missing (`POST /internal/tree/nodes`), then the project (named after the proposal, or the idea's first line), then an app (slug from the proposal, default `web`).
  4. The run's log says "{name} will live in a new division, {Division}, as the project {project}." (or "will live in {Division}…" when the division existed).
  5. Within 15 seconds, home shows the new division column with the project card.
- **You know it worked when:** a new division column appears on the chart.
- **Variations and refusals:**
  - To choose the division yourself, pick it in "Where it goes" (TREE-05), or make it first on "Manage" (TREE-02).
  - A concurrent placement with the same slug reuses the existing node.
  - A new division can raise a hire proposal (HIRE-01).
- **Where:** `features/start/StartView.tsx`; `Runner/Workflows/BuildWorkflow.cs` (`PlaceAsync`); `FactoryEndpoints` `POST /internal/tree/nodes`; `TreeService.EnsureChildAsync`.
- **Reachable from:** UI (indirectly, through an idea).
- **Covered by tests:** `WorkflowTests.A_new_division_and_a_recurring_job_raise_their_hires_and_a_waiting_hire_never_stops_the_work`; factory tests.

### TREE-02 Create a division directly
- **Who:** Admin or Owner at the organisation.
- **Starts at:** the org chart's **"Add a division"** tile (Admins only), which opens `/tree?scope={organisation}&add=1`; or "Manage", the organisation chosen, **"Add a division"**. Also API `POST /api/divisions {parent, name, slug}` and MCP `node_create`.
- **Needs:** Admin at the organisation.
- **Level:** Core · **Learn first:** ORG-07, TREE-13 · **What you learn:** a node's address is made from its name once, when it is made, and never changes.
- **Steps:**
  1. On the chart, after the last division, the dashed tile **"Add a division"**.
  2. It opens "Manage" with the organisation chosen and the form "A new division in {organisation}" open, with **"Name"** and **"Its address"**.
  3. Type the name. "Its address" fills itself from it (`Field Trips` → `field-trips`); its hint reads "{organisation}/{slug}. It cannot be changed once it is made." You may change the address before pressing the button.
  4. Press **"Add the division"**. The new division is listed in "Every part of the organisation" and chosen.
  5. On its next refresh the org chart shows its column: "No projects in {name} yet."
- **You know it worked when:** the division appears in "Every part of the organisation" and is chosen.
- **Variations and refusals:**
  - An address that is not one: "Use 2 to 40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit." The button stays disabled.
  - Over 200 characters: "A name is at most 200 characters."
  - Server refusals are shown as "The division was not made: {reason} Nothing changed.", for example 409 "A sibling already uses that slug."
  - **"Not now"** closes the form.
  - Below Admin the panel reads "An Admin or above adds a division here." and the chart shows no tile.
- **Where:** `features/tree/ManageView.tsx`, `NodeControls.tsx` (`CreateChild`); `home/OrgChart.tsx`; `TreeEndpoints` `/divisions`; `TreeService.CreateChildAsync`.
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `ManageView.test.tsx` ("adds a division with its address made from the name…", "refuses an address that is not one…"); `OrgChart.test.tsx`; `tests-e2e/manage.spec.ts` ("an Admin adds a division from the chart…"); `CascadeCreditsAndAppsTests.The_tree_refuses_bad_slugs_duplicate_siblings_and_deleting_what_has_children`; `AuthorizationMatrixTests`.

### TREE-03 Create a project directly
- **Who:** Builder or above at the division.
- **Starts at:** the division's "Manage" on the chart, or "Manage" with the division chosen, **"Add a project"**. Also API `POST /api/projects` and MCP `node_create`.
- **Needs:** Builder at the division.
- **Level:** Core · **Learn first:** TREE-02 · **What you learn:** a project is always under exactly one division.
- **Steps:**
  1. The division's "Manage" link opens "Manage" with the division chosen.
  2. Press **"Add a project"**: the form "A new project in {division}".
  3. Type the name; "Its address" fills itself ("{division path}/{slug}").
  4. Press **"Add the project"**. It is listed under its division in the outline, and chosen.
  5. On the chart it is a card in its division with the stage chip "Planning".
- **You know it worked when:** the project is chosen in the outline and appears under "What is in it" of its division.
- **Variations and refusals:** as TREE-02. Below Builder: "A Builder or above adds a project here."
- **Where:** as TREE-02 (group `/projects`).
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `ManageView.test.tsx`; `acceptance.spec.ts` step 2; `AuthorizationMatrixTests`.

### TREE-04 Create an app node directly
- **Who:** Builder or above at the project.
- **Starts at:** "Manage" with the project chosen, **"Add an app"**. Also API `POST /api/apps` and MCP `node_create`.
- **Needs:** Builder at the project.
- **Level:** Advanced · **Learn first:** TREE-03 · **What you learn:** an app node exists before anything is built into it, and it is the deepest level.
- **Steps:**
  1. Choose the project in the outline.
  2. Press **"Add an app"**: the form "A new app in {project}".
  3. Type the name; "Its address" fills itself.
  4. Press **"Add the app"**. The app is chosen, with the link **"The app’s page"**. It starts as a draft.
  5. Its page says "Not published yet." Building it is the factory's work.
- **You know it worked when:** the app is chosen in the outline with **"The app’s page"** link.
- **Variations and refusals:** an app has no "What is in it" and nothing is added beneath it. Below Builder: "A Builder or above adds an app here."
- **Where:** as TREE-02 (group `/apps`).
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `acceptance.spec.ts` steps 2–3; `ManageView.test.tsx` (role rules).

### TREE-05 Put new work into an existing division
- **Who:** Builder or above at the division.
- **Starts at:** "New idea" on home (`/start`), **"Where it goes"**. Also the conversation with the division selected (TALK-07), or "Ideas from your portfolio".
- **Needs:** the division exists and is active.
- **Level:** Core · **Learn first:** TREE-01, IDEA-01 · **What you learn:** an idea raised at a division is placed in that division.
- **Steps:**
  1. **"Where it goes"** lists "The whole of {organisation}" and each active division the person is a Builder or above in.
  2. Choose the division. The hint reads "It is researched for {division}, and built there if it is built."
  3. Describe the idea and press "Research this idea". The idea is recorded at that division, and the factory later places its project there.
- **You know it worked when:** the research run opens, and (after a build) the project appears in that division.
- **Variations and refusals:**
  - Archived divisions are not offered. If the divisions cannot be read: "The divisions could not be loaded, so for now it can only go to the whole organisation."
  - From the conversation with a project or app selected, the idea is raised at the division above (`/internal/ideas`).
- **Where:** `features/start/StartView.tsx`; `ConversationDock.tsx`; `StartIdeaTool`; `FactoryEndpoints` `POST /internal/ideas`; `BuildWorkflow.PlaceAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `StartView.test.tsx`; `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TREE-06 Rename a division, project or app
- **Who:** Admin for a division; Builder for a project or app.
- **Starts at:** "Manage" (`/tree?scope={path}`), panel **"Its name"**; for an app also its page, **"The app itself"** (APP-13). Also `PATCH /api/{divisions|projects|apps}/{id} {name}` and MCP `node_update`.
- **Needs:** the role above.
- **Level:** Core · **Learn first:** TREE-02 · **What you learn:** the display name can change; the address never does.
- **Steps:**
  1. The field **"Name"** holds the current name, with the hint "Its address stays {slug}: an address never changes once it is made."
  2. Type the new name and press **"Save the name"**. The outline shows it at once and "It is called {name} now." appears.
  3. The chart and the breadcrumb follow the new name.
- **You know it worked when:** the outline, the chart and the breadcrumb show the new name.
- **Variations and refusals:**
  - Empty: "A name cannot be empty."; over 200 characters: "A name is at most 200 characters."
  - Refused by the server: "The name was not changed: {reason} It is back to {old name}." and the old name returns.
  - Below the role: "An Admin or above renames a division." / "A Builder or above renames a project."
- **Where:** `features/tree/NodeControls.tsx` (`RenameNode`); `TreeEndpoints.MapNodeChanges`; `ControlPlaneTools` `node_update`.
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `ManageView.test.tsx` ("renames at once and puts the old name back…"); `tests-e2e/manage.spec.ts` ("renames a project…"); `CascadeCreditsAndAppsTests`.

### TREE-07 Archive or reactivate a division or project
- **Who:** Admin (division) or Builder (project).
- **Starts at:** "Manage" (`/tree?scope={path}`), panel **"Archive or delete"**. Also `PATCH … {status}` and MCP `node_update`.
- **Needs:** the role above.
- **Level:** Core · **Learn first:** TREE-06 · **What you learn:** anything with history is archived rather than deleted, and can come back.
- **Steps:**
  1. Press **"Archive {name}"**. The confirmation reads "Archive {name}?" and "It is marked archived and keeps its history, spending and people. None of its apps is served until it is reactivated."
  2. Press **"Yes, archive {name}"** ("Keep it active" cancels). "{name} is archived. Nothing in it was deleted." appears; the routing table is recalculated at once, and the outline marks it "Archived".
  3. On the org chart it is drawn archived: a dashed header or card with the badge "Archived".
  4. To bring it back, press **"Reactivate {name}"**: "{name} is active again." and its apps are served again.
- **You know it worked when:** the badge "Archived" shows, and its apps no longer answer.
- **Variations and refusals:**
  - Refused: "{name} was not archived: {reason} It is as it was."
  - Divisions and projects only accept "active" or "archived". The tree marks the node `archived: true`.
  - Below the role: "An Admin or above archives a division." / "A Builder or above archives a project."
- **Where:** `NodeControls.tsx` (`ArchiveNode`); `treeManage.ts` (`isArchived`); `OrgChart.tsx`; `TreeService.UpdateAsync`, `TreeService.RoutesAsync`; `TreeEndpoints.MapNodeChanges`.
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `ManageView.test.tsx` ("reactivates an archived division…"); `OrgChart.test.tsx`; `tests-e2e/manage.spec.ts`; `CascadeCreditsAndAppsTests`; `ScreensAndRolesTests.The_tree_carries_each_nodes_effective_role_and_archived_levels_are_marked_and_not_served`.

### TREE-08 Archive an app, or set an app's status by hand
- **Who:** Builder at the app.
- **Starts at:** "Manage" with the app chosen, or the app's page (**"The app itself"**), **"Archive {name}"**. API `PATCH /api/apps/{id} {status}`.
- **Needs:** Builder.
- **Level:** Core · **Learn first:** TREE-07 · **What you learn:** an archived app leaves the routing table; its code and data stay.
- **Steps:**
  1. Press **"Archive {name}"**. The confirmation says "It stops being served at its address. Its code, data and history are kept, and reactivating it brings it back."
  2. Press **"Yes, archive {name}"**: "{name} is archived. Nothing in it was deleted."
  3. The chart's app row shows the single chip "Archived".
  4. **"Reactivate {name}"** sets it to sleeping when it has been published (it wakes on its next visit), or back to a draft when it never was: "{name} is active again."
- **You know it worked when:** the row reads "Archived", or after reactivating its health and running chips return.
- **Variations and refusals:** the API still lets a Builder set any status by hand ("running", "failed"); the console only archives and reactivates.
- **Where:** `NodeControls.tsx` (`ArchiveNode`, `reactivatedStatus`); `TreeService.RoutesAsync`.
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `OrgChart.test.tsx`; `ManageView.test.tsx`.

### TREE-09 Delete a division, project or app
- **Who:** Admin.
- **Starts at:** "Manage" (`/tree?scope={path}`) or the app's page, **"Delete {name}"**. API `DELETE /api/{divisions|projects|apps}/{id}`.
- **Needs:** Admin; nothing attached to the node.
- **Level:** Advanced · **Learn first:** TREE-07 · **What you learn:** only an untouched node can be deleted; everything else is archived.
- **Steps:**
  1. Press **"Delete {name}"**. The confirmation reads "This cannot be undone. Only a {level} with nothing in it, no work and no spending can be deleted; the settings and roles set on it go with it."
  2. Press **"Yes, delete {name}"** ("Keep it" cancels). The node leaves the outline and its parent is chosen.
- **You know it worked when:** the node is gone from the outline and the chart.
- **Variations and refusals:**
  - Children, runs or credit entries: the server's 409 is shown as it came — "{name} was not deleted: '{path}' still has children, work or credit history attached. Archive it instead (status: archived). (409)" — with the button **"Archive it instead"**, which archives it: "{name} is archived instead. Nothing in it was deleted."
  - Below Admin: "An Admin or above deletes a {level} with nothing in it." MCP has no delete tool.
- **Where:** `NodeControls.tsx` (`DeleteNode`); `TreeService.DeleteAsync`.
- **Reachable from:** UI; API.
- **Covered by tests:** `ManageView.test.tsx` ("shows the refusal to delete what has history, and archives it instead"); `tests-e2e/manage.spec.ts`; `CascadeCreditsAndAppsTests`.

### TREE-10 Move a division, project or app
- **Who:** —
- **Starts at:** —
- **Needs:** —
- **Level:** — · **Learn first:** — · **What you learn:** —
- **Steps:** **Not supported by any route, on purpose.** A node's address is its parent's address plus its own slug, and every app's two addresses, every grant, secret, budget and setting are keyed by that path; moving one changes every address beneath it. No endpoint, MCP tool or screen changes a node's parent, and the console does not imitate one. Employees can be reassigned (EMP-02).
- **You know it worked when:** —
- **Variations and refusals:** to put work elsewhere, create the new node (TREE-02 to TREE-04) and archive the old one (TREE-07).
- **Where:** —
- **Reachable from:** nowhere.
- **Covered by tests:** —

### TREE-11 Describe a level: say what it is, for its work to read
- **Who:** read: anyone with a role there; add, change, remove: Builder or above.
- **Starts at:** "Manage" (`/tree?scope={path}`), the side panel **"What this is"**. Also API `PUT /api/cascade {scope, kind: "context", key, value}` and MCP `cascade_set`.
- **Needs:** Builder to write.
- **Level:** Core · **Learn first:** TREE-13 · **What you learn:** what you say at a level is read by everything beneath it unless a lower level says it differently.
- **Steps:**
  1. The panel reads "What {name} is, said once. Everything beneath it reads this, unless a lower level says it differently."
  2. Press **"Say something about {name}"**. Fill **"What it is about"** (hint "For example: Purpose, Audience, House style.") and **"What it says"**.
  3. Press **"Add it"**. It shows at once with the badge "Said here".
  4. An entry inherited from above shows "From {level name}"; **"Say it differently here"** replaces it at this level. An entry said here offers **"Change"** and **"Remove it"**.
- **You know it worked when:** the entry is listed with "Said here".
- **Variations and refusals:**
  - Empty: "Nothing is said about {name} yet, here or above it." (at the organisation: "Nothing is said about {name} yet.").
  - Refused: "{Label} was not saved: {reason} What was said before is back." and the entry goes back.
  - The label becomes the key (`House style` → `house-style`); technical mode shows the key itself.
  - Below Builder: "A Builder or above changes what is said here."
  - Failed read: "What this is could not be loaded".
- **Where:** `features/tree/ContextPanel.tsx`; `TreeEndpoints` `/cascade`; `CascadeService`.
- **Reachable from:** UI; API; MCP. The conversation cannot set it.
- **Covered by tests:** `ManageView.test.tsx` ("describes a level…", "adds what a level is at once, and takes it back…"); `tests-e2e/manage.spec.ts`; `CascadeCreditsAndAppsTests`.

### TREE-12 Read what applies at a level and what a lower level replaces, and remove a value set there
- **Who:** read: Viewer (Admin for secrets); remove: the role that sets it.
- **Starts at:** "Manage" (`/tree?scope={path}`), "What this is" and **"Said differently beneath it"**. Also `GET /api/cascade?scope=&kind=`, `GET /api/cascade/below?scope=&kind=`, `DELETE /api/cascade?scope=&kind=&key=`; MCP `cascade_get`, `cascade_remove`.
- **Needs:** a role at the scope.
- **Level:** Core · **Learn first:** TREE-11 · **What you learn:** each value says which level set it, and removing one brings the inherited one back.
- **Steps:**
  1. Each entry says "Said here" or "From {level}", and "Set {date}".
  2. "Said differently beneath it" lists what lower levels set, each with "{level} replaces it" (it replaces an entry that applies here) or "Only for {level}".
  3. **"Say it differently here"** on an inherited entry, then **"Save it"**: it is now "Said here", with "Replaces what {level} says".
  4. **"Remove it; {level}'s applies again"** (or "Remove it", when nothing is inherited) removes the entry set here; the inherited one shows again.
- **You know it worked when:** after removing, the entry from above is listed with "From {level}".
- **Variations and refusals:** "Nothing beneath {name} replaces or adds to this." · "What lower levels say could not be loaded" · removal refused: "It was not removed: {reason} It is still said here." `/cascade/below` refuses `permission` (roles are listed by `/api/members`) and never returns a secret's value.
- **Where:** `ContextPanel.tsx`; `TreeEndpoints` `/cascade`, `/cascade/below`; `CascadeService.BelowAsync`.
- **Reachable from:** UI (context; other kinds on their own screens); API; MCP.
- **Covered by tests:** `ManageView.test.tsx`; `CascadeCreditsAndAppsTests.What_a_lower_level_sets_is_listed_with_where_it_was_set_and_a_secret_value_never`; `AuthorizationMatrixTests`.

### TREE-13 Manage a division from the console
- **Who:** any member; each control is offered to the role that may use it.
- **Starts at:** `/`, the division's **"Manage"** link on its header (also on each project card, and "Manage" on the shortcut row), which opens `/tree?scope={path}`.
- **Needs:** a division.
- **Level:** Core · **Learn first:** ORG-06, ORG-07 · **What you learn:** everything about one level is managed from the page that takes it as its level.
- **Steps:**
  1. On the chart, a division's header has "Manage" (read out as "Manage {division}").
  2. It opens "Manage {organisation}". The outline "Every part of the organisation" lists the organisation, its divisions, projects and apps; archived ones are marked "Archived".
  3. The panel for the chosen part shows its level and parent ("Division in {organisation}"), its name, "Its address: {path}", and the badge "Active" or "Archived".
  4. "Its name" (TREE-06), and "What is in it", with **"Add a {level}"** (TREE-02 to TREE-04).
  5. "Archive or delete" (TREE-07 to TREE-09).
  6. Beside it, the side panel "What this is" (TREE-11, TREE-12).
  7. Autonomy, hiring, people and secrets stay on their own screens, from the shortcut row (ORG-06); budgets on `/credits`.
- **You know it worked when:** the panel shows the part chosen.
- **Variations and refusals:** each control is shown only to the role that may use it; anyone else reads who may. Loading draws skeletons; a failed read says "The organisation could not be loaded" with **"Try again"**; with no organisation: "There is no organisation to manage yet".
- **Where:** `features/tree/ManageView.tsx`; `home/OrgChart.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `ManageView.test.tsx`; `OrgChart.test.tsx`; `tests-e2e/manage.spec.ts`.

---

## ONT: "Who works on what" and "How data flows"

### ONT-01 Switch between the three views
- **Who:** any member.
- **Starts at:** `/`, the tab list "View" above the chart.
- **Needs:** at least one division.
- **Level:** Core · **Learn first:** ORG-08 · **What you learn:** the same organisation can be read as a chart, as responsibility, or as data.
- **Steps:**
  1. Above the chart, the tabs "The organisation" (the default), "Who works on what" and "How data flows".
  2. "Who works on what" swaps the panel for the responsibility graph (`GET /api/ontology?scope={selection}&view=org-chart`).
  3. "How data flows" swaps it for the data graph (`view=data-flow`).
- **You know it worked when:** the selected tab is raised and the panel changes.
- **Variations and refusals:** the choice is not remembered: it returns to "The organisation" on every visit.
- **Where:** `HomeView.tsx` (`ChartViews`).
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("…and the graph views").

### ONT-02 Read "Who works on what" (desktop)
- **Who:** any member.
- **Starts at:** `/`, tab "Who works on what".
- **Needs:** md width or wider for the drawing (ONT-04 otherwise).
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** who is responsible for what, and who reports to whom.
- **Steps:**
  1. While loading: a skeleton (label "Drawing the organisation").
  2. A key lists the edge types present: "Holds", "Works on", "Reports to". It ends with "Drag to move around. Generated {time}."
  3. A left-to-right layered drawing shows:
     - the organisation, then its divisions, projects and apps (linked by "holds");
     - employees and contractors one column beyond what they work on ("works on" with their role, and "now on {run}" while working, animated);
     - "reports to" dashed lines (including "briefed by");
     - members as "Person" nodes (works on, with their role);
     - secrets by name (held by the node that set them).
  4. Each node card shows its type ("Organisation", "Division", "Project", "App", "Employee", "Contractor", "Person", "Secret"), " · working" when working, and its name (cut at 26 characters).
  5. Hovering an edge shows a title like "{A} works on {B} ({label})".
  6. Dragging with the mouse pans the frame. The page itself never scrolls sideways.
- **You know it worked when:** you see your employees drawn beside what they work on.
- **Variations and refusals:** empty state "Nobody works on anything yet". **Finding:** in practice this is unreachable, because the "holds" edges from the organisation to its divisions always exist whenever this tab is shown. Secret names appear in normal mode.
- **Where:** `OntologyView.tsx`, `ontologyModel.ts` (`layoutGraph`); `GET /api/ontology` (`OntologyService.BuildAsync`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `OntologyView.test.tsx`: "draws who works on what, and lists it readably…", "lays things out left to right…"
  - `WorkforceTests.The_ontology_is_derived_from_the_tree_the_workforce_the_vault_and_what_each_app_used`

### ONT-03 Read "How data flows" (desktop)
- **Who:** as ONT-02.
- **Starts at:** `/`, tab "How data flows".
- **Needs:** as ONT-02.
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** which platform services each app relies on, and what travels in and out.
- **Steps:**
  1. The key shows "Relies on" and "Sends data to".
  2. The drawing shows apps, the platform services they have actually used, and each app's declared webhooks ("Incoming data") and schedules ("Schedule"). Services are named by what they do in normal mode; the internal name shows in technical mode.
  3. "Sends data to" edges are animated, with labels drawn on the line: "inbound calls", "scheduled calls", "prompts", "outbound mail", "signed-in people", "operational telemetry".
- **You know it worked when:** an app that sends mail shows a moving line labelled "outbound mail".
- **Variations and refusals:** empty state "No data flows yet" with "Once an app signs people in, sends mail, calls a model or receives data, the flow appears here."
- **Where:** as ONT-02.
- **Reachable from:** UI.
- **Covered by tests:**
  - `OntologyView.test.tsx`: "shows data flows with services named by what they do"
  - `FinalDefectsTests.An_app_people_sign_in_to_depends_on_identity_in_the_data_flow_even_with_no_end_users`

### ONT-04 Read either graph on a phone or with a screen reader
- **Who:** any member.
- **Starts at:** as ONT-02 / ONT-03, below md width (or any width, for a screen reader).
- **Needs:** —
- **Level:** Foundation · **Learn first:** ONT-01 · **What you learn:** the graph is also a plain list.
- **Steps:**
  1. Below md width the drawing is hidden, and a list takes its place; a screen reader reads the list at any width.
  2. Each card in the list shows a node that has outgoing edges: its type, its name (a link for employees, contractors and apps), and lines like "works on {Name} ({label})".
- **You know it worked when:** you see a list of cards under the tabs instead of a drawing.
- **Variations and refusals:** none further.
- **Where:** `OntologyView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `OntologyView.test.tsx` ("…lists it readably…").

### ONT-05 Open an employee or app from a graph
- **Who:** any member.
- **Starts at:** ONT-02 to ONT-04.
- **Needs:** —
- **Level:** Core · **Learn first:** ONT-02 · **What you learn:** the graph is a way into the records.
- **Steps:**
  1. Select an Employee or Contractor node, or its link in the list: `/employees/{id}` opens.
  2. Select an App node, or its link: `/apps/{id}` opens. Other nodes (organisation, division, project, person, secret, service, webhook, schedule) do nothing when selected.
- **You know it worked when:** the employee's or app's page opens.
- **Variations and refusals:** the drawn nodes are clickable but are `aria-hidden` and not focusable, so keyboard users reach them only through the list.
- **Where:** `OntologyView.tsx` (`hrefFor`, `open`).
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("…the graph views").

### ONT-06 A graph that fails to load
- **Who:** any member.
- **Starts at:** a graph tab.
- **Needs:** a failed read.
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** a failed read is never shown as an empty graph.
- **Steps:**
  1. A failed first load shows "The organisation graph could not be loaded", "{reason} Nothing here is known until it loads." and "Try again".
  2. "Try again" reads it again; once it can be read, the graph is drawn.
- **You know it worked when:** you see the failure panel, not an empty state.
- **Variations and refusals:**
  - A failed refresh shows the stale notice above the last good graph.
  - A crash inside the tab shows "Who works on what stopped working." (panel boundary, SYS-08). It resets when you switch tabs.
- **Where:** `OntologyView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `OntologyView.test.tsx`: "loading, failed and empty are distinct".

### ONT-07 Read the ontology by API or MCP
- **Who:** Viewer or above at the scope.
- **Starts at:** `GET /api/ontology?scope=&view=all|org-chart|data-flow`; MCP `ontology_get {scope, view}`.
- **Needs:** Viewer.
- **Level:** Developer · **Learn first:** ONT-02 · **What you learn:** the graph is derived on every read and stored nowhere.
- **Steps:**
  1. The answer is `{scope, generatedAt, nodes, edges, views}`. Unlike the console, `view=all` returns every edge type (`owns`, which the console draws as "Holds", `works-on`, `reports-to`, `depends-on`, `data-flows-to`).
  2. Over MCP, `ontology_get` answers the same for any scope the key may read.
- **You know it worked when:** a 200 answer with nodes and edges.
- **Variations and refusals:** a bad view: "view is all, org-chart, data-flow."
- **Where:** `WorkforceEndpoints` (`/ontology`), `ControlPlaneTools` `ontology_get`.
- **Reachable from:** API / MCP (the console uses the two fixed views at the selected level, ONT-01).
- **Covered by tests:** `WorkforceTests.The_ontology_is_derived…`; `McpTests`.

---

## TALK: conversations

**How every conversation works** (`ConversationService`, `ConversationWorkflow`):
- Sending a message needs Builder at the scope. Reading the history needs Viewer.
- Each message (1 to 20,000 characters) becomes a `conversation` run. The message is its first event, from "owner".
- One conversation exists per scope plus employee, and every new message continues the latest one, whoever sends it.
- The reply is written by a general assistant (system prompt `Runner/Prompts/conversation.md`). It remembers the last 6 turns and has three tools:
  - `read_organisation`, which reads "overview", "workforce", "tasks", "runs" or "credits" at the scope or beneath it;
  - `start_idea`, a checkpoint (asks first);
  - `adjust_setting`, a checkpoint, limited to `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`, `sleep.mode`, `sleep.idle_minutes` and `workforce.idle_days`.
- It works in up to 12 steps.
- It cannot create, rename or delete nodes, set budgets, secrets, context or access, answer approvals, hire, or decide verdicts.

### TALK-01 Talk to the whole organisation
- **Who:** Builder or above at the organisation (to send); Viewer (to read).
- **Starts at:** `/`, the dock, with the whole organisation selected (the default).
- **Needs:** at least one division (otherwise there is no dock, ORG-12).
- **Level:** Foundation · **Learn first:** ORG-07 · **What you learn:** the conversation answers for the selected level and everything beneath it.
- **Steps:**
  1. The dock shows a square avatar and "Talking to {org}", with the hint "Select a division, project or employee to narrow this."
  2. The history loads: a skeleton, screen-reader text "Loading what was said before" (TALK-11).
  3. If nothing has been said yet: "Ask what needs you, or tell it what to change. It answers for {org} and everything beneath it."
  4. Below the log: label "Message {org}", input placeholder "Ask, or tell it what to change", and the button "Send" (disabled while the input is blank).
  5. The person types a question (for example "what is over budget?") and presses "Send". Their bubble appears right away, faded while it sends (`POST /api/conversations {scope}`). Typing dots and "Working on it" show.
  6. The Runner answers using `read_organisation`. The reply streams in as a grey bubble. When the run did tool work, the link "See how it got there" appears (TALK-12).
  7. Up to two lines under the log show employees working anywhere in the tree: "{Name} is {activity}".
- **You know it worked when:** a grey reply bubble appears under your message.
- **Variations and refusals:** see TALK-13 to TALK-15. No cost estimate is shown before a message is sent (see Gaps).
- **Where:** `ConversationDock.tsx`; `POST`/`GET /api/conversations` (`WorkEndpoints`); `Runner/Workflows/ConversationWorkflow.cs`; `Runner/Agents/RunnerTools.cs` (`ReadOrganisationTool`); `GET /api/runs/{id}/events`.
- **Reachable from:** UI.
- **Covered by tests:**
  - `HomeView.test.tsx`: "scopes the breadcrumb and the conversation to the selected node, and streams the reply"
  - `IdeasAndConversationsTests.A_conversation_persists_per_scope_and_returns_runs`
  - `WorkflowTests.A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea`
  - `RunnerContractTests.The_conversation_reads_the_organisation_through_its_own_tool`

### TALK-02 Talk to a division
- **Who:** Builder or above at the division.
- **Starts at:** `/`, select a division (ORG-07).
- **Needs:** a division.
- **Level:** Foundation · **Learn first:** TALK-01 · **What you learn:** narrowing the level narrows what the assistant reads and where its actions land.
- **Steps:** as TALK-01, with "Talking to {division}" and the hint "Select the organisation band to talk to everything again." Reads are limited to the division and beneath; a read outside is refused ("'{path}' is outside {scope}, the scope this conversation is about."). An idea started here is placed in this division (TREE-05).
- **You know it worked when:** the dock heading names the division and the earlier organisation-level messages are gone.
- **Variations and refusals:** as TALK-01.
- **Where:** as TALK-01.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` (scoping); `console.spec.ts` ("…selection scopes the breadcrumb and the conversation").

### TALK-03 Talk to a project
- **Who:** Builder or above at the project.
- **Starts at:** `/`, select a project card's name.
- **Needs:** a project.
- **Level:** Foundation · **Learn first:** TALK-02 · **What you learn:** as TALK-02.
- **Steps:** as TALK-02, with "Talking to {project}". An idea started here is raised at the division above.
- **You know it worked when:** "Talking to {project}".
- **Variations and refusals:** as TALK-01.
- **Where:** as TALK-01.
- **Reachable from:** UI.
- **Covered by tests:** as TALK-02.

### TALK-04 Talk to an app
- **Who:** Builder or above at the app.
- **Starts at:** API `POST /api/conversations {scope: "{org}/{division}/{project}/{app}", message}`, or MCP `conversation_post`.
- **Needs:** Builder.
- **Level:** Developer · **Learn first:** TALK-03 · **What you learn:** the app level has a conversation of its own.
- **Steps:** send the message. 201 with the run. Follow `GET /api/runs/{id}/events` for the reply. Read back with `GET /api/conversations?scope=…`.
- **You know it worked when:** a `message` event from "assistant" arrives on the run.
- **Variations and refusals:** **Finding: no console route.** App rows are links, so the dock never takes an app scope, though the spec names "an app" as a conversation scope. The app page's "Ask about this app" is a different feature (questions answered from the app's telemetry; apps reader).
- **Where:** `WorkEndpoints` `/conversations`; `ControlPlaneTools` `conversation_post`.
- **Reachable from:** API / MCP only.
- **Covered by tests:** `IdeasAndConversationsTests` (per scope); `McpTests`.

### TALK-05 Talk to an employee from the chart
- **Who:** Builder or above at the employee's level.
- **Starts at:** `/`, select an employee chip (band, division or project).
- **Needs:** an employee.
- **Level:** Core · **Learn first:** ORG-11, TALK-01 · **What you learn:** each employee has its own conversation, apart from the level's.
- **Steps:**
  1. The dock shows a round avatar and "Talking to {Name}", the hint "Select the organisation band to talk to everything again.", and the link "See {Name}’s job, record and memory" (to `/employees/{id}`).
  2. The history loads for that level plus that employee (`GET /api/conversations?scope=…&employeeId=…`).
  3. Typing lines show only that employee's activity.
  4. Sending works as TALK-01, with `employeeId`. The run carries the employee's id, so its model cost is charged to them.
- **You know it worked when:** "Talking to {Name}" with the link to their record.
- **Variations and refusals:** **Finding:** the reply is written by the same general assistant with the same three tools. The employee's memory, job description and role are not given to it (`AgentFactory.Conversation` never calls `AgentFactory.As`). So "talking to an employee" is a separate thread charged to the employee, not the employee answering.
- **Where:** `OrgChart.tsx` (`WorkerChip`), `ConversationDock.tsx`; `ConversationService.PostAsync`; `AgentFactory.Conversation`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "asks for one employee's conversation by their id"; `workforce.spec.ts`: "the conversation is scoped to an employee from the chart, and leads to their screen".

### TALK-06 Talk to an employee on their own page
- **Who:** Builder or above.
- **Starts at:** `/employees/{id}`, section "Talk to {Name}".
- **Needs:** the record is an employee (not a contractor) and has not been released; the tree has loaded.
- **Level:** Core · **Learn first:** TALK-05 · **What you learn:** the same conversation is reachable from the employee's record.
- **Steps:** the same dock as TALK-05. On this page the hint reads "Only {Name} hears this, and answers from what it knows.", and the link to the record is left out. It is the same conversation as from the chart, at the employee's level.
- **You know it worked when:** messages sent here also appear when the same employee is selected on home.
- **Variations and refusals:**
  - Contractors and released employees have no conversation section.
  - **Finding:** "answers from what it knows" is not true in code (see TALK-05).
- **Where:** `features/workforce/EmployeeView.tsx`, `ConversationDock.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `EmployeeView.test.tsx` (workforce reader; not inspected in detail).

### TALK-07 Ask the conversation to start researching an idea
- **Who:** Builder or above (to send). To approve: whoever may answer the run's approval, Builder at the run's scope (`POST /api/runs/{id}/approvals/{id}`).
- **Starts at:** any dock (TALK-01 to TALK-06).
- **Needs:** a scope; credits (TALK-15).
- **Level:** Core · **Learn first:** TALK-01, ORG-05 · **What you learn:** the conversation proposes; nothing happens until a person approves.
- **Steps:**
  1. The person writes, for example, "Start researching a booking app for dive centres." and presses "Send".
  2. The assistant calls `start_idea`. It is a checkpoint, so the run raises an approval titled "Start researching an idea: {idea text}?" and waits. In the dock, the typing line "Working on it" stays and "See how it got there" appears. **The dock offers no approve or reject button.**
  3. Home's "needs you" strip gains an "Approval needed" card with that headline. Within the sweep interval (about 30 seconds per UC-119), a notification "Approval needed: Start researching an idea: …?" appears too.
  4. The person opens the card, or "See how it got there", to reach `/runs/{id}`, and approves there (runs reader).
  5. The tool calls `POST /internal/ideas`. The idea is recorded (at the division, or at the division above for a project or app scope) with its research estimate, and research is queued.
  6. The assistant replies in the dock, for example confirming research has started. A new research run appears on the chart.
- **You know it worked when:** the reply confirms it, and a "Researching" card or run appears, then a "Verdict waiting" card once research ends.
- **Variations and refusals:**
  - Rejected: TALK-09.
  - The idea is refused (for example a red line, or no credits): the tool reports "The idea could not be started ({status}): …" and the assistant must say it did not happen.
  - The approval card's line is the raw detail. It names the tool, for example "start_idea: {text}. … Checkpoint: …" (`AgentLoop.AskAsync`), which is technical wording in normal mode.
- **Where:**
  - `RunnerTools.StartIdeaTool`, `AgentFactory.Conversation` (checkpoints)
  - `Harness/Kernel/AgentLoop.cs` (`AskAsync`)
  - `FactoryEndpoints` `POST /internal/ideas`
  - `HomeView.tsx` (needs you)
- **Reachable from:** UI (the approval is answered on the run page, not in the dock); MCP `conversation_post` plus `approval_answer`.
- **Covered by tests:** `WorkflowTests.A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea`; `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TALK-08 Ask the conversation to change a setting at this level
- **Who:** Builder or above (send). Approver as TALK-07.
- **Starts at:** any dock.
- **Needs:** —
- **Level:** Advanced · **Learn first:** TALK-07 · **What you learn:** a setting changed at a level applies beneath it; the assistant may only touch an allow-list, and only after you approve.
- **Steps:**
  1. The person asks, for example, "switch this division to checkpoints", "keep apps awake", "let apps sleep after 30 minutes" or "flag idle employees after 14 days".
  2. The assistant calls `adjust_setting {key, value}`. An approval titled "Change a setting for this part of the organisation?" is raised, appearing as in TALK-07.
  3. Once approved, `PUT /internal/cascade` sets the value at this level, marked as set by an agent. For `sleep.*` keys, the edge's routes are refreshed.
  4. The assistant replies. The change shows wherever that setting is read, for example "Autonomy for …" (autonomy reader) or the app's running chip.
- **You know it worked when:** the reply confirms it, and the relevant screen shows the value "set at" this level.
- **Variations and refusals:**
  - Any key off the allow-list is refused with 403 "An agent may not change that": "Agents may change only these settings, each confirmed by the owner first: … Everything else, including who may open an app, is done by a person in the console."
  - The approval title does not say which setting. Only the detail line does, with the raw key, for example "adjust_setting: sleep.mode=\"always_on\"…".
- **Where:** `RunnerTools.AdjustSettingTool`; `FactoryEndpoints` `PUT /internal/cascade`; `Domain/Cascade/Autonomy.cs` (`AgentSettings.Allowed`).
- **Reachable from:** UI (approval on the run page).
- **Covered by tests:** `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TALK-09 Decline what the conversation proposed
- **Who:** the approver.
- **Starts at:** the run page from TALK-07 or TALK-08.
- **Needs:** a pending conversation approval.
- **Level:** Core · **Learn first:** TALK-07 · **What you learn:** a rejection is final for that step; the assistant says it did not do it.
- **Steps:** the person rejects on the run page. The tool is denied ("The owner rejected this call. Do the work another way, or finish and explain."). The assistant's reply in the dock says it did not do it.
- **You know it worked when:** no idea or setting appears, and the reply says so.
- **Variations and refusals:** none further.
- **Where:** `AgentLoop.AskAsync`; `POST /api/runs/{id}/approvals/{approvalId}`.
- **Reachable from:** UI (run page); MCP `approval_answer`.
- **Covered by tests:** `WorkflowTests` (conversation test; whether it covers decline specifically was not verified).

### TALK-10 Ask the conversation for something it cannot do
- **Who:** Builder or above.
- **Starts at:** any dock.
- **Needs:** —
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** the conversation can read, start ideas and change a few settings, and nothing else.
- **Steps:** the person asks, for example, to make an app public, create or rename a division, set a budget, set a secret, hire someone or approve something. The assistant has no tool for these. Its prompt says "Never claim to have done something a tool did not do." It should answer that it cannot, and may point to the screen. For an off-list setting, it gets the 403 in TALK-08.
- **You know it worked when:** the reply says it cannot, and nothing changes.
- **Variations and refusals:** the wording of the reply is the model's own (not fixed in code).
- **Where:** `Runner/Prompts/conversation.md`; `ConversationWorkflow`.
- **Reachable from:** UI.
- **Covered by tests:** `RunnerContractTests` (refused settings).

### TALK-11 Read what was said before, after a reload or a return visit
- **Who:** Viewer or above at the level.
- **Starts at:** any dock.
- **Needs:** earlier messages at this level (and employee).
- **Level:** Foundation · **Learn first:** TALK-01 · **What you learn:** the conversation is kept on the server, per level.
- **Steps:**
  1. Opening the dock reads `GET /api/conversations?scope=&employeeId=`: the last 200 messages, oldest first.
  2. Earlier turns draw as blue bubbles (the person's) and grey bubbles (replies). Consecutive messages from one side of one run are merged.
  3. Messages sent during this visit are drawn from their live run, never twice.
- **You know it worked when:** after a reload, your earlier exchange is still in the dock.
- **Variations and refusals:**
  - History fails: "What was said before could not be loaded: {reason} New messages still send." with "Try again".
  - A failed refresh: "The latest refresh failed: {reason}".
  - **Finding:** the conversation is shared by everyone at that level. Any member's message shows as a blue "you" bubble, with no name.
  - An unknown `conversationId` (API only) gives 404 "The conversation"; one from another level gives 409 "This conversation belongs to another scope; start a new one here."
- **Where:** `ConversationDock.tsx` (`groupTurns`, `EarlierTurn`); `ReadModels.ConversationAsync`; `ConversationService`.
- **Reachable from:** UI; API `GET /api/conversations`.
- **Covered by tests:**
  - `HomeView.test.tsx`: "reads what was said before at the selected scope…", "appends a new turn after the history, and does not draw a turn twice…", "records a failed history read on the page, and still lets a message be sent"
  - `console.spec.ts`: "the conversation survives a reload…"
  - `IdeasAndConversationsTests`

### TALK-12 See how a reply was reached
- **Who:** Viewer or above.
- **Starts at:** a reply in the dock.
- **Needs:** the reply's run made a tool call or has tasks.
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** every reply is a run, with a trace you can open.
- **Steps:** select "See how it got there" to go to `/runs/{id}` (runs reader), where its trace and any approvals are shown.
- **You know it worked when:** the run page for that reply opens.
- **Variations and refusals:** replies with no tool work have no link.
- **Where:** `ConversationDock.tsx` (`Replies`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` (streaming).

### TALK-13 A message that is not sent
- **Who:** anyone using the dock.
- **Starts at:** any dock.
- **Needs:** the send request fails.
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** a failed send is kept and can be sent again.
- **Steps:** under the bubble: "Not sent: {reason}" and the button "Send again", which re-sends the same text as a new message.
- **You know it worked when:** after "Send again", the bubble goes solid and a reply begins.
- **Variations and refusals:**
  - A Viewer: "Not sent: This needs the builder role at '{path}'; you are a viewer there (set at …). (403)". The input and "Send" are still offered to Viewers.
  - No role at the level: 404 (ORG-19).
  - Over 20,000 characters: "A message is 1 to 20000 characters."
- **Where:** `ConversationDock.tsx` (`Exchange`); `ConversationService.PostAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "keeps a message that failed to send, says why, and offers to send it again".

### TALK-14 The reply's stream drops
- **Who:** anyone.
- **Starts at:** a reply being written.
- **Needs:** the event stream fails.
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** the reply keeps being written on the server while you reconnect.
- **Steps:**
  - While it is retrying itself, the typing line reads "Reconnecting…".
  - If it gives up: "{error} The reply is still being written." with "Reconnect", which resumes from the last event it received.
- **You know it worked when:** after "Reconnect", the rest of the reply appears.
- **Variations and refusals:** none further.
- **Where:** `ConversationDock.tsx` (`Replies`), `features/runs/useRunStream.ts`; `GET /api/runs/{id}/events` (server-sent events, resumes after `Last-Event-ID`).
- **Reachable from:** UI.
- **Covered by tests:** `useRunStream.test.ts` (runs reader).

### TALK-15 Talk when credits, a budget or the model connection run out
- **Who:** anyone.
- **Starts at:** any dock.
- **Needs:** the balance is past the overdraft, a monthly cap on the chain is spent, or the model service is unavailable.
- **Level:** Advanced · **Learn first:** TALK-01, credits (another reader) · **What you learn:** a conversation spends credits like any other work, and stops when they run out.
- **Steps:**
  1. Sending still succeeds: the run is queued.
  2. When the model call is refused for budget, the run fails with "The credit budget is exhausted, so the work stopped. Raise the budget or top up, then start it again." No reply bubble is added. The typing line simply stops.
  3. That reason is visible only on the run page, and only if the "See how it got there" link appears.
  4. If the assistant cannot complete for another reason, the reply reads "I could not finish answering that. Please ask again."
- **You know it worked when:** (a refusal) the typing stops with no reply; the run page says why.
- **Variations and refusals:**
  - **Not verified from code:** whether a missing or invalid model key ends as "I could not finish…" or as a failed run with no message.
  - **Not verified:** whether starting a conversation run is checked against the remaining budget when it is queued.
  - **No estimate is shown before a conversation message is sent.**
- **Where:** `ConversationWorkflow`; `Runner/Execution/RunContext.cs` (`WorkflowOutcome.FromAgent`).
- **Reachable from:** UI.
- **Covered by tests:** none found for the dock's behaviour here.

### TALK-16 Talk over MCP or the API
- **Who:** an AI assistant with a token (Builder or above), or a developer.
- **Starts at:** MCP `conversation_post {scope, message, employeeId?}`, or `POST /api/conversations {scope, message, employeeId?, conversationId?}`.
- **Needs:** Builder; with a token, capped at the token's role.
- **Level:** Developer · **Learn first:** TALK-01, AI assistants (another reader) · **What you learn:** the docked conversation is the same thing from outside.
- **Steps:** send it. Get back the run. Read its events via MCP `run_events` or the stream. Pending approvals are answered with `approval_answer`. MCP has no tool to read the conversation history; it is read with `GET /api/conversations`.
- **You know it worked when:** a `message` event from "assistant" on the run.
- **Variations and refusals:** a Viewer's token changes nothing.
- **Where:** `ControlPlaneTools` `conversation_post`; `WorkEndpoints`.
- **Reachable from:** API / MCP.
- **Covered by tests:** `McpTests.The_control_plane_tools_do_what_the_console_does_under_the_same_rules`, `McpTests.A_viewers_token_reads_and_changes_nothing`; `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…`.

---

## NOTE: notifications

**What raises notices** (`NotificationSweep`, every `IntervalSeconds`; UC-119 says 30 seconds). Each is raised once per episode, and appears only to Admins and Owners whose grant covers the node:

| Kind | Title | Severity | Subject (where it leads) |
| --- | --- | --- | --- |
| verdict | "A verdict is waiting: {idea}" | info | the idea |
| approval | "Approval needed: {title}" | info | the run |
| hire | "Hire {Name} as {Role}?" | info | the hire |
| budget.80 | "{node} has used 80% of its monthly budget", or for an employee "{Name} has used 80% of their monthly budget" | info | `/credits`, or the employee's page |
| budget.cap | "{node} reached its monthly budget", or for an employee "{Name} reached their monthly budget" | urgent | `/credits`, or the employee's page |
| credits.zero | "Credits have run out" | urgent | `/credits` |
| overdraft.half | "Halfway to the overdraft limit" | urgent | `/credits` |
| overdraft.limit | "The overdraft limit is reached: work has stopped and apps are paused" | urgent | `/credits` |
| app.crashed | "{app} stopped working" (raised at once from Dock's report) | urgent | the app |
| security.finding | "The security review found {n} problem(s)" | urgent | the run |
| topup.requested | "{Org} asks for {n} credits" — raised when an Owner asks (CRED-07), to FrostAura's operators only, in each organisation where an operator holds a role at the top; the line is the Owner's note | info | `/operator`, labelled "Top-up request" |

### NOTE-01 See how many notices are unread
- **Who:** any member (the count is 0 for Builders and Viewers).
- **Starts at:** any screen, the bell in the header.
- **Needs:** the person's session has an organisation.
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** the bell counts what needs you.
- **Steps:**
  1. The bell polls `GET /api/notifications?organisation={slug}&limit=50` every 30 seconds while focused. A coral badge shows the unread count ("99+" above 99). The accessible label reads "Notifications, {n} unread" or "Notifications, none unread".
- **You know it worked when:** a number appears on the bell.
- **Variations and refusals:**
  - While the count is unknown (loading or failed), no badge and the label "Notifications".
  - No organisation: no bell.
  - An operator inside an organisation they entered sees that organisation's bell (OP-04).
- **Where:** `shell/NotificationsBell.tsx`, `notifications/useUnread.ts`, `NotificationFeed.tsx` (`BellIcon`).
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "the bell — shows the unread count and opens the feed in place", "says nothing about a count it does not know"; `breadth.spec.ts`: "the bell counts the unread, leads to the feed…".

### NOTE-02 Open the latest notices in place (desktop)
- **Who:** any member.
- **Starts at:** the bell, at sm width or wider.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-01 · **What you learn:** the latest eight are one click away.
- **Steps:**
  1. Select the bell. A panel "Notifications" opens with "See all" (to `/notifications`) and the first 8 items of the feed (the rows are described in NOTE-03).
  2. Escape, or a click outside, closes it.
  3. Following an item, or "See all", also closes it and goes there.
- **You know it worked when:** the panel lists your latest notices.
- **Variations and refusals:** a crash in the panel shows "Your notifications stopped working." (SYS-08). On a phone the bell is a link to the full feed instead.
- **Where:** `NotificationsBell.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx` (the bell).

### NOTE-03 Read the full feed
- **Who:** any member.
- **Starts at:** `/notifications`, reached by the bell on a phone (a link), "See all", or a direct address.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-01 · **What you learn:** what you are told about, and that urgent ones are e-mailed.
- **Steps:**
  1. The breadcrumb reads "{organisation} / Notifications".
  2. Heading "Notifications", with: "What needs you, newest first. The urgent ones — a cap reached, credits at zero, the overdraft, an app that stopped, a security finding — are e-mailed too, when e-mail is set up."
  3. The feed shows "Nothing unread." or "{n} unread", plus "Mark all read".
  4. Each row shows:
     - a badge: "Verdict", "Approval", "Hire", "Budget", "Credits", "Overdraft", "App", "Security" or "Top-up request" (anything else "Update"); amber for urgent, blue otherwise;
     - "New" when unread;
     - how long ago;
     - the title as a link;
     - one line of detail;
     - "Mark read" when unread;
     - "Also e-mailed" when it was;
     - in technical mode, the raw kind.

     Unread urgent rows are tinted amber; other unread rows are tinted blue.
  5. An aside "What you are told about" lists: "A verdict waiting for your call", "An approval the work is waiting on", "A hire proposed", "A budget at 80% and at its cap", "Credits at zero, halfway to the overdraft limit, and at it", "An app that stopped working", "A security review that found a problem", "For FrostAura’s operators: an Owner asking for a top-up". It adds: "Owners and Admins are told about what their grant covers; others see an empty feed."
- **You know it worked when:** the page lists your notices, newest first.
- **Variations and refusals:** the UI asks for at most 50.
- **Where:** `notifications/NotificationsView.tsx`, `NotificationFeed.tsx`, `notificationModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "lists each with a short title, one line and where it leads…".

### NOTE-04 Follow a notice to its subject
- **Who:** an Admin or Owner with that notice.
- **Starts at:** a row in NOTE-02 or NOTE-03.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-03 · **What you learn:** every notice leads to where you act on it.
- **Steps:** select the title. If unread, it is marked read without waiting for the answer. The panel closes, and the person lands on:
  - the idea, run, hire, app or employee named as the subject (see the table above), or Every organisation for a top-up request;
  - otherwise, `/credits` for budget, credits or overdraft kinds;
  - otherwise, `/hires?scope=…` for a hire;
  - otherwise, `/notifications`.
- **You know it worked when:** the subject's page opens and the row no longer shows "New".
- **Variations and refusals:** an employee's budget notice goes to the employee's page, not credits, because the subject wins. Every notice the control plane raises today names its subject or is a budget, credits or overdraft kind, so the last two are fallbacks.
- **Where:** `notificationModel.ts` (`notificationHref`).
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "notification model — leads each kind to what needs the person".

### NOTE-05 Mark one notice read
- **Who:** an Admin or Owner.
- **Starts at:** a row's "Mark read".
- **Needs:** an unread notice.
- **Level:** Foundation · **Learn first:** NOTE-03 · **What you learn:** read state is yours alone.
- **Steps:**
  1. Select "Mark read". The row and the count update at once (`POST /api/notifications/{id}/read`), on the page and on the bell. The read is recorded for this person only.
- **You know it worked when:** "New" disappears and the count drops by one.
- **Variations and refusals:** refused: the change is rolled back and the row says "Not marked read: {reason}". A notice the person cannot see gives 404 "The notification".
- **Where:** `NotificationFeed.tsx` (`Row`), `store/api.ts` (`markRead`); `NotificationService.MarkReadAsync`.
- **Reachable from:** UI; API. **MCP has no tool for this.**
- **Covered by tests:** `Notifications.test.tsx` ("…marking read is at once and rolls back when refused"); `BreadthTests.The_owner_is_told_what_needs_them_once_per_episode_and_urgent_ones_are_emailed`.

### NOTE-06 Mark every notice read
- **Who:** an Admin or Owner.
- **Starts at:** "Mark all read" (shown only when something is unread).
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-05 · **What you learn:** as NOTE-05.
- **Steps:**
  1. Select it. Everything turns read at once, and the count reads "Nothing unread." (`POST /api/notifications/read-all?organisation=…`; up to 200).
- **You know it worked when:** "Nothing unread." and no badge on the bell.
- **Variations and refusals:** refused: rolled back, with "They were not marked read: {reason}".
- **Where:** `NotificationFeed.tsx`; `NotificationService.MarkAllReadAsync`.
- **Reachable from:** UI; API. No MCP tool.
- **Covered by tests:** `Notifications.test.tsx`: "marks everything read"; `breadth.spec.ts`.

### NOTE-07 An empty feed
- **Who:** anyone.
- **Starts at:** NOTE-02 / NOTE-03.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-03 · **What you learn:** an empty feed means nothing needs you, not that it failed.
- **Steps:**
  1. Nothing to show: "Nothing needs you" with "Verdicts waiting, approvals, hires, budgets running low and anything that breaks appear here."
  2. A Builder or Viewer always sees this, because the server returns an empty feed.
- **You know it worked when:** you see "Nothing needs you".
- **Variations and refusals:** a signed-in person with no organisation, on `/notifications`, sees "There are no notifications until your organisation is named".
- **Where:** `NotificationFeed.tsx`, `NotificationsView.tsx`; `NotificationService.FeedAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "records a failed read, and an empty feed as nothing needing the person".

### NOTE-08 The feed fails to load
- **Who:** anyone.
- **Starts at:** NOTE-02 / NOTE-03.
- **Needs:** a failed read.
- **Level:** Core · **Learn first:** NOTE-03 · **What you learn:** a failure is never shown as "nothing".
- **Steps:**
  1. The first load fails: "Your notifications could not be loaded", "{reason} Nothing here is known until it loads." and "Try again".
  2. "Try again" reads it again; once it can be read, the feed appears.
- **You know it worked when:** the failure panel appears.
- **Variations and refusals:** a later refresh fails: the stale notice above the last good feed.
- **Where:** `NotificationFeed.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx` ("records a failed read…").

### NOTE-09 Receive an urgent notice by e-mail
- **Who:** the Owner and organisation-level Admins.
- **Starts at:** the system raises an urgent notice.
- **Needs:** a mail server configured.
- **Level:** Core · **Learn first:** NOTE-03 · **What you learn:** urgent notices reach you away from the console.
- **Steps:**
  1. When a notice is first raised and is urgent, an e-mail is queued to the Owner and the organisation-level Admins, with the subject "{organisation}: {title}" and a body of the title, the detail, and "({path})".
  2. Its row in the feed then shows "Also e-mailed".
- **You know it worked when:** the e-mail arrives and the row shows "Also e-mailed".
- **Variations and refusals:**
  - No mail server: nothing is queued; the feed is the record.
  - Admins granted below organisation level are not e-mailed, though they see the notice in their feed.
- **Where:** `NotificationService.RaiseAsync`, `EmailAsync`.
- **Reachable from:** system.
- **Covered by tests:** `BreadthTests.The_owner_is_told_what_needs_them_once_per_episode_and_urgent_ones_are_emailed`.

### NOTE-10 Read notices over MCP
- **Who:** an assistant with an Admin-level token.
- **Starts at:** MCP `notifications_list {unread?}`.
- **Needs:** Admin at the token's organisation.
- **Level:** Developer · **Learn first:** NOTE-03 · **What you learn:** an assistant can see what needs a person.
- **Steps:**
  1. Call it. It returns the same feed as the console, up to 50: `{organisation, unread, notifications}`.
- **You know it worked when:** the feed comes back.
- **Variations and refusals:** Builder or below: refused, as an error result "This needs the admin role at '{organisation}'; you are a builder there (set at {path})." There is no MCP tool to mark a notice read. The same feed on a screen is NOTE-03.
- **Where:** `ControlPlaneTools` `notifications_list`.
- **Reachable from:** MCP only.
- **Covered by tests:** `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…`.

---

## SYS: system status, mode, unknown addresses and failures

### SYS-01 Switch between normal and technical mode
- **Who:** anyone signed in.
- **Starts at:** the header toggle, "Normal" / "Technical".
- **Needs:** —
- **Level:** Core · **Learn first:** ORG-04 · **What you learn:** technical detail is available, never in the way.
- **Steps:**
  1. Select "Technical". The toggle marks it pressed, and a "System" link (a health icon) appears beside it.
  2. Technical wording appears across screens: "MCP access", raw notification kinds, internal service names, context keys. The choice is remembered in this browser.
- **You know it worked when:** "Technical" is pressed and the "System" link appears.
- **Variations and refusals:** in a private window that refuses storage, the mode holds for the session only.
- **Where:** `AppShell.tsx` (`ModeToggle`), `store/uiSlice.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx`: "keeps system status behind technical mode, and remembers the mode".

### SYS-02 Open system status in normal mode
- **Who:** anyone.
- **Starts at:** `/system` while in normal mode.
- **Needs:** —
- **Level:** Core · **Learn first:** SYS-01 · **What you learn:** service health is technical detail.
- **Steps:**
  1. The breadcrumb reads "System". The page shows "System status is technical detail", "It names the services Endgame runs on, so it is shown in technical mode only." and "Switch to technical mode".
  2. Selecting the button switches mode and shows SYS-03 in place.
- **You know it worked when:** the heading "System status" appears.
- **Variations and refusals:** none further.
- **Where:** `App.tsx` (`SystemRoute`).
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx` (as SYS-01).

### SYS-03 Read system status
- **Who:** anyone in technical mode.
- **Starts at:** "System" in the header, or `/system`.
- **Needs:** technical mode.
- **Level:** Advanced · **Learn first:** SYS-01 · **What you learn:** each service is asked directly, and the whole is healthy only if every part is.
- **Steps:**
  1. Heading "System status", with "Every service, asked directly whether it is healthy." and a "Check again" button. On first load: "Checking every service…".
  2. A summary card shows "All services healthy" (green) or "{n} of {m} services unhealthy" (amber), and "Checked at {hh:mm:ss}".
  3. One card per configured service, in this order: "Control plane", "Edge", "Runner", "Dock", "Database", "Console", "Cloudflare and backups", "Telemetry collector", then any extras. Each shows its latency ("{n} ms" or "{n.n} s"), a "Healthy" / "Unhealthy" badge, and any detail.
  4. The page re-checks every 10 seconds while focused. "Check again" forces a check, spinning while it runs.
- **You know it worked when:** "All services healthy" with one card per service.
- **Variations and refusals:**
  - An unhealthy service turns the summary amber and its card says why, in its probe's own words, for example "No answer within 2000 ms." or "Unreachable: {reason}".
  - A service whose address is not configured is not probed or listed.
  - A probe that throws still yields a row, marked unhealthy, with the error.
- **Where:** `features/status/SystemStatusView.tsx`, `statusModel.ts`; `GET /api/system/status` (`Program.cs`, `Application/Status/GetSystemStatus.cs`, `Infrastructure/Health/StatusOptions.cs`, `HttpHealthProbe.cs`, `DatabaseHealthProbe.cs`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `SystemStatusView.test.tsx`: "lists every service when all are healthy", "names the unhealthy service and why"
  - `smoke.spec.ts`: "the console shows every service healthy, live from the control plane"
  - `SystemStatusEndpointTests`

### SYS-04 System status cannot be read, or reads oddly
- **Who:** as SYS-03.
- **Starts at:** `/system`.
- **Needs:** —
- **Level:** Advanced · **Learn first:** SYS-03 · **What you learn:** a failed check is never shown as an empty or healthy system.
- **Steps:**
  1. The first load fails: "System status could not be loaded", "{reason} Nothing below is known until a check succeeds." and "Try again". Reasons: "The control plane answered {status}.", "The control plane could not be reached.", "The control plane sent an answer that could not be read." or "The control plane did not answer in time."
  2. "Try again" checks again; once it succeeds, the services appear.
- **You know it worked when:** the matching message appears.
- **Variations and refusals:**
  - A later check fails: on the summary card, "The latest check failed: {reason} These results are from the last one that succeeded."
  - Zero services: the summary reads "No services reported", and "The control plane answered, but reported no services. That is a fault, not a quiet system."
- **Where:** `SystemStatusView.tsx`, `statusModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `SystemStatusView.test.tsx`: "renders a failed read as a failure…", "says so when the control plane cannot be reached at all", "keeps the last good answer, marked stale…"; `statusModel.test.ts`.

### SYS-05 Read system status by API
- **Who:** anyone for the summary; a signed-in person for the services.
- **Starts at:** `GET /api/system/status`.
- **Needs:** nothing for `overall`; a console session for the rest.
- **Level:** Developer · **Learn first:** SYS-03 · **What you learn:** health is a single live read, and only the whole is public.
- **Steps:**
  1. Signed out, the answer is `{overall, checkedAt}` only — what `make smoke` and a load balancer need.
  2. Signed in, it is `{overall, checkedAt, services[{key, name, state, latencyMs, detail}]}`.
- **You know it worked when:** a 200 answer.
- **Variations and refusals:** which services exist, how fast they answer and what went wrong are never shown to someone signed out. The same read on a screen is SYS-03.
- **Where:** `Program.cs`, `Application/Status/ServiceHealth.cs` (`SystemStatusSummary`).
- **Reachable from:** API (the summary anonymously).
- **Covered by tests:** `SystemStatusEndpointTests` (including "Signed_out_it_says_only_whether_the_whole_is_healthy_and_when").

### SYS-06 Open an address that does not exist
- **Who:** anyone signed in.
- **Starts at:** any unmatched address, for example `/divisions/x`.
- **Needs:** —
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** a stale link says so plainly.
- **Steps:**
  1. The breadcrumb reads "Not found". The page shows "Nothing lives at this address" and "The link may be old, or the thing it pointed to was removed."
  2. "Back to the org chart" goes to `/`.
- **You know it worked when:** "Nothing lives at this address".
- **Variations and refusals:**
  - A well-formed address whose record is missing (for example `/apps/{unknown id}`) is not this page: it is that screen's own failed state.
  - Ids over 80 characters, or with other characters, fall here.
  - A signed-in visit to `/sign-in` is replaced with `/`.
  - Signed out, every address goes to `/sign-in`.
- **Where:** `App.tsx` (`NotFound`), `lib/router.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx`: "answers an unknown address plainly".

### SYS-07 A whole screen crashes
- **Who:** anyone.
- **Starts at:** any screen.
- **Needs:** a rendering error.
- **Level:** Core · **Learn first:** — · **What you learn:** a crash never blanks the page or loses work.
- **Steps:**
  1. The route boundary replaces the screen with a frame (the mark and "Endgame") and an amber panel:
     - "This screen stopped working.";
     - "Something on this part of the page went wrong while it was drawn. Nothing you had done was lost, and nothing was changed.";
     - a "What failed" disclosure with the error message;
     - "Try again";
     - "Back to the org chart" (a full page load of `/`).
  2. Navigating to another address clears it.
- **You know it worked when:** the amber panel appears instead of a blank page.
- **Variations and refusals:** none further. The academy has no live demonstration of a crash: the demo console is the real one and does not crash on purpose.
- **Where:** `components/ErrorBoundary.tsx`, `App.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `ErrorBoundary.test.tsx`: both tests; `workforce.spec.ts`: "a crash or an unreadable answer never blanks the page".

### SYS-08 One panel crashes and the rest keeps working
- **Who:** anyone.
- **Starts at:** home, the bell, Manage or the employee page.
- **Needs:** a rendering error inside a panel.
- **Level:** Core · **Learn first:** SYS-07 · **What you learn:** as SYS-07.
- **Steps:** only that panel shows "{name} stopped working." with the same text and buttons. The named panels:
  - "The org chart";
  - "The conversation" (resets when the selection changes);
  - "The organisation", "Who works on what" or "How data flows" (resets when the tab changes);
  - "Your notifications";
  - on Manage, "The part chosen" and "What this is" (reset when another part is chosen).
- **You know it worked when:** the rest of the page stays usable.
- **Variations and refusals:** none further.
- **Where:** `HomeView.tsx`, `NotificationsBell.tsx`, `NotificationsView.tsx`, `ManageView.tsx`, `EmployeeView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `ErrorBoundary.test.tsx`.

### SYS-09 The console opens, or cannot check who you are
- **Who:** anyone.
- **Starts at:** any address.
- **Needs:** —
- **Level:** Foundation · **Learn first:** — · **What you learn:** "signed out" and "could not check" are different.
- **Steps:**
  1. While `GET /api/me` runs: a header skeleton (label "Opening Endgame"); while a screen's code loads: "Opening the screen".
  2. A 401 is treated as signed out and goes to sign-in.
  3. Any other failure: "Endgame could not check who you are", "{reason} Nothing here is known until it loads." and "Try again".
  4. Once the check succeeds, the console opens on the address asked for.
- **You know it worked when:** the console opens on home.
- **Variations and refusals:** none further.
- **Where:** `App.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx`: "shows the opening skeleton…", "records a failed session check, which is not the same as signed out".

### SYS-10 Home fails to load
- **Who:** anyone.
- **Starts at:** `/`.
- **Needs:** the tree read fails.
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** a failed read is never shown as an empty organisation.
- **Steps:**
  1. While loading, skeletons.
  2. On failure: "The organisation could not be loaded", "{reason} Nothing here is known until it loads." and "Try again". There is no conversation while failed. The reason is the server's own text where it gives one, for example "The organisation 'x' was not found, or you cannot see it. (404)", or "Endgame could not be reached.", "Endgame did not answer in time.", etc.
  3. "Try again" reads it again; once it can be read, the chart appears.
- **You know it worked when:** after "Try again", the chart appears.
- **Variations and refusals:** an answer in an unexpected shape fails the same way, with "Endgame sent the organisation in a shape this screen does not understand: {field}."
- **Where:** `HomeView.tsx`, `lib/queryState.ts`, `store/api.ts` (`checkedQuery`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "shows skeletons while the tree loads", "records a failed read on the page, never as an empty organisation"; `console.spec.ts`: "a failed read is shown as a failure, with a way to try again".

---

## Gaps and oddities found

1. **Fixed:** the tree is managed on "Manage" (`/tree`): create, rename, describe, archive, reactivate and delete (TREE-02 to TREE-13), and `/start` offers "Where it goes" (TREE-05). Moving is still impossible by any route, on purpose (TREE-10).
2. **Fixed:** the Owner renames the organisation on "Manage" (ORG-14); MCP `node_update` refuses organisations and names `PATCH /api/organisations/{id}`.
3. **Fixed:** a level is described in "What this is" on "Manage" (TREE-11, TREE-12). The conversation still cannot set it.
4. **The employee conversation is not the employee** (TALK-05, TALK-06). It is the general assistant without the employee's memory. The copy "answers from what it knows" overstates it.
5. **Conversations are shared per level, unlabelled.** Every member's messages render as "you".
6. **An app can never be selected for the conversation in the UI.** The spec says it can, and that "Selecting a node opens it". Divisions and projects open on "Manage" instead.
7. **The dock cannot answer its own approvals.** start_idea and adjust_setting approvals must be answered on the run page or from "needs you". The approval title for a setting does not say which setting. The detail line shows raw tool names and keys in normal mode.
8. **No estimate is shown before a conversation message** (CLAUDE.md rule 11). When budget runs out, the dock shows no reply and no reason.
9. **Fixed:** a person granted below organisation level starts at their own level, and the graphs ask at the selection (ORG-19).
10. **Dead UI branches**:
    - the "verdict" project stage, with "Read the verdict" and "Idea · paused at verdict";
    - the stages "idea", "evaluating", "publishing" and "dropped";
    - the "Nobody works on anything yet" empty state when divisions exist.
11. **Fixed:** `topup.requested` is raised to operators and labelled "Top-up request" (NOTE).
12. **Fixed:** archiving a division or project stops its apps being routed, and the tree, the outline and the chart mark archived nodes (TREE-07, ORG-08). A Builder can still set an app's status to "running" or "failed" by hand through `PATCH /api/apps/{id}` (TREE-08).
13. **Fixed:** `GET /api/system/status` says only `overall` and `checkedAt` to someone signed out (SYS-05).
14. **Fixed:** the empty "needs you" line claims only what it checks (ORG-05), and someone who can never name an organisation is told organisations are set up by FrostAura, on home and on `/start` (ORG-03).
15. **Small mismatches with the UC docs.**
    - UC-102 and UC-001 describe `needsYou` as "verdicts and approvals" only; hires and idle employees are also sent.
    - UC-001 says selecting "a node or an employee" scopes the conversation; apps cannot be selected.
    - MCP lacks mark-read for notifications, delete for nodes, and a conversation-history read.
16. **The academy's demo world has research projects the product never draws.** Northwind's demo tree carries project cards for ideas still in research or at a verdict ("Idea · paused at verdict", "Researching"), which the real tree never sends (ORG-09). The academy's scripts do not point at them.
