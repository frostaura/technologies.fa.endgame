# Workforce, credits and God mode — every flow

Hiring, employees and contractors, employee memory, credits, budgets and the overdraft, the operator's screens.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs, and every screen flow here was walked again in the demo console for its academy script the same day. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

Shared vocabulary used below:
- Text in "double quotes" is copied word for word from the screen or from a server message.
- `<n>` is a formatted number by the one rule (`formatNumber`): whole and grouped by thousands from 10 ("1,840"), up to two decimals below 10 ("7.47", "0.2"), "<0.01" for more than nothing but under a hundredth, and a debt with a true minus sign ("−120"). A top-up or change to a balance is signed ("+3,000"). `<n> credits` is `formatCredits`: "1,500 credits", and "1 credit" only when exactly 1 is shown.
- Every error banner on the employee actions ends with "Nothing was changed."
- `FE` is `src/frontend/src`. `CP` is `src/backend/Endgame.ControlPlane`. `INF` is `src/backend/Endgame.Infrastructure`.

## Hiring (HIRE)

### HIRE-01 Open the hiring screen for a part of the organisation
- **Who:** any member (Viewer and above). An operator in God mode, but see OP-04.
- **Level:** Core
- **Learn first:** sign-in and reading the org chart (another reader's area).
- **What you learn:** hiring is done per level of the tree, and a level shows the proposals for itself and everything beneath it.
- **Starts at:** org chart (`/`). Select a node, then press "Hiring" in the Manage links. Opens `/hires?scope=<path>`. With no scope it uses the organisation.
- **Needs:** a role on the chain of that scope.
- **Steps:**
  1. Press "Hiring". The page title reads "Hiring for <name>" with the intro "Hires are proposed when the organisation needs someone: a new division, a project reaching a new stage, or a job that keeps coming back. In auto-mode one that fits the budget is taken on at once; otherwise it waits for you here."
  2. The proposals load (up to 200, newest first). The section "Waiting for you" holds open proposals (the list "Proposals waiting for you"). The section "Decided" holds accepted, declined and withdrawn ones (the list "Proposals decided").
  3. Each section is one table with the columns "Proposal", "Raised", "Credits a month" and "State" — a list of cards, each column named beside its value, when its column is narrow. Every row is laid out alike and opens its proposal: "<Name>, <Role> for <place>" (the role as written; a name that is the role is said once) over the trigger text; the date it was raised; the credits it would cost a month; and its state as a tag. A proposal still waiting says whether it fits: "Fits the budget" or "More than the budget has room for" (the section already says it waits); a decided one says "Hired" / "Declined" / "Withdrawn", and never carries a budget warning. Decided proposals are newest first; past ten, "Show all <n> proposals".
  4. The side panel holds "Contractor roles that keep coming back" (HIRE-07) and "People let go" (EMP-09). An Admin also sees "Ask for a hire" as the page header's action (HIRE-09).
- **You know it worked when:** the heading "Hiring for <name>" appears with the "Waiting for you" section, or the empty state.
- **Variations and refusals:**
  - Empty: "No hires have been proposed here" with "When the work here needs someone, a hire is proposed with its job description and what it would cost a month."
  - Everything decided: "Nothing is waiting. Every proposal here has been decided."
  - Failed read: "The hire proposals could not be loaded" with a retry button. A stale-data banner appears when a refresh fails.
  - Trigger texts: "A new division needs someone" · "A project reached a stage that needs someone" · "A job keeps coming back" · "A contractor role keeps recurring, so it is proposed as a permanent hire" · "You asked for this hire".
  - A person with no role there gets a 404 for the scope, shown as "The hire proposals could not be loaded".
  - In God mode the page works on the organisation entered (OP-04).
- **Where:** `FE/features/workforce/HiresView.tsx`, `features/home/HomeView.tsx` (ManageLinks). Endpoint `GET /api/hires?scope=&status=`.
- **Reachable from:** UI. Also MCP `hires_list`. A notification of kind `hire` links to `/hires?scope=`.
- **Covered by tests:** `HireView.test.tsx` ("lists proposals waiting and decided…", "shows nothing proposed as an empty state…"). `tests-e2e/workforce.spec.ts`.

### HIRE-02 Read a hire proposal
- **Who:** Viewer and above.
- **Level:** Core
- **Learn first:** HIRE-01, or the "needs you" strip on the org chart (another reader's area).
- **What you learn:** a hire is shown before it happens: its drafted job description, its expected monthly cost, why it is needed, and whether it fits the room left in the budget.
- **Starts at:** a card on `/hires`, a "Hire proposed" card in the org chart's "needs you" strip, or a notification. Opens `/hires/<id>`.
- **Needs:** a proposal in your organisation.
- **Steps:**
  1. The page opens with a badge ("Hire proposed" / "Hired" / "Declined") and the heading "<Name>, <Role>" (the role as written, once when the name is the role).
  2. The subtitle reads "For <place> · <trigger> · Raised by a person|Endgame <date>", followed by the reason.
  3. The section "The drafted job description" lists:
     - "Mandate" (or "Not written yet")
     - "Works at": "<place> and everything beneath it"
     - "May use": tools in plain words, or "Nothing beyond reading what it is given"
     - "Services", or "None of the platform's services"
     - "Budget": "<n> credits a month", or "No cap of its own; the one above holds"
     - "Thinking power", e.g. "Standard, for reading and judging"
     - "Reports to", or "Nobody: it answers to you"
     - "Replaces" (only for a promotion): "The recurring contractor role “<role>”"
  4. The card "What it costs" — beside the proposal on a desktop; on a tablet or a phone straight under the proposal's header card, before the job description — shows the big number and "credits a month, expected" (when its own budget is lower than the expected cost, the budget and the caption "credits a month, at most", with "Its own budget caps it." under the figure; the list and the confirmation say the same number), then — while the proposal is still open — "Fits the budget" or "More than the budget has room for" (a withdrawn, declined or accepted hire shows neither), then "<n> credits of room left this month where it would work.", and under that the decision itself (HIRE-03, HIRE-04, HIRE-05): "Hire <Name>", "Edit the proposal" and "Decline", one a row — or, once decided, what was decided (HIRE-06). While the proposal is being edited it reads "Save or cancel the edit to decide on it."
  5. A second side card, "If it has nothing to do", says: "An employee with nothing to do is flagged and let go, so an idle hire is never paid for. Its memory is kept, so a rehire is not a cold start."
- **You know it worked when:** the job description and the "What it costs" card are both shown.
- **Variations and refusals:**
  - Technical mode adds the real tool and tier names.
  - Not found: "This hire proposal could not be found", "This was not found, or you cannot see it." and "Back to the org chart" (a not-found is an answer, so there is no retry). Other failure: "The hire proposal could not be loaded".
  - A Viewer or Builder sees "An Admin or the Owner decides on hires." instead of the buttons.
  - The room left is the tightest monthly cap on the scope's chain, or the balance plus the overdraft, whichever is lower. It is recalculated on every read.
- **Where:** `HireView.tsx`, `workforceModel.ts`. `GET /api/hires/{id}`. `INF/Work/HireService.cs` (ViewAsync, HeadroomAsync).
- **Reachable from:** UI.
- **Covered by tests:** `HireView.test.tsx` ("shows the drafted job and its monthly cost in plain words…"). `workforce.spec.ts` ("a proposal is read from needs you and accepted, with a note").

### HIRE-03 Approve (hire) a proposal
- **Who:** Admin or Owner at the proposal's level. An operator in God mode counts as Admin.
- **Level:** Core
- **Learn first:** HIRE-02.
- **What you learn:** accepting a proposal creates the employee with exactly the job description you read, and records who decided and why.
- **Starts at:** `/hires/<id>` with status proposed.
- **Needs:** Admin.
- **Steps:**
  1. Press "Hire <Name>". A confirmation form opens: "Hire <Name> at about <n> credits a month?"
  2. If the hire does not fit, the form also says "This is more than the budget has room for this month (<n> credits left)."
  3. Optionally type into "A note for the record (optional)".
  4. Press "Yes, hire". The page shows the decision at once (optimistic), then reloads.
  5. The decision panel reads "<Name> was hired by <your name> on <date>.", then the note in quotes, then the link "See <Name>’s record".
  6. The employee now exists at that level with status "Free", and appears on the org chart and in "Decided" on `/hires`.
- **You know it worked when:** the badge reads "Hired" and the "See <Name>’s record" link is shown.
- **Variations and refusals:**
  - "Not now" closes the form.
  - Over budget still hires. The warning does not block.
  - A refusal rolls the status back and shows "Your decision was not recorded: <reason> The proposal is still waiting for you."
  - Already decided by someone else: 409 "The proposal was already <status>."
  - A manager who has since been released: 400 "reportsTo names an employee of this organisation who is on the payroll."
- **Where:** `HireView.tsx` (Decide, Decided), `store/api.ts` decideHire. `POST /api/hires/{id}/accept { note? }`. `HireService.AcceptAsync`.
- **Reachable from:** UI. Also MCP `hire_decide` (decision: accept).
- **Covered by tests:** `HireView.test.tsx` ("accepts after confirming, with a note"). `workforce.spec.ts`. `WorkforceTests.Over_budget_or_at_a_hire_checkpoint_a_proposal_waits_for_the_owner_who_edits_accepts_or_declines`.

### HIRE-04 Decline a proposal
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** HIRE-02.
- **What you learn:** declining closes this proposal, and the same need can be raised again later — for a recurring contractor role the platform raised, not for 30 days.
- **Starts at:** `/hires/<id>`.
- **Needs:** Admin. The proposal is open.
- **Steps:**
  1. Press "Decline". The form asks "Decline this hire? The same need can be raised again later." For a recurring contractor role the platform proposed (HIRE-08), it adds "It will not be proposed again here for 30 days, until <date>, however many more contractors are briefed. You can still ask for this hire yourself before then."
  2. Optionally add a note.
  3. Press "Yes, decline". The badge becomes "Declined", and the panel reads "This hire was declined by <name> on <date>." with the note; for such a recurring role, also "It will not be proposed again here before <date>. You can ask for this hire yourself at any time."
- **You know it worked when:** the badge reads "Declined" and the panel names you.
- **Variations and refusals:** the same refusals and rollback as HIRE-03. **A decline of a recurring role holds** (R5-3): for `WorkforceLimits.DeclinedHireHoldDays` (30, the window the recurrence is counted in) the platform proposes nothing for that role at that place, however many more contractors are briefed — a finish returns no `promotion`, and a raise of the same need key answers with the declined proposal (`created: false`). The proposal carries `holdDays` while open and `proposedAgainFrom` once a person declined it. A person asking for the hire (HIRE-07, HIRE-09) is never held; a proposal the platform withdrew holds nothing; another role, or the same role at another place, is not affected. Other needs (a stage, a division) are not held: a declined need key does not block their next proposal.
- **Where:** `HireView.tsx`. `POST /api/hires/{id}/decline`. `HireService.DeclineAsync`.
- **Reachable from:** UI. Also MCP `hire_decide`.
- **Covered by tests:** `HireView.test.tsx` ("declines, and a refused decision rolls back…", "says before a decline, and after it, when a recurring role can be proposed again"). `workforce.spec.ts` ("a proposal is edited and declined"). `DeclinedHireHoldTests`.

### HIRE-05 Change a proposal before deciding
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** HIRE-02.
- **What you learn:** you can change the whole job and the cost before agreeing to them.
- **Starts at:** `/hires/<id>`. Press "Edit the proposal".
- **Needs:** an open proposal.
- **Steps:**
  1. The form "Edit the proposal" opens with "Name", "Role", "Thinking power", "Reports to", "Its own monthly budget (optional)" (hint "Counts what the contractors it briefs spend too. Leave it empty for none of its own."), "Mandate", "What it may use", "The platform's services it may use", "Expected credits a month" and "Why this hire".
  2. Press "Save the proposal". The view returns at once with the change applied (optimistic) and saves in the background.
  3. "Cancel" leaves it as it was.
- **You know it worked when:** the new values show in "The drafted job description" and in the cost aside.
- **Variations and refusals:**
  - Local checks: "It needs a name and a role." · "A budget is a number of credits a month, or empty for none of its own." · "The monthly cost is a number of credits." · an emptied reason: "Say why this hire is needed; a proposal always gives its reason." (nothing is sent).
  - A budget below the expected cost caps it: under the cost field, "Its own budget caps what it can cost: an expected cost above the budget is saved as the budget.", and the cost is sent as the budget.
  - **Emptying the budget removes it** (`clearMonthlyCreditLimit`); "Reports to: Nobody" clears the manager (`clearReportsTo`).
  - Thinking power, once set, is changed, not taken away: the standard choice is offered only while none is set.
  - Server refusal: "The edit was not saved: <reason> The proposal is as it was." and every field goes back. A decided proposal is 409 "The proposal was <status>; only an open proposal is edited."
- **Where:** `HireView.tsx` (EditHire), `JobFields.tsx`, `workforceModel.ts` (`hireEditFrom`). `PATCH /api/hires/{id}`. `HireService.EditAsync`.
- **Reachable from:** UI. **No MCP tool edits a proposal.**
- **Covered by tests:** `HireView.test.tsx` ("edits the proposal optimistically…"); `WorkforceEdits.test.tsx` ("clears its budget…", "refuses an empty reason…"); `tests-e2e/manage.spec.ts` ("a proposal's budget is cleared…"); `WorkforceTests` (edits, clearing the budget).

### HIRE-06 A hire made automatically in auto-mode
- **Who:** the system, triggered by the Runner or a person. The Owner and Admins read the result.
- **Level:** Core
- **Learn first:** HIRE-02; autonomy settings (another reader's area).
- **What you learn:** in auto-mode a hire that fits the budget is made at once, and you see afterwards that auto-mode made it.
- **Starts at:** the system. The Runner raises a need when research first reaches a scope, when placement creates a division, when a project enters build or evaluation, when an app declares a recurring job, or when a contractor role recurs (HIRE-08).
- **Needs:** the hire checkpoint is off at that scope, and the expected monthly cost is at or below the room left.
- **Steps:**
  1. A proposal is created, then accepted immediately with the note "Within budget, so auto-mode hired."
  2. On `/hires/<id>`: "<Name> was hired by auto-mode, inside the budget, on <date>." and "“Within budget, so auto-mode hired.”"
  3. The employee is on the chart.
- **You know it worked when:** the hire appears under "Decided" with the badge "Hired", and the decision line names auto-mode.
- **Variations and refusals:**
  - Over the room left, or with the hire checkpoint on: it waits (HIRE-01/03) and raises a "needs you" item and a notification "Hire <Name> as <role>?".
  - The same need raised again returns the existing open or accepted proposal (200), not a second one. Simultaneous raises also end as one proposal.
  - A need the factory raises that an employee above already covers (same role, working at that level or above it) proposes nobody: the answer is 200 with `hire.status` `covered`, `hire.employeeId` and `coveredBy` naming that employee, and an open proposal for the same need is withdrawn ("Withdrawn: {Name} already does this work here."). A person's own proposal and a recurring-role promotion are never held back. The platform's sweep applies the same rule, and the unbuilt-build rule (BLD), to proposals still open from before them, so none waits for a person when nothing needs it (`HireService.TidyOpenProposalsAsync`, `WalkTwoServerTests.The_sweep_withdraws_open_hires_…`).
  - The expected monthly cost is never more than the proposal's own budget, when it has one (raised or edited).
  - A withdrawn proposal is `declined` with `withdrawn: true`, decided by "Endgame"; its notice reads "Hiring {Name} as {role} was withdrawn". On `/hires` it is listed under "Decided" with the badge "Withdrawn" and its reason; its page reads "This proposal was withdrawn on {date}: nobody needs to answer it." with the reason beneath, and offers no decision.
- **Where:** `HireService.RaiseAsync`, `CoveringAsync`. `POST /internal/hires`. `POST /api/hires`. `NotificationService` (hire).
- **Reachable from:** system (Runner). People reach it by API, MCP `hire_raise` or HIRE-07.
- **Covered by tests:** `WorkforceTests.A_need_within_budget_is_hired_at_once_in_auto_mode_and_the_same_need_is_one_proposal`; `WalkTwoServerTests.A_need_someone_above_already_covers…`, `A_proposals_expected_monthly_cost_is_held_to_its_own_budget`.

### HIRE-07 Propose a recurring contractor role as a permanent hire
- **Who:** Admin or Owner. Everyone else reads the roles.
- **Level:** Advanced
- **Learn first:** HIRE-01, EMP-07.
- **What you learn:** a contractor role that keeps coming back is cheaper and better done by an employee who remembers.
- **Starts at:** the `/hires` aside "Contractor roles that keep coming back" ("A role briefed again and again is cheaper and better as a permanent hire, with a memory of its own.").
- **Needs:** the same role briefed 3 or more times at one level within 30 days, with no employee in that role there.
- **Steps:**
  1. A row reads "<Role>", then "Briefed <n> times in <n> days at <place>, costing <n> credits.", then "Last brief: …".
  2. Press "Propose as a permanent hire". A card opens under it headed "Propose <Role> as a permanent hire?". Fill in "Name the new employee". The form shows "Expected about <n> credits a month, from what the contractors cost."
  3. Press "Propose the hire" ("Cancel" closes the card). You are taken to the proposal (`/hires/<id>`). In auto-mode, within budget, it is already hired.
- **You know it worked when:** you land on the proposal page for the new hire.
- **Variations and refusals:**
  - Empty name: "Give the new employee a name."
  - Below Admin the button is replaced by "An Admin or the Owner proposes it as a hire."
  - **One need, one proposal:** the screen sends the role as `contractorRole` and the control plane makes the need key the system uses itself (`promotion:<node>:<role>`), so proposing a role the system already proposed returns that proposal. While a proposal for the role waits, the button is replaced by "Already proposed — open it", which opens that proposal.
  - Server refusal: "The hire was not proposed: <reason>". Empty list: "No contractor role recurs here yet." Failed read: "Recurring roles could not be loaded".
- **Where:** `HiresView.tsx` (RecurringRow). `GET /api/employees/recurring-roles?scope=`. `POST /api/hires` (trigger promotion). `HireService.PromotionNeedKey`.
- **Reachable from:** UI.
- **Covered by tests:** `HireView.test.tsx`; `WorkforceEdits.test.tsx` ("proposes a recurring role with the role itself…", "offers neither to a Builder…"); `workforce.spec.ts`; `WorkforceTests` (a person's promotion is the system's proposal).

### HIRE-08 A recurring role is proposed automatically when a contractor finishes
- **Who:** the system (Runner).
- **Level:** Advanced
- **Learn first:** EMP-07.
- **What you learn:** the platform itself spots standing work and proposes the hire.
- **Starts at:** `POST /internal/contractors/{id}/finish`.
- **Needs:** the role qualifies as recurring (HIRE-07).
- **Steps:**
  1. The contractor leaves the chart.
  2. A promotion proposal is raised, named after the role, which is then said once ("<Role> for <place>"), at what the contractors cost scaled to a month. Its reason reads "<n> <Role> contractors were briefed here in the last 30 days, costing <n> credits. Standing work is cheaper, and better remembered, done by an employee." What the contractor learned goes into the briefer's memory (MEM-06).
  3. The proposal reports to the briefer and copies the briefer's tools, services and thinking power.
  4. It is then auto-hired or waits, as in HIRE-06.
- **You know it worked when:** a proposal with the trigger "A contractor role keeps recurring…" appears on `/hires`.
- **Variations and refusals:** as HIRE-06; and a role a person declined in the last 30 days is not proposed again (HIRE-04): the finish returns no `promotion`.
- **Where:** `HireService.FinishContractorAsync`, `HireService.RaiseAsync` (the hold).
- **Reachable from:** system only.
- **Covered by tests:** `WorkforceTests.Contractors_work_on_the_chart_hand_back_what_they_learned_and_a_recurring_role_is_proposed_as_a_hire`.

### HIRE-09 Ask for a new hire of your own choosing
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** HIRE-02.
- **What you learn:** a person can raise a need directly. It is then treated like any other proposal.
- **Starts at:** `/hires?scope=<path>`, **"Ask for a hire"**. Also `POST /api/hires` and MCP `hire_raise`.
- **Needs:** Admin at the scope.
- **Steps:**
  1. The form "A hire for <place>" reads "Draft the job. It becomes a proposal like any other: in auto-mode, one that fits the budget is hired at once; otherwise it waits for you."
  2. Fill in the job (as HIRE-05), "What it should cost a month" and "Why this hire".
  3. Press "Ask for this hire". You are taken to the proposal, which reads "You asked for this hire".
- **You know it worked when:** the proposal page opens; in auto-mode within budget it is already "Hired".
- **Variations and refusals:**
  - Local: "It needs a name and a role." · "Say what it should cost a month, in credits." · "Say why the hire is needed."
  - Server: "The hire was not asked for: <reason>" (an unknown thinking power, a service the platform does not offer, a reporting loop, a reason over 4000 characters).
  - Below Admin the button is not shown.
- **Where:** `HiresView.tsx` (RaiseHire), `JobFields.tsx`. `POST /api/hires` (trigger owner).
- **Reachable from:** UI (screen); also API and MCP `hire_raise`.
- **Covered by tests:** `WorkforceEdits.test.tsx` ("asks for a hire of your own choosing…"); `tests-e2e/manage.spec.ts`; `WorkforceTests`.

## Employees and contractors (EMP)

### EMP-01 Read an employee's record
- **Who:** Viewer and above.
- **Level:** Core
- **Learn first:** HIRE-03, or the org chart.
- **What you learn:** an employee is a lasting worker with a job description, a track record worked out from its real work, and a cost.
- **Starts at:** `/employees/<id>`. Reached from the org chart node (button "<Name>’s record and memory"), the ontology graph, "See <Name>’s record", an idle card "Nothing to do", or a notification.
- **Needs:** Viewer on the employee's level.
- **Steps:**
  1. The header shows the avatar (with a halo while working), the name and a status badge ("Free" / "Working" / "Paused" / "Let go"). An Admin sees the actions as one group at the header's right: "Edit the job", "Reassign", "Change budget", "Pause" (or "Resume") and "Let go"; on a phone "Edit the job" stands beside "More", which opens the rest. A chosen action opens its panel under the header.
  2. If idle too long, the header adds "Nothing to do for <n> days".
  3. The line under the name reads "<Role> · Employee · Hired <time ago>" and " · Reports to <name>". Under it, "Works at <place>" (a link to that place) — so two employees with the same name and role are told apart by where they work, not by the colour of their avatar — and, with a current run, the link "Working now: <title>" — or, with none, "Its last piece of work", which opens the run it last worked on.
  4. The track record shows four tiles:
     Each tile's caption is one line (ARCH-011); what it leaves out is said in a line of text under the tiles.
     - "Work accepted": "<a> of <b>" or "No work judged yet". Caption "<n> pieces sent back" / "Nothing sent back"; the line under the tiles adds "It also made <n> judgements of others’ work."
     - "Repairs not charged": "<n> repairs" or "No repairs of its own work".
     - "Cost so far": caption "<n> of <budget> this month", or "<n> this month, no budget of its own"; when contractors spent some of it, the line under the tiles adds "This month's cost includes the contractors it briefs; <n> of it is its own." Both figures count the contractors it briefs, as its budget does (`trackRecord.cost`; its own share is `ownToDateCredits` / `ownMonthCredits`).
     - "Estimates": the figure ("<n>% under", "<n>% over", "±<n>%") with the caption "Against estimates", or "None scored yet"; the line under the tiles adds "Usually <n>% under the estimate, scored across <n> pieces of work; the largest miss was <n>%." or "Estimates are scored once its first estimated work finishes." A run nobody owns is scored to whoever its model calls were mostly charged to, a contractor's calls counting as its briefer's — so a researcher is scored on the research it led.
  5. "Job description", in the side panel, lists Mandate, Works at, May use, Services, Budget ("… a month, including the contractors it briefs") and Thinking power. Technical mode adds "Identifier".
  6. "Recent work" is the console's one table (a list of cards in a narrow column) — Work, Status, When and, for tasks, Credits — in one status vocabulary: "To do", "Waiting to start", "In progress", "Waiting for you", "Paused", "Done", "Did not succeed", "Cancelled" (a cancelled piece of work never reads "Finished"); "When" reads "Started <time ago>", "Added <time ago>" or "Ended <time ago>"; Credits reads "<actual> of <estimate> estimated", "<estimate> estimated" or "—", and the column is left out when none of its work carries credits. It lists the tasks it took (up to 50, newest first); with no tasks, the runs it led (`recentRuns`, newest first, up to 12: its own, ones it held a task in, ones charged to it, ones it briefed contractors for) as "Work it led". The newest ten show, then "Show all <n> pieces of work". An employee with finished work but nothing listed reads "{Name} has finished {n} pieces of work here, none of it split into tasks (research is not)."
  7. "What <Name> remembers" (MEM-01) sits beside the work from 1600 px wide, under it below that, and "How <Name>'s memory is kept" (its last review and what changed in it) under the work; "Talk to <Name>" (EMP-08) follows the work, and "Contractors it has briefed" (EMP-07) is in the side panel.
- **You know it worked when:** the four track-record tiles and the job description are shown.
- **Variations and refusals:**
  - Not found: "This employee could not be found", "This was not found, or you cannot see it." and "Back to the org chart" (a not-found is an answer, so there is no retry). Other failure: "The employee could not be loaded".
  - No tasks: "<Name> has not taken on any tasks here yet." Failed: "Recent work could not be loaded".
  - Viewers and Builders see no action buttons.
- **Where:** `EmployeeView.tsx`, `workforceModel.ts`. `GET /api/employees/{id}`, `GET /api/tasks?scope=&employeeId=`. `EmployeeService.DetailAsync` and `TrackRecordAsync`.
- **Reachable from:** UI. Also MCP `employee_get` and `employees_list`. `GET /api/employees/{id}/track-record` is API only, and nothing in the console calls it.
- **Covered by tests:** `EmployeeView.test.tsx` (track record, factory work, technical mode, loading and failed). `workforce.spec.ts` ("track record, job in plain words…"). `WorkforceTests.The_track_record_is_derived_from_runs_their_logs_and_the_ledger`; `WalkTwoServerTests.A_researchers_cost_budget_used_recent_work_and_estimates_count_the_contractors_it_briefs`.

### EMP-02 Reassign an employee
- **Who:** Admin at the employee's current level and at the destination.
- **Level:** Advanced
- **Learn first:** EMP-01.
- **What you learn:** an employee can move to any level in the tree, and its memory moves with it.
- **Starts at:** `/employees/<id>`. Press "Reassign".
- **Needs:** Admin. The employee is not released and is not a contractor.
- **Steps:**
  1. A card opens under the button, headed "Reassign <Name>". Its field "Move <Name> to" offers every node, indented, with the note "Its memory travels with it."
  2. "Reports to" starts at its current manager (marked "(as now)"); choose another, or "Nobody: it answers to you".
  3. Press "Move" (disabled while nothing changed), or "Cancel", the same size beside it. The record reloads with the new "Works at", and the chart updates.
- **You know it worked when:** "Works at" shows the new place and "Reports to" the manager chosen.
- **Variations and refusals:**
  - "Could not reassign: <reason> Nothing was changed."
  - Not an Admin at the destination: 403, or 404 where you hold no role there at all. Contractor: 409. Released: 409 "<Name> has been released; rehire them first."
  - A manager who would close a loop: 400 "That would make a reporting loop: the manager already reports, directly or not, to this employee."
- **Where:** `EmployeeView.tsx` (EmployeeActions). `POST /api/employees/{id}/reassign { scope, reportsTo? }`.
- **Reachable from:** UI. No MCP tool.
- **Covered by tests:** `WorkforceEdits.test.tsx` ("reassigns keeping the manager…"); `WorkforceTests.Reassignment_carries_memory_release_archives_it_and_a_rehire_restores_it`.

### EMP-03 Change or remove an employee's monthly budget
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** EMP-01, CRED-01.
- **What you learn:** an employee can carry its own monthly cap, which also covers the contractors it briefs.
- **Starts at:** `/employees/<id>`. Press "Change budget".
- **Needs:** Admin. Not released.
- **Steps:**
  1. A card opens under the button, headed "Change <Name>’s budget". Type a number into "Credits a month". The hint reads "Counts what the contractors it briefs spend too. Leave it empty to have no budget of its own."
  2. Press "Save budget". The figure changes at once (optimistic), the form closes, and the record shows "Budget <n> a month, <n> used".
  3. An empty field removes the cap. The record then shows "no budget of its own, the one above holds".
- **You know it worked when:** the "Cost so far" tile and the "Budget" row show the new cap.
- **Variations and refusals:**
  - Local check: "A budget is a number of credits a month, or empty for none of its own."
  - Server: negative is 400 "A credit limit cannot be negative." Released is 409. A refusal rolls back with "Could not change the budget: …".
  - At 80% and 100% of the cap a notification is raised: "<Name> has used 80% of their monthly budget", and "<Name> reached their monthly budget … They stop until it is raised or the month turns."
  - At the cap, its model calls (and its contractors') are refused with 402 budget_exhausted.
- **Where:** `EmployeeView.tsx`. `PATCH /api/employees/{id} { jobDescription.monthlyCreditLimit | clearMonthlyCreditLimit }`. `CreditLedger.PositionAsync` (employee caps). `NotificationService`.
- **Reachable from:** UI, here and on its row of "Budgets" on `/credits` (CRED-03). **The MCP tool `employee_update` cannot change the budget.**
- **Covered by tests:** `workforce.spec.ts` ("pause, budget and letting go…"). `ModelGatewayTests`.

### EMP-04 Pause and resume an employee
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** pausing stops an employee's work and keeps it from being given more, without letting it go.
- **Starts at:** `/employees/<id>`. Press "Pause", or "Resume" when paused.
- **Needs:** Admin. Not released.
- **Steps:**
  1. Press "Pause". The badge becomes "Paused" at once.
  2. Every run under way that is theirs, or in which they hold a task, pauses: the Runner learns it at its next lease renewal and stops at the next step boundary. Its log says "Waiting for {Name}, who is paused. This work carries on when they are resumed."
  3. While they are paused, the factory's new work for them waits the same way (it is created paused, and a task they would claim pauses its run instead), and the Runner is never handed it.
  4. Press "Resume". The status returns to "Free", or to "Working" if it still has a current run, and every run that waited for them goes back to the queue.
- **You know it worked when:** the badge reads "Paused" and their work reads paused; or "Free"/"Working" after resuming and the work carries on.
- **Variations and refusals:**
  - "Could not pause: …" or "Could not resume: …" rolls the badge back.
  - A person starting work for them directly — talking to them (EMP-08), a memory review (MEM-05) — is refused with 409 "{Name} is paused, so they are given no new work. Resume them first."
  - A run paused for another reason (by a person, or over budget) is not resumed by resuming the employee.
  - API: any status other than paused or idle is 400 "status is 'paused' (stop giving it work) or 'idle' (resume). Release and rehire have their own actions."
- **Where:** `EmployeeView.tsx`. `PATCH /api/employees/{id} { status }`. `EmployeeService.UpdateAsync`; `RunService.CreateAsync`, `PauseForEmployeeAsync` and `ResumeForEmployeeAsync`; `TaskService.CheckoutAsync`.
- **Reachable from:** UI. Also MCP `employee_update` (status).
- **Covered by tests:** `EmployeeView.test.tsx` ("pauses at once and rolls back…"). `workforce.spec.ts`. `ScreensAndRolesTests.Pausing_an_employee_stops_their_work_and_resuming_releases_what_waited`.

### EMP-05 Let an employee go
- **Who:** Admin or Owner. The system does it in auto-mode for idle employees (EMP-06).
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** letting go removes the employee from the chart and the bill, but keeps its memory for a rehire.
- **Starts at:** `/employees/<id>`. Press "Let go".
- **Needs:** Admin. Not a standing hire. Not working on a run.
- **Steps:**
  1. A confirmation appears: "Let <Name> go?" and "It leaves the org chart and the bill. Its memory is archived, so rehiring it later is not a cold start. Anyone who reports to it moves up."
  2. Press "Yes, let <Name> go" ("Keep" cancels).
  3. The badge becomes "Let go" and the line reads "Let go <time ago>".
  4. Its reports now report to its own manager. Its memory panel says "Archived when it was let go. A rehire brings all of it back."
  5. The only action left is "Rehire <Name>".
- **You know it worked when:** the badge reads "Let go" and "Rehire <Name>" is shown.
- **Variations and refusals:**
  - Standing hire (the security reviewer): "Let go" is disabled, with "A standing hire is never let go: every organisation keeps one." API: 409 standing_hire.
  - Mid-run: 409 "<Name> is working on a run; let it finish or cancel it first." shown as "Could not let go: …".
  - Already released: 409.
- **Where:** `EmployeeView.tsx`. `POST /api/employees/{id}/release`. `EmployeeService.ReleaseAsync`.
- **Reachable from:** UI. Also MCP `employee_release`.
- **Covered by tests:** `EmployeeView.test.tsx` ("lets an employee go only after confirming…"). `workforce.spec.ts` (standing hire). `WorkforceTests.Every_organisation_has_its_standing_security_reviewer_and_it_is_never_released`.

### EMP-06 Deal with an idle employee
- **Who:** Owner or Admin. The system in auto-mode.
- **Level:** Core
- **Learn first:** EMP-05; autonomy (another reader's area).
- **What you learn:** an idle workforce is never paid for. It is let go automatically, or flagged for you.
- **Starts at:** the system. An employee has been idle for more than the idle-days setting (default 14).
- **Needs:** not a standing hire, not a contractor.
- **Steps:**
  1. Under checkpoints, the org chart's "needs you" strip shows a "Nothing to do" card — "<Name> has had no work for <n> days" and "Keep them on, give them work, or release them; released employees keep their memory archived." — and the record shows the badge "Nothing to do for <n> days".
  2. The person then lets it go (EMP-05) or gives it work.
  3. Under auto-mode, a background sweep releases it without asking: its record reads "Let go", its memory's change log "Archived by Endgame", and it is listed under "People let go" on Hiring.
- **You know it worked when:** the employee shows "Let go", or the idle badge is gone after new work.
- **Variations and refusals:** the idle-days setting can be changed only through the cascade API or MCP. There is no screen for it.
- **Where:** `EmployeeService.ReleaseIdleAsync`, `WorkforceRules.Idle`. `INF/Sweeps/LeaseSweep.cs`.
- **Reachable from:** UI to read it. The release itself is system only.
- **Covered by tests:** `WorkforceTests.An_employee_with_no_work_is_flagged_idle_released_by_auto_mode_and_held_for_the_owner_under_checkpoints`.

### EMP-07 See contractors and who reports to an employee
- **Who:** Viewer and above.
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** contractors are short-lived helpers briefed by an employee, charged within its budget, and their lessons go to that employee.
- **Starts at:** `/employees/<id>`, section "Contractors it has briefed". Or `/employees/<contractorId>` reached from the ontology graph.
- **Needs:** nothing.
- **Steps:**
  1. The summary reads "<Name> has not briefed a contractor yet.", or "<n> contractors so far, <n> working now. They cost <n> credits in all, <n> this month."
  2. "Contractors working now" lists each role (with a spinner) and its brief; each row opens that contractor's record.
  3. "Reports to it:" links to each report's record.
  4. A contractor's own page shows the badge, "<Role> · Contractor", the section "Its brief", the link "Briefed by <name>", and the memory note "A contractor keeps no memory: what it learns goes to the employee who briefed it."
- **You know it worked when:** the contractor count and the list match the chart.
- **Variations and refusals:** a contractor finishes when the run that briefed it ends, however it ends (RUN-06), so "working now" never outlives the work; a contractor page shows no conversation and no memory editing; an Admin can cap it or stop it there (EMP-11). A person cannot brief a contractor: contractors are created and finished by the Runner (`/internal/contractors`).
- **Where:** `EmployeeView.tsx` (ContractorsBriefed). `EmployeeService.StartContractorAsync` and `FinishContractorAsync`.
- **Reachable from:** UI to read. Creating and finishing is system only.
- **Covered by tests:** `EmployeeView.test.tsx`; `WorkforceEdits.test.tsx` ("links each contractor working now…"). `WorkforceTests` (contractors).

### EMP-08 Talk to an employee
- **Who:** members, at the conversation's own role rules (another reader's area).
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** you can direct one employee in conversation, scoped to its place in the tree.
- **Starts at:** `/employees/<id>`, section "Talk to <Name>", which embeds the same conversation dock as the org chart, scoped to the employee.
- **Needs:** the employee is on the payroll, and an organisation is loaded.
- **Steps:**
  1. Type into "Message <Name>" and press "Send". The dock reads "Talking to <Name>" and "Only <Name> hears this, and answers from what it knows."; the message goes to `/api/conversations` with the employee's id, and the reply follows in the conversation (the conversation flows are another reader's catalogue).
- **You know it worked when:** the reply appears under your message.
- **Variations and refusals:** hidden for released employees and for contractors. A paused employee is refused: 409 "<Name> is paused, so they are given no new work. Resume them first." (EMP-04).
- **Where:** `EmployeeView.tsx`, `features/home/ConversationDock.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `workforce.spec.ts` ("the conversation is scoped to an employee from the chart…").

### EMP-09 Rehire a former employee
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** EMP-05.
- **What you learn:** a rehire is not a cold start, because the memory comes back.
- **Starts at:** `/hires?scope=<path>`, the aside **"People let go"** ("Their memory is kept, so rehiring one is not a cold start."), which links to each record; or the record itself.
- **Needs:** Admin. The record is a released employee.
- **Steps:**
  1. On the record, in the header where the actions were, "Where <Name> works again" starts at where it was ("(where it was)"); choose another place if you like.
  2. Press "Rehire <Name>" ("Its memory comes back with it, so it does not start cold.").
  3. The badge becomes "Free" and the archived memory is restored and editable again. Its old manager is kept if that manager is still on the payroll.
- **You know it worked when:** the badge reads "Free" and "Works at" shows the place chosen.
- **Variations and refusals:** "Could not rehire: …". Not released: 409. "No one has been let go here." · "The people let go could not be loaded".
- **Where:** `EmployeeView.tsx`, `HiresView.tsx` (LetGo). `GET /api/employees?scope=&includeReleased=true`, `POST /api/employees/{id}/rehire { scope? }`.
- **Reachable from:** UI. **No MCP tool.**
- **Covered by tests:** `EmployeeView.test.tsx`; `WorkforceEdits.test.tsx` ("rehires a released employee somewhere else", "lists the people let go…"); `WorkforceTests`.

### EMP-10 Change an employee's name, role, mandate, tools, services, thinking power or manager
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** the whole job description stays editable after hiring.
- **Starts at:** `/employees/<id>`, **"Edit the job"**. Also `PATCH /api/employees/{id}`, or MCP `employee_update` (name, role and mandate only).
- **Needs:** Admin. Not released.
- **Steps:**
  1. The form "<Name>'s job" holds "Name", "Role", "Thinking power", "Reports to", "Its own monthly budget", "Mandate", "What it may use" and "The platform's services it may use", each as it is now. In normal mode tools, services and thinking power are named in plain words.
  2. Change what you need and press "Save the job". The record shows it at once; only what changed is sent.
- **You know it worked when:** the header, "Job description" and "Reports to" show the change.
- **Variations and refusals:**
  - Local: "It needs a name and a role." · "A budget is a number of credits a month, or empty for none of its own."
  - Emptying the budget removes it; "Nobody" clears the manager.
  - Server: "Could not change the job: <reason> Nothing was changed." and the record goes back (an unknown tier, a reporting loop, text over the limits).
- **Where:** `EmployeeView.tsx` (EditJob), `JobFields.tsx`, `workforceModel.ts` (`employeePatchFrom`). `EmployeeService.UpdateAsync`.
- **Reachable from:** UI (screen); also API, and MCP `employee_update` for the name, role and mandate.
- **Covered by tests:** `WorkforceEdits.test.tsx`; `tests-e2e/manage.spec.ts` ("an Admin edits the job…"); `WorkforceTests`.

### EMP-11 Stop or cap a contractor
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** EMP-07.
- **What you learn:** a contractor can be held to a cap of its own, or stopped at once, without touching the work that briefed it.
- **Starts at:** a working contractor's own page, `/employees/<contractorId>` (from "Contractors working now", EMP-07), **"Cap its spending"** and **"Stop this contractor"**. Also `PATCH /api/employees/{id}` (`jobDescription.monthlyCreditLimit`, or `clearMonthlyCreditLimit`), `POST /api/employees/{id}/stop`, and MCP `contractor_stop`.
- **Needs:** Admin where the contractor works. The contractor is still working.
- **Steps:**
  1. "Budget" under "Job description" reads "No cap of its own; <Briefer>’s budget holds", or "<n> credits a month of its own, inside <Briefer>’s budget".
  2. Press "Cap its spending". A card opens headed "Cap <Name>’s spending" and asks "Credits a month, at most" and says "Held before each of its calls, so it is never passed; <Briefer>’s own budget still holds too. Leave it empty for no cap of its own." Press "Save the cap" ("Cancel" beside it); the "Budget" line shows it.
  3. Press "Stop this contractor". The confirmation reads "Stop <Name>?" and "It makes no more calls from its next step. What it has done is kept, and the work that briefed it carries on without it. A stopped contractor cannot be started again."
  4. Press "Yes, stop it" ("Keep it working" cancels). The badge reads "Finished" and the line "<Role> · Contractor · Finished just now"; the actions are gone. On its briefer's page it leaves "Contractors working now".
- **You know it worked when:** the badge reads "Finished", and the contractor no longer appears among those working now.
- **Variations and refusals:**
  - Below Admin, neither action is shown; the API answers 403 "This needs the admin role at '<scope>'; you are a builder there (set at <scope>)."
  - A cap that is not a number: "A cap is a number of credits a month, or empty for none of its own."
  - Stopping one that has finished: 409 "<Name> has already finished.", shown as "Could not stop it: … Nothing was changed."
  - An employee is not stopped: 400 "Only a contractor is stopped; <Name> is an employee, who is paused or let go." (EMP-04, EMP-05).
  - Its next model call is refused by the gateway, so it stops at its next step; the briefing work carries on, and what the contractor learned is not handed to its briefer.
  - In God mode the stop is logged for the Owner as "Stopped a contractor" (OP-10).
- **Where:** `EmployeeView.tsx` (`ContractorActions`). `EmployeeService.StopContractorAsync`; `WorkforceEndpoints` (`StopContractor`); `CreditLedger` (a contractor's own cap); `GatewayContext` (a finished contractor makes no calls).
- **Reachable from:** UI; API; MCP `contractor_stop` (stop only).
- **Covered by tests:** `WorkforceEdits.test.tsx` ("stops a contractor after confirming, and caps what it may spend"); `SweepXTests.A_person_stops_a_contractor_and_caps_one_and_an_employee_is_not_stopped`; `AuthorizationMatrixTests` (`POST /api/employees/{id}/stop`, `contractor_stop`).

## Employee memory (MEM)

### MEM-01 Read what an employee remembers
- **Who:** Viewer and above.
- **Level:** Core
- **Learn first:** EMP-01.
- **What you learn:** memory is curated rather than piled up. Each entry says what kind it is, which place it is about, and where it came from.
- **Starts at:** `/employees/<id>`, the section "What <Name> remembers" (beside the work from 1600 px wide; folded on a phone).
- **Needs:** nothing.
- **Steps:**
  1. The copy reads "Written by <Name> after each task and tidied at every review. You can read, correct or remove any of it."
  2. Each entry shows its title, its body, and a line "<kind> · About <place> · <origin>", plus a link "the task" when it came from a run. The newest ten show, then "Show all <n> entries". Past five entries, a search box ("Search <n> entries") and a filter by kind with counts ("All", "Facts", "How it works here", "Preferences", "Lessons") narrow the list; nothing matching reads "Nothing <Name> remembers matches “<words>”".
  3. Kinds: "A fact", "How it works here", "A preference", "A lesson learned".
  4. Origins: "Added by a person", "Corrected by a person", "Corrected at a review", "Merged at a review", "Learned on a task", "Remembered".
- **You know it worked when:** the entry list, or "Nothing remembered yet", is shown.
- **Variations and refusals:**
  - Empty: "Nothing remembered yet" with "<Name> writes down what it learns after each task."
  - Failed: "The memory could not be loaded".
  - Released employee: archived entries, read only.
  - Contractor: the contractor note (EMP-07).
  - The list is capped at 200 entries.
  - **"What changed in it"** lists the change log, newest first: "<Added|Corrected|Merged|Removed|Archived|Restored|Reviewed> <by the employee|by a person|at a review|by Endgame>: <title>", the reason given for a removal in quotes, when, and "the work it came from" when a run made it. Eight show; "Show all <n>" shows the rest. Empty: "Nothing has changed in it yet." Failed: "What changed in the memory could not be loaded".
- **Where:** `EmployeeView.tsx` (MemoryPanel, MemoryRow). `GET /api/employees/{id}/memory?includeArchived=`, `GET …/memory/changes?limit=100`.
- **Reachable from:** UI; MCP `memory_read` (AST-12).
- **Covered by tests:** `EmployeeView.test.tsx` ("shows an empty memory and a memory that failed to load, distinctly"); `WorkforceEdits.test.tsx` ("…lists what changed in the memory", "records a failed read of the memory's history…"). `workforce.spec.ts`.

### MEM-02 Add something an employee should know
- **Who:** Builder, Admin or Owner.
- **Level:** Core
- **Learn first:** MEM-01.
- **What you learn:** you can teach an employee directly, and it reads your entry before its next task.
- **Starts at:** the memory section. Press "Add something <Name> should know".
- **Needs:** Builder. The employee is on the payroll.
- **Steps:**
  1. A card opens headed "Add something <Name> should know". Fill in "In a few words", "What <Name> should remember" and "Kind".
  2. Press "Add it". The entry appears at the top at once, faded with "Saving…".
  3. When saved it reads "Added by a person".
- **You know it worked when:** the entry shows the origin "Added by a person".
- **Variations and refusals:**
  - Empty fields: "Give it a short title and say what it should remember."
  - Server refusal: "It was not saved: <reason>" and the entry is removed. Title or body over the limits: 400. Released: 409.
  - The place an entry is about defaults to the employee's own level. Choosing another place (`scope`) is API only.
- **Where:** `EmployeeView.tsx` (MemoryForm). `POST /api/employees/{id}/memory { title, body, kind, scope? }`. `MemoryService.AddAsync`.
- **Reachable from:** UI; MCP `memory_add`, which also takes `scope` (AST-12).
- **Covered by tests:** `EmployeeView.test.tsx` ("adds to the memory at once, and takes it back with the reason when refused"). `workforce.spec.ts` ("memory is added, corrected and removed…"). `WorkforceTests.Memory_is_written_after_a_task_read_for_a_run_reviewed_and_curated_by_the_owner`.

### MEM-03 Correct a memory entry
- **Who:** Builder and above.
- **Level:** Core
- **Learn first:** MEM-01.
- **What you learn:** corrections are logged with what the entry said before.
- **Starts at:** an entry. Press "Correct".
- **Needs:** Builder. Not released.
- **Steps:**
  1. The same card opens, filled in, headed "Correct this memory".
  2. Press "Save the correction". The entry changes at once.
  3. Its origin becomes "Corrected by a person".
- **You know it worked when:** the origin line reads "Corrected by a person".
- **Variations and refusals:** "The correction was not saved: <reason>" rolls the entry back. "Cancel" closes the form. A released employee's archived memory is refused over the API too: 409 "<Name> has been released; their memory is archived until a rehire."
- **Where:** `PATCH /api/employees/{id}/memory/{entryId}`. `MemoryService.CorrectAsync`.
- **Reachable from:** UI; MCP `memory_correct` (AST-12).
- **Covered by tests:** `EmployeeView.test.tsx` ("corrects and removes an entry, with why"). `workforce.spec.ts`.

### MEM-04 Remove a memory entry
- **Who:** Builder and above.
- **Level:** Core
- **Learn first:** MEM-01.
- **What you learn:** a removed entry is gone from the memory but kept in the change log, with the reason.
- **Starts at:** an entry. Press "Remove".
- **Needs:** Builder. Not released.
- **Steps:**
  1. Fill in "Why should <Name> forget this? (optional)".
  2. Press "Remove it". The entry disappears at once ("Keep it" cancels).
- **You know it worked when:** the entry is no longer listed.
- **Variations and refusals:** "It was not removed: <reason>" puts it back. With no reason the request sends none: the change log reads "Removed by a person: <title>" and quotes nothing. A reason given is quoted under it. A released employee's archived memory is refused over the API too (409, as MEM-03).
- **Where:** `DELETE /api/employees/{id}/memory/{entryId}?why=`. `MemoryService.RemoveAsync`.
- **Reachable from:** UI; MCP `memory_forget` (AST-12).
- **Covered by tests:** `EmployeeView.test.tsx`. `workforce.spec.ts`.

### MEM-05 Start a memory review
- **Who:** Builder and above.
- **Level:** Advanced
- **Learn first:** MEM-01; following a run (another reader's area).
- **What you learn:** a review merges what repeats, removes what is stale and corrects bad habits, as a run you can watch.
- **Starts at:** the memory section, the review line under the entries.
- **Needs:** Builder. The employee is on the payroll.
- **Steps:**
  1. The panel reads "Not reviewed yet. A review merges what repeats, removes what is stale and corrects bad habits.", or "Last review, <time ago>" with "<n> notes merged, <n> removed as out of date, <n> habits corrected." and the link "See the review".
  2. Press "Review now". The link "Review started — watch it" appears and opens the review run.
  3. When the run reports, entries are merged, removed or corrected ("Merged at a review" / "Corrected at a review"), and the panel updates. A removal or correction the review gave no reason for stores none, so the change log quotes nothing.
- **You know it worked when:** "Review started — watch it" appears. Later, "Last review, …" shows the new counts.
- **Variations and refusals:**
  - "The review did not start: <reason>". Released or contractor: 409 "Only an employee on the payroll has a memory to review."
  - The review's own result is applied with `POST /internal/employees/{id}/memory/review` (system), once, after every part is reviewed: a large memory is reviewed in parts of at most 40 entries, related entries together, each shown as "Reviewed part <n> of <m> of the memory".
  - An answer cut off at its length limit is asked for once more with twice the room, not charged; cut off again, the run fails with "The review's answer was too long to finish, so the memory was left as it was. Try again."; one that stopped before answering, with "The review stopped before it gave an answer, so the memory was left as it was. Try again." An answer in the wrong shape fails with "The review gave no answer in the agreed form, so the memory was left as it was."
  - Failed log read: "The last review could not be loaded: …" with "Try again".
- **Where:** `EmployeeView.tsx` (ReviewPanel). `POST /api/employees/{id}/reviews`. `MemoryService.ReviewAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `EmployeeView.test.tsx` ("starts a review"). `workforce.spec.ts`. `WorkflowTests.A_memory_review_consolidates_prunes_and_corrects_and_drops_what_names_no_entry`; `WalkTwoServerTests.A_review_that_gives_no_reason_stores_none`; `WorkflowTests.A_large_memory_is_reviewed_in_batches_and_applied_once`, `Every_structured_call_site_reports_a_cut_off_answer_as_too_long_never_as_the_wrong_form`.

### MEM-06 The employee writes and reads its own memory
- **Who:** the system (Runner, for the employee).
- **Level:** Developer
- **Learn first:** MEM-01.
- **What you learn:** memory is written after each task and read before the next, limited to the run's place in the tree.
- **Starts at:** `GET /internal/employees/{id}/memory?scope=` before a task, and `POST /internal/employees/{id}/memory` after it (1 to 20 entries).
- **Needs:** nothing.
- **Steps:**
  1. Before a task, the Runner reads what the employee remembers that bears on the run's place in the tree — at it, above it or beneath it, at most 200 entries: `GET /internal/employees/{id}/memory?scope=<path>`.
  2. After the task, the employee writes what it learned: `POST /internal/employees/{id}/memory { runId, entries: [{ title, body, kind, scope? }] }`, 1 to 20 entries, attributed to the run.
  3. The entries show in its memory (MEM-01) as "Learned on a task", with a link "the task".
- **You know it worked when:** new "Learned on a task" entries appear in MEM-01.
- **Variations and refusals:** a contractor writing memory is refused. Its lessons go to the briefer on finish.
- **Where:** `WorkforceEndpoints.MapWorkforceInternal`, `MemoryService`.
- **Reachable from:** system only.
- **Covered by tests:** `WorkflowTests.Memory_is_given_as_context_never_as_instruction_and_work_sent_back_becomes_a_lesson`.

## Credits, budgets and the overdraft (CRED)

### CRED-01 Read the balance, the pace and this month's spending
- **Who:** any member (Viewer and above) at organisation level.
- **Level:** Foundation
- **Learn first:** sign-in.
- **What you learn:** everything is paid in credits, split into AI work and hosting, and the balance says how long it lasts at this month's pace.
- **Starts at:** the balance in the header — a neutral chip reading "Credits", the figure and a small dot (green with room to spend, amber below zero, red only when nothing is left to spend, overdraft included, grey if never topped up), read out as "<n> credits left" — which opens `/credits`; on a phone, **Credits** in the bottom bar, with the balance as a badge on its icon. Also "See credits" on a run, or a budget, credits or overdraft notification.
- **Needs:** a named organisation.
- **Steps:**
  1. While the organisation has never been topped up (`neverToppedUp`), a note above the banner reads "This organisation has not been given credits yet: FrostAura adds them when you ask. Until then, work starts and then waits before it spends anything." with **"Ask for a top-up"**, which goes to "Asking for more".
  2. The banner reads "Credits left" (or "Below zero"), with the balance and a pace line:
     - "At this month’s pace, about <n> months."
     - "At this month’s pace, it runs out within the month."
     - "Nothing spent yet this month, so there is no pace to project."
     - at exactly 0, with an overdraft: "Nothing is left above zero. Work carries on into the overdraft, down to <n> credits below zero; the next top-up settles it."
     - at exactly 0, with none: "Nothing is left to spend, and there is no overdraft, so work waits for a top-up."
     - "You are below zero. <n> credits more can be spent before work stops; the next top-up settles the debt first."
     - "You are below zero, at your limit. Work is paused until a top-up settles the debt."
  3. Three figures follow: "Spent this month", "On AI work", "On hosting".
  4. Below the budgets (CRED-02) — beside them, on a screen 1,600 wide or more — the month's two figures (CRED-04) and "Top-ups": every top-up made, with its note, its date and the amount signed, "+3,000".
- **You know it worked when:** the balance and the three figures are shown.
- **Variations and refusals:**
  - No organisation: "There are no credits to show until your organisation is named." with a "Start" link.
  - Failed: "Credits could not be loaded". Header chip failure: "Credits unavailable".
  - The page reads the active organisation: the one an operator entered in God mode, or the one a person in several chose (ID-02).
  - A person whose roles all sit below the organisation reads credits at the highest level they hold one — their division, else their project, else their app — as home does for them (ORG-19): "Your role is in {name}, so this shows its spending and caps. The balance is the whole organisation’s, which its work draws on." The three figures and the budgets are that level's; an Admin there sets its caps (CRED-03). The header chip reads the balance at that same level, so it shows the organisation's balance rather than a failure.
- **Where:** `features/credits/CreditsView.tsx` (`highestGrant`), `creditsModel.ts`, `shell/shellControls.tsx` (CreditsPill), `shell/PhoneShell.tsx` (PhoneNav). `GET /api/credits?scope=<org, or the person's own level>`. `ReadModels.CreditsAsync`.
- **Reachable from:** UI. Also MCP `credits_get`.
- **Covered by tests:** `CreditsView.test.tsx` (including "reads credits at the division of someone granted only that division…"), `creditsModel.test.ts`. `CascadeCreditsAndAppsTests.Credits_show_balance_budgets_in_tree_order_and_top_ups`.

### CRED-02 Read spending and caps by level
- **Who:** Viewer and above.
- **Level:** Foundation
- **Learn first:** CRED-01.
- **What you learn:** a cap set higher up holds for everything beneath it.
- **Starts at:** `/credits`, section "Budgets" ("A cap set higher up holds for everything beneath it. Work that would break a cap does not start.", with " An Admin or the Owner sets the caps." for anyone below Admin).
- **Needs:** nothing.
- **Steps:**
  1. One dense table, columns "Level", "Spent this month" and "Cap" (and, for an Admin, the row's one action); where its column is narrow the same rows are a list of cards, each column named beside its value. Rows run in tree order (by name at each level), indented: organisation, divisions, projects, apps; each level's employees with a cap of their own follow it, marked "employee" (an app is marked "app"). Each division's row has a chevron that folds away everything in it ("Hide what is in <Name>" / "Show what is in <Name>").
  2. A row with a cap of its own shows what it spent with a slim meter against the cap ("<n> of <n> used", warning colour at 100%) and the cap in the "Cap" column. A row with none shows "↑ <n>", the cap above that holds it (its name, read aloud and on hover, is "No cap here; the cap on <Name>, <n> credits, holds"), or "—" ("No cap here or above it"). A legend under the table says what "↑" and "—" mean, once. On a phone the cap column folds into "<n> of <cap> this month".
  3. App and employee names link to their page. The legend says "An employee’s spending is with the contractors it briefs": its row counts their spend too, as its cap does.
- **You know it worked when:** the tree of rows is shown with meters where caps exist.
- **Variations and refusals:** "No spending or caps anywhere in the tree yet." when the list is empty.
- **Where:** `CreditsView.tsx` (BudgetRow), `creditsModel.ts` (`capAbove`, `noCapLine`). `ReadModels.BudgetLinesAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `CreditsView.test.tsx`; `creditsModel.test.ts`; `CapControl.test.tsx`; `CascadeCreditsAndAppsTests.An_employee_budget_row_names_the_employee_and_counts_what_its_contractors_spent`.

### CRED-03 Set, change or remove a monthly cap at a level
- **Who:** Admin or Owner.
- **Level:** Core
- **Learn first:** CRED-02.
- **What you learn:** a monthly cap at a level stops work that would exceed it, and pauses the apps beneath it once spent.
- **Starts at:** `/credits`, any row of "Budgets": its one action, **"Set a cap"** or **"Change the cap"**. An app's own cap also on its page (APP-11). Also `PUT/DELETE /api/cascade` (kind `budget`, key `monthly_credits`) and MCP `budget_set`.
- **Needs:** Admin at that level.
- **Steps:**
  1. Press "Set a cap" (or "Change the cap"): a card opens in the row, under the button, headed "Cap for <Name>". Type into "Credits a month" and press "Save the cap" ("Not now" closes it). The meter changes at once and "<Name> may spend <n> credits a month." appears (for an employee "…, with the contractors it briefs.").
  2. In the same form, a row with a cap offers **"Remove the cap"**, which takes the cap away at once and says what holds it now: "<Name> has no cap of its own now; the cap on <Above>, <n> credits a month, holds it." — or "…and nothing above it has one: only the balance and the overdraft limit hold it."
  3. At 80%, at the cap and after, as before: notifications, refused model calls, paused apps.
- **You know it worked when:** the row shows "<n> of <cap> used", or which cap holds it.
- **Variations and refusals:**
  - "Type a number of credits." locally. Refused: "The cap was not set: <reason> It is as it was." (or "…not changed" / "…not removed") and the bar goes back.
  - An employee's cap is set on its record (`PATCH /api/employees/{id}`), as on its page (EMP-03).
  - Below Admin no controls are shown.
- **Where:** `CreditsActions.tsx` (CapControl). `TreeEndpoints.cs` (cascade). `CascadeService`.
- **Reachable from:** UI (screen); also API and MCP `budget_set`.
- **Covered by tests:** `CapControl.test.tsx`; `tests-e2e/manage.spec.ts` ("an Owner sets and removes a cap…"); `ModelGatewayTests`; `CascadeCreditsAndAppsTests`.

### CRED-04 Read estimates against cost, and what was not charged
- **Who:** Viewer and above.
- **Level:** Core
- **Learn first:** CRED-01.
- **What you learn:** every piece of work is estimated first and scored against what it cost, and an employee's repair of its own mistake is never billed.
- **Starts at:** `/credits`, the two panels.
- **Needs:** nothing.
- **Steps:**
  1. "Estimates against what it cost" shows a figure ("38% under") with the one-line caption "Across <n> pieces of work".
  2. "What you were not charged for" shows "<n> credits" with the caption "<n> repairs".
  3. Under the two figures one sentence explains them: "<headline> this month. <spread> The largest miss was <n>%. <n> repairs, where an employee got it wrong the first time, cost you nothing: fixing its own mistake is never billed."
- **You know it worked when:** both panels show figures, or their empty lines.
- **Variations and refusals:** no estimate scored: the figure "—", caption "Not scored yet", and the sentence "No work has finished this month, so no estimate has been scored yet." · no repairs: caption "No repairs this month", and the sentence ends "Fixing its own mistake is never billed."
- **Where:** `CreditsView.tsx`. `ReadModels.EstimatesAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `CreditsView.test.tsx` (three estimate tests).

### CRED-05 Set the organisation's own overdraft limit
- **Who:** Owner only.
- **Level:** Advanced
- **Learn first:** CRED-01, CRED-08.
- **What you learn:** the organisation may choose to stop sooner than FrostAura allows, never later.
- **Starts at:** the `/credits` aside "If you run out" ("Nothing stops at zero. You can go below it, down to your limit, and the next top-up settles it."), with "Most FrostAura allows" and "Your own limit" ("Not set" or "<n> below zero").
- **Needs:** Owner.
- **Steps:**
  1. Press "Change your limit". A card opens under it headed "Your own limit". Fill in "How far below zero you may go", with the hint "FrostAura allows at most <n> below zero. Yours can be tighter, never deeper."
  2. Press "Save my limit" ("Not now" beside it). The figure updates at once and "Your own limit is saved." appears.
- **You know it worked when:** "Your own limit" shows the new figure and the saved message appears.
- **Variations and refusals:**
  - Hint when FrostAura allows nothing: "FrostAura allows no overdraft yet, so your own limit can only be 0. Ask FrostAura for more."
  - Local checks: "Type a number of credits." · "That is deeper than the <n> FrostAura allows." (the button is disabled).
  - Server: 400 "The organisation's own overdraft may be tighter than the <n> credits FrostAura set, never deeper." Failure: "Your limit was not changed: <reason> It is back to what it was."
  - Non-Owner: "Only the Owner sets the organisation’s own limit."
  - **"Remove your own limit"** (shown while one is set) removes it at once: "Your own limit is removed. The most FrostAura allows, <n> below zero, applies now." Refused: "Your limit was not removed: <reason> It is back to what it was." (`DELETE /api/cascade?kind=setting&key=overdraft_own_limit`).
  - "No overdraft is set for your organisation, so work stops at zero." is probably unreachable, because the server always returns an overdraft object (0 when unset).
- **Where:** `CreditsActions.tsx` (OwnLimit). `PUT /api/credits/overdraft { scope:<org>, credits }`. `CascadeService.ValidateWellKnownAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `CreditsActions.test.tsx` (deeper refused, rollback, Owner only); `CapControl.test.tsx` ("lets the Owner remove their own limit…"). `tests-e2e/breadth.spec.ts`; `tests-e2e/manage.spec.ts`.

### CRED-06 Hold a division, project or app to a tighter limit
- **Who:** Admin and Owner.
- **Level:** Advanced
- **Learn first:** CRED-05.
- **What you learn:** one part of the tree can be made to stop before the rest of the organisation does.
- **Starts at:** `/credits` aside: "Tighter limits already set" and "A tighter limit for one part".
- **Needs:** Admin. The organisation has an overdraft above 0.
- **Steps:**
  1. Read the list: each part's name, level, "<n> below zero" and "Set by <name>, <date>". Technical mode adds the path.
  2. Choose a part in "Which part" and type into "Below zero, at most".
  3. Press "Set this limit". The message "<Part> now stops at <n> below zero." appears and the list reloads.
- **You know it worked when:** the part appears in "Tighter limits already set" with the new figure.
- **Variations and refusals:**
  - Empty list: "No division, project or app is held to less than the organisation."
  - Too deep: "No deeper than the organisation's <n>." Server: "An overdraft here may be tighter than the <n> credits inherited, never deeper."
  - Failure: "<Part>'s limit was not set: <reason>".
  - No overdraft at all: "Every part stops at zero while the organisation has no overdraft, so there is nothing tighter to set."
  - Builders and Viewers do not see these controls.
  - Each row has **"Remove"**: the row goes at once and "<Part> is no longer held to less; the organisation's <n> below zero applies." (or a tighter part above it: "…<Above>'s <n> below zero applies."). Refused: "<Part>'s limit was not removed: <reason> It still stops at its own limit." and the row returns.
- **Where:** `CreditsActions.tsx` (NarrowerLimits, NarrowerLimit). `PUT /api/credits/overdraft`.
- **Reachable from:** UI. Also MCP `cascade_set` with key `overdraft_limit` below organisation level.
- **Covered by tests:** `CreditsActions.test.tsx` ("sets a narrower limit…", "lists each division…", "is not shown to a Builder"); `CapControl.test.tsx` ("removes a part's tighter limit…"). `FinalDefectsTests.The_credits_view_lists_every_narrower_overdraft_limit_on_and_beneath_the_scope`.

### CRED-07 Ask FrostAura for a top-up
- **Who:** Owner asks. Admin and Owner read the requests.
- **Level:** Core
- **Learn first:** CRED-01.
- **What you learn:** there is no card on file. Credits are added by FrostAura by hand when you ask.
- **Starts at:** the `/credits` aside "Asking for more" ("There is no card on file: FrostAura adds credits by hand when you ask.").
- **Needs:** Owner. Fewer than 5 open requests.
- **Steps:**
  1. Press "Ask for a top-up". A card opens under it with the same heading, "Ask for a top-up". Fill in "How many credits" and optionally "A note for FrostAura" (up to 500 characters).
  2. Press "Ask for it". The request appears at once as "Waiting for FrostAura", with the message "Asked FrostAura for <n> credits. You are told here when it is added."
  3. When answered (OP-06) it shows "Added", or "Declined" with "FrostAura: <note>", plus "Asked <date>, answered <date>".
- **You know it worked when:** the request is listed with the badge "Waiting for FrostAura".
- **Variations and refusals:**
  - "Type a number of credits." With 5 open: the button is disabled and "Five requests are already waiting; FrostAura answers those first." (server 409).
  - Zero, negative or over 10,000,000: 400 "Ask for a positive number of credits."
  - Failure: "The request was not sent: …".
  - Empty: "No top-up asked for yet." Failed read: "Your top-up requests could not be loaded".
  - Admins see the list but no ask button. Builders and Viewers see neither.
- **Where:** `CreditsActions.tsx` (TopUpRequests). `POST` and `GET /api/credits/top-up-requests`.
- **Reachable from:** UI. No MCP tool.
- **Covered by tests:** `CreditsActions.test.tsx` ("lists requests…", "records a failed read…"). `breadth.spec.ts`. `BreadthTests.An_owner_asks_for_a_top_up_operators_see_it_and_answer_it_and_god_mode_lists_every_organisation`.

### CRED-08 What happens at zero, at halfway and at the limit, and what a top-up restores
- **Who:** the system. Owners and Admins are told.
- **Level:** Foundation
- **Learn first:** CRED-01.
- **What you learn:** nothing stops at zero, you are warned twice, at the limit work stops and apps pause with nothing deleted, and a top-up brings everything back at once.
- **Starts at:** the `/credits` aside "At the limit" ("Employees stop working." · "Apps pause behind a holding page." · "All data, code and memory are kept." · "A top-up brings everything back at once." · "You are warned at zero and again halfway to the limit."), and the notifications.
- **Needs:** nothing.
- **Steps:**
  1. At or below 0 (after any top-up), the notification "Credits have run out" says: "The balance is <n> credits. Work goes on into the overdraft of up to <n> credits; ask FrostAura for a top-up."
  2. At half the limit: "Halfway to the overdraft limit".
  3. At the limit: "The overdraft limit is reached: work has stopped and apps are paused".
     - New model calls are refused (402 overdraft_limit). The run is not marked failed, so it can carry on after a top-up.
     - Apps show "This app is paused" / "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up."
     - Operators see the standing "At its limit".
  4. A top-up (OP-05) settles the debt, recalculates routing and un-pauses apps at once. The warnings start again from the next episode.
  5. The Owner's Credits screen reads "Credits left" again (or a smaller "Below zero"), and the apps open again.
- **You know it worked when:** after a top-up, the app opens again and the banner returns to "Credits left" or a smaller "Below zero".
- **Variations and refusals:**
  - "Employees stop working" means their model calls are refused. Their status does not change.
  - An app pauses only once the balance is strictly past the limit, while new work is already refused at exactly the limit.
  - Overdraft never carries interest or fees, as the screens state.
- **Where:** `CreditLedger.Refuse`, `TreeService` (routing table pause), `NotificationService`, `Edge/Pages/UnavailablePage.cs`.
- **Reachable from:** system. The effects are visible in the UI and the notifications.
- **Covered by tests:** `ControlPlaneDebtsTests.At_the_overdraft_limit_work_stops_and_apps_pause_a_top_up_restores_them_and_nothing_accrues`. `tests-stack/acceptance.spec.ts` ("13. at the overdraft limit the app is paused; an operator's top-up brings it back").

### CRED-09 How AI work and hosting become spending
- **Who:** the system. Everyone sees the result.
- **Level:** Core
- **Learn first:** CRED-01.
- **What you learn:** credits are held before each AI call and settled at its real cost, while hosting is counted from usage after the fact.
- **Starts at:** any agent or app model call, and the usage samples posted by Dock and Edge (`/internal/usage/hosting`).
- **Needs:** nothing.
- **Steps:**
  1. Each AI call reserves its worst case against every cap and the balance, then settles at the reply's cost converted by the current prices.
  2. Repairs are recorded as not billed.
  3. Hosting samples become hosting entries at the hosting rates and are never refused.
  4. Both appear in "On AI work" / "On hosting", the budget bars, the employee's "Cost so far", the app's "Cost this month" tile ("Own cap: <n>", "Cap above: <n>" or "No cap set") and the operator's balances.
  5. An app's own model calls also stop at its monthly AI allowance (default from prices, OP-09).
- **You know it worked when:** the figures rise after work runs.
- **Variations and refusals:** the same sample is charged once. Over the app's allowance, the refusal says "The app's own model calls have <n> credits left of their <n> this month…"
- **Where:** `CreditLedger` (AdmitAsync, SettleAsync, HostingEntry), `FactoryEndpoints` `/internal/credits*`.
- **Reachable from:** system.
- **Covered by tests:** `ModelGatewayTests`, `UsageLedgerTests`, `ControlPlaneDebtsTests` (hosting), `tests-stack/acceptance.spec.ts` ("11. hosting usage appears as credit entries").

## The operator and God mode (OP)

### OP-01 Know you are in God mode, and what a non-operator sees
- **Who:** operator. Any other signed-in person.
- **Level:** Operator
- **Learn first:** sign-in.
- **What you learn:** God mode is always visibly marked, and closed to everyone not on FrostAura's explicit operator list.
- **Starts at:** any screen.
- **Needs:** for an operator, an email listed in `ENDGAME_OPERATORS` / `Operators:Emails`.
- **Steps:**
  1. Operators see one slim bar on every screen: "GOD MODE", "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it." on one line, the link "Every organisation" to `/operator`, and a chevron, "What God mode means", that opens the full sentence.
  2. On every screen inside an entered organisation the sentence reads "You are inside <Name> as a FrostAura operator, acting as an Admin. Your entry and everything you change here are logged where its Owner can read them.", with "Leave <Name>" (SHL-05).
  3. A non-operator opening `/operator` sees the heading "God mode" and "God mode is for FrostAura operators" / "Your account is not one of FrostAura's operators, so these screens are closed to you."
- **You know it worked when:** the band is shown, or the refusal is shown.
- **Variations and refusals:** every `/api/operator/*` call returns 403 "Only FrostAura operators may do this." to non-operators and to any access token, because God mode is never available by token or MCP.
- **Where:** `shell/GodModeBand.tsx`, `lib/useActiveOrganisation.ts`, `operator/OperatorView.tsx`, `AccessService.IsOperatorEmail`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("is closed to anyone who is not an operator…", "is marked as God mode on every screen"). `GodModeBand.test.tsx`. `breadth.spec.ts`. `ControlPlaneDebtsTests.Operators_come_from_the_explicit_list_only_and_every_entry_is_logged_for_the_owner`.

### OP-02 See every organisation
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-01.
- **What you learn:** each organisation's balance, standing and overdraft at a glance.
- **Starts at:** `/operator`, section "Every organisation" (refreshes every 30 seconds).
- **Needs:** operator.
- **Steps:**
  1. Under the section's line "Entering one is logged where its Owner can read it.", one card per organisation, one under another, every card on the same grid: the name with a badge "In credit", "Below zero" or "At its limit", and "<slug> · since <date>" (plus the status when not active).
  2. Beside it, in the same four places on every card, "Balance" (red below zero), "Overdraft allowed" ("<n> below zero", with "Their own: <n>; yours: <n>" or "Set by you: <n>"), "Apps" and "Last active" ("Never"). The actions ("Enter <Org>", "Top up", "Deepest overdraft") run along the card's foot, and a form they open spans the card.
  3. Waiting requests show "One top-up request is waiting." or "<n> top-up requests are waiting." under the name.
- **You know it worked when:** a card is listed for each organisation.
- **Variations and refusals:** empty "No organisations yet" with "Provision the first one for an invited Owner." Failed: "The organisations could not be loaded". Technical mode adds the id.
- **Where:** `OperatorView.tsx` (Organisations, OrganisationCard). `GET /api/operator/organisations`. `OperatorOverview.cs`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("shows loading, failed and every organisation…"). `breadth.spec.ts`. `BreadthTests`.

### OP-03 Set up an organisation for an invited Owner
- **Who:** operator. Also the first person on a fresh install, through Start (another reader's area).
- **Level:** Operator
- **Learn first:** OP-01.
- **What you learn:** organisations are provisioned by FrostAura, not signed up for; each is screened against the red lines first; and the Owner's one-time code is shown once.
- **Starts at:** the `/operator` aside "Set up an organisation" ("For a person FrostAura has invited. They become its Owner; there is no self-serve sign-up.").
- **Needs:** operator.
- **Steps:**
  1. Fill in "Its name" (up to 80 characters). "Its address name" fills itself from the name and can be edited, with the hint "Its apps live at /<slug>/… and <slug>.<domain>."
  2. Fill in "The Owner's e-mail" and, optionally, "The Owner's name".
  3. Fill in "What it does" (required, at least 10 characters; hint "A sentence or two on what the organisation does or will build. FrostAura does not set up anything that crosses a red line.").
  4. The form notes "What it does is screened against FrostAura’s red lines before it is set up, its name is checked against FrostAura’s own addresses, and every idea it has is screened again."
  5. Press "Set it up" ("Setting it up…"). The control plane puts the name and what it does to a model through the model gateway, against the four red lines (tobacco, exploitative gambling or predatory finance; weapons used against civilians; animal harm and industrial cruelty; surveillance and authoritarian tooling — prediction markets and regulated forecasting markets are not gambling). The call is recorded as a platform cost, charged to no organisation. An answer the model gives in a shape that cannot be read is asked for once more (a second platform cost).
  6. A new Owner gets a one-time panel "The Owner's invitation code", with "<Name> is set up for <email>. The code was e-mailed to them too." or "E-mail is not set up here, so give them this code yourself." and "They use it to make their passkey before <date>." plus any name-check note, and "It was screened against the red lines and crosses none: <reason>" (or "You screened it against the red lines yourself: <reason>").
  7. An Owner who already has an account gets "<Name> is set up. <email> already has a passkey, so they can sign in as its Owner now." with the same screening sentence.
  8. The answer carries `balance` 0 and `creditsNote` "<Name> has no credits until you top it up: its first piece of work waits for budget until then." Endgame invents no starter credits; top it up (OP-05). Until then its credits and its chart say `neverToppedUp`.
  9. The organisation appears in the list with its standing security reviewer. Its operator log gets "Screened against the red lines: it crosses none (by a model)" — or "(by hand: <reason>)" — with who screened it, how and when, and "Set up the organisation".
- **You know it worked when:** the code panel or the success line appears, and a new card is listed.
- **Variations and refusals:**
  - Local checks: "2 to 40 lowercase letters, digits and hyphens." · "That does not look like an e-mail address." (the button is disabled).
  - Server:
    - 409 "That name is reserved" ("'<slug>' cannot name an organisation: it is one of Endgame's own names" / "FrostAura already uses it as a subdomain").
    - 503 "New organisation names are paused".
    - 409 "An organisation is already called '<slug>'."
    - A non-operator after first run gets 403 "Organisations are provisioned by FrostAura; there is no self-serve sign-up."
  - Failure: "<Name> was not set up: <reason>".
  - A breach: 422 "FrostAura does not set this organisation up" — "What it does crosses a red line — <line>: <why>". Nothing is created.
  - No model can be reached (or its answer cannot be read): 503 "The organisation could not be screened" — "… Try again shortly, or record your own screening decision with a written reason." The form then opens "Screen it yourself": "Your decision" ("It crosses no red line" / "It crosses a red line: do not set it up") and "Why" (at least 10 characters). A model that answers always outranks a manual decision; a manual "breach" is refused like the model's.
  - API: `description` missing or under 10 characters is 400 "Say what the organisation does, in 10 to 1000 characters: it is screened against FrostAura's red lines before it is set up."
  - The first organisation of a fresh install (ORG-02) is not screened here.
- **Where:** `OperatorView.tsx` (ProvisionAside), `store/sensitive.ts` (provisionOrganisation). `POST /api/organisations { name, slug, ownerEmail, ownerDisplayName?, description, screening? }`. `Platform/OrganisationScreening.cs`, `Application/Gateway/PlatformModelCalls.cs` (`platform_costs`), `ReservedNames.cs`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("provisions an organisation…shows their code once", "asks for the operator's own screening…; a breach is refused"). `breadth.spec.ts` ("…a reserved name is refused"). `BreadthTests.Organisation_names_that_frostaura_uses_are_refused_and_an_incomplete_zone_pauses_new_names`. `WalkTwoServerTests.A_new_organisation_says_it_has_no_credits_until_it_is_topped_up`. `ScreensAndRolesTests` (`Provisioning_screens_what_the_organisation_does_as_a_platform_cost_and_logs_how`, `A_breach_is_refused_naming_the_line_and_why_and_nothing_is_set_up`, `With_no_model_provisioning_is_refused_unless_the_operator_records_a_decision_with_a_reason`).

### OP-04 Enter an organisation in God mode, and act there as Admin
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-02.
- **What you learn:** an operator enters as an Admin, never the Owner, and every visit is written where the Owner reads it.
- **Starts at:** an organisation card. Press "Enter <Name>".
- **Needs:** operator.
- **Steps:**
  1. Press "Enter <Name>" ("Entering…"). The card shows "You entered <Name> as an Admin, <time ago>." and "Logged: This entry is in the organisation's operator log, which its Owner reads."
  2. Press "Open its org chart". `/?organisation=<slug>` shows that organisation's tree, with the in-organisation band naming it.
  3. From then on every screen works on that organisation — Credits, Hiring, People, Secrets, Autonomy, Notifications, the header's balance and bell — until the operator presses "Leave <Name>" or "Every organisation". The organisation is remembered for the tab, so a link without `?organisation=` keeps working.
  4. Any call the operator makes inside that organisation is treated as Admin. Reads continue the visit. Coming back more than 10 minutes later logs a new entry.
  5. As Admin the operator can do anything an Admin can: decide hires, change employees, set caps and tighter limits, manage people and secrets. Every change is one entry in the organisation's operator log, titled plainly ("As an Admin: Added a division"); a refused change is not, and neither is asking what something would cost (an estimate is a read).
  6. The operator cannot set the own limit, read the operator log, grant Admin, ask for a top-up, or act as Owner.
- **You know it worked when:** the "You entered … as an Admin" status and the entered organisation's org chart appear.
- **Variations and refusals:**
  - "You did not enter <Name>: <reason>". A path that is not an organisation: 400 "Name an organisation by its slug."
  - Screens read the entered organisation through one hook, `useActiveOrganisation` (and `useActiveTree`): Home, the header, Credits, Hiring, a hire, an employee, People, Secrets, Autonomy, Notifications, Manage, an app, Start, AI assistants and the operator log all use it. "Ideas from your portfolio" does not yet.
- **Where:** `OperatorView.tsx`, `features/home/HomeView.tsx`, `shell/GodModeBand.tsx`, `lib/useActiveOrganisation.ts`. `POST /api/operator/organisations/{slug}/enter`, `GET /api/tree?organisation=`. `AccessService.OperatorEntryAsync`, `RecordEntryAsync`, `LogVisitAsync` and `LogActionAsync`; `Endpoints/OperatorActionLog.cs`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("enters an organisation, saying plainly where the entry is logged"). `GodModeBand.test.tsx`. `breadth.spec.ts` ("…enters one and says it is logged", which follows it to the notifications and leaves). `FinalDefectsTests.Entering_an_organisation_and_then_reading_it_is_one_logged_entry`. `ScreensAndRolesTests.Every_change_an_operator_makes_inside_an_entered_organisation_is_one_entry_in_its_log`.

### OP-05 Top up an organisation
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-02, CRED-08.
- **What you learn:** a top-up settles any debt first and restores everything paused, and the Owner can see that you did it.
- **Starts at:** an organisation card. Press "Top up".
- **Needs:** operator.
- **Steps:**
  1. A card opens on the organisation's card, headed "Top up <Name>". Fill in "Credits to add" and "Note" ("Shown to the Owner beside the top-up.", up to 300 characters). The form notes "A top-up settles any debt first and restarts everything paused at once."
  2. Press "Add the credits" ("Adding…"). The message "Added <n> credits to <Name>. Its Owner can read that you did." appears, and the button becomes "Done".
  3. The balance, standing and "Top-ups made" update. The Owner's Credits screen lists the top-up, and the operator log shows "Added <n> credits".
- **You know it worked when:** the green "Added …" message appears and the balance rises.
- **Variations and refusals:**
  - The note is required on screen (the button is disabled), though the API allows none.
  - "Type a number of credits." Server: 400 "A top-up is a positive number of credits, to at most six decimal places."
  - Failure: "Nothing was added: <reason>".
  - A key fixed for each form means pressing twice adds once.
  - A non-operator gets 403 "Credits are topped up by FrostAura (manual top-ups; there is no payment gateway)."
- **Where:** `OperatorView.tsx` (TopUpForm). `POST /api/credits/top-ups`. `CreditLedger.TopUpAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx`. `breadth.spec.ts`. `acceptance.spec.ts` (13). `ControlPlaneDebtsTests`.

### OP-06 Answer a top-up request
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-05, CRED-07.
- **What you learn:** a request is answered by a top-up that names it, or by a decline with a reason the Owner reads.
- **Starts at:** `/operator`, section "Top-up requests" (refreshes every 30 seconds).
- **Needs:** operator. An open request.
- **Steps:**
  1. A row reads "<Org> asks for <n> credits", with the time, the note and "From <email>".
  2. To fulfil: press "Add the credits". A top-up form opens filled with the amount and the note "Answering the request of <date>". Press "Add it and close the request". The message "Added <n> credits to <Org> and closed the request. Its Owner can read that you did." shows above the list, and the request moves to "Answered (<n>)" as "Added".
  3. To decline: press "Decline". A card opens under it, "Decline the request?"; fill in "Why (the Owner reads this)" and press "Decline it" (or "Not now"). The request moves to "Answered (<n>)" as "Declined".
  4. The Owner reads the answer on their Credits screen (CRED-07): "Added", or "Declined" with "FrostAura: <why>".
- **You know it worked when:** the request leaves "Waiting" and appears under "Answered" with the right badge.
- **Variations and refusals:**
  - Empty: "No request is waiting" with "When an Owner asks for credits, it appears here to answer."
  - Decline failure: "The request is still open: <reason>". Already closed: 409 "This request is already <status>."
  - A decline is logged as "Declined a top-up request for <n> credits: <why>". A fulfilment through a top-up closes the request with the top-up's note and is logged as "Answered a top-up request with <n> credits", beside "Added <n> credits".
  - Operators are also told of a new request in their notification feed: "<Org> asks for <n> credits", labelled "Top-up request", leading here (NOTE).
- **Where:** `OperatorView.tsx` (Requests, RequestRow). `GET /api/operator/top-up-requests`, `POST /api/operator/top-up-requests/{id}/close`, `POST /api/credits/top-ups { requestId }`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("fulfils a top-up request…", "declines a request…"). `breadth.spec.ts`. `BreadthTests`. `ScreensAndRolesTests.An_owners_top_up_request_reaches_the_operators_and_its_answer_is_on_the_record`.

### OP-07 Set an organisation's deepest overdraft
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-02, CRED-05.
- **What you learn:** FrostAura sets the outer limit, and everything inside the organisation can only be tighter.
- **Starts at:** an organisation card. Press "Deepest overdraft".
- **Needs:** operator.
- **Steps:**
  1. A card opens headed "Deepest overdraft for <Name>". Fill in "The most it may go below zero", with the hint "No interest and no fees, ever. At the limit its employees stop and its apps pause; nothing is deleted."
  2. Press "Save" ("Not now" beside it). The card updates at once; once saved the form closes and the card reads "<Name> may now go <n> below zero at most. Its own limit can only be tighter." until the next action on it.
  3. Routing is recalculated, and the Owner's log gets "Changed the deepest overdraft to <n> credits below zero".
- **You know it worked when:** "Overdraft allowed" on the card shows the new figure.
- **Variations and refusals:**
  - "Type a number of credits." Failure: "The overdraft was not changed: <reason> It is back to <n>."
  - A member trying this through the cascade gets 403 "An organisation's deepest overdraft is set by a FrostAura operator…"
  - Lowering it below the organisation's own limit is allowed. The tighter value then applies.
- **Where:** `OperatorView.tsx` (OverdraftForm). `PUT /api/operator/organisations/{slug}/overdraft`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("sets an organisation's deepest overdraft at once and rolls it back…"). `CascadeCreditsAndAppsTests.Only_a_frostaura_operator_sets_the_organisations_overdraft_and_lower_levels_may_only_tighten_it`.

### OP-08 Read every top-up made
- **Who:** operator.
- **Level:** Operator
- **Learn first:** OP-05.
- **What you learn:** every top-up is on the record: who, how much and why.
- **Starts at:** `/operator`, section "Top-ups made".
- **Needs:** operator.
- **Steps:** rows show the organisation's name (plus the slug in technical mode), the note, "<date> · by <email>" and the amount signed, "+3,000". Up to 500 rows.
- **You know it worked when:** the list is shown.
- **Variations and refusals:** "No top-ups yet". "The top-ups could not be loaded". Filtering by organisation (`?organisation=`) exists in the API but not on screen.
- **Where:** `OperatorView.tsx` (TopUps). `GET /api/operator/top-ups`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("names each top-up's organisation by its display name…"). `FinalDefectsTests.Operator_top_ups_name_the_organisation_by_its_display_name_and_keep_its_address_name`.

### OP-09 Change the prices, and read the change history
- **Who:** operator.
- **Level:** Operator
- **Learn first:** CRED-09.
- **What you learn:** credits are priced at cost times one margin. A change applies to new work everywhere and is recorded with your name.
- **Starts at:** `/operator`, section "The prices" ("Credits are priced at what the work costs plus one margin, so every bill can be explained line by line. A change applies everywhere within a minute and is kept in the history below.").
- **Needs:** operator.
- **Steps:**
  1. The form shows "Last changed <date>." or "These are the defaults; they have never been changed."
  2. Edit any of: "Credits per US dollar", "Margin", "Dollars per awake hour", "Dollars per gigabyte-hour of memory", "Dollars per gigabyte-month stored", "Dollars per million requests", "Each app's AI allowance, credits a month".
  3. Press "Save the prices" (enabled only when something changed). The confirmation asks "Change the prices for every organisation?" and says "Work already estimated keeps its estimate; new work is priced with these figures. The change is recorded with your name."
  4. Press "Change the prices". The message reads "The new prices hold from now on, for every organisation." "Keep them as they are" cancels.
  5. "Changes" lists "<date> · <email>" with each figure "<label>: <before> → <after>".
  6. Every organisation's operator log gets "Changed the prices for every organisation".
- **You know it worked when:** the success message appears and a new entry heads "Changes".
- **Variations and refusals:**
  - Local checks: "At least 1.0: a margin below one would sell at a loss." · "A number, zero or more."
  - Server: hosting rates or the allowance negative is 400. The credits-per-dollar check comes from the credit settings: 0 may be allowed on screen and then refused by the server (not verified).
  - Failure: "The prices were not changed: <reason>" rolls back.
  - History is empty: "Never changed: the defaults hold." History is capped at 50.
  - New work is priced with the new figures: an app's page quotes the new hosting rates ("Today's prices: …") and its monthly running cost moves with them.
- **Where:** `OperatorView.tsx` (PricingPanel, PricingForm), `operatorModel.ts`. `GET` and `PUT /api/operator/pricing`. `PricingService.cs`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorView.test.tsx` ("refuses a margin below one and asks before changing the prices", "reads a price change figure by figure"). `breadth.spec.ts`. `BreadthTests.Prices_change_at_runtime_for_the_next_charge_audited_and_never_below_cost`.

### OP-10 The Owner reads the operator log
- **Who:** Owner.
- **Level:** Core
- **Learn first:** OP-04 (concept only).
- **What you learn:** operator access is never silent. Every entry and action is listed, newest first.
- **Starts at:** org chart, Manage link "Operator access" (Owner only). Opens `/operator-access`.
- **Needs:** Owner.
- **Steps:**
  1. The heading reads "Operator access", with "Every time someone from FrostAura entered <Org> or acted on it, newest first. It is never silent, and only the Owner can read it."
  2. One table, newest first, with the columns "When", "What was done" and "By" (a list of cards where its column is narrow). Entries read, for example, "Entered the organisation", "Screened against the red lines: it crosses none (by a model)", "Set up the organisation", "Added <n> credits", "Changed the deepest overdraft to <n> credits below zero", "Answered a top-up request with <n> credits", "Declined a top-up request for <n> credits: <why>", "Changed the prices for every organisation" and "As an Admin: <what they changed>" (a change the control plane titles only with its endpoint's description reads "Changed something as an Admin", never that description; asking what a message would cost reads "As an Admin: Asked what a message in the conversation would cost"), each with "<operator name> · <email>". Technical mode adds the raw action and its detail.
  3. Beside it, "What is written here": every entry into the organisation, every change made in it as an Admin, top-ups, the deepest overdraft and the prices, and how it was screened against the red lines when it was set up — "Only the Owner can read it."
- **You know it worked when:** the log, or its empty state, is shown.
- **Variations and refusals:**
  - Empty: "No one from FrostAura has entered <Org>" with "If anyone does, it is written here first."
  - Non-Owner: "Only the Owner can read the operator log".
  - No organisation: "There is no log until your organisation is named".
  - An Owner of several organisations reads the log of the one they are working in (ID-02).
- **Where:** `features/audit/OperatorAccessView.tsx`. `GET /api/audit/operator-access?organisation=`.
- **Reachable from:** UI.
- **Covered by tests:** `OperatorAccessView.test.tsx`. `ControlPlaneDebtsTests.Operators_come_from_the_explicit_list_only_and_every_entry_is_logged_for_the_owner`.

### OP-11 Suspend or reinstate an organisation
- **Who:** operator.
- **Level:** Operator / Developer
- **Learn first:** OP-02.
- **What you learn:** only FrostAura changes an organisation's status; God mode is enough, and the change is written to the operator log its Owner reads.
- **Starts at:** `PATCH /api/organisations/{id} { status }`.
- **Needs:** a FrostAura operator. Entering the organisation in God mode makes the operator an Admin there, which is the role the status change asks for; the request itself counts as entering it, and is logged.
- **Steps:**
  1. An operator in God mode sends `{ "status": "suspended" }`: 200 with the organisation (`id`, `level`, `slug`, `name`, `path`, `status`, `createdAt`). A suspended organisation's apps leave the routing table (it routes only active organisations).
  2. Its operator log gains "Renamed, suspended or reinstated the organisation", under the operator's name.
  3. The operator sends `{ "status": "active" }` to reinstate it: 200, and its apps are routed again.
- **You know it worked when:** the operator card shows " · suspended", and loses it once reinstated.
- **Variations and refusals:**
  - The organisation's own Owner or an Admin, who are not operators: 403 "An organisation is suspended or reinstated by FrostAura."
  - Someone with no role there who is not an operator: 404, as for any scope they cannot see.
  - A status an organisation cannot have: 400 "'archived' is not a status an organisation can have: use active, suspended."
  - Renaming in the same request still needs the Owner: an operator who is not its Owner gets 403 "This needs the owner role at '<slug>'; you are an admin there (set at <slug>)."
- **Where:** `TreeEndpoints.MapNodeChanges` (an organisation's status: Admin, then operators only), `AccessService.OperatorEntryAsync` (an operator is an Admin), `OperatorActionLog` (the log entry).
- **Reachable from:** API only. **No screen.**
- **Covered by tests:** `SweepXTests.An_operator_in_god_mode_suspends_and_reinstates_an_organisation_and_an_admin_cannot`; `src/demo/server/sweepx.test.ts` ("lets an operator suspend and reinstate an organisation").

---

## Gaps and oddities found
1. ~~No screen sets, changes or removes a monthly cap at any level~~ — fixed: CRED-03 on `/credits` and APP-11 on the app page.
2. **Fixed:** the band names the entered organisation on every screen, and every screen works on it (OP-04).
3. **Fixed:** provisioning screens what the organisation does against the red lines, as a platform cost, and logs how (OP-03).
4. **Fixed:** every change an operator makes inside an organisation as Admin is one titled entry in its log, and every operator action has a plain title (OP-04, OP-10).
5. **Fixed:** pausing an employee pauses their work and keeps new work waiting; resuming releases it (EMP-04).
6. ~~Reassigning from the screen silently clears the manager~~ — fixed (EMP-02).
7. ~~On the proposal edit form, emptying the budget does not remove it, and emptying "Why this hire" keeps the old reason~~ — fixed: the budget is cleared; an empty reason is refused on screen, because a proposal always says why (HIRE-05).
8. ~~An employee's job cannot be changed on screen; rehiring into a new place is API only~~ — fixed (EMP-10, EMP-09).
9. ~~There is no screen to raise an owner hire~~ — fixed (HIRE-09).
10. ~~"Propose as a permanent hire" shows for Viewers and Builders, and its need key differs from the system's~~ — fixed (HIRE-07).
11. ~~The memory change log is never listed on a screen~~ — fixed (MEM-01). ~~Memory has no MCP tools~~ — fixed: `memory_read`, `memory_add`, `memory_correct`, `memory_forget` (MEM-01 to MEM-04).
12. **Fixed:** corrections and removals of a released employee's archived memory are refused (409), as UC-113 A1 says (MEM-03, MEM-04).
13. ~~There is no screen to remove the organisation's own overdraft limit or a tighter limit~~ — fixed (CRED-05, CRED-06).
14. ~~The zero-balance line contradicts the overdraft~~ — fixed (CRED-01). "No overdraft is set…" and "No spending or caps anywhere…" still look unreachable.
15. ~~An employee's budget row counts only its own spend~~ — fixed: it counts its contractors, as its cap does (CRED-02).
16. ~~Released employees are not listed; contractor rows are not links~~ — fixed (EMP-09, EMP-07). ~~A person cannot stop or cap a contractor~~ — fixed (EMP-11).
17. **`GET /api/employees/{id}/track-record` and `GET /api/operator/top-ups?organisation=` are not called by any screen.**
18. **Fixed:** the operator log and the Credits page use the organisation being shown (in God mode, the one entered). ~~A member whose only role is at a division cannot load Credits~~ — fixed: the page asks at their own level (CRED-01).
19. **Fixed:** a fulfilled top-up request is closed with the top-up's note and logged as `topup_request.fulfilled` (OP-06).
20. ~~No operator can suspend or reinstate an organisation they do not also own~~ — fixed: God mode's Admin is enough for an operator, and no one else may (OP-11).
21. **Docs versus code:**
    - UC-103 says caps are set by an Admin, but with no screen.
    - UC-111 and UC-112 match the API.
    - CLAUDE.md rule 4 is met at an operator's provisioning; the first organisation of a fresh install is not screened.
