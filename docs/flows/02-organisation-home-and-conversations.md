# The organisation, home and conversations — every flow

The home screen, the tree of divisions, projects and apps, the two graph views, conversations, notifications, system status.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

**What most needs your attention**

1. **There is no screen anywhere to create, rename, archive, move or delete a division, project or app.** Nodes get created in two ways:
   - by the factory, when it places an idea it is building;
   - by calling the API or MCP directly.

   Renaming and archiving are API or MCP only. Deleting is API only. Moving is not possible by any route. The conversation cannot create or rename anything either.
2. **Talking to an employee is not answered by that employee.** The reply comes from the same general assistant, with no access to the employee's memory. The only difference is that the cost is charged to the employee. The page still says "answers from what it knows".
3. **A conversation at a level is shared.** Everyone who talks at the same level and with the same employee writes into one conversation, and every person's message is drawn as "your" bubble.
4. **Someone whose only role is in one division gets errors on home.** Home always starts at the whole organisation, so for this person the conversation history, sending, and both graph tabs all fail with a "not found" answer.

Throughout, "the dock" means the conversation panel. It is in `ConversationDock.tsx`, sits beside the org chart and is scoped to whatever is selected.

---

## ORG: the organisation and the home screen

### ORG-01 Arrive with no organisation (first run)
- **Who:** the first person signed in to a fresh Endgame (owner-to-be).
- **Starts at:** `/` (home).
- **Needs:** signed in. No organisation exists anywhere on the platform, and this person has no membership.
- **Level:** Foundation · **Learn first:** sign-in (another reader's area) · **What you learn:** everything you make lives under one organisation, and you name it first.
- **Steps:**
  1. The person opens `/`. While the tree loads, home shows skeletons (screen-reader label "Loading the organisation").
  2. `GET /api/tree` answers 200 with `organisation: null` and empty `divisions` and `needsYou`. That is a real empty answer, not an error.
  3. Home shows a dark band with the Endgame mark:
     - the heading "Name your organisation, then describe your first idea.";
     - the text "Everything you make lives under it. Endgame researches the idea first, tells you plainly whether it is worth building, then builds and runs it.";
     - a white button, "Start".
  4. The breadcrumb is empty, so only the "Endgame" wordmark shows. There is no conversation dock, no bell and no credits pill, because those appear only once `me.organisation` exists.
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
  2. Because this is a first run, a field labelled "Your organisation" appears. Its hint reads "Everything you make lives under this name. Its apps appear at {host}/{slug}." The slug is worked out from the name as you type; before anything is typed it shows "your-name".
  3. The person types the organisation's name, then fills in "The idea" (a text area). They can toggle any of the constraint chips ("Members sign in", "Works on a phone", "Sends email", "Uses AI inside the app", "Receives data from a device") and add "Anything else, in your own words".
  4. Once the idea reaches 12 characters, the panel "Research comes first" fetches an estimate (`POST /api/ideas/estimate`, free) and shows "Estimated {credits}".
  5. The person presses "Research this idea". While it works, the button reads "Starting research…".
  6. The console first calls `POST /api/organisations {name, slug}`. The control plane validates the slug, checks it against reserved names, creates the organisation, makes the caller its Owner, and adds the standing Security reviewer employee. It then calls `POST /api/ideas`.
  7. The browser goes to the research run at `/runs/{id}`. From here on it is the ideas and runs readers' area.
- **You know it worked when:** you land on the research run's page, and the header gains the organisation's name, the bell and the credits pill.
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
  - Typing `/start` still reaches the Start screen; naming an organisation there is refused with 403 "Organisations are provisioned by FrostAura; there is no self-serve sign-up.", shown as "Research did not start: … (403) Nothing was charged."
  - An older control plane that sends no `firstRun` is read as a first run, as before.
- **Where:** `HomeView.tsx` (`NotInvited`), `StartView.tsx`; `GET /api/tree` (`ReadModels.FirstRun`, `AccountService.IsFirstRunAsync`), `POST /api/organisations`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` "does not offer a first organisation to someone who can never name one"; `ScreensAndRolesTests.Someone_with_no_role_is_offered_the_first_organisation_only_on_a_first_run`; `AuthorizationMatrixTests` covers the endpoint's refusal.

### ORG-04 Read the organisation band and the header
- **Who:** any member (Owner, Admin, Builder, Viewer); an operator who has entered the organisation.
- **Starts at:** `/`.
- **Needs:** an organisation exists and the person holds a role in it.
- **Level:** Foundation · **Learn first:** ORG-02 · **What you learn:** the band totals the whole organisation and is live.
- **Steps:**
  1. The header shows:
     - the mark and "Endgame";
     - the breadcrumb "{org} / Whole organisation";
     - the "Normal" / "Technical" toggle;
     - the credits pill "{n} credits left", which links to `/credits` and polls every 30 seconds;
     - the bell (NOTE-01);
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
  - "Balance unavailable" appears if the credits read fails.
  - Someone whose role is only on part of the tree sees no organisation-level worker chips, and spend summed from the divisions they can see.
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
     | Idle employee | "Nothing to do" | "{Name} has had no work for over {n} days" | "Release them to stop paying for an idle workforce: their memory is kept, so a rehire starts where they left off." | `/employees/{id}` |

  2. The person selects a card and is taken to that page (other readers' areas).
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
  - "{employee}’s record and memory": only when an employee is selected. Goes to `/employees/{id}`.
  - "Autonomy for {level name}": always. Goes to `/autonomy?scope={path}`.
  - "Hiring": always. Goes to `/hires?scope={path}`.
  - "Ideas from your portfolio": only when the whole organisation or a division is selected. Goes to `/suggestions?scope={path}`.
  - "People": Admin, Owner or operator. Goes to `/people?scope={path}`.
  - "AI assistants" (reads "MCP access" in technical mode): always. Goes to `/assistants`, which is not scoped to the level.
  - "Secrets for {level name}": Admin, Owner or operator. Goes to `/secrets?scope={path}`.
  - "Operator access": Owner only. Goes to `/operator-access`.

  When an employee is selected, the links use the level the employee sits on.
- **You know it worked when:** the destination opens, already scoped to the level you chose (its own heading names it; other readers).
- **Variations and refusals:** Viewers and Builders still see "Autonomy" and "Hiring". Whether they can change anything there is decided on those screens (other readers).
- **Where:** `HomeView.tsx` (`ManageLinks`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "offers the Owner the selection's secrets and the operator log", "shows an Admin the secrets but not the operator log, and a Builder neither".

### ORG-07 Select a level, and go back up with the breadcrumb
- **Who:** any member.
- **Starts at:** `/`.
- **Needs:** at least one division exists (otherwise there is nothing to select and no dock).
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** the selection is "where you are": the breadcrumb, the conversation and the shortcuts all follow it.
- **Steps:**
  1. On load, the selection is the whole organisation. The breadcrumb reads "{org} / Whole organisation" and the dock "Talking to {org}".
  2. The person selects one of:
     - a division header (the letter badge and name);
     - a project card's name;
     - an employee chip (on the band, a division or a project).

     The selected card gains a blue ring; an employee chip gains a violet ring.
  3. The breadcrumb becomes the trail, for example "{org} / {division} / {project}". Every step except the last is a button that selects that level in place.
  4. The dock re-scopes and fetches that level's history (TALK-01 to TALK-05). The shortcut row rebuilds (ORG-06).
  5. To return to everything, the person selects the organisation name in the band or the first breadcrumb step. The dock hint says "Select the organisation band to talk to everything again."
- **You know it worked when:** the breadcrumb's last step and the dock heading "Talking to {name}" both show what you selected.
- **Variations and refusals:**
  - **An app cannot be selected.** App rows are links to the app page (ORG-10), so the dock is never scoped to an app from the UI. **Spec mismatch:** the spec says the dock can be scoped to "an app" and that "Selecting a node opens it". Selecting a division or project only re-scopes; neither has a page of its own.
  - On a phone, the breadcrumb shows only its last two steps after "…".
  - A selection that no longer exists in the tree resets to the whole organisation. The check is a text-prefix match, so selecting a path in organisation `acme-labs` would survive switching to `acme` (operator case only; not verified in practice).
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
  - "Division" and its name;
  - this month's spend as a badge;
  - its own employees as chips;
  - a wire down to its projects.

  When anything beneath it is working, a dot travels down the wire. A lone division takes the full width, with its projects side by side.
- **You know it worked when:** the column shows its name and spend.
- **Variations and refusals:**
  - With no projects: "No projects in {division} yet."
  - Archived divisions are still shown, with nothing marking them archived. **Finding:** the tree read does not filter or flag an archived division.
  - Divisions are ordered by name.
- **Where:** `OrgChart.tsx` (`DivisionColumn`); `ReadModels.TreeAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` ("draws the org chart…").

### ORG-09 Read a project card and watch its work
- **Who:** any member who can see the project.
- **Starts at:** `/`.
- **Needs:** a project exists.
- **Level:** Foundation · **Learn first:** ORG-08 · **What you learn:** a project shows what stage its work is at and how far through it is, against the estimate.
- **Steps:**
  1. The card shows its name (a selection button).
  2. A stage chip appears unless the project is live with apps. The stages the server actually sends are "Researching", "Security review", "Building", "Planning", "Live" and "Paused".
  3. The card shows "{credits} this month" and an optional note: "Waiting for your approval.", "Work here is paused.", "The last piece of work failed." or "Archived.".
  4. If work is under way: "{run title}, step {x} of {y}", then "{spent} of an estimated {estimate}" (or "{spent} so far" when there is no estimate), a moving progress bar, and the link "Watch the work", which goes to `/runs/{id}`.
  5. Below that: its apps (ORG-10) and its people (ORG-11).
- **You know it worked when:** "Watch the work" opens the live run.
- **Variations and refusals:** dead branches in the UI:
  - The "verdict" stage (a dashed amber card, "Idea · paused at verdict", "Read the verdict") is never sent by `ReadModels.ProjectStage`, so it is never drawn.
  - The stages "idea", "evaluating", "publishing" and "dropped" are never sent either.
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
  2. Selecting the name opens `/apps/{id}` (the apps reader's area).
- **You know it worked when:** the app page opens.
- **Variations and refusals:** an app paused by overdraft or an exhausted budget shows "Paused". An archived app shows "Paused" and "Health unknown", with nothing saying it is archived.
- **Where:** `OrgChart.tsx` (`AppRow`), `treeModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`; `console.spec.ts` ("an app that has measured nothing yet says so, never zero").

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
  4. Selecting an employee chip scopes the dock to that employee (TALK-05).
- **You know it worked when:** a working employee shows animated dots and their activity.
- **Variations and refusals:** none further.
- **Where:** `OrgChart.tsx` (`Workers`, `WorkerChip`), `treeModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts`: "employees and contractors on their nodes…".

### ORG-12 An empty organisation (no divisions yet)
- **Who:** the Owner after naming the organisation, before anything is placed.
- **Starts at:** `/`.
- **Needs:** an organisation with zero divisions.
- **Level:** Foundation · **Learn first:** ORG-02 · **What you learn:** the tree fills itself from ideas; you do not draw it by hand.
- **Steps:**
  1. Home shows the band and "needs you". In place of the chart, a dashed panel shows "{org} has nothing in it yet", "Describe an idea and Endgame researches it, suggests a division and a name for it, and builds it once you agree.", and the button "Describe your first idea", which goes to `/start`.
  2. No dock is shown: the dock needs at least one division.
- **You know it worked when:** you see "{org} has nothing in it yet".
- **Variations and refusals:** **Finding:** with no divisions, there is no conversation even at organisation level, though the conversation could start an idea there.
- **Where:** `HomeView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "says plainly when an organisation is genuinely empty"; `console.spec.ts`: "an empty organisation says so and leads to a first idea".

### ORG-13 Home keeps itself live, and says when a refresh fails
- **Who:** any member.
- **Starts at:** `/`.
- **Needs:** the tree loaded once.
- **Level:** Core · **Learn first:** ORG-04 · **What you learn:** a failed refresh keeps the last good picture and says so.
- **Steps:** while the tab is in focus, the tree is re-read every 15 seconds. If a refresh fails after a good load, a notice appears above the chart: "The latest refresh failed: {reason} What you see is from the last one that worked." The chart below stays.
- **You know it worked when:** the amber notice appears while the chart stays drawn.
- **Variations and refusals:** see SYS-10 for a failed first load.
- **Where:** `HomeView.tsx`, `components/states.tsx` (`Stale`), `lib/queryState.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` covers the failed first load; no home-specific stale test found.

### ORG-14 Rename the organisation
- **Who:** Owner.
- **Starts at:** API only: `PATCH /api/organisations/{id} {name}`.
- **Needs:** the Owner role at the organisation; the organisation's id, which is in the `GET /api/tree` answer.
- **Level:** Developer · **Learn first:** ORG-04 · **What you learn:** only the Owner renames the organisation.
- **Steps:** send the request. The answer is the node view with the new name. The next tree read shows it.
- **You know it worked when:** the band shows the new name after the next refresh.
- **Variations and refusals:**
  - An empty name: "A name cannot be empty."
  - Over 200 characters: "A name is at most 200 characters."
  - The slug (the address) cannot be changed by any route.
  - MCP `node_update` refuses organisations with "An organisation is renamed by its Owner, through PATCH /api/organisations/{id} with a signed-in session; not with an assistant's key."
- **Where:** `TreeEndpoints.MapNodeChanges`, `TreeService.UpdateAsync`.
- **Reachable from:** API only. Endpoint with no screen.
- **Covered by tests:** `AuthorizationMatrixTests` (roles); no rename-specific test for organisations found.

### ORG-15 Suspend or reinstate an organisation
- **Who:** FrostAura operator.
- **Starts at:** API only: `PATCH /api/organisations/{id} {status: "suspended" | "active"}`.
- **Needs:** operator; Owner-level access to the organisation's scope (operator entry).
- **Level:** Operator · **Learn first:** ORG-17 · **What you learn:** suspension is FrostAura's act; a suspended organisation's apps drop out of the routing table.
- **Steps:** send the request. The organisation's status changes. The routing table only includes apps in active organisations, so its apps stop being served.
- **You know it worked when:** the answer's `status` reads "suspended". (No console view shows this; not verified on God-mode screens.)
- **Variations and refusals:**
  - A non-operator: 403 "An organisation is suspended or reinstated by FrostAura."
  - Any other status: "'x' is not a status a organisation can have: use active, suspended."
- **Where:** `TreeEndpoints.MapNodeChanges`, `NodeStatuses`, `TreeService.RoutesAsync`.
- **Reachable from:** API only.
- **Covered by tests:** none found for suspension specifically.

### ORG-16 Delete the organisation
- **Who:** Owner.
- **Starts at:** API only: `DELETE /api/organisations/{id}`.
- **Needs:** Owner.
- **Level:** Developer · **Learn first:** ORG-14 · **What you learn:** anything with history attached cannot be deleted.
- **Steps:** send the request. The server deletes the cascade entries and grants set on the node, then the node itself.
- **You know it worked when:** a 204 answer.
- **Variations and refusals:** any children, work or credit history gives 409 "'{path}' still has children, work or credit history attached. Archive it instead (status: archived)." An organisation archive status does not exist. **Not verified from code:** whether the standing Security reviewer, created with every organisation, always blocks this.
- **Where:** `TreeService.DeleteAsync`.
- **Reachable from:** API only.
- **Covered by tests:** none found for organisations.

### ORG-17 An operator with no organisation of their own lands in God mode
- **Who:** FrostAura operator.
- **Starts at:** `/`.
- **Needs:** operator; no membership.
- **Level:** Operator · **Learn first:** sign-in · **What you learn:** an operator works across organisations, and every entry is logged where that organisation's Owner can read it.
- **Steps:** a coral band "God mode" sits above the header on every screen: "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it." with the link "Every organisation". Home shows the panel "God mode", "You run Endgame for FrostAura. Every organisation is one step away.", "List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation’s Owner can read it.", and the button "Every organisation", which goes to `/operator` (God-mode reader).
- **You know it worked when:** the coral "God mode" band is visible.
- **Variations and refusals:** none further.
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
  - An unknown slug: 404 "The organisation '{slug}'", shown as "The organisation could not be loaded".
  - A non-operator who adds `?organisation=` is ignored: they read their own organisation.
- **Where:** `HomeView.tsx`, `GodModeBand.tsx`, `AppShell.tsx`, `lib/useActiveOrganisation.ts`; `GET /api/tree` (`AccessService.OperatorEntryAsync`).
- **Reachable from:** UI.
- **Covered by tests:** `FinalDefectsTests.Entering_an_organisation_and_then_reading_it_is_one_logged_entry`; `GodModeBand.test.tsx`; `breadth.spec.ts` "is marked on every screen, lists every organisation, enters one and says it is logged".

### ORG-19 A person granted only part of the tree uses home
- **Who:** an Admin, Builder or Viewer whose grant is on a division, project or app, not the organisation.
- **Starts at:** `/`.
- **Needs:** such a grant.
- **Level:** Advanced · **Learn first:** ORG-07 · **What you learn:** you see your branch and the path to it, nothing else.
- **Steps:**
  1. The tree shows only their branch and its ancestors. The band shows no organisation-level workers. Each node carries their role there; the organisation's is null.
  2. Home starts at the highest level they hold a role at — their division, else their project, else their app — so the conversation asks there (`GET /api/conversations?scope={their level}`) and the breadcrumb starts "{Org} / {their level}".
  3. The levels above their grant are names on the way down: the organisation in the breadcrumb is not a button, and the organisation's name in the band takes them back to their own level.
  4. "Who works on what" and "How data flows" ask at the level selected (`GET /api/ontology?scope={selection}`), never at the organisation.
- **You know it worked when:** the dock heading reads "Talking to {their level}" with no error, and both graph tabs draw.
- **Variations and refusals:** someone with grants in two divisions starts at the first; selecting the other works too.
- **Where:** `HomeView.tsx` (`homeSelection`, `selectable`), `lib/roles.ts` (`roleInTree`), `ConversationDock.tsx`, `OntologyView.tsx`; `GET /api/tree` (each node's `role`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx` "starts someone granted only a division at that division, and asks the conversation and the graphs there"; `ScreensAndRolesTests.The_tree_carries_each_nodes_effective_role_and_archived_levels_are_marked_and_not_served`; `TreeEndpointTests` / `AuthorizationMatrixTests`.

---

## TREE: divisions, projects and apps as nodes

**What is and is not possible.** In the console you can read nodes (ORG-08 to ORG-10). Nodes are created by the factory or by API/MCP. Renaming and archiving are API/MCP only; deleting is API only; moving is not possible at all. Context and other cascade values are API/MCP only from this screen. Other screens set autonomy, rule sets, budgets, secrets and app settings (other readers).

The cascade carries six kinds of value: `permission`, `secret`, `budget`, `rule_set`, `context`, `setting`.
- A value set at a node applies to everything beneath it unless something lower narrows or overrides it.
- Reading a value returns it with the level that set it.
- Removing a value lets the inherited one apply again.
- To set one you need: Builder for `context` and `sleep.*`; Owner for `overdraft_own_limit`; Admin for everything else.

### TREE-01 Create a division by letting the factory place an idea
- **Who:** Owner, Admin or Builder (whoever can start an idea and decide to build).
- **Starts at:** `/start` ("New idea" on home), the conversation at organisation level (TALK-07), or "Ideas from your portfolio".
- **Needs:** an organisation; a "build" decision on a verdict (verdict reader).
- **Level:** Core · **Learn first:** ORG-02, and the verdict flow (another reader) · **What you learn:** you do not draw divisions; Endgame places each built idea into one, creating the division if needed.
- **Steps:**
  1. An idea started at organisation level is researched. The verdict may propose a placement: division, project and app slugs.
  2. When the build starts, the build workflow's placement step (`BuildWorkflow.PlaceAsync`) works out where it goes:
     - if the idea was raised at a division, it uses that division;
     - otherwise it uses research's proposed division slug, defaulting to `labs`;
     - it creates the division if missing (`POST /internal/tree/nodes`), then the project (named after the proposal, or the idea's first line), then an app (slug from the proposal, default `web`).
  3. The run's log says "{name} will live in a new division, {Division}, as the project {project}." (or "will live in {Division}…" when the division existed).
  4. Within 15 seconds, home shows the new division column with the project card.
- **You know it worked when:** a new division column appears on the chart.
- **Variations and refusals:**
  - The owner cannot pick or confirm the division on `/start`. The Start page's side list promises "A home for it — Endgame suggests a division and a name." Not verified in my scope whether the verdict page lets the owner change the placement.
  - A concurrent placement with the same slug reuses the existing node.
  - A new division can raise a hire proposal (workforce reader).
- **Where:** `Runner/Workflows/BuildWorkflow.cs` (`PlaceAsync`); `FactoryEndpoints` `POST /internal/tree/nodes`; `TreeService.EnsureChildAsync`.
- **Reachable from:** UI (indirectly, through an idea).
- **Covered by tests:** `WorkflowTests.A_new_division_and_a_recurring_job_raise_their_hires_and_a_waiting_hire_never_stops_the_work`; factory tests (other readers).

### TREE-02 Create a division directly
- **Who:** Admin or Owner at the organisation.
- **Starts at:** API `POST /api/divisions {parent: "{org}", name, slug}`, or MCP `node_create {level: "division", parent, name, slug}`.
- **Needs:** Admin.
- **Level:** Developer · **Learn first:** TREE-01 · **What you learn:** a node's slug becomes part of every address beneath it.
- **Steps:** send it. The answer is 201 with `{id, level, slug, name, path, status: "active", createdAt}`. Home shows an empty column, "No projects in {name} yet.", on its next refresh.
- **You know it worked when:** the new column appears on home.
- **Variations and refusals:**
  - Bad slug: "'{slug}' is not a valid slug: use 2-40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit."
  - Sibling clash: 409 "A sibling already uses that slug."
  - Wrong parent level: "A division is created under a organisation; '{path}' is a project."
  - Empty name: "A name cannot be empty."
  - No role: 404. Too low a role: 403 "This needs the admin role at '{path}'; you are a builder there (set at …)."
  - **The console has no form for this.** The conversation cannot do it either (no tool).
- **Where:** `TreeEndpoints` (group `/divisions`), `Mcp/ControlPlaneTools.cs` (`node_create`), `TreeService.CreateChildAsync`.
- **Reachable from:** API / MCP only.
- **Covered by tests:**
  - `acceptance.spec.ts`: "2. the organisation, a division, a project and two apps, through the API"
  - `CascadeCreditsAndAppsTests.The_tree_refuses_bad_slugs_duplicate_siblings_and_deleting_what_has_children`
  - `McpTests.The_control_plane_tools_do_what_the_console_does_under_the_same_rules`
  - `AuthorizationMatrixTests`

### TREE-03 Create a project directly
- **Who:** Builder or above at the division.
- **Starts at:** API `POST /api/projects {parent: "{org}/{division}", name, slug}` or MCP `node_create {level: "project", …}`.
- **Needs:** Builder at the division.
- **Level:** Developer · **Learn first:** TREE-02 · **What you learn:** a project is always under exactly one division.
- **Steps:** as TREE-02. Home shows a project card with the stage chip "Planning" and no apps.
- **You know it worked when:** a "Planning" card appears in the division.
- **Variations and refusals:** as TREE-02, with role Builder. Created by placement in TREE-01. No console form.
- **Where:** as TREE-02 (group `/projects`).
- **Reachable from:** API / MCP only.
- **Covered by tests:** `acceptance.spec.ts` step 2; `AuthorizationMatrixTests`.

### TREE-04 Create an app node directly
- **Who:** Builder or above at the project.
- **Starts at:** API `POST /api/apps {parent: "{org}/{division}/{project}", name, slug}` or MCP `node_create {level: "app", …}`.
- **Needs:** Builder at the project.
- **Level:** Developer · **Learn first:** TREE-03 · **What you learn:** an app node exists before anything is built into it, and it is the deepest level.
- **Steps:** as TREE-02. The app starts with status `draft`. Home shows it as "Waking" with "Health unknown" until hosting reports a state.
- **You know it worked when:** an app row appears in the project card.
- **Variations and refusals:** below an app: "An app is the deepest level; nothing is created beneath it." Created by placement in TREE-01. Building it is the factory's work (other reader).
- **Where:** as TREE-02 (group `/apps`).
- **Reachable from:** API / MCP only.
- **Covered by tests:** `acceptance.spec.ts` steps 2–3.

### TREE-05 Put new work into an existing division
- **Who:** Builder or above.
- **Starts at:** `/`. Select the division, then use the dock (TALK-07), or "Ideas from your portfolio" (suggestions reader).
- **Needs:** the division exists.
- **Level:** Core · **Learn first:** TREE-01, TALK-07 · **What you learn:** an idea raised at a division is placed in that division.
- **Steps:** with the division selected, tell the dock something like "start researching an idea for …". The conversation's `start_idea` asks for approval (TALK-07). Once approved, the idea is recorded at that division, and the factory later places its project there.
- **You know it worked when:** the reply says research started, and (after a build) the project appears in that division.
- **Variations and refusals:**
  - From a project or app scope, the idea is raised at the division above (`/internal/ideas`).
  - `/start` always raises at the organisation, so placement there depends on research's proposal.
- **Where:** `ConversationDock.tsx`; `StartIdeaTool`; `FactoryEndpoints` `POST /internal/ideas`; `BuildWorkflow.PlaceAsync`.
- **Reachable from:** UI (through the conversation).
- **Covered by tests:** `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TREE-06 Rename a division, project or app
- **Who:**
  - API: Admin for a division; Builder for a project or app.
  - MCP `node_update`: Admin for a division; Builder for a project or app.
- **Starts at:** `PATCH /api/{divisions|projects|apps}/{id} {name}`, or MCP `node_update {scope, name}`.
- **Needs:** the role above; the node's id (API) or path (MCP).
- **Level:** Developer · **Learn first:** TREE-02 · **What you learn:** the display name can change; the slug (address) never does.
- **Steps:** send it. The answer is the node. Home shows the new name on the next refresh.
- **You know it worked when:** the chart shows the new name.
- **Variations and refusals:** empty or over-long names refused as in ORG-14. No console control; the conversation cannot.
- **Where:** `TreeEndpoints.MapNodeChanges`, `ControlPlaneTools` `node_update`.
- **Reachable from:** API / MCP only.
- **Covered by tests:** `CascadeCreditsAndAppsTests` (the archive request also renames to "Tech").

### TREE-07 Archive or reactivate a division or project
- **Who:** Admin (division) or Builder (project).
- **Starts at:** `PATCH /api/{divisions|projects}/{id} {status: "archived" | "active"}`, or MCP `node_update {scope, status}`.
- **Needs:** the role above.
- **Level:** Advanced · **Learn first:** TREE-06 · **What you learn:** anything with history is archived rather than deleted.
- **Steps:**
  1. Send it. The routing table is recalculated at once: no app in an archived division or project is served, and reactivating serves them again.
  2. The tree marks the node `archived: true` (and each archived app). An archived project shows on home with the "Paused" chip and the note "Archived."
- **You know it worked when:** a project card reads "Archived.", and its apps no longer answer.
- **Variations and refusals:**
  - Divisions and projects only accept "active" or "archived".
  - The chart does not yet draw "Archived" on a division; the tree sends the field for it.
  - No console control.
- **Where:** `TreeService.UpdateAsync`, `TreeService.RoutesAsync`, `NodeStatuses`, `ReadModels.ProjectStage` and `TreeAsync`; `TreeEndpoints.MapNodeChanges` (tells Edge the routes changed).
- **Reachable from:** API / MCP only.
- **Covered by tests:** `CascadeCreditsAndAppsTests.The_tree_refuses_bad_slugs_duplicate_siblings_and_deleting_what_has_children`; `ScreensAndRolesTests.The_tree_carries_each_nodes_effective_role_and_archived_levels_are_marked_and_not_served`.

### TREE-08 Archive an app, or set an app's status by hand
- **Who:** Builder at the app (API); Builder (MCP `node_update`).
- **Starts at:** `PATCH /api/apps/{id} {status}`.
- **Needs:** Builder.
- **Level:** Developer · **Learn first:** TREE-07 · **What you learn:** an archived app leaves the routing table.
- **Steps:** send `status: "archived"`. The app drops out of the edge's routing table. On home it reads "Paused" and "Health unknown".
- **You know it worked when:** the app row's chip reads "Paused" and its address stops serving.
- **Variations and refusals:** an app's status may be any of draft, building, running, sleeping, stopped, failed or archived. **Finding:** the public endpoint lets a Builder set "running" or "failed" by hand, though MCP's description says an app's status "is reported by hosting". No console control.
- **Where:** as TREE-06; `TreeService.RoutesAsync`.
- **Reachable from:** API / MCP only.
- **Covered by tests:** none found for app archiving.

### TREE-09 Delete a division, project or app
- **Who:** Admin.
- **Starts at:** `DELETE /api/{divisions|projects|apps}/{id}`.
- **Needs:** Admin; nothing attached to the node.
- **Level:** Developer · **Learn first:** TREE-07 · **What you learn:** only an untouched node can be deleted; everything else is archived.
- **Steps:** send it. The values and grants set on the node are removed with it. 204.
- **You know it worked when:** the node disappears from the chart.
- **Variations and refusals:** children, runs or credit entries give 409 "'{path}' still has children, work or credit history attached. Archive it instead (status: archived)." MCP has no delete tool. No console control.
- **Where:** `TreeService.DeleteAsync`.
- **Reachable from:** API only.
- **Covered by tests:** `CascadeCreditsAndAppsTests.The_tree_refuses_…_deleting_what_has_children`.

### TREE-10 Move a division, project or app
- **Who:** —
- **Starts at:** —
- **Needs:** —
- **Level:** — · **Learn first:** — · **What you learn:** —
- **Steps:** **Not supported by any route.** No endpoint, MCP tool or conversation tool changes a node's parent, and no slug can change. Only employees can be reassigned (workforce reader).
- **You know it worked when:** —
- **Variations and refusals:** —
- **Where:** —
- **Reachable from:** nowhere.
- **Covered by tests:** —

### TREE-11 Describe a level: set context that its work inherits
- **Who:** Builder or above at the node.
- **Starts at:** API `PUT /api/cascade {scope, kind: "context", key, value}`, or MCP `cascade_set`.
- **Needs:** Builder.
- **Level:** Advanced · **Learn first:** TREE-12 · **What you learn:** context set at a level is read by everything beneath it unless a lower level replaces the same key.
- **Steps:** send a key (lower-case letters, digits, dots, hyphens and underscores, up to 200 characters) and a JSON value. The answer is the effective value with the level that set it. The conversation's `read_organisation` "overview" reads context through `GET /internal/context`, and the factory's agents receive the resolved levels.
- **You know it worked when:** `GET /api/cascade?scope=…&kind=context` lists it with that level.
- **Variations and refusals:**
  - Bad key: "'{key}' is not a cascade key: use 1-200 lower-case letters, digits, dots, hyphens and underscores."
  - There is no description field on any node; context entries are the only way to describe one.
  - **No console screen sets context.** The conversation cannot set it: context is not on the agent allow-list.
- **Where:** `TreeEndpoints` `/cascade`; `CascadeService.RoleToSet`, `SetAsync`; `CascadeKinds`.
- **Reachable from:** API / MCP only.
- **Covered by tests:** `RunnerContractTests.The_conversation_reads_the_organisation_through_its_own_tool`. No context-specific set/inherit test found by name.

### TREE-12 Read what applies at a level, and remove a value set there
- **Who:**
  - Read: Viewer (Admin for `secret` and `permission`).
  - Remove: the same role as setting.
- **Starts at:** `GET /api/cascade?scope=&kind=` / `DELETE /api/cascade?scope=&kind=&key=`; MCP `cascade_get`, `cascade_remove`.
- **Needs:** a role at the scope.
- **Level:** Advanced · **Learn first:** ORG-07 · **What you learn:** each value says the level that set it, and removing one brings the inherited value back.
- **Steps:**
  1. Read: a list of effective values, each with the level and path that set it, and what it overrides.
  2. Remove: 204. The inherited value now applies.
- **You know it worked when:** a fresh read shows the value set at the higher level.
- **Variations and refusals:** removing something not set there gives 404 "A {kind} '{key}' set at '{scope}'". Some kinds have their own console screens (secrets, autonomy, budgets, app settings; other readers). Context does not.
- **Where:** `TreeEndpoints` `/cascade`; `CascadeService`.
- **Reachable from:** API / MCP (context and settings); UI for specific kinds via other screens.
- **Covered by tests:** `PlatformApiTests.Secrets_cascade_are_sealed_at_rest_and_the_console_only_ever_sees_names`; `RunnerContractTests.Autonomy_and_stage_rule_sets_resolve_down_the_cascade_and_reach_the_runner`.

### TREE-13 Manage a division from the console: what is actually there
- **Who:** depends on the link.
- **Starts at:** `/`, select the division.
- **Needs:** a division.
- **Level:** Core · **Learn first:** ORG-06, ORG-07 · **What you learn:** a division is managed through the screens that take it as their level, not through a division page.
- **Steps:** with the division selected, the person can:
  - talk to it (TALK-02);
  - set its autonomy ("Autonomy for {division}");
  - see its hiring ("Hiring");
  - ask for ideas from it ("Ideas from your portfolio");
  - manage its people ("People", Admin);
  - manage its secrets ("Secrets for {division}", Admin).

  Budgets and narrower overdrafts are set on `/credits` (credits reader).

  Nothing in the console renames, archives, deletes or moves it. There is no division page and no division settings form.
- **You know it worked when:** each linked screen opens already scoped to the division.
- **Variations and refusals:** none further.
- **Where:** `HomeView.tsx` (`ManageLinks`).
- **Reachable from:** UI.
- **Covered by tests:** see ORG-06.

---

## ONT: "Who works on what" and "How data flows"

### ONT-01 Switch between the three views
- **Who:** any member.
- **Starts at:** `/`, the tab list "View" above the chart.
- **Needs:** at least one division.
- **Level:** Core · **Learn first:** ORG-08 · **What you learn:** the same organisation can be read as a chart, as responsibility, or as data.
- **Steps:** tabs "The organisation" (default), "Who works on what" and "How data flows". Selecting one swaps the panel. The two graph tabs each call `GET /api/ontology?scope={org}&view=org-chart|data-flow`.
- **You know it worked when:** the selected tab is raised and the panel changes.
- **Variations and refusals:**
  - The choice is not remembered: it returns to "The organisation" on every visit.
  - **Finding:** both graphs always ask at organisation level and ignore the selection.
- **Where:** `HomeView.tsx` (`ChartViews`).
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("…and the graph views").

### ONT-02 Read "Who works on what" (desktop)
- **Who:** any member with a role at organisation level (see ORG-19).
- **Starts at:** `/`, tab "Who works on what".
- **Needs:** md width or wider.
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
- **Steps:** the drawing is hidden. A list shows each node that has outgoing edges: its type, its name (a link for employees, contractors and apps), and lines like "works on {Name} ({label})".
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
- **Steps:** select an Employee or Contractor node, or its link in the list, to go to `/employees/{id}`. Select an App node to go to `/apps/{id}`. Other nodes (organisation, division, project, person, secret, service, webhook, schedule) do nothing when selected.
- **You know it worked when:** the employee's or app's page opens.
- **Variations and refusals:** the SVG nodes are clickable but are `aria-hidden` and not focusable, so keyboard users reach them only through the list.
- **Where:** `OntologyView.tsx` (`hrefFor`, `open`).
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("…the graph views").

### ONT-06 A graph that fails to load
- **Who:** any member.
- **Starts at:** a graph tab.
- **Needs:** a failed read.
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** a failed read is never shown as an empty graph.
- **Steps:**
  - A failed first load shows "The organisation graph could not be loaded", "{reason} Nothing here is known until it loads." and "Try again".
  - A failed refresh shows the stale notice above the last good graph.
- **You know it worked when:** you see the failure panel, not an empty state.
- **Variations and refusals:** a crash inside the tab shows "Who works on what stopped working." (panel boundary, SYS-08). It resets when you switch tabs.
- **Where:** `OntologyView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `OntologyView.test.tsx`: "loading, failed and empty are distinct".

### ONT-07 Read the ontology by API or MCP
- **Who:** Viewer or above at the scope.
- **Starts at:** `GET /api/ontology?scope=&view=all|org-chart|data-flow`; MCP `ontology_get`.
- **Needs:** Viewer.
- **Level:** Developer · **Learn first:** ONT-02 · **What you learn:** the graph is derived on every read and stored nowhere.
- **Steps:** the answer is `{scope, generatedAt, nodes, edges, views}`. Unlike the console, any scope can be asked for, and `view=all` returns every edge type.
- **You know it worked when:** a 200 answer with nodes and edges.
- **Variations and refusals:** a bad view: "view is all, org-chart, data-flow."
- **Where:** `WorkforceEndpoints` (`/ontology`), `ControlPlaneTools` `ontology_get`.
- **Reachable from:** API / MCP (the console uses two fixed views at organisation level).
- **Covered by tests:** `WorkforceTests.The_ontology_is_derived…`; `McpTests`.

---

## TALK: conversations

**How every conversation works** (`ConversationService`, `ConversationWorkflow`):
- Sending a message needs Builder at the scope. Reading the history needs Viewer.
- Each message (1 to 20,000 characters) becomes a `conversation` run. The message is its first event, from "owner".
- One conversation exists per scope plus employee, and every new message continues the latest one, whoever sends it. Every message says who sent it, by name.
- Before a message is sent, the dock shows what it can cost at most (`POST /api/conversations/estimate`); the same estimate opens the turn's run.
- The reply is written by Endgame's assistant (system prompt `Runner/Prompts/conversation.md`) or, with an employee, **by that employee** (TALK-05). It remembers the last 6 turns and has five tools:
  - `read_organisation`, which reads "overview", "workforce", "tasks", "runs" or "credits" at the scope or beneath it;
  - `start_idea`, a checkpoint (asks first);
  - `change_app`, a checkpoint: asks the factory to change a built app (CHG-02);
  - `try_again`, a checkpoint: starts stopped research, a build or a change again (TALK-18);
  - `adjust_setting`, a checkpoint, limited to `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`, `sleep.mode`, `sleep.idle_minutes` and `workforce.idle_days`.
- Each checkpoint is answered in the conversation itself (TALK-17), titled with what will happen.
- It works in up to 12 steps.
- It cannot create, rename or delete nodes, set budgets, secrets, context or access, hire, or decide verdicts.

### TALK-01 Talk to the whole organisation
- **Who:** Builder or above at the organisation (to send); Viewer (to read).
- **Starts at:** `/`, the dock, with the whole organisation selected (the default).
- **Needs:** at least one division (otherwise there is no dock, ORG-12).
- **Level:** Foundation · **Learn first:** ORG-07 · **What you learn:** the conversation answers for the selected level and everything beneath it.
- **Steps:**
  1. The dock shows a square avatar and "Talking to {org}", with the hint "Select a division, project or employee to narrow this."
  2. The history loads: a skeleton, screen-reader text "Loading what was said before" (TALK-11).
  3. If nothing has been said yet: "Ask what needs you, or tell it what to change. It answers for {org} and everything beneath it."
  4. Below the log: label "Message {org}", input placeholder "Ask, or tell it what to change", the button "Send" (disabled while the input is blank or the cost is being worked out), and under it "A message here costs at most {ceiling} credits, usually about {credits} credits; it is charged at what it actually costs." ("Working out what a message costs…" while it loads).
  5. The person types a question (for example "what is over budget?") and presses "Send". Their bubble, headed "You", appears right away, faded while it sends (`POST /api/conversations {scope}`). Typing dots and "Working on it" show.
  6. The Runner answers using `read_organisation`. The reply streams in as a grey bubble headed "Endgame". When the run did tool work, the link "See how it got there" appears (TALK-12).
  7. Up to two lines under the log show employees working anywhere in the tree: "{Name} is {activity}".
- **You know it worked when:** a grey reply bubble appears under your message.
- **Variations and refusals:** see TALK-13 to TALK-15. If the cost cannot be worked out: "What a message costs could not be worked out: {reason} Its cost is still held before each step and shown with the reply." and Send stays available.
- **Where:** `ConversationDock.tsx`; `POST /api/conversations/estimate`, `POST`/`GET /api/conversations` (`WorkEndpoints`); `FactoryEstimates.ConversationAsync`; `Runner/Workflows/ConversationWorkflow.cs`; `Runner/Agents/RunnerTools.cs` (`ReadOrganisationTool`); `GET /api/runs/{id}/events`.
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
- **Starts at:** the app's page, where the app page mounts the conversation for that app (`AppConversation`, exported by `ConversationDock.tsx`); or API `POST /api/conversations {scope: "{org}/{division}/{project}/{app}", message}`, or MCP `conversation_post`.
- **Needs:** an app.
- **Level:** Core · **Learn first:** TALK-03 · **What you learn:** the app has a conversation of its own, about it only, which can ask for a change to it.
- **Steps:**
  1. The dock shows a square avatar and "Talking to {app}", with the hint "About {app} only: ask about it, or ask for a change to it."
  2. Ask a question, or describe a change (CHG-02). Reads are limited to the app.
  3. Replies, approvals and the cost before sending work as in TALK-01, TALK-17.
- **You know it worked when:** "Talking to {app}" heads the dock and replies arrive.
- **Variations and refusals:** the app page's "Ask about this app" is a different feature (questions answered from the app's telemetry; apps reader). An idea started here is raised at the division above.
- **Where:** `ConversationDock.tsx` (`AppConversation`, the `app` selection); `WorkEndpoints` `/conversations`; `ControlPlaneTools` `conversation_post`.
- **Reachable from:** UI (once the app page mounts it); API / MCP.
- **Covered by tests:** `TryAgainAndChanges.test.tsx` ("the conversation… shows the cost first, answers its own approval inline…"); `IdeasAndConversationsTests` (per scope); `McpTests`.

### TALK-05 Talk to an employee from the chart
- **Who:** Builder or above at the employee's level.
- **Starts at:** `/`, select an employee chip (band, division or project).
- **Needs:** an employee.
- **Level:** Core · **Learn first:** ORG-11, TALK-01 · **What you learn:** the employee itself answers — from its job, its mandate and what it remembers.
- **Steps:**
  1. The dock shows a round avatar and "Talking to {Name}", the hint "Select the organisation band to talk to everything again.", and the link "See {Name}’s job, record and memory" (to `/employees/{id}`).
  2. The history loads for that level plus that employee (`GET /api/conversations?scope=…&employeeId=…`).
  3. Typing lines show only that employee's activity. The cost shown before sending is priced on the employee's own model tier.
  4. Sending works as TALK-01, with `employeeId`. The employee answers: its name, role and mandate, its curated memory as context, its own thinking power (model tier); it may keep a note with `remember`. The reply bubble is headed with its name.
- **You know it worked when:** "Talking to {Name}", and the reply is headed "{Name}" and answers in the first person from its job.
- **Variations and refusals:** the same tools and checkpoints as any conversation; the model cost is charged to the employee.
- **Where:** `OrgChart.tsx` (`WorkerChip`), `ConversationDock.tsx`; `ConversationService.PostAsync`; `ConversationWorkflow` (`AsEmployee`, `AgentFactory.As`).
- **Reachable from:** UI.
- **Covered by tests:** `WorkflowTests.Talking_to_an_employee_is_answered_by_that_employee_from_its_job_and_memory`; `TryAgainAndChanges.test.tsx` ("names the employee who answers"); `HomeView.test.tsx`: "asks for one employee's conversation by their id"; `workforce.spec.ts`.

### TALK-06 Talk to an employee on their own page
- **Who:** Builder or above.
- **Starts at:** `/employees/{id}`, section "Talk to {Name}".
- **Needs:** the record is an employee (not a contractor) and has not been released; the tree has loaded.
- **Level:** Core · **Learn first:** TALK-05 · **What you learn:** the same conversation is reachable from the employee's record.
- **Steps:** the same dock as TALK-05. On this page the hint reads "Only {Name} hears this, and answers from its job and what it remembers.", and the link to the record is left out. It is the same conversation as from the chart, at the employee's level.
- **You know it worked when:** messages sent here also appear when the same employee is selected on home.
- **Variations and refusals:**
  - Contractors and released employees have no conversation section.
- **Where:** `features/workforce/EmployeeView.tsx`, `ConversationDock.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `EmployeeView.test.tsx` (workforce reader; not inspected in detail).

### TALK-07 Ask the conversation to start researching an idea
- **Who:** Builder or above (to send and to approve).
- **Starts at:** any dock (TALK-01 to TALK-06).
- **Needs:** a scope; credits (TALK-15).
- **Level:** Core · **Learn first:** TALK-01, ORG-05 · **What you learn:** the conversation proposes; nothing happens until you approve, there in the conversation.
- **Steps:**
  1. The person writes, for example, "Start researching a booking app for dive centres." and presses "Send".
  2. The assistant calls `start_idea`. It is a checkpoint, so a card appears in the dock: **"Needs you"**, "Start researching an idea: {idea text}?", **"Add a note (optional)"**, **"Approve"** / **"Decline"** and "Declining skips only this step; the work goes on without it." The typing line reads "Waiting for your answer".
  3. Home's "needs you" strip gains an "Approval needed" card too, and within the sweep interval a notification.
  4. Press **"Approve"** (TALK-17). The idea is recorded (at the division, or at the division above for a project or app scope) with its research estimate, and research is queued.
  5. The assistant replies in the dock, for example confirming research has started.
- **You know it worked when:** the reply confirms it, and a "Researching" card or run appears, then a "Verdict waiting" card once research ends.
- **Variations and refusals:**
  - Declined: TALK-09.
  - The idea is refused (for example a red line, or no credits): the tool reports "The idea could not be started ({status}): …" and the assistant must say it did not happen.
- **Where:** `RunnerTools.StartIdeaTool` (`IApprovalTitle`), `AgentFactory.Conversation` (checkpoints); `Harness/Kernel/AgentLoop.cs` (`AskAsync`); `FactoryEndpoints` `POST /internal/ideas`; `ConversationDock.tsx` (`Replies`), `runs/ApprovalCard.tsx`.
- **Reachable from:** UI; MCP `conversation_post` plus `approval_answer`.
- **Covered by tests:** `WorkflowTests.A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea`; `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TALK-08 Ask the conversation to change a setting at this level
- **Who:** Builder or above (send). Approver as TALK-07.
- **Starts at:** any dock.
- **Needs:** —
- **Level:** Advanced · **Learn first:** TALK-07 · **What you learn:** a setting changed at a level applies beneath it; the assistant may only touch an allow-list, and only after you approve.
- **Steps:**
  1. The person asks, for example, "switch this division to checkpoints", "keep apps awake", "let apps sleep after 30 minutes" or "flag idle employees after 14 days".
  2. The assistant calls `adjust_setting {key, value}`. A card in the dock asks what will change, in the screens' own words, for example "Stop for your sign-off at checkpoints here?", "Switch here to auto-mode?", "Turn on the “Before the plan is carried out” checkpoint here?", "Keep the apps here always on?", "Let the apps here sleep after 30 minutes without a visitor?" or "Flag employees here who have had no work for 14 days?" (TALK-17).
  3. Once approved, `PUT /internal/cascade` sets the value at this level, marked as set by an agent. For `sleep.*` keys, the edge's routes are refreshed.
  4. The assistant replies. The change shows wherever that setting is read, for example "Autonomy for …" (autonomy reader) or the app's running chip.
- **You know it worked when:** the reply confirms it, and the relevant screen shows the value "set at" this level.
- **Variations and refusals:**
  - Any key off the allow-list is refused with 403 "An agent may not change that": "Agents may change only these settings, each confirmed by the owner first: … Everything else, including who may open an app, is done by a person in the console."
  - The raw key and value are in the detail line, shown in technical mode only.
- **Where:** `RunnerTools.AdjustSettingTool`; `FactoryEndpoints` `PUT /internal/cascade`; `Domain/Cascade/Autonomy.cs` (`AgentSettings.Allowed`).
- **Reachable from:** UI (approval in the conversation, or on the run page).
- **Covered by tests:** `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

### TALK-09 Decline what the conversation proposed
- **Who:** the approver.
- **Starts at:** the card in the conversation (TALK-17), or the run page.
- **Needs:** a pending conversation approval.
- **Level:** Core · **Learn first:** TALK-07 · **What you learn:** a decline is final for that step, your note reaches the assistant, and it says it did not do it.
- **Steps:** optionally type a note, then press **"Decline"**. The card reads "Declined. It was not done; the work continues without it." The tool is denied ("The owner declined this call, so it was not done. Their note: “…” Carry on without it, or finish and say plainly that it was not done."). The assistant's reply says it did not do it.
- **You know it worked when:** no idea, change or setting appears, and the reply says so.
- **Variations and refusals:** none further.
- **Where:** `AgentLoop.AskAsync`; `POST /api/runs/{id}/approvals/{approvalId} {decision, note}`.
- **Reachable from:** UI; MCP `approval_answer`.
- **Covered by tests:** `WorkflowTests.The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully`; `TryAgainAndChanges.test.tsx`.

### TALK-10 Ask the conversation for something it cannot do
- **Who:** Builder or above.
- **Starts at:** any dock.
- **Needs:** —
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** the conversation can read, start ideas, ask for a change to an app, try stopped work again and change a few settings, and nothing else.
- **Steps:** the person asks, for example, to make an app public, create or rename a division, set a budget, set a secret, or hire someone. The assistant has no tool for these. Its prompt says "Never claim to have done something a tool did not do." It should answer that it cannot, and may point to the screen. For an off-list setting, it gets the 403 in TALK-08.
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
  2. Earlier turns draw as blue bubbles (people's) and grey bubbles (replies), each headed by who said it: "You" for your own, the sender's name for anyone else's, the employee's name or "Endgame" for replies. Endgame's own notices (TALK-15) draw as notices. Consecutive messages from one person on one run are merged.
  3. Messages sent during this visit are drawn from their live run, never twice.
- **You know it worked when:** after a reload, your earlier exchange is still in the dock.
- **Variations and refusals:**
  - History fails: "What was said before could not be loaded: {reason} New messages still send." with "Try again".
  - A failed refresh: "The latest refresh failed: {reason}".
  - The conversation is shared by everyone at that level; each message is named, so who said what is clear.
  - An unknown `conversationId` (API only) gives 404 "The conversation"; one from another level gives 409 "This conversation belongs to another scope; start a new one here."
- **Where:** `ConversationDock.tsx` (`groupTurns`, `EarlierTurn`); `ReadModels.ConversationAsync`; `ConversationService`.
- **Reachable from:** UI; API `GET /api/conversations`; MCP `conversation_history`.
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
- **Level:** Advanced · **Learn first:** TALK-01, credits (another reader) · **What you learn:** a conversation spends credits like any other work, shows its cost first, and says so when they run out.
- **Steps:**
  1. Under the input, before sending: "A message here costs at most {ceiling} credits, usually about {credits} credits; it is charged at what it actually costs."
  2. Sending still succeeds: the run is queued.
  3. When the model call is refused for budget, a notice appears in the dock instead of a reply: "The credit budget ran out before a reply could be written, so nothing was answered and nothing more was charged. Top up or raise the budget, then ask again." with **"See credits"**. It is kept in the conversation's history.
  4. If the assistant cannot complete for another reason, the reply reads "I could not finish answering that. Please ask again."
- **You know it worked when:** (a refusal) the notice with "See credits" shows in the conversation.
- **Variations and refusals:** **Not verified from code:** whether a missing or invalid model key ends as "I could not finish…" or as a failed run with no message.
- **Where:** `ConversationWorkflow` (the `budget_exhausted` notice); `ConversationDock.tsx` (`Notice`); `Runner/Execution/RunContext.cs` (`WorkflowOutcome.FromAgent`).
- **Reachable from:** UI.
- **Covered by tests:** `WorkflowTests.A_conversation_the_budget_stops_says_so_in_the_conversation`; `TryAgainAndChangesTests.A_message_shows_what_it_can_cost_first_and_the_conversation_names_who_said_what`; `TryAgainAndChanges.test.tsx`.

### TALK-16 Talk over MCP or the API
- **Who:** an AI assistant with a token (Builder or above), or a developer.
- **Starts at:** MCP `conversation_post {scope, message, employeeId?}`, or `POST /api/conversations {scope, message, employeeId?, conversationId?}`.
- **Needs:** Builder; with a token, capped at the token's role.
- **Level:** Developer · **Learn first:** TALK-01, AI assistants (another reader) · **What you learn:** the docked conversation is the same thing from outside.
- **Steps:** send it. Get back the run. Read its events via MCP `run_events` or the stream. Pending approvals are answered with `approval_answer` (with `note`). The history is read with MCP `conversation_history`, and what a message costs with `conversation_estimate`.
- **You know it worked when:** a `message` event from "assistant" on the run.
- **Variations and refusals:** a Viewer's token changes nothing.
- **Where:** `ControlPlaneTools` `conversation_post`; `WorkEndpoints`.
- **Reachable from:** API / MCP.
- **Covered by tests:** `McpTests.The_control_plane_tools_do_what_the_console_does_under_the_same_rules`, `McpTests.A_viewers_token_reads_and_changes_nothing`; `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…`.

### TALK-17 Answer the conversation's own approval in the conversation
- **Who:** Builder or above at the conversation's scope.
- **Starts at:** a card in the dock, under the message that led to it.
- **Needs:** the assistant asked for a checkpoint (`start_idea`, `change_app`, `try_again`, `adjust_setting`).
- **Level:** Core · **Learn first:** TALK-07 · **What you learn:** you answer where you asked, and the answer says truthfully what happens next.
- **Steps:**
  1. The card shows **"Needs you"**, the title of what will happen ("Start researching an idea: …?", "Change the app: …?", "Try again: …?", a setting in plain words), **"Add a note (optional)"**, **"Approve"** / **"Decline"**, and "Declining skips only this step; the work goes on without it." The typing line reads "Waiting for your answer".
  2. Optionally type a note; press **"Approve"** or **"Decline"**.
  3. The card reads "Approved. The work carries on from here." or "Declined. It was not done; the work continues without it."; the assistant receives the answer and the note and replies.
- **You know it worked when:** the card is answered and the reply follows.
- **Variations and refusals:** a failed answer: "Your answer was not recorded: {reason}". In technical mode the detail (tool, arguments, rule) is shown under the title.
- **Where:** `ConversationDock.tsx` (`Replies`), `runs/ApprovalCard.tsx`; `POST /api/runs/{id}/approvals/{approvalId}`.
- **Reachable from:** UI; MCP `approval_answer`.
- **Covered by tests:** `TryAgainAndChanges.test.tsx` ("the conversation… answers its own approval inline with a note…").

### TALK-18 Ask the conversation to try stopped work again
- **Who:** Builder or above.
- **Starts at:** any dock whose scope holds the stopped work.
- **Needs:** failed, cancelled or budget-stopped research, a build or a change in the conversation's part of the tree.
- **Level:** Core · **Learn first:** CHG-03, TALK-17 · **What you learn:** the conversation can start stopped work again on your word, carrying on from where it stopped.
- **Steps:**
  1. Ask, for example, "Try the failed build again."
  2. The assistant reads the runs, then asks **"Try again: {the work's title}?"** (TALK-17).
  3. Approve. The new attempt starts with its estimate first and carries on from the earlier one (CHG-03); the assistant says so.
- **You know it worked when:** a new run for the work appears.
- **Variations and refusals:** work outside the conversation's scope is not found; work that has not stopped, or was already tried again, is refused with the reason, and the assistant says it did not start.
- **Where:** `RunnerTools.TryAgainTool`; `POST /internal/runs/{id}/retry`; `RetryService`.
- **Reachable from:** UI (conversation); MCP `run_retry`.
- **Covered by tests:** `WorkflowTests.The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully`; `TryAgainAndChangesTests.A_built_app_is_changed…` (the internal retry's scope check).

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
- **Steps:** the bell polls `GET /api/notifications?organisation={slug}&limit=50` every 30 seconds while focused. A coral badge shows the unread count ("99+" above 99). The accessible label reads "Notifications, {n} unread" or "Notifications, none unread".
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
- **Steps:** select the bell. A panel "Notifications" opens with "See all" (to `/notifications`) and the first 8 items of the feed (the rows are described in NOTE-03). Escape, or a click outside, closes it. Following an item, or "See all", also closes it.
- **You know it worked when:** the panel lists your latest notices.
- **Variations and refusals:** a crash in the panel shows "Your notifications stopped working." (SYS-08).
- **Where:** `NotificationsBell.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx` (the bell).

### NOTE-03 Read the full feed
- **Who:** any member.
- **Starts at:** `/notifications`, reached by the bell on a phone (a link), "See all", or a direct address.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-01 · **What you learn:** what you are told about, and that urgent ones are e-mailed.
- **Steps:**
  1. The breadcrumb reads "{org} / Notifications".
  2. Heading "Notifications", with: "What needs you, newest first. The urgent ones — a cap reached, credits at zero, the overdraft, an app that stopped, a security finding — are e-mailed too, when e-mail is set up."
  3. The feed shows "Nothing unread." or "{n} unread", plus "Mark all read".
  4. Each row shows:
     - a badge: "Verdict", "Approval", "Hire", "Budget", "Credits", "Overdraft", "App" or "Security" (anything else "Update"); amber for urgent, blue otherwise;
     - "New" when unread;
     - how long ago;
     - the title as a link;
     - one line of detail;
     - "Mark read" when unread;
     - "Also e-mailed" when it was;
     - in technical mode, the raw kind.

     Unread urgent rows are tinted amber; other unread rows are tinted blue.
  5. An aside "What you are told about" lists: "A verdict waiting for your call", "An approval the work is waiting on", "A hire proposed", "A budget at 80% and at its cap", "Credits at zero, halfway to the overdraft limit, and at it", "An app that stopped working", "A security review that found a problem". It adds: "Owners and Admins are told about what their grant covers; others see an empty feed."
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
  - the idea, run, hire, app or employee named as the subject (see the table above);
  - otherwise, `/credits` for budget, credits or overdraft kinds;
  - otherwise, `/hires?scope=…` for a hire;
  - otherwise, `/notifications`.
- **You know it worked when:** the subject's page opens and the row no longer shows "New".
- **Variations and refusals:** an employee's budget notice goes to the employee's page, not credits, because the subject wins.
- **Where:** `notificationModel.ts` (`notificationHref`).
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "notification model — leads each kind to what needs the person".

### NOTE-05 Mark one notice read
- **Who:** an Admin or Owner.
- **Starts at:** a row's "Mark read".
- **Needs:** an unread notice.
- **Level:** Foundation · **Learn first:** NOTE-03 · **What you learn:** read state is yours alone.
- **Steps:** select "Mark read". The row and the count update at once (`POST /api/notifications/{id}/read`). The read is recorded for this person only.
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
- **Steps:** select it. Everything turns read at once, and the count reads "Nothing unread." (`POST /api/notifications/read-all?organisation=…`; up to 200).
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
  - Nothing to show: "Nothing needs you" with "Verdicts waiting, approvals, hires, budgets running low and anything that breaks appear here."
  - A Builder or Viewer always sees this, because the server returns an empty feed.
  - A signed-in person with no organisation, on `/notifications`, sees "There are no notifications until your organisation is named".
- **You know it worked when:** you see "Nothing needs you".
- **Variations and refusals:** none further.
- **Where:** `NotificationFeed.tsx`, `NotificationsView.tsx`; `NotificationService.FeedAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx`: "records a failed read, and an empty feed as nothing needing the person".

### NOTE-08 The feed fails to load
- **Who:** anyone.
- **Starts at:** NOTE-02 / NOTE-03.
- **Needs:** a failed read.
- **Level:** Core · **Learn first:** NOTE-03 · **What you learn:** a failure is never shown as "nothing".
- **Steps:**
  - First load fails: "Your notifications could not be loaded", "{reason} Nothing here is known until it loads." and "Try again".
  - A later refresh fails: the stale notice above the last good feed.
- **You know it worked when:** the failure panel appears.
- **Variations and refusals:** none further.
- **Where:** `NotificationFeed.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx` ("records a failed read…").

### NOTE-09 Receive an urgent notice by e-mail
- **Who:** the Owner and organisation-level Admins.
- **Starts at:** the system raises an urgent notice.
- **Needs:** a mail server configured.
- **Level:** Core · **Learn first:** NOTE-03 · **What you learn:** urgent notices reach you away from the console.
- **Steps:** when a notice is first raised and is urgent, an e-mail is queued with the subject "{org}: {title}" and a body of the title, the detail, and "({path})". The row then shows "Also e-mailed".
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
- **Steps:** call it. It returns the same feed, up to 50.
- **You know it worked when:** the feed comes back.
- **Variations and refusals:** Builder or below: refused. There is no MCP tool to mark a notice read.
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
- **Steps:** select "Technical". The toggle marks it pressed, and a "System" link (a health icon) appears beside it. Technical wording appears across screens: "MCP access", raw notification kinds, internal service names. The choice is remembered in this browser.
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
- **Steps:** the breadcrumb reads "System". The page shows "System status is technical detail", "It names the services Endgame runs on, so it is shown in technical mode only." and "Switch to technical mode". Selecting the button switches mode and shows SYS-03 in place.
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
  1. Heading "System status", with "Every service, asked directly whether it is healthy." and a "Check again" button.
  2. On first load: "Checking every service…".
  3. A summary card shows "All services healthy" (green) or "{n} of {m} services unhealthy" (amber), and "Checked at {hh:mm:ss}".
  4. One card per configured service, in this order: "Control plane", "Edge", "Runner", "Dock", "Database", "Console", "Cloudflare and backups", "Telemetry collector", then any extras. Each shows its latency ("{n} ms" or "{n.n} s"), a "Healthy" / "Unhealthy" badge, and any detail.
  5. The page re-checks every 10 seconds while focused. "Check again" forces a check, spinning while it runs.
- **You know it worked when:** "All services healthy" with one card per service.
- **Variations and refusals:**
  - A service whose address is not configured is not probed or listed.
  - A probe that throws still yields a row, marked unhealthy, with the error.
- **Where:** `features/status/SystemStatusView.tsx`, `statusModel.ts`; `GET /api/system/status` (`Program.cs`, `Application/Status/GetSystemStatus.cs`, `Infrastructure/Health/StatusOptions.cs`).
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
  - First load fails: "System status could not be loaded", "{reason} Nothing below is known until a check succeeds." and "Try again". Reasons: "The control plane answered {status}.", "The control plane could not be reached.", "The control plane sent an answer that could not be read." or "The control plane did not answer in time."
  - A later check fails: on the summary card, "The latest check failed: {reason} These results are from the last one that succeeded."
  - Zero services: "The control plane answered, but reported no services. That is a fault, not a quiet system."
- **You know it worked when:** the matching message appears.
- **Variations and refusals:** none further.
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
- **Variations and refusals:** which services exist, how fast they answer and what went wrong are never shown to someone signed out.
- **Where:** `Program.cs`, `Application/Status/ServiceHealth.cs` (`SystemStatusSummary`).
- **Reachable from:** API (the summary anonymously).
- **Covered by tests:** `SystemStatusEndpointTests` (including "Signed_out_it_says_only_whether_the_whole_is_healthy_and_when").

### SYS-06 Open an address that does not exist
- **Who:** anyone signed in.
- **Starts at:** any unmatched address, for example `/divisions/x`.
- **Needs:** —
- **Level:** Foundation · **Learn first:** ORG-04 · **What you learn:** a stale link says so plainly.
- **Steps:** the breadcrumb reads "Not found". The page shows "Nothing lives at this address", "The link may be old, or the thing it pointed to was removed." and "Back to the org chart", which goes to `/`.
- **You know it worked when:** "Nothing lives at this address".
- **Variations and refusals:**
  - A well-formed address whose record is missing (for example `/apps/{unknown id}`) is not this page: it is that screen's own failed state (other readers).
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
- **Variations and refusals:** none further.
- **Where:** `components/ErrorBoundary.tsx`, `App.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `ErrorBoundary.test.tsx`: both tests; `workforce.spec.ts`: "a crash or an unreadable answer never blanks the page".

### SYS-08 One panel crashes and the rest keeps working
- **Who:** anyone.
- **Starts at:** home, the bell or the employee page.
- **Needs:** a rendering error inside a panel.
- **Level:** Core · **Learn first:** SYS-07 · **What you learn:** as SYS-07.
- **Steps:** only that panel shows "{name} stopped working." with the same text and buttons. The named panels in my scope:
  - "The org chart";
  - "The conversation" (resets when the selection changes);
  - "The organisation", "Who works on what" or "How data flows" (resets when the tab changes);
  - "Your notifications".
- **You know it worked when:** the rest of the page stays usable.
- **Variations and refusals:** none further.
- **Where:** `HomeView.tsx`, `NotificationsBell.tsx`, `NotificationsView.tsx`, `EmployeeView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `ErrorBoundary.test.tsx`.

### SYS-09 The console opens, or cannot check who you are
- **Who:** anyone.
- **Starts at:** any address.
- **Needs:** —
- **Level:** Foundation · **Learn first:** — · **What you learn:** "signed out" and "could not check" are different.
- **Steps:**
  - While `GET /api/me` runs: a header skeleton (label "Opening Endgame").
  - When a screen's code is loading: "Opening the screen".
  - A 401 is treated as signed out and goes to sign-in.
  - Any other failure: "Endgame could not check who you are", "{reason} Nothing here is known until it loads." and "Try again".
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
- **Steps:** while loading, skeletons. On failure: "The organisation could not be loaded", "{reason} Nothing here is known until it loads." and "Try again". There is no dock while failed. The reason is the server's own text where it gives one, for example "The organisation 'x' (404)", or "Endgame could not be reached.", "Endgame did not answer in time.", etc.
- **You know it worked when:** after "Try again", the chart appears.
- **Variations and refusals:** an answer in an unexpected shape fails the same way, with "Endgame sent the organisation in a shape this screen does not understand: {field}."
- **Where:** `HomeView.tsx`, `lib/queryState.ts`, `store/api.ts` (`checkedQuery`).
- **Reachable from:** UI.
- **Covered by tests:** `HomeView.test.tsx`: "shows skeletons while the tree loads", "records a failed read on the page, never as an empty organisation"; `console.spec.ts`: "a failed read is shown as a failure, with a way to try again".

---

## Gaps and oddities found

1. **No console route to manage the tree.** Creating, renaming, archiving and deleting divisions, projects and apps are API/MCP only; creation also happens through factory placement. Moving is impossible by any route. The owner cannot choose a division on `/start`.
2. **Fixed:** MCP `node_update` no longer points to a console control that does not exist; it names `PATCH /api/organisations/{id}`. There is still no console control to rename the organisation.
3. **There is no way to describe a level from the console.** No node has a description field, and context is set only through `PUT /api/cascade` or MCP `cascade_set`. The conversation cannot set it.
4. **Fixed on 2026-11-25 (lane C):** the employee conversation is answered by the employee (TALK-05, TALK-06); messages are named (TALK-11); the dock works for an app scope and is exported for the app page (TALK-04 — the app page mounts it); the dock answers its own approvals, titled in plain words (TALK-17); a message's cost is shown first and a budget stop is said in the dock (TALK-15).
5. **Conversations are shared per level.** Everyone at a level reads and continues the same conversation; messages are named, not private.
6. **Divisions and projects have no page of their own**, though the spec says "Selecting a node opens it".
7. **Fixed:** a person granted below organisation level starts at their own level, and the graphs ask at the selection (ORG-19).
8. **Dead UI branches**:
    - the "verdict" project stage, with "Read the verdict" and "Idea · paused at verdict";
    - the stages "idea", "evaluating", "publishing" and "dropped";
    - the "Nobody works on anything yet" empty state when divisions exist.
9. **Fixed:** `topup.requested` is raised to operators and labelled "Top-up request" (NOTE).
10. **Partly fixed:** archiving a division or project stops its apps being routed, and the tree marks archived nodes (TREE-07); the chart does not draw "Archived" on a division yet. A Builder can still set an app's status to "running" or "failed" by hand through `PATCH /api/apps/{id}`.
11. **Fixed:** `GET /api/system/status` says only `overall` and `checkedAt` to someone signed out (SYS-05).
12. **Fixed:** the empty "needs you" line claims only what it checks (ORG-05), and someone who can never name an organisation is told organisations are set up by FrostAura (ORG-03). `/start` itself still offers the organisation field to them.
13. **Small mismatches with the UC docs.**
    - UC-102 and UC-001 describe `needsYou` as "verdicts and approvals" only; hires and idle employees are also sent.
    - UC-001 says selecting "a node or an employee" scopes the conversation; apps cannot be selected.
    - MCP lacks mark-read for notifications and delete for nodes.
