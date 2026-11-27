# The organisation, home and conversations — every flow

The home screen, the tree of divisions, projects and apps, the two graph views, conversations, notifications, system status.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

**What most needs your attention**

1. **The tree is managed on "Manage"** (`/tree`): create, rename, describe, archive, reactivate and delete divisions, projects and apps (TREE-02 to TREE-13). Moving is not possible by any route (TREE-10). The factory still places each built idea, creating its division when needed (TREE-01).
2. **A conversation at a level is shared.** Everyone who talks at the same level and with the same employee writes into one conversation; each message is named, not private.

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
  4. The header shows only the "Endgame" wordmark, the "Normal" / "Technical" switch, your account and "Sign out" (below 1,100 px wide the switch and Sign out are in the account menu). There is no breadcrumb, conversation, bell or credits chip: those appear only once the person has an organisation.
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
  6. The console first calls `POST /api/organisations {name, slug}`. The control plane validates the slug, checks it against reserved names, creates the organisation, makes the caller its Owner, and adds the standing Security reviewer employee. Its answer carries `balance` 0 and `creditsNote` "{Name} has no credits until FrostAura tops it up: its first piece of work waits for budget until then." — Endgame invents no starter credits, so `/api/credits` and the chart read `neverToppedUp: true` until the first top-up. It then calls `POST /api/ideas`.
  7. The browser goes to the research run at `/runs/{id}`. From here on it is the ideas and runs flows (RUN-01).
- **You know it worked when:** you land on the research run's page, and the header gains the organisation's name and the credits chip.
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
     - the mark ("Endgame" beside it from 1,280 px wide);
     - the breadcrumb "{organisation} / Whole organisation", in the bar from 1,280 px wide and on its own row beneath it below that;
     - the "Normal" / "Technical" switch, from 1,100 px wide;
     - the organisation switcher **"Working in"**, always in the bar, for someone in two or more organisations (ID-09);
     - the balance: a neutral chip reading **"Credits"**, the figure and a small status dot, which links to `/credits`, is read out as "{n} credits left" and polls every 30 seconds;
     - the bell (NOTE-01);
     - in technical mode, from 1,100 px wide, **"System"**, an icon link to system status;
     - "Your account" (a person icon, ID-09) and "Sign out" from 1,100 px wide; below that one account menu, **"Your account, the mode and signing out"**, holds your account, the mode, System status (technical mode) and Sign out.

     The bar never wraps (SHL-03). There is also a hidden "Skip to the content" link for keyboard users.
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
  - The chip itself stays neutral; only its dot changes: green with room to spend, amber below zero, red only when nothing is left to spend (overdraft included), grey for an organisation FrostAura has never topped up. The read-out adds ", below zero", ", at its limit" or ", never topped up".
  - "Credits unavailable" appears only when the credits read fails. Someone with no role at the organisation itself has the balance read at their own level (as on Credits), so the chip shows the organisation's balance for them too.
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
     | Verdict refused over a red line | "Refused" | "Research refused this idea: it crosses a red line" | "“{title}” — drop it, or change it." (nothing else can be decided: VERD-06) | `/ideas/{id}` |
     | Approval | "Approval needed" | the approval's title, for example "Start researching an idea: …?" | the detail, or "It waits until you answer." | `/runs/{runId}` |
     | Hire | "Hire proposed" | "Hire {Name} as {Role}?" | "About {credits} a month. {reason}" | `/hires/{id}` |
     | Idle employee | "Nothing to do" | "{Name} has had no work for {n} days" | "Keep them on, give them work, or release them; released employees keep their memory archived." | `/employees/{id}` |

  2. The person selects a card and is taken to that page (other areas).
- **You know it worked when:** the card's subject page opens.
- **Variations and refusals:**
  - On a phone the strip is one row, "{n} things need you", naming the kinds waiting; it opens the sheet "Needs you" with every card.
  - With nothing waiting, the strip shows "Nothing needs you right now: no verdict, approval or hire is waiting, and no one is idle." — exactly the four kinds it checks. Budgets are told in notifications (NOTE).
  - Someone with a role on only part of the tree sees only items on the nodes they can see.
  - A do-not-build verdict reads its idea (`GET /api/ideas/{id}`) to learn whether research refused it over a red line; until that answers, it reads as any do-not-build verdict.
  - An approval whose work ended before anyone answered it is not on the strip (RUN-07).
- **Where:** `HomeView.tsx` (`NeedsYouStrip`, `RefusableVerdictCard`, `needHref`), `needsYouModel.ts` (`RED_LINE_HEADLINE`); `GET /api/tree` (`needsYou`; `ReadModels.NeedsYouAsync`, `WorkforceNeedsAsync`).
- **Reachable from:** UI. MCP `tree_get` returns the same list.
- **Covered by tests:**
  - `HomeView.test.tsx`: "says a verdict waiting in a headline and one line…", "claims only what it checks when nothing needs you", "words a red-line verdict as refused, not as a verdict waiting…"
  - `breadth.spec.ts`: "a needs-you card is a headline and one line"
  - `workforce.spec.ts`: "employees and contractors on their nodes, hires and idle employees in needs you…", "a proposal is read from needs you and accepted…"

### ORG-06 Use the shortcut row for the selected level
- **Who:** depends on the link (below).
- **Starts at:** `/`, the secondary navigation below "needs you" (`nav` "Manage"): one line of links that never wraps; whatever does not fit the width goes, in order, into **"More"** at its end. On a phone the More sheet already holds the organisation's pages, so with the top level selected the row is not drawn; with a division, project, app or employee selected it is one folded row, "Pages for {name}", that opens to the same links.
- **Needs:** an organisation exists.
- **Level:** Core · **Learn first:** ORG-07 · **What you learn:** the links follow the selection, so each one opens that screen for the level you chose.
- **Steps:** the person selects a level (ORG-07); the row rebuilds for it. Possible links, in this order:
  - "Manage": always. Goes to `/tree?scope={path}` (TREE-13).
  - "Hiring": always. Goes to `/hires?scope={path}`.
  - "Autonomy for {level name}": always. Goes to `/autonomy?scope={path}`.
  - "People": Admin, Owner or operator. Goes to `/people?scope={path}`.
  - "Secrets for {level name}": Admin, Owner or operator. Goes to `/secrets?scope={path}`.
  - "Ideas from your portfolio": only when the whole organisation or a division is selected. Goes to `/suggestions?scope={path}`.
  - "AI assistants" (reads "MCP access" in technical mode): always. Goes to `/assistants`, which is not scoped to the level.
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

     The selected card gains a blue ring; so does a selected employee chip.
  3. The breadcrumb becomes the trail, for example "Northwind / Technologies / Court booking". Every step except the last is a button that selects that level in place.
  4. The conversation re-scopes and fetches that level's history (TALK-01 to TALK-05). The shortcut row rebuilds (ORG-06).
  5. To return to everything, the person selects the organisation name in the band or the first breadcrumb step. The conversation's hint says "Select the organisation band to talk to everything again."
- **You know it worked when:** the breadcrumb's last step and the conversation heading "Talking to {name}" both show what you selected.
- **Variations and refusals:**
  - **An app cannot be selected.** App rows are links to the app page (ORG-10), so the conversation is never scoped to an app from home. **Spec mismatch:** the spec says the conversation can be scoped to "an app" and that "Selecting a node opens it". Selecting a division or project only re-scopes; each has its "Manage" link instead (TREE-13).
  - On a phone the header names the level above the one selected while the page's title is in view, then the level selected once the title scrolls under it; **"Up to {level}"** selects the level above, and tapping the name lists every level (SHL-03). Each division on the chart opens folded, the first one open: its header says how many projects and apps it holds, and its chevron shows or folds them.
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
- **Steps:** the chart is a masonry of columns — as many as its width holds, up to four — and each division stacks under whichever column is shortest, so a short division leaves no hole. Each division shows:
  - its letter in an ink badge (one look for every division);
  - "Division" and its name; a long name wraps rather than being cut;
  - "· {credits}", this month's spend summed beneath it, beside "Division", and "Manage" (TREE-13);
  - its own employees as chips;
  - a wire down to its projects: each project (and the row of the division's own people) hangs off it with the same node, and the wire ends at the last project. A lone division takes the full width, with its projects side by side.

  Admins and the Owner see **"Add a division"** at the end of the chart's header row, beside the view tabs (TREE-02).
- **You know it worked when:** the column shows its name and spend.
- **Variations and refusals:**
  - With no projects: "No projects in {division} yet."
  - Archived divisions are folded away after the chart, under one row "Archived ({n})" naming them; opened, each is drawn muted with the badge "Archived" (TREE-07).
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
  3. Under its name the card shows its stage chip and "{credits} this month" (by the one number rule: "0.05 credits this month", "<0.01 credits this month" for under a hundredth, "1 credit this month" only for exactly 1), then an optional note: "Waiting for your approval.", "Work here is paused.", "The last piece of work failed." or "Archived.". A live project with apps has no chip at all. A project that is one app of the same name, with the same spend, says its name and spend once: the app's row carries its chips, **"Open the app"** and its two figures. An app with no version yet (never built, or its build stopped before anything was published) has nothing to open there: the row says a muted "No version yet" in place of "Open the app".
  4. If work is under way: "{stage}, step {x} of {y}" — {x} the step under way, counted from 1 (`progress.step`) — (just "{stage}" until a step of the plan has begun: never "step 0 of {y}"), then "{spent} of an estimated {estimate}" (or "{spent} so far" when there is no estimate, or an estimate of 0), a moving progress bar once there is a plan, filled by the finished steps (`progress.done`), and the link "Watch the work", which goes to `/runs/{id}`.
  5. Below that: its apps (ORG-10) and its people (ORG-11).
- **You know it worked when:** "Watch the work" opens the live run.
- **Variations and refusals:**
  - An archived project is a muted card with the badge "Archived" in place of its stage.
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
     - an app that was never built (a draft, or its first build under way) shows the single chip "Not built yet" in place of these; one whose build stopped before anything was published (`notBuilt`) shows "Not built", with the control plane's line beneath it ("Not built — the build was cancelled."), and its project's stage reads "Not built" with the same line;
     - an app paused behind Edge's holding page (health `paused`) shows "Paused" in place of its health, with the reason beneath it ("Paused: a monthly budget above it is spent. …");
     - an access chip: "Public", "Shared with {n}", "Shared" or "Private";
     - "{n} visits today" (or "{time ago} last visit", or "Not measured yet" when nothing has been measured);
     - "{n} credits this month" — written by the one precision rule (ARCH-011): whole from 10, up to two decimals below, "<0.01" for an amount under a hundredth.
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
  2. Under the chips, working employees get a typing line, "{Name}: {activity}", worded as the dock words it ("Theo is making a change: {request}").
  3. Contractors appear as one dashed spinning line: "{n} contractor(s) · {activity}". On the organisation band a contractor is named by its role, "{Role} · contractor", with the step it is doing after it ("— Looked for evidence people will pay"); so is its node in "Who works on what".
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
  - Any other status: "'x' is not a status an organisation can have: use active, suspended."
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
  1. One slim coral bar, "God mode", sits above the header on every screen, with "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it." on one line, the link "Every organisation" and a chevron, "What God mode means", that opens the full sentence (SHL-05).
  2. Home shows the panel "God mode", "You run Endgame for FrostAura. Every organisation is one step away.", and "List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation’s Owner can read it."
  3. The button "Every organisation" goes to `/operator` (OP-01).
  4. Beside it, every organisation at a glance: "Organisations", "Top-ups asked for" (with "Waiting for your answer" when any are) and "Below zero" ("—" until they are read).
  5. Under the panel, "The organisations": one table with "Organisation", "Standing" ("In credit", "Below zero", "At its limit"), "Balance" and "Last active"; beside it (under it on narrower screens), "Waiting for your answer": each open top-up request ("{organisation} asks for {n} credits", its note and how long ago) and the link "Answer them in God mode" — or "No request is waiting".
- **You know it worked when:** the coral "God mode" band is visible.
- **Variations and refusals:** an operator who holds a role in an organisation (FrostAura's own, where top-up requests reach them) lands on that organisation's home instead, under the same band.
- **Where:** `HomeView.tsx`, `operator/OperatorHome.tsx`, `shell/GodModeBand.tsx`.
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
- **Variations and refusals:** someone with grants in two divisions starts at the first; selecting the other works too. The credits chip shows the organisation's balance, read at their own level (`GET /api/credits?scope={their level}`), never at the organisation where they hold no role.
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
     - it creates the division if missing (`POST /internal/tree/nodes`), then a **new** project (named after the proposal, or the idea's first line) and a new app in it (slug from the proposal, default `web`). A build from an idea is always a new app: a project slug that is already taken gets the next free one (`dive-club-tools-2`), never the project that has it (R9-1).
  4. The run's log says "{name} is a new app. It will live in a new division, {Division}, as a new project of its own." (or "…It will live in {Division} as a new project of its own." when the division existed; "…, beside {project}." when the suggested address was another project's).
  5. Within 15 seconds, home shows the new division column with the project card.
- **You know it worked when:** a new division column appears on the chart.
- **Variations and refusals:**
  - To choose the division yourself, pick it in "Where it goes" (TREE-05), or make it first on "Manage" (TREE-02).
  - A division with the same slug is reused (the idea belongs there); a project or an app never is. A Runner that dies after making the project finds its own project again from its log.
  - A new division can raise a hire proposal (HIRE-01).
- **Where:** `features/start/StartView.tsx`; `Runner/Workflows/BuildWorkflow.cs` (`PlaceAsync`); `FactoryEndpoints` `POST /internal/tree/nodes`; `TreeService.EnsureChildAsync`.
- **Reachable from:** UI (indirectly, through an idea).
- **Covered by tests:** `WorkflowTests.A_new_division_and_a_recurring_job_raise_their_hires_and_a_waiting_hire_never_stops_the_work`; factory tests.

### TREE-02 Create a division directly
- **Who:** Admin or Owner at the organisation.
- **Starts at:** the org chart's **"Add a division"** action (Admins only), which opens `/tree?scope={organisation}&add=1`; or "Manage", the organisation chosen, **"Add a division"**. Also API `POST /api/divisions {parent, name, slug}` and MCP `node_create`.
- **Needs:** Admin at the organisation.
- **Level:** Core · **Learn first:** ORG-07, TREE-13 · **What you learn:** a node's address is made from its name once, when it is made, and never changes.
- **Steps:**
  1. On the chart's header row, beside the view tabs, **"Add a division"**.
  2. It opens "Manage" with the organisation chosen and the form "A new division in {organisation}" open as a card headed by those words, with **"Name"** and **"Its address"**, and **"Add the division"** beside an outlined **"Not now"** of the same size.
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
  2. Press **"Add a project"**: a card opens under it headed "A new project in {division}", with **"Add the project"** and **"Not now"**.
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
  2. Press **"Add an app"**: a card opens under it headed "A new app in {project}", with **"Add the app"** and **"Not now"**.
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
  3. On the org chart it is drawn archived: a division folds into "Archived ({n})" after the chart; a project is a muted card with the badge "Archived".
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
- **Starts at:** "Manage" (`/tree?scope={path}`) or the app's page, **"Delete {name}"**. API `DELETE /api/{divisions|projects|apps}/{id}`; MCP `node_delete` (by scope path).
- **Needs:** Admin; nothing attached to the node.
- **Level:** Advanced · **Learn first:** TREE-07 · **What you learn:** only an untouched node can be deleted; everything else is archived.
- **Steps:**
  1. Press **"Delete {name}"**. The confirmation "Delete {name}?" reads, for a division, "This cannot be undone. Only a division with nothing in it, no work and no spending can be deleted; the settings and roles set on it go with it." — "Only a project …" for a project, and "Only an app …" for an app.
  2. Press **"Yes, delete {name}"** ("Keep it" cancels). The node leaves the outline and its parent is chosen.
- **You know it worked when:** the node is gone from the outline and the chart.
- **Variations and refusals:**
  - Children, runs or credit entries: in normal mode the 409 reads "{name} was not deleted: It still has things beneath it, work or credit history. Archive it instead: it keeps everything and can be brought back." (technical mode shows the server's own words and "(409)") — with the button **"Archive it instead"**, which archives it: "{name} is archived instead. Nothing in it was deleted."
  - Below Admin, no button: "An Admin or above deletes a division with nothing in it." (or "a project", "an app"). The API answers 403 "This needs the admin role at '{path}'; you are a builder there (set at {path})."
  - MCP `node_delete` is held to the same Admin check and gives the same 409 for a node with history; an organisation is refused (400 "An organisation is not deleted; delete a division, project or app.").
- **Where:** `NodeControls.tsx` (`DeleteNode`); `TreeService.DeleteAsync`.
- **Reachable from:** UI; API; MCP `node_delete`.
- **Covered by tests:** `ManageView.test.tsx` ("shows the refusal to delete what has history, and archives it instead"); `tests-e2e/manage.spec.ts`; `CascadeCreditsAndAppsTests`; `SweepXTests.An_assistant_reads_adds_corrects_and_forgets_memory_and_deletes_an_empty_node`; `AuthorizationMatrixTests` (`node_delete`).

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
  2. Press **"Say something about {name}"**. A card opens under it headed "Say something about {name}". Fill **"What it is about"** (hint "For example: Purpose, Audience, House style.") and **"What it says"**.
  3. Press **"Add it"** ("Cancel" beside it). It shows at once with the badge "Said here".
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
  4. **"Remove it; {level}'s applies again"** (or "Remove it", when nothing is inherited) asks first — "Remove {entry} from {name}?", with what follows — and **"Yes, remove it"** removes the entry set here ("Keep it" or Escape keeps it); the inherited one shows again.
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
  6. "What this is" (TREE-11, TREE-12): in the same card, beside the rest on a wide screen and under it on a narrower one. The page is two panes — the outline as wide as a side panel, and the part chosen filling the rest — from 1024 wide up.
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
  2. "Who works on what" swaps the panel for the people, team by team (`GET /api/ontology?scope={selection}&view=org-chart`).
  3. "How data flows" swaps it for the apps against the services they use (`view=data-flow`).
- **You know it worked when:** the selected tab is raised and the panel changes.
- **Variations and refusals:** the choice is not remembered: it returns to "The organisation" on every visit.
- **Where:** `HomeView.tsx` (`ChartViews`).
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("…and the graph views").

### ONT-02 Read "Who works on what"
- **Who:** any member.
- **Starts at:** `/`, tab "Who works on what".
- **Needs:** —
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** who is responsible for what, and who reports to whom.
- **Steps:**
  1. While loading: a skeleton (label "Drawing the organisation").
  2. A key names each mark drawn below, and only those: an arrow for "Works on", the elbow a report hangs from ("Reports to the person above", when anyone reports to anyone) and the accent dot ("Working now", when anyone is); then "Generated {time}."
  3. One card per team, in the organisation's order: "Across the organisation" ({organisation}: the people whose work is the whole organisation), then each division that has people ("Division", its full name), then "Members" ("People who sign in", when the read includes members). Each card says how many people it holds ("2 people").
  4. In a card, each person: an avatar, their name (a link to their page for employees and contractors), their role (left out when it is their name, as for "Security reviewer"), "Working" with the accent dot while at work, and one line per place they work on — "→ Court booking · Project", "→ Northwind · Whole organisation" — and, while on a run elsewhere, "Now on {run} · {place}" in the accent.
  5. A report sits indented under the person they report to, on a rule; a contractor briefed by an employee sits under them with "Briefed by {name}". Contractors alike in every way (same role, place and briefing) are one row with "× {count}", not a link. A reporting line that loops is cut where it closes.
  6. The cards fill the width: as many 20 rem columns as fit (never more than there are teams), each card whole and the columns balanced; one column on a phone. Nothing is cut short — a long name wraps — and nothing scrolls sideways.
- **You know it worked when:** you see your employees, each under the person they report to, beside what they work on.
- **Variations and refusals:** empty state "Nobody works on anything yet" when nobody works on anything (divisions alone do not hide it). Secrets and places nobody works on are not shown here: the chart shows the tree, and "Secrets for {name}" the secrets.
- **Where:** `OntologyView.tsx` (`WhoWorksOnWhat`), `ontologyModel.ts` (`teamsOf`); `GET /api/ontology` (`OntologyService.BuildAsync`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `OntologyView.test.tsx`: "groups people by the division they work in…", "ends on a reporting loop…", "lists who works on what, team by team…" (the key matches the marks drawn)
  - `tests-demo/home-layout.spec.ts`: the views never leave their card, no word is cut while there is room, text is 14 px or more
  - `WorkforceTests.The_ontology_is_derived_from_the_tree_the_workforce_the_vault_and_what_each_app_used`

### ONT-03 Read "How data flows"
- **Who:** as ONT-02.
- **Starts at:** `/`, tab "How data flows".
- **Needs:** as ONT-02.
- **Level:** Core · **Learn first:** ONT-01 · **What you learn:** which platform services each app relies on, and what travels in and out.
- **Steps:**
  1. The key names each mark drawn: an arrow out of a filled accent circle ("The app sends it"), an arrow in, outlined in ink ("The app receives it"), and a hollow ring ("Relies on it; nothing travels") — each only when some cell carries it.
  2. A matrix: a row per app (its name a link to the app), a column per platform service any app has used, in the order Sign-in, Stored data, AI inside apps, Email, Secrets, Health and traffic, Scheduled jobs, Incoming data. Each column heading says how many apps use it ("3 of 5 apps"). Services are named by what they do in normal mode; the internal name follows in brackets in technical mode.
  3. Each cell lists what travels, each on its own line after its mark: "Prompts", "Stored records", "Signed-in people", "Outbound mail", "Operational telemetry"; a declared webhook or schedule appears in its service's column as "Inbound calls ({name})" or "Scheduled calls ({name})". A service an app does not use is "–" ("Not used" to a screen reader).
  4. Pointing at a cell, or reaching it with the arrow keys (the cells are one tab stop, moved between with the arrows), lights its row and column; its tooltip, and what a screen reader reads, is the cell as a sentence: "{app} relies on Sign-in, and receives signed-in people from it."
  5. Where the matrix would not fit (each service needs 120 px beside a 176 px app column) — a phone, a tablet, or a desktop with the conversation open and many services — each app is a card instead: its name, how many services it uses, and a line per service with the same marks and words.
- **You know it worked when:** the cell where an app meets "AI inside apps" says "Prompts" after the arrow out.
- **Variations and refusals:** empty state "No data flows yet" with "Once an app signs people in, sends mail, calls a model or receives data, the flow appears here."
- **Where:** `OntologyView.tsx` (`DataFlow`, `FlowMatrix`, `FlowCards`), `ontologyModel.ts` (`flowOf`, `cellSentence`).
- **Reachable from:** UI.
- **Covered by tests:**
  - `OntologyView.test.tsx`: "puts every relation between an app and a service in one cell…", "shows data flows app by service…", "draws the matrix when the frame has room, and the keyboard walks its cells"
  - `tests-demo/home-layout.spec.ts`
  - `FinalDefectsTests.An_app_people_sign_in_to_depends_on_identity_in_the_data_flow_even_with_no_end_users`

### ONT-04 Read either view on a phone or with a screen reader
- **Who:** any member.
- **Starts at:** as ONT-02 / ONT-03, on a phone (or any width, for a screen reader). On a phone the three view tabs read "Organisation", "Who works" and "Data flow" (their full names are read out).
- **Needs:** —
- **Level:** Foundation · **Learn first:** ONT-01 · **What you learn:** both views are made for a phone too, and read aloud as they are seen.
- **Steps:**
  1. "Who works on what": the same team cards, one under another. Every link in them is a full-size touch target.
  2. "How data flows": a card per app (ONT-03 step 5), every app name a full-size touch target.
  3. A screen reader reads the teams as nested lists ("In Technologies", "Reporting to Odile", "What Kasper works on"), and the matrix as a table whose cells are sentences.
- **You know it worked when:** you see cards under the tabs, and nothing runs off the screen.
- **Variations and refusals:** none further.
- **Where:** `OntologyView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `tests-demo/phone.spec.ts` ("the graph views are cards…"); `OntologyView.test.tsx`.

### ONT-05 Open an employee or app from a graph
- **Who:** any member.
- **Starts at:** ONT-02 to ONT-04.
- **Needs:** —
- **Level:** Core · **Learn first:** ONT-02 · **What you learn:** both views are a way into the records.
- **Steps:**
  1. Select an employee's or contractor's name, or an app named as what someone works on: `/employees/{id}` or `/apps/{id}` opens.
  2. In "How data flows", select an app's name: `/apps/{id}` opens. Divisions, projects, the organisation, members and services are not links.
- **You know it worked when:** the employee's or app's page opens.
- **Variations and refusals:** a row standing for several alike contractors ("× 3") is not a link.
- **Where:** `OntologyView.tsx` (`hrefFor`).
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
- One conversation exists per scope plus employee, and every new message continues the latest one, whoever sends it. Every message says who sent it, by name.
- Before a message is sent, the dock shows what it can cost at most (`POST /api/conversations/estimate`); the same estimate opens the turn's run.
- The reply is written by Endgame's assistant (system prompt `Runner/Prompts/conversation.md`) or, with an employee, **by that employee** (TALK-05). It remembers the last 6 turns and has five tools:
  - `read_organisation`, which reads "contents", "overview", "workforce", "tasks", "runs" or "credits" at the scope or beneath it. "Contents" is every division, project and app there, each app with its state (live, sleeping, building, never built, paused, down, archived) and the counts home shows, so "how many apps do we run?" is answered as home counts — "3 apps: 2 live, 1 never finished building" — never from the recent runs; the overview leads with it;
  - `start_idea`, a checkpoint (asks first);
  - `change_app`, a checkpoint: asks the factory to change a built app (CHG-02);
  - `try_again`, a checkpoint: starts stopped research, a build or a change again (TALK-18);
  - `adjust_setting`, a checkpoint, limited to `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`, `sleep.mode`, `sleep.idle_minutes` and `workforce.idle_days`.
- Each checkpoint is answered in the conversation itself (TALK-17), titled with what will happen.
- It works in up to 12 steps.
- It cannot create, rename or delete nodes, set budgets, secrets, context or access, hire, or decide verdicts.
- A message may carry files (TALK-19): up to 10, 10 MB each, 25 MB in all — images (PNG, JPEG, WebP, GIF), PDFs and text files, checked by their bytes, stored with the conversation in the database and deleted with it. Images reach the model as pictures only where every model on the answering route takes images; otherwise an image is refused before sending. Text and a PDF's text reach it as named blocks.
- A message may be narrowed for itself alone (TALK-20): "Don’t search the web" (where whoever answers can search and the rules let it) and "Answer only: start no work" (where it can start work). The Runner enforces both; nothing widens what the autonomy rules allow.
- Work a message starts (an idea's research, a change, a try again) is named in the turn's log (`message` with `kind: "work.started"`) and followed in the conversation by a live work card (TALK-21). The history lists each turn's run with its tool count and the work it started, so cards come back after a reload.
- The pane (ARCH-012): one conversation, scoped to the page's subject — home's selected level, an app's page its app, an employee's page that employee, a piece of work's page and a verdict's page the level they belong to; tool pages (credits, people, secrets…) have none. On a desktop it is docked at the window's right edge at every width, full height under a header that stays put, narrow or wide, collapsible to a rail, or full width (TALK-23); the page column is capped and centred in the room left. On a tablet it is a drawer from the right, opened from the chat icon in the header; on a phone it fills the sheet opened by **Talk**. A window under 800 px tall draws its header, the "also happening" line and the cost line as one line each.

### TALK-01 Talk to the whole organisation
- **Who:** Builder or above at the organisation (to send); Viewer (to read).
- **Starts at:** `/`, the conversation pane, with the whole organisation selected (the default).
- **Needs:** at least one division (otherwise there is no conversation, ORG-12).
- **Level:** Foundation · **Learn first:** ORG-07 · **What you learn:** the conversation answers for the selected level and everything beneath it.
- **Steps:**
  1. The pane's header shows a square avatar, the level ("ORGANISATION"), "Talking to {org}" and the hint "Select a division, project or employee to narrow this."; at a narrower level, the level just above as a way back up ("· in Technologies") and **×**, which talks to the whole organisation again; on a desktop, the buttons "Make the pane wider", "Open full width" and "Collapse the pane" (TALK-23).
  2. The history loads: a skeleton, screen-reader text "Loading what was said before" (TALK-11).
  3. If nothing has been said yet: "Ask about {org}, or tell it what to change", a sentence on what it answers for and that it can start work here asking first, "Type / for the actions here, or @ to send it to someone or an app beneath this level. Files can be attached or dropped in.", and up to three things to ask, each built from what is really there (an app that is down, what waits for you, the app that cost most this month, a project being built, an idle employee). Choosing one puts it in the box, ready to send or change.
  4. At the foot of the pane: a text box labelled "Message {org}" with the placeholder "Ask, or tell it what to change", which grows to about eight lines (Enter sends, Shift+Enter starts a new line); beneath it **Attach files** (TALK-19), **What it can use here** (TALK-20), **Actions** ("/", TALK-22), **Mention someone** ("@", TALK-22) — named under their icons ("Attach", "Can use", "Actions", "Mention") wherever the pane is 400 px wide or more, icons with tooltips where it is narrower, the same whether or not you type — and **Send**, solid blue when it will send and pale grey while the box is blank or the cost is being worked out; and under the box one short line, "A message here costs at most {ceiling} credits, usually about {credits}." (a usual figure under 0.1 reads "usually less than 0.1"; when the ceiling is more than 20 times the usual figure, "Usually under 1 credit a message, never over {ceiling}.") with the full sentence in its tooltip ("Working out what a message costs…" while it loads).
  5. The person types a question (for example "what is over budget?") and presses Enter or **Send**. Their bubble, headed "You", appears right away, faded while it sends (`POST /api/conversations {scope}`). Typing dots show under it at once — "Sending…" until the work that answers it has started, then "Working on it" until it ends — and, while the box is empty, **Send** becomes **Stop the reply** in the same place, cancelling the reply being written. The log scrolls to the latest as the message and then the reply arrive.
  6. The Runner answers using `read_organisation`. The steps it took show as one line ("Read the org chart and what waits for you · Read the recent work", which opens to each step) with **"See how it got there"** beside it (TALK-12). The reply streams in as a grey bubble headed "Endgame", drawn from its markdown: headings, lists, tables, quotes, code (with **Copy the code**), bold, italics and links; a link to an app, an employee, a piece of work or an idea is drawn as a chip with its kind; nothing in it is ever run as HTML. The runner's closing word is not printed beside a reply, so each thing is said once; a notice with a reason of its own (the budget ran out) stays, in the attention colour. A screen reader hears the reply once it arrives ("Endgame replied: …"), not every word as it streams.
  7. Under the header, an "Also happening here" line shows who is working anywhere in the tree, the first in full and "{n} more" opening the rest: "{Name} is {activity}" as a sentence: a run's title becomes what they are doing — "Theo is making a change: {request}", "Theo is building: {name}", "Iris is researching: {idea}" — an activity in "-ing" keeps "is", and anything else reads "{Name}: {activity}".
- **You know it worked when:** a grey reply bubble appears under your message.
- **Variations and refusals:** see TALK-13 to TALK-15. Someone who has scrolled up to read what was said before is left there when a reply arrives, and a **"New reply"** button docked just above the message box takes them down to it (and the log follows again); it appears only when something new arrived below what they can see. On a phone the conversation is in a full-screen sheet opened by **Talk** in the bottom bar (SHL-07); on a tablet it is a drawer from the right, opened by the chat icon in the header. If the cost cannot be worked out: "What a message costs could not be worked out: {reason} Its cost is still held before each step and shown with the reply." and Send stays available.
- **Where:** `features/home/ConversationDock.tsx`, `features/conversation/Composer.tsx`; `components/Markdown.tsx`; `POST /api/conversations/estimate`, `POST`/`GET /api/conversations` (`WorkEndpoints`); `FactoryEstimates.ConversationAsync`; `Runner/Workflows/ConversationWorkflow.cs`; `Runner/Agents/RunnerTools.cs` (`ReadOrganisationTool`); `GET /api/runs/{id}/events`.
- **Reachable from:** UI.
- **Covered by tests:**
  - `HomeView.test.tsx`: "scopes the breadcrumb and the conversation to the selected node, and streams the reply"
  - `ConversationDock.test.tsx`: "says who it is talking to and at which level, with its log, its composer pinned beneath"
  - `composer.test.tsx`: "sends on Enter, keeps a new line on Shift+Enter"
  - `Markdown.test.tsx`: "draws a table, and a link to something in the organisation as a chip with its kind (ARCH-012)"
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
- **Starts at:** the app's page `/apps/{id}`, below "Change {app}" and the dashboard (`AppConversation`, exported by `ConversationDock.tsx`); or API `POST /api/conversations {scope: "{org}/{division}/{project}/{app}", message}`, or MCP `conversation_post`.
- **Needs:** an app.
- **Level:** Core · **Learn first:** TALK-03 · **What you learn:** the app has a conversation of its own, about it only, which can ask for a change to it.
- **Steps:**
  1. The dock shows a square avatar and "Talking to {app}", with the hint "About {app} only: ask about it, or ask for a change to it."
  2. Ask a question, or describe a change (CHG-02). Reads are limited to the app.
  3. Replies, approvals and the cost before sending work as in TALK-01, TALK-17.
- **You know it worked when:** "Talking to {app}" heads the dock and replies arrive.
- **Variations and refusals:** the app page's "Ask about this app" is a different feature (questions answered from the app's telemetry; apps reader). An idea started here is raised at the division above.
- **Where:** `ConversationDock.tsx` (`AppConversation`, the `app` selection); `WorkEndpoints` `/conversations`; `ControlPlaneTools` `conversation_post`.
- **Reachable from:** UI; API / MCP.
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
- **Steps:** the same dock as TALK-05. On this page the hint reads "Only {Name} hears this, and answers from its job and what it remembers.", and the link to the record is left out. Before anything is said, the log reads "Ask about its work, or give it something to do. {Name} answers from its job and what it remembers." It is the same conversation as from the chart, at the employee's level.
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
  2. The assistant calls `start_idea`. It is a checkpoint, so a card appears in the dock: **"Needs you"**, "Start researching an idea: “{your own words}”" — what you wrote this turn, in typographic quotes, cut at a word at 140 characters with "…", and no question mark after it — the sentence "Approving starts research on this idea, its estimate shown first; the verdict comes back to you to decide on. If you decline, nothing is started.", **"Add a note (optional)"**, **"Approve"** / **"Decline"** and "Declining skips only this step; the work goes on without it." The typing line reads "Waiting for your answer".
  3. Home's "needs you" strip gains an "Approval needed" card too, and within the sweep interval a notification.
  4. Press **"Approve"** (TALK-17). The idea is recorded (at the division, or at the division above for a project or app scope) with its research estimate, and research is queued.
  5. The assistant replies in the dock, for example confirming research has started.
- **You know it worked when:** the reply confirms it, the org chart shows the researcher "researching an idea", and a "Verdict waiting" card appears once research ends.
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
  2. The assistant calls `adjust_setting {key, value}`. One card in the dock asks what will change, in the screens' own words and naming the place, for example "Stop for your sign-off at checkpoints in Community?", "Switch Community to auto-mode?", "Turn off the “Before anyone is hired” checkpoint in Community?", "Keep apps in Community always on?", "Let apps in Community sleep after 30 idle minutes?" or "Flag employees in Community who have had no work for 14 days?" (TALK-17). One request raises exactly one card: a key or value the tool does not take is refused before anyone is asked.
  3. Once approved, `PUT /internal/cascade` sets the value at this level, marked as set by an agent. For `sleep.*` keys, the edge's routes are refreshed.
  4. The assistant replies in the place's name, never its path, for example "Apps in Community now sleep after 30 idle minutes." The change shows wherever that setting is read, for example "Autonomy for …" (autonomy reader) or the app's running chip.
- **You know it worked when:** the reply confirms it, and the relevant screen shows the value "set at" this level.
- **Variations and refusals:**
  - Any key off the allow-list is refused with 403 "An agent may not change that": "Agents may change only these settings, each confirmed by the owner first: … Everything else, including who may open an app, is done by a person in the console."
  - The raw key and value are in the detail line, shown in technical mode only.
- **Where:** `RunnerTools.AdjustSettingTool`; `FactoryEndpoints` `PUT /internal/cascade`; `Domain/Cascade/Autonomy.cs` (`AgentSettings.Allowed`).
- **Reachable from:** UI (approval in the conversation, or on the run page).
- **Covered by tests:** `RunnerContractTests.The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`; `WorkflowTests.Every_setting_the_tool_takes_has_a_plain_title_and_reply_naming_the_place`, `…A_setting_asked_for_in_chat_raises_exactly_one_approval_and_the_reply_names_the_place`.

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
- **Steps:** the person asks, for example, to make an app public, top up credits, change the organisation's overdraft, export an app, create or rename a division, set a budget, set a secret, or hire someone. The assistant has no tool for these, and its prompt lists them with where a person does each: who may open an app on the app's page under "Who can open it", top-ups and the overdraft on the Credits page, exporting on the app's page, divisions in the tree, budgets on the Credits page, secrets on the Secrets page, hiring on the Hiring page. It answers that it cannot, and names the place. It never offers "Change the app" for these: a change request about who may open the app, credits, the overdraft or exporting is refused by `change_app` itself before anyone is asked. For an off-list setting, it gets the refusal in TALK-08.
- **You know it worked when:** the reply says it cannot, and nothing changes.
- **Variations and refusals:** the wording of the reply is the model's own; the refusal of `change_app` is code's.
- **Where:** `Runner/Prompts/conversation.md`; `ConversationWorkflow`; `RunnerTools.ChangeAppTool.PersonsAct`.
- **Reachable from:** UI.
- **Covered by tests:** `RunnerContractTests` (refused settings); `WorkflowTests.Asked_to_make_an_app_public_the_conversation_asks_nobody_and_starts_no_change`, `…A_request_about_who_may_open_the_app_credits_or_export_is_a_persons_act`.

### TALK-11 Read what was said before, after a reload or a return visit
- **Who:** Viewer or above at the level.
- **Starts at:** any dock.
- **Needs:** earlier messages at this level (and employee).
- **Level:** Foundation · **Learn first:** TALK-01 · **What you learn:** the conversation is kept on the server, per level.
- **Steps:**
  1. Opening the dock reads `GET /api/conversations?scope=&employeeId=`: the last 200 messages, oldest first.
  2. Earlier turns draw as blue bubbles (people's) and grey bubbles (replies), each headed by who said it: "You" for your own, the sender's name for anyone else's, the employee's name or "Endgame" for replies. Endgame's own notices (TALK-15) draw as notices. Consecutive messages from one person on one run are merged.
  3. Messages sent during this visit are drawn from their live run, never twice.
  4. Files sent with a message show with it, as pictures or as chips that open (TALK-19). A turn that did work shows its steps line again, and the work it started comes back as its card in its present state (TALK-21); an earlier turn's work is read only once it scrolls into view, so a long history opens fast.
- **You know it worked when:** after a reload, your earlier exchange is still in the dock.
- **Variations and refusals:**
  - History fails: "What was said before could not be loaded: {reason} New messages still send." with "Try again".
  - A failed refresh: "The latest refresh failed: {reason}".
  - The conversation is shared by everyone at that level; each message is named, so who said what is clear.
  - Each turn in the history says whether it has its reply (`replied`), and whether it ended — failed or was stopped — with no reply and no notice of Endgame's own saying why (`endedWithoutReply`), with the sentence for it (`interruption`: "The reply could not be written. Nothing more was charged; ask again." or "This was stopped before a reply was written."). Such a turn offers to try again. A turn still being written when the page is reloaded is neither: its reply carries on streaming from where it is.
  - In the demo: `talk-long-history` (32 turns over five days, two finished cards, a declined and an approved approval, a reply with a table), `talk-reply-interrupted` (the last turn ended with no reply) and `talk-midreply` (a long reply still being written; reload part-way).
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
- **Steps:** above the reply, the steps it took read as one line ("Read the org chart and what waits for you · Read the recent work"); select it to see each step and how many there were in all. Select **"See how it got there"** beside it to go to `/runs/{id}` (runs reader), where its trace and any approvals are shown.
- **You know it worked when:** the run page for that reply opens.
- **Variations and refusals:** replies with no tool work have no steps line and no link. Work the reply started has a card of its own with **"See the whole run"** (TALK-21). A reply is Markdown where that helps (TALK-01): in the demo, "Compare what each app cost this month." answers with a table, "Give me the full picture of Northwind." with headings and lists, "What is waiting for me?" with chips to ideas and work, "Show me Court booking's config." with fenced YAML, "Where does Court booking keep its bookings?" with a long path in inline code, and "Who works on Court booking?" with chips to people — in any scenario, and all together in `talk-rich-replies` (with `talk-rich-replies-app` and `talk-rich-replies-employee` on the app's and Kasper's pages).
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
  - A Viewer: "Not sent: Only a Builder, an Admin or the Owner can do this here. You are a Viewer here." (technical mode: the server's "This needs the builder role at '{path}'; you are a viewer there (set at …). (403)"). The input and "Send" are still offered to Viewers.
  - No role at the level: 404 (ORG-19).
  - Over 20,000 characters: "A message is 1 to 20000 characters."
  - The control plane cannot answer: "Not sent: {reason}" with "Send again", which then goes. In the demo, `talk-not-sent` fails the first send once.
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
  4. If the AI models cannot be reached (no key, a key refused, the provider down), the reply reads "I could not reach Endgame's AI models, so I could not answer that, and nothing was charged. Please ask again; if it keeps happening, tell FrostAura." When the work instead stops with no reply at all, the dock shows the stop notice in plain words ("Endgame could not reach its AI models, so the work stopped before it was finished. …") with **"Try again"**, which sends the same message again; what the gateway said is in technical mode only.
  5. If the assistant cannot complete for another reason, the reply reads "I could not finish answering that. Please ask again."
- **You know it worked when:** (a refusal) the notice with "See credits" shows in the conversation.
- **Variations and refusals:** a chat is answered in a lane of its own in the Runner, so it never waits behind long builds or research (and chats never hold builds up). In the demo, `budget-spent` stops a message in Technologies; `talk-budget-stopped` spends Northwind's own budget, so the notice is already in the conversation on home and every new message gets it.
- **Where:** `ConversationWorkflow` (the `budget_exhausted` notice); `ConversationDock.tsx` (`Notice`); `Runner/Execution/RunContext.cs` (`WorkflowOutcome.FromAgent`).
- **Reachable from:** UI.
- **Covered by tests:** `WorkflowTests.A_conversation_the_budget_stops_says_so_in_the_conversation`, `…A_conversation_that_cannot_reach_a_model_says_so`, `…Conversations_are_claimed_in_their_own_lane_and_neither_lane_starves_the_other`; `TryAgainAndChangesTests.A_message_shows_what_it_can_cost_first_and_the_conversation_names_who_said_what`; `TryAgainAndChanges.test.tsx`.

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
  1. The card shows **"Needs you"**, the title of what will happen — the act and the place or work by its own name, then your own words of this turn in typographic quotes, cut at a word with "…" ("Start researching an idea: “…”", "Change {app's name}: “…”", "Try the build again: “{its short title}”", "Try the change again: “…”", "Try the research again: “…”", a setting in plain words ending "?"); no "?" follows a quote, so no words are put in your mouth — a plain sentence saying what approving does and what declining does ("Approving starts this change to {app}: its estimate is shown first, then a plan, the change built and checked in the running app, and a new version. If you decline, nothing changes."), **"Add a note (optional)"**, **"Approve"** / **"Decline"**, and "Declining skips only this step; the work goes on without it." The typing line reads "Waiting for your answer".
  2. Optionally type a note; press **"Approve"** or **"Decline"**.
  3. The card reads "Approved. The work carries on from here." or "Declined. It was not done; the work continues without it."; the assistant receives the answer and the note and replies. The question and its answer stay in the turn's log (`approval.requested`, then `approval.answered` with `answer`, `comment` and `byName`, who answered by name), so the conversation keeps a record of what was asked, what was chosen and the note, and what was said after the answer is said after it.
- **You know it worked when:** the card is answered and the reply follows.
- **Variations and refusals:** a failed answer: "Your answer was not recorded: {reason}". The tool, its arguments and the rule — with the model's own rephrasing of what you asked — are sent as the approval's separate `technical` field, for technical mode, never as the sentence under the title. If the act is refused after you approve (the work was already tried again by someone else, for example), the assistant says it did not happen and why, and no card appears.
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
  2. The assistant reads the runs, then asks **"Try the build again: “{its short title}”"** — "Try the change again" or "Try the research again" for those — naming the stopped work by its own title read from the run, without its leading "Build: ", cut at a word at 80 characters (TALK-17).
  3. Approve. The new attempt starts with its estimate first and carries on from the earlier one (CHG-03): where it was placed, the plan agreed then, and the parts that passed their check, which its card shows as done before (TALK-21). The assistant says so.
- **You know it worked when:** a new run for the work appears.
- **Variations and refusals:** work outside the conversation's scope is not found; work that has not stopped, or was already tried again, is refused with the reason, and the assistant says it did not start ("I could not start it again: …"), never that it did. In the demo, `build-failed` and `run-long` (the longest real build, from Northwind's home) both start again with their card; `talk-retry-carried` has the attempt already finished, its earlier parts carried over.
- **Where:** `RunnerTools.TryAgainTool`; `POST /internal/runs/{id}/retry`; `RetryService`.
- **Reachable from:** UI (conversation); MCP `run_retry`.
- **Covered by tests:** `WorkflowTests.The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully`; `TryAgainAndChangesTests.A_built_app_is_changed…` (the internal retry's scope check).

### TALK-19 Attach files to a message
- **Who:** Builder or above at the conversation's level.
- **Starts at:** any conversation's composer.
- **Needs:** —
- **Level:** Core · **Learn first:** TALK-01 · **What you learn:** a message can carry pictures, PDFs and text files, and whoever answers reads them.
- **Steps:**
  1. Press **Attach files** and pick files, drop files anywhere on the pane ("Drop files to attach them"), or paste them into the box.
  2. Each file shows as a chip above the box with its name and size (a picture shows itself), "Adding…" while it uploads (`POST /api/conversations/attachments`), and **Take off {name}**. The cost line adds "Files counted." and its figures include them; a file refused keeps its chip, in its error state, with the reason on it.
  3. Send. The files show with your message — pictures as thumbnails, other files as chips ("PDF, 3 pages", a size for text) — and each opens in a new tab. Whoever answers reads them first (in the demo: "I read **court-rules.md**. …").
- **You know it worked when:** the files are on your message and the reply speaks to them.
- **Variations and refusals:**
  - Said before anything uploads, in the words the control plane uses: "{name}: SVG images are not accepted, because they can carry scripts. Send it as PNG instead.", "{name}: this kind of file is not accepted. Images (PNG, JPEG, WebP, GIF), PDFs and text files are.", "{name} is empty.", "{name} is {size}; a file may be at most 10 MB.", "A message carries at most 10 files.", "These files come to {size}; a message carries at most 25 MB."
  - Refused by the control plane by the file's bytes, whatever its name: a picture named as text, text named as a picture, an archive (even renamed), a file that is not UTF-8 text, a picture over 40 megapixels, a PDF whose text cannot be read.
  - A picture where whoever answers reads text only (Endgame's own assistant): "Endgame’s assistant reads text only, so an image cannot be sent here. Take the image off, or put it in a PDF, or ask an employee who can look at pictures." Send stays off until it is taken off. An employee whose thinking power takes pictures receives it as a picture.
  - Someone else's unsent file cannot be read or sent; a sent file cannot be taken back (409). Unsent files are cleared after a day.
- **Where:** `features/conversation/attachments.ts`, `useDraftFiles.ts`, `AttachmentChips.tsx`; `ConversationAttachments`, `ConversationAttachmentService` (`WorkEndpoints`); `ConversationWorkflow` (content parts); `ModelEntry.InputModalities`.
- **Reachable from:** UI; API `POST /api/conversations/attachments`, `GET /api/conversations/attachments/{id}/content`, `DELETE /api/conversations/attachments/{id}`.
- **Covered by tests:** `composer.test.tsx` ("uploads a file as it is added and sends it by id; refuses an SVG before uploading it", "says before sending that an image cannot go to an answerer that reads text only", "refuses what the control plane would, in the same words"); `AttachmentChecksTests`; `ConversationAttachmentsTests`; `ConversationContentTests`; `demo/server/conversation.test.ts`; `phone.spec.ts` ("the composer: files, what it can use and the actions…").

### TALK-20 See what it can use here, and narrow one message
- **Who:** Viewer or above (to read); Builder (to send narrowed).
- **Starts at:** any conversation's composer: **What it can use here**.
- **Needs:** —
- **Level:** Core · **Learn first:** TALK-01, AUTO-01 · **What you learn:** what whoever answers at this level can use, from real data, and how to ask for less for one message.
- **Steps:**
  1. Press **What it can use here** (`GET /api/conversations/capabilities`). A panel opens over the thread, headed "What {name} can use here":
     - **Who answers:** "Endgame’s assistant, for everything here" or the employee by name and role, with its thinking power ("Light, for quick answers").
     - **It may:** the tools it answers with, in the hire page's words ("Read the organisation", "Remember things"), and web search as "Search the web: may / asks you first / may not" under the autonomy rules — or "It answers from what Endgame holds here; it does not search the web." where it cannot search.
     - **Work it can start, asking you first:** only what applies here ("Ask for a change to an app" only where there is an app; "Try stopped work again" only where something stopped).
     - **Skills the builders here use**, **Services the apps here have** (Sign-in, AI inside apps, Secrets, Email, Scheduled jobs, Incoming data, Health and traffic, each with a fact where one is known: "2 secrets set here"), **AI assistants** (each key's name, role and when it was last used, or "Give one access"), and **Attaching files** (the limits).
  2. Under **For this message only**, switch on "Don’t search the web" or "Answer only: start no work", where they apply. The composer shows "No web search" or "Answer only" beside the box; select it to turn it off.
  3. Send. The narrowing goes with that message only (`narrow` on `POST /api/conversations`) and is then cleared.
- **You know it worked when:** with "Answer only", a request that would start work is answered and nothing asks to start.
- **Variations and refusals:** nothing can be widened here; the autonomy rules are changed on the Autonomy page (AUTO-01). Close the panel with **Close** or Escape.
- **Where:** `features/conversation/CanUse.tsx`, `Composer.tsx`; `ConversationCapabilitiesService`; `ConversationWorkflow` (narrowing).
- **Reachable from:** UI; API `GET /api/conversations/capabilities`.
- **Covered by tests:** `composer.test.tsx` ("sends a narrowing with the one message it was set for, and never again"); `ConversationAttachmentsTests` (capabilities); `ConversationContentTests` (narrowing enforced); `demo/server/conversation.test.ts` ("what it can use here", "starts nothing when the message asked for an answer only").

### TALK-21 Follow the work a message started, in its card
- **Who:** Viewer or above.
- **Starts at:** a conversation where a message started work (TALK-07, TALK-17, TALK-18, CHG-02).
- **Needs:** work started from the conversation.
- **Level:** Core · **Learn first:** TALK-17 · **What you learn:** the work shows live in the conversation — its plan, its parts, who is doing what — without leaving it.
- **Steps:**
  1. Once approved, a card appears under the reply: what the work is ("A change", "Research", "Building", "Trying again") and its title on one line (**Show what was asked** opens the rest), who is doing it (employees' avatars and names, contractors by role: "3 research contractors"), a status chip (Starting · Working · Waiting for you · Paused · Finished · Stopped · Cancelled), the time it has taken, and a meter of the credits used against its estimate ("2.5 of about 10 credits").
  2. **The plan:** "{n} of {m} parts done", with a track of the parts (five or fewer) or a stepper (more), each part's state: Waiting · Working on it now · Being checked · Sent back for repair (round n) · Passed · Needs a look (the checker found it working, the factory's own reading disagreed twice, so it stopped rather than going to another repair) · Did not pass, and the security review after them. A part an earlier attempt finished (TALK-18) counts as done. Every task names who holds it: an employee, or the role that does the work while nobody is hired yet ("Software engineer"). A thin track above sums every part up at a glance; beneath it each part is listed by name in a stepper, its state as a small tag. The part being worked on is open: its tasks with who holds each ("Build · Kasper · Done", "Check · Mina · Working"), what the checker said, and what its tools did ("Read 3 files, changed 3, ran the tests once"); select another part to open it. Technical mode adds **Each action** (every tool call).
  3. **Research:** the researchers side by side — "Looking", "Reported" or "Stopped", what each looks for, and "{n} of 7 searches".
  4. An approval the work asks for appears inside the card; the plan's approval shows the plan above it ("The plan, waiting for you").
  5. Once the plan is agreed the estimate is made again, said with the figure it replaces and why ("Re-estimated after planning: 3 parts."); the meter runs past its estimate when the work costs more.
  6. When it ends: the outcome sentence and what to do next — **Open {app}** and **Manage {app}**, **Read the verdict**, or **Try again** — with "Cost {n} credits, estimated {m}". **See the whole run** opens its page at any time.
- **You know it worked when:** the card ends "Finished" with the outcome and the next step.
- **Variations and refusals:** a dropped stream: "{error} The work goes on; its page has everything." The card stays in the conversation in its final state, and comes back after a reload (TALK-11). A screen reader hears that an answer is needed, once.
  - In the demo, each state has a scenario on home: `talk-web-search-approval` (research asking before a web search, its approval in the card), `talk-plan-approval` (a change stopped at "The plan, waiting for you"; `talk-plan-approval-app` and `talk-plan-approval-employee` from Court booking's and Kasper's pages), `talk-card-failed` (with **Try again**), `talk-card-cancelled`, `talk-part-states` (a part that did not pass, and one whose check needs a look), `talk-over-estimate` (about 10, about 15 after planning, then over), `talk-many-parts` (six parts, under way) and `talk-retry-carried`.
- **Where:** `features/conversation/WorkCard.tsx`, `workModel.ts`; `ConversationDock.tsx` (`Replies`, `TurnWork`); the run's events (`GET /api/runs/{id}/events`); `message` `kind: "work.started"`.
- **Reachable from:** UI.
- **Covered by tests:** `WorkCard.test.tsx`; `workModel.test.ts`; `demo/server/conversation.test.ts` ("is named in the conversation's own log once approved…"); `ConversationContentTests` (`work.started`); `phone.spec.ts` ("work the conversation starts is a card in the sheet…").

### TALK-22 Act with "/", or send it to someone with "@"
- **Who:** Builder or above.
- **Starts at:** any conversation's composer.
- **Needs:** for "@", an employee or an app beneath the level.
- **Level:** Core · **Learn first:** TALK-01, TALK-05 · **What you learn:** the actions a conversation can take here are one keystroke away, and a message can be sent to someone beneath without leaving the box.
- **Steps:**
  1. Type "/" in an empty box, or press **Actions**: "Actions here" lists what the conversation can do at this level — "Start an idea", "Change {app}" or "Change an app", "Try stopped work again", "Change a setting" — and "Propose a hire", which opens Hiring. Arrow keys move, Enter or a click chooses; Escape closes.
  2. Choosing an action puts its opening words in the box ("Change the app ", "Start researching this idea: "); finish the sentence and send. It asks before it acts (TALK-17).
  3. Type "@" (or press **Mention someone**): "Send it to" lists the employees and apps beneath this level, filtered as you type. Choosing one moves the conversation there ("Talking to {Name}"), keeping what you typed without the mention; send it there.
- **You know it worked when:** the header names who you chose, and the reply comes from them.
- **Variations and refusals:** on an app's or an employee's page, "@" moves to the org chart with the conversation at who you chose, your words carried over. Only actions that apply here are listed.
- **Where:** `features/conversation/Composer.tsx`, `scopeModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `composer.test.tsx` ("offers the actions it can take here under /…", "lists the employees and apps beneath a level for @…").

### TALK-23 Make the pane wider, collapse it, or open it full width
- **Who:** anyone with a conversation, on a desktop.
- **Starts at:** the conversation pane's header on `/`.
- **Needs:** a desktop-sized window.
- **Level:** Foundation · **Learn first:** TALK-01 · **What you learn:** the pane fits how you work, and keeps to it next time.
- **Steps:**
  1. **Make the pane wider** widens it from 26 rem to 34 rem (**Make the pane narrower** goes back); on a window under 1,500 px the wide pane lies over the page's edge as a drawer, so the page keeps its width. On a screen 1,880 pixels wide or more it opens wide until you choose.
  2. **Open full width** hides the page; header, thread and message box share one centred column; **Back to the page** returns.
  3. **Collapse the pane** leaves a rail at the window's right edge with the avatar, a chat mark and "Talk to {name}" read up the rail; **Open the conversation with {name}** opens it again. Typing dots say a reply is being written, a dot for each piece of work under way here, and a marker says a reply arrived while it was closed.
- **You know it worked when:** after a reload, the pane is as wide, or as collapsed, as you left it.
- **Variations and refusals:** the width and collapsed state are kept per person in this browser (`endgame.dock.{user}`); full width is not kept, so the page is never lost.
- **Where:** `features/conversation/dockLayout.ts`; `features/shell/AppShell.tsx` (the docked aside); `ConversationDock.tsx` (`PaneHeader`).
- **Reachable from:** UI.
- **Covered by tests:** `academy-scripts.spec.ts` (TALK-23).

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
- **Variations and refusals:** a crash in the panel shows "Your notifications stopped working." (SYS-08). On a phone there is no bell: **Alerts** in the bottom bar, with the unread count, opens the full feed (SHL-07).
- **Where:** `NotificationsBell.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `Notifications.test.tsx` (the bell).

### NOTE-03 Read the full feed
- **Who:** any member.
- **Starts at:** `/notifications`, reached by **Alerts** in a phone's bottom bar, "See all", or a direct address.
- **Needs:** —
- **Level:** Foundation · **Learn first:** NOTE-01 · **What you learn:** what you are told about, and that urgent ones are e-mailed.
- **Steps:**
  1. The breadcrumb reads "{organisation} / Notifications".
  2. Heading "Notifications", with: "What needs you, newest first. The urgent ones — a cap reached, credits at zero, the overdraft, an app that stopped, a security finding — are e-mailed too, when e-mail is set up."
  3. The feed shows "Nothing unread." or "{n} unread", plus "Mark all read". At every size it shows every unread notice and the newest ten, newest first and grouped under the day they came ("Today", "Yesterday", then the date), then **"Show {k} older of {n}"** (or **"Show {n} older notice(s)"** when ten or fewer are left), which adds ten more each time.
  4. Each row shows:
     - a blue dot when unread (read aloud as "Unread"), with the title in bold — the only way unread is marked; a read row has neither;
     - the title as a link, cut at a word and never inside a quotation — where the server cut it inside one, the quotation is closed after the "…"; its quotation marks are always curly, a quotation inside one single ("‘Done by’"), and a run's raw label inside a quoted title ("Change Web: ", "Build: ") is dropped;
     - one line of detail, cut the same way — a notice raised before details were written plainly, whose detail is a raw tool line ("adjust_setting: …", "try_again: …") with no technical line beside it, shows no detail in normal mode; technical mode shows that line;
     - a tag: "Verdict", "Approval", "Hire", "Budget", "Credits", "Overdraft", "App", "Security" or "Top-up request" (anything else "Update"); amber for an urgent one not yet answered, grey otherwise;
     - "Answered" (green) when what it asked is already answered — or "Closed" (grey) for an approval whose work ended before anyone answered it; such a row has no dot and no "Mark read", and its title is plain;
     - "Also e-mailed" when it was;
     - in technical mode, the raw kind;
     - "Mark read", a quiet button at the end of the tag line, when unread — at every width;
     - how long ago, at the end of the title's first line, in every row at every width (in the bell's narrow list, at the end of the tag line, before "Mark read");
     - the detail's figures written the console's way ("361 of 450 credits", "−402"), without the scope path the title already names.
  5. An aside "What you are told about" (on a phone a folded row, "Verdicts, approvals, hires, budgets, credits, apps and security") lists: "A verdict waiting for your call", "An approval the work is waiting on", "A hire proposed", "A budget at 80% and at its cap", "Credits at zero, halfway to the overdraft limit, and at it", "An app that stopped working", "A security review that found a problem", "For FrostAura’s operators: an Owner asking for a top-up". It adds: "Owners and Admins are told about what their grant covers; others see an empty feed."
- **You know it worked when:** the page lists your notices, newest first.
- **Variations and refusals:** the UI asks for at most 50. A verdict, approval or hire that has been answered (by anyone) comes back resolved and read, its title saying what happened — "You approved “Accept this plan?”", "Theo was hired as Software engineer", "Dean chose to build: …", "Auto-mode chose to build: …" (a verdict auto-mode acted on) — and it no longer counts as unread. An approval whose run ended before anyone answered it is closed with the run (expired, never "declined") and reads "No longer waiting: “{question}” — the work ended before it was answered"; it is not on the "Needs you" strip, and its row reads "Closed" rather than "Answered". Such a row has no unread dot and no "Mark read", here and in the bell's popover.
- **Where:** `notifications/NotificationsView.tsx`, `NotificationFeed.tsx`, `notificationModel.ts`; `NotificationService.FeedAsync` (`resolved`).
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
- **You know it worked when:** the subject's page opens and the row no longer shows the unread dot.
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
- **You know it worked when:** the unread dot disappears and the count drops by one.
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
- **Starts at:** the mode switch, "Normal" / "Technical": in the header bar from 1,100 px wide, in the account menu ("Your account, the mode and signing out") below that, under **More** on a phone.
- **Needs:** —
- **Level:** Core · **Learn first:** ORG-04 · **What you learn:** technical detail is available, never in the way.
- **Steps:**
  1. Select "Technical". The switch marks it pressed, and "System" appears: in the bar, an icon link (a health icon) of its own outside the switch; in the account menu and in More, a "System status" row.
  2. Technical wording appears across screens: "MCP access", raw notification kinds, internal service names, context keys. The choice is remembered in this browser.
- **You know it worked when:** "Technical" is pressed and "System" appears.
- **Variations and refusals:** in a private window that refuses storage, the mode holds for the session only.
- **Where:** `shellControls.tsx` (`ModeToggle`, `SystemLink`, `AccountMenu`), `store/uiSlice.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx`: "keeps system status behind technical mode, and remembers the mode".

### SYS-02 Open system status in normal mode
- **Who:** anyone.
- **Starts at:** `/system` while in normal mode.
- **Needs:** —
- **Level:** Core · **Learn first:** SYS-01 · **What you learn:** normal mode answers whether Endgame is working; naming its services is technical detail.
- **Steps:**
  1. The breadcrumb reads "System". The page is titled "Is Endgame working?" and answers in plain words, never naming a service: "Everything is working" (tagged Healthy) or "Part of Endgame is not answering" (tagged Needs attention, with what that means while it lasts), the figures "Parts answering" ("7 of 8"), "Last checked" and "Checked again", and beside it "Which part, and why" with "Switch to technical mode".
  2. Selecting the button switches mode and shows SYS-03 in place.
- **You know it worked when:** the heading "System status" appears.
- **Variations and refusals:** none further.
- **Where:** `features/status/SystemRoute.tsx` (`SystemRoute`, `PlainStatus`).
- **Reachable from:** UI.
- **Covered by tests:** `App.test.tsx` (as SYS-01), `SystemRoute.test.tsx`.

### SYS-03 Read system status
- **Who:** anyone in technical mode.
- **Starts at:** "System" in the header (in the account menu below 1,100 px wide, under More on a phone), or `/system`.
- **Needs:** technical mode.
- **Level:** Advanced · **Learn first:** SYS-01 · **What you learn:** each service is asked directly, and the whole is healthy only if every part is.
- **Steps:**
  1. Heading "System status", with "Every service, asked directly whether it is healthy." and a "Check again" button. On first load: "Checking every service…".
  2. A white summary card across the page shows "All services healthy" with a green tick and the tag "Healthy", or "{n} of {m} services unhealthy" with a warning sign and the tag "Needs attention", and "Checked at {hh:mm:ss}", on the 24-hour clock ("Checked at 14:05:09").
  3. Beneath it, one card per configured service (two, three or four across as the screen widens), in this order: "Control plane", "Edge", "Runner", "Dock", "Database", "Console", "Cloudflare and backups", "Telemetry collector", then any extras. Each shows its latency ("{n} ms" or "{n.n} s"), a "Healthy" / "Unhealthy" badge, and any detail.
  4. The page re-checks every 10 seconds while focused. "Check again" forces a check, spinning while it runs.
- **You know it worked when:** "All services healthy" with one card per service.
- **Variations and refusals:**
  - An unhealthy service changes the summary and its card says why, in its probe's own words, for example "No answer within 2000 ms." or "Unreachable: {reason}".
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
  2. On failure: "The organisation could not be loaded", "{reason} Nothing here is known until it loads." and "Try again". A refusal (401, 403) or a not-found (404) is an answer: it drops "Nothing here is known until it loads." and never offers "Try again"; it offers "Back to the org chart" instead, or nothing inside a panel of a page whose own navigation serves. The same holds for every failed first load in the console. There is no conversation while failed. The reason is the server's own text where it gives one, for example "The organisation 'x' was not found, or you cannot see it. (404)", or "Endgame could not be reached.", "Endgame did not answer in time.", etc.
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
4. **Fixed on 2026-11-25 (lane C):** the employee conversation is answered by the employee (TALK-05, TALK-06); messages are named (TALK-11); the dock works for an app scope and is exported for the app page (TALK-04 — the app page mounts it); the dock answers its own approvals, titled in plain words (TALK-17); a message's cost is shown first and a budget stop is said in the dock (TALK-15).
5. **Conversations are shared per level.** Everyone at a level reads and continues the same conversation; messages are named, not private.
6. **Divisions and projects have no page of their own**, though the spec says "Selecting a node opens it"; each opens on "Manage" instead.
7. **Fixed:** a person granted below organisation level starts at their own level, and the graphs ask at the selection (ORG-19).
8. **Dead UI branches**:
    - the "verdict" project stage, with "Read the verdict" and "Idea · paused at verdict";
    - the stages "idea", "evaluating", "publishing" and "dropped";
    - the "Nobody works on anything yet" empty state when divisions exist.
9. **Fixed:** `topup.requested` is raised to operators and labelled "Top-up request" (NOTE).
10. **Fixed:** archiving a division or project stops its apps being routed, and the tree, the outline and the chart mark archived nodes (TREE-07, ORG-08). A Builder can still set an app's status to "running" or "failed" by hand through `PATCH /api/apps/{id}` (TREE-08).
11. **Fixed:** `GET /api/system/status` says only `overall` and `checkedAt` to someone signed out (SYS-05).
12. **Fixed:** the empty "needs you" line claims only what it checks (ORG-05), and someone who can never name an organisation is told organisations are set up by FrostAura, on home and on `/start` (ORG-03).
13. **Small mismatches with the UC docs.**
    - UC-102 and UC-001 describe `needsYou` as "verdicts and approvals" only; hires and idle employees are also sent.
    - UC-001 says selecting "a node or an employee" scopes the conversation; apps cannot be selected.
    - MCP lacks mark-read for notifications and delete for nodes.
14. ~~**The academy's demo world has research projects the product never draws.**~~ Fixed: ideas in research or at a verdict are no longer drawn on the demo's chart; they wait on the home strip, as in the product (ORG-09).
