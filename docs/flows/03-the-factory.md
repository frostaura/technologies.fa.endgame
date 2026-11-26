# The factory — every flow

From an idea to a running app: ideas, research and the verdict, runs, plan, build, check, review, publish, autonomy and rule sets, changing an app.

Read from the code on 2026-11-25, one reader per area; nothing here was taken from the other docs. The fields and how to read them are in [README.md](README.md). A flow marked *API only* or *MCP only* has no screen.

**Shared terms.**
- **Scope:** a path in the tree, e.g. `acme` or `acme/products`.
- **Normal mode** (the default) and **technical mode** come from the console's mode switch.
- **Roles:** Viewer < Builder < Admin < Owner. An operator is FrostAura God mode.
- **On-screen labels** are quoted exactly. In the run log, a plain-language message shows as `<speaker> · <title>`. Speakers: researcher → "Research", runner → "Endgame", builder → "The builder", security-reviewer → "Security review", owner → "You".

## Starting an idea and ideas from the portfolio (IDEA)

### IDEA-01 Name your organisation and describe your first idea
- **Who:** an invited person with no organisation yet (becomes its Owner).
- **Starts at:** the home page `/`. The first-run panel "Name your organisation, then describe your first idea." has a button **"Start"** that opens `/start`.
- **Needs:** signed in; no organisation yet.
- **Level:** Foundation. **Learn first:** signing in (another reader's area).
- **What you learn:** everything you make lives under one organisation, and research comes before anything is built.
- **Steps:**
  1. The page heading reads "What do you want to build?", with the line "Describe it the way you would to a friend. Endgame researches it first, tells you plainly whether it is worth building, then builds and runs it."
  2. Type a name into **"Your organisation"**. The hint underneath reads "Everything you make lives under this name. Its apps appear at {host}/{slug}." (it shows `your-name` until you type).
  3. Type the idea into **"The idea"**. Optionally tap any of the one-tap constraints under **"Anything it must respect? Optional"**: "Members sign in", "Works on a phone", "Sends email", "Uses AI inside the app", "Receives data from a device". Each one toggles on and off. You can also type into **"Anything else, in your own words"**.
  4. Once the idea is at least 12 characters, the **"Research comes first"** panel asks for an estimate after a 0.5-second pause. It shows a loading bar, then "Estimated {credits}" and the line "You are charged for research only now. If the verdict is to build, it is built on its own, inside the budget, with its own estimate first. If the estimate turns out wrong, you see by how much." followed by the basis (a new organisation is in auto-mode until someone sets checkpoints).
  5. Press **"Research this idea"**. While it works the button reads "Starting research…". The organisation is created first (`POST /api/organisations`), then the idea (`POST /api/ideas`).
  6. You are taken to the research run at `/runs/{id}` (RUN-01).
- **You know it worked when:** the run page opens with the title "Research: {first line of the idea}" and the badge "Waiting to start" or "Working". The breadcrumb now names your organisation.
- **Variations and refusals:**
  - A name that slugifies to fewer than 2 letters or digits shows "Use at least two letters or digits." and the button stays disabled.
  - The button stays disabled until an estimate has been shown. A failed estimate shows "The estimate could not be worked out: {reason} Research cannot start until it is shown." (for example `503 estimate_unavailable`).
  - If the request fails: "Research did not start: {reason} Nothing was charged."
  - If the organisation was created but the idea failed, the organisation stays. On the retry the name field is gone, because the session now has an organisation.
  - The idea may be 1 to 20,000 characters, constraints the same; otherwise 400.
  - A reserved FrostAura name is refused (TreeEndpoints, another reader).
  - A new organisation starts with no credits, so beside the estimate the page says "A new organisation starts with no credits, and this needs about {credits}. Research starts, then waits for a top-up before it spends anything."
  - The side panel shows **"What happens next"**: Research → Verdict → A home for it → Hiring → Build, check, review → Running, privately.
- **Where:** `features/start/StartView.tsx`. `POST /api/ideas/estimate`, `POST /api/organisations`, `POST /api/ideas` (WorkEndpoints), `IdeaService.CreateAsync`.
- **Reachable from:** UI (also API/MCP, see IDEA-06).
- **Covered by tests:** `StartView.test.tsx` ("names the organisation on first run…"); `tests-e2e/console.spec.ts` ("first run: name the organisation, see the estimate, research…"); `IdeasAndConversationsTests.The_estimate_is_free_and_works_before_an_organisation_exists`.

### IDEA-02 Describe a new idea in an existing organisation
- **Who:** Builder or above at the organisation or at the division it goes to.
- **Starts at:** the home hero's **"New idea"** button, or the empty organisation's **"Describe your first idea"**. Both open `/start`.
- **Needs:** an organisation.
- **Level:** Foundation. **Learn first:** IDEA-01.
- **What you learn:** every idea is researched first, for the place you choose, and its estimate is shown before anything is charged.
- **Steps:**
  1. The breadcrumb shows "{Org} › New idea".
  2. **"Where it goes"** offers "The whole of {Org}" and each active division where you may start work. The hint reads "Endgame suggests a division for it once it is researched." or, for a division, "It is researched for {Division}, and built there if it is built."
  3. Type the idea, pick constraints, and wait for "Estimated {credits}". The estimate is asked for that place, so the figure shown is the figure the run records.
  4. "What happens next" says what will actually happen at that place: in auto-mode "Build, change, or do not build. A build or change verdict goes ahead on its own; a do-not-build waits for you, and you can overrule it." and "The people this needs are hired as they are needed, inside the budget; one that does not fit waits for you."; in checkpoints mode "Nothing is built until you decide; you can overrule it.", plus "It waits for your word once its estimate is known." or "The plan waits for you to agree it first." for each checkpoint that is on. The line under the estimate reads "You are charged for research only now. If the verdict is to build, it is built on its own, inside the budget, with its own estimate first." in auto-mode, and "You are charged for research only. Nothing is built until you have seen the verdict and decided." in checkpoints mode.
  5. Press **"Research this idea"** and the run page opens.
- **You know it worked when:** the run page "Research: …" opens; built, the project appears in the division chosen.
- **Variations and refusals:**
  - Someone below Builder everywhere sees "Only a Builder or above starts an idea" and "You are a {Role} in {Org}, and no division gives you more. An Admin or the Owner can make you a Builder; until then, you can follow everything that is being built." instead of the form.
  - The divisions cannot be read: "The divisions could not be loaded, so for now it can only go to the whole organisation."
  - What happens next cannot be read: "What happens next could not be worked out" with **"Try again"**.
  - "Research did not start: … Nothing was charged." on a refusal.
  - Less to spend here than the estimate (the organisation's balance and overdraft room, less what is held for work in flight, under the tightest cap on the way up): beside the estimate, "You have {room} to spend here, and this needs about {credits}. It starts, then waits for a top-up before it spends anything." with **"See credits"**. The button still works; the run waits for budget (RUN-09).
- **Where:** `StartView.tsx`, `startModel.ts` (`roomFor`, `shortfall`); `POST /api/ideas/estimate {scope}`, `POST /api/ideas {scope}`, `GET /api/autonomy?scope=`, `GET /api/credits?scope=`.
- **Reachable from:** UI.
- **Covered by tests:** `StartView.test.tsx` (including "sends the chosen division with both the estimate and the idea…", "tells someone below Builder why…", "what happens next"); `tests-e2e/manage.spec.ts` ("the estimate and the idea name the division chosen", "a Viewer is told why…"); `IdeasAndConversationsTests.An_idea_queues_research…`.

### IDEA-03 Read the research estimate before starting
- **Who:** anyone, even before an organisation exists (the endpoint allows anonymous calls).
- **Starts at:** `/start`, the **"Research comes first"** panel.
- **Needs:** nothing.
- **Level:** Foundation. **Learn first:** none.
- **What you learn:** an estimate is free, always comes first, and work cannot start without one.
- **Steps:**
  1. Before typing, the panel reads "Describe the idea and the research estimate appears here before anything is charged."
  2. At 12 or more characters a loading bar appears (screen readers hear "Estimating").
  3. The figure appears as "Estimated {n}", with the basis sentence after it.
  4. Editing the text or the constraints throws the old answer away and asks again.
- **You know it worked when:** "Estimated {n}" shows and the **"Research this idea"** button is enabled.
- **Variations and refusals:** a failed estimate shows "The estimate could not be worked out: … Research cannot start until it is shown." The estimate is the most research may cost; the run then holds credits for each model call as it happens.
- **Where:** `StartView.tsx` `EstimatePanel`; `POST /api/ideas/estimate`.
- **Reachable from:** UI; API; MCP `idea_estimate`.
- **Covered by tests:** `StartView.test.tsx` ("shows the estimate loading…", "records a failed estimate…").

### IDEA-04 Start an idea with too few credits
- **Who:** Builder.
- **Starts at:** `/start`.
- **Needs:** a balance or budget headroom below the estimate.
- **Level:** Core. **Learn first:** IDEA-02; credits and overdraft (another reader's area).
- **What you learn:** in every autonomy mode, work whose estimate would break the budget does not begin. It waits, and nothing is lost.
- **Steps:**
  1. Nothing on the start screen checks the balance. "Research this idea" works and the run opens.
  2. Before any work, in auto-mode and checkpoints mode alike, the Runner compares the estimate with the headroom: the tightest monthly cap on the chain, or the balance down to the overdraft limit. If the estimate is larger, the run shows the badge **"Paused"** and the message **"Endgame · Waiting for budget"**: "This work is estimated at {x} credits, more than the {y} left in its budget, so it has not started. Raise the budget or top up, then resume it."
  3. After a top-up or a budget raise, press **"Resume"** (RUN-05). The check runs again, and the run starts or pauses again.
- **You know it worked when:** after resuming, the badge changes to "Working" and the step "Work started" appears.
- **Variations and refusals:**
  - **In checkpoints mode the budget waits too**: the run pauses with the same message. With the start checkpoint on, "Start this work?" is asked only once the estimate fits, and its card says how much budget is left (RUN-08).
  - An estimate that fits, for work that then costs more, starts; the model gateway's per-call hold stops it when the headroom runs out (RUN-10).
  - Because of the overdraft, a zero balance still leaves headroom down to the limit.
- **Where:** `Endgame.Runner/Execution/RunExecutor.cs` (`GateAsync`); `GET /internal/credits/headroom`.
- **Reachable from:** UI, as the result of any start.
- **Covered by tests:** `EstimateTests.In_every_autonomy_mode_work_whose_estimate_would_break_the_budget_does_not_begin`, `…A_resumed_run_does_not_gate_twice`; `scenarios.s3.test.ts` ("waits for budget in checkpoints mode too").

### IDEA-05 Start an idea by asking the docked conversation
- **Who:** Builder at the selected scope.
- **Starts at:** the conversation docked beside the org chart (placeholder "Ask, or tell it what to change"), with any node selected.
- **Needs:** an organisation.
- **Level:** Core. **Learn first:** IDEA-02; the conversation (another reader's area).
- **What you learn:** the assistant may start research for you, but only after you approve it.
- **Steps:**
  1. Describe the idea in the conversation.
  2. The assistant calls `start_idea`. Its rules mark that call as needing a checkpoint, so the run raises an approval and waits. The dock shows the card **"Start researching an idea: {text}?"** and "Waiting for your answer". The home strip also shows an **"Approval needed"** card.
  3. Press **"Approve"** on the card in the dock (TALK-17), or on the run page (RUN-07).
  4. The idea is created through `POST /internal/ideas`. From a project or app scope it is proposed to the division above.
  5. The assistant's reply arrives in the dock, starting "Research started…".
- **You know it worked when:** a new research run exists: the org chart shows the researcher "researching an idea", and once research ends its verdict waits on the home strip ("Verdict waiting").
- **Variations and refusals:** pressing "Decline" refuses the call ("Declined. It was not done; the work continues without it."), and the assistant says it did not start it.
- **Where:** `ConversationWorkflow.cs`, `RunnerTools.cs` `StartIdeaTool`, `AgentFactory.Conversation` (checkpoints `start_idea`, `adjust_setting`); `POST /internal/ideas` (FactoryEndpoints).
- **Reachable from:** UI (conversation) and MCP `conversation_post`.
- **Covered by tests:** `RunnerContractTests…The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may` (named in UC-114; I did not open it).

### IDEA-06 Submit an idea to a division by API or MCP
- **Who:** a Builder, or an AI assistant using that person's token.
- **Starts at:** `POST /api/ideas { text, constraints[], scope }` or MCP `idea_submit`.
- **Needs:** a token or session.
- **Level:** Developer. **Learn first:** IDEA-02; assistant tokens (another reader's area).
- **What you learn:** an idea is proposed to the organisation or a division, never deeper.
- **Steps:**
  1. Send the text and the scope.
  2. The response is 201 with the idea and its `runId`.
  3. Follow the run with `run_events` or the event stream.
- **You know it worked when:** the response has `status: "researching"` and a `runId`.
- **Variations and refusals:**
  - A project or app scope is refused with 400 ("An idea is proposed to the organisation or to a division…"). Only `POST /internal/ideas` moves it up to the division.
  - No organisation: 409 `no_organisation`.
  - Below Builder: 403.
- **Where:** WorkEndpoints `CreateIdea`; `Mcp/ControlPlaneTools.cs` `idea_submit`.
- **Reachable from:** API/MCP only for a division scope.
- **Covered by tests:** `McpTests.The_control_plane_tools_do_what_the_console_does…`; `IdeasAndConversationsTests`.

### IDEA-07 Ask for ideas from your portfolio
- **Who:** Builder at the scope (Viewers read only).
- **Starts at:** the home page's **"Ideas from your portfolio"** link, with the organisation or a division selected. It is hidden for a project, app or employee. It opens `/suggestions?scope=…`.
- **Needs:** an organisation.
- **Level:** Core. **Learn first:** IDEA-02.
- **What you learn:** Endgame can propose products from what you already hold, and shows the cost first.
- **Steps:**
  1. The heading reads "Ideas from your portfolio".
  2. Optionally pick the scope under **"Suggest for"**: "{Org} (the whole organisation)" or a division. The picker only appears when there is more than one choice.
  3. In the side panel **"Ask for ideas"** ("…suggests up to five products that fill a gap"), press **"See what it costs"** ("Working it out…" while it works).
  4. Read "About {credits}." (what it usually costs) and the basis, which says the most it can ever cost. Press **"Suggest ideas"** ("Starting…") or **"Not now"**.
  5. The panel reads the suggest run itself and says what it is doing: while it works, "The suggestions are being worked out." / "They appear here as soon as they are ready; you can watch the work meanwhile." with **"Watch it work"**, which links to the suggest run. The page checks the run and for new suggestions every 10 seconds.
  6. Cards appear, each with: the title, "Suggested {time ago}", the idea, **"The gap it fills"**, **"Why you are placed to build it"**, and **"What it would reuse"** as badges. A platform service is named as the app page names it ("Sign-in", "E-mail"); technical mode shows what the model wrote.
- **You know it worked when:** suggestion cards appear under the list "Suggested ideas". In the run, the message "Research · New ideas for you" appears ("A new idea for you" for one).
- **Variations and refusals:**
  - Below Builder: "Asking for ideas spends credits, so it needs the Builder role here."
  - Estimate refused: "No estimate could be made: … Nothing was started."
  - Start refused: "The suggestions were not started: …"
  - Empty list: "No suggestions waiting" / "Ask for ideas and Endgame looks at what you already hold for gaps worth filling." While working: "The suggestions are being worked out".
  - With the start checkpoint on (RUN-08), the run waits for your word first: the page says "It is waiting for you to approve the start" / "Nothing is worked out until you approve it." with **"Approve it"**, which opens the run. A paused run says "It is paused"; a stopped one "It stopped before any suggestions were made" with **"See what happened"**.
  - No organisation: "There is nothing to suggest from until your organisation is named".
  - A project or app scope is moved up to its division.
  - The run can fail with "No usable suggestion was made: …" or "What the organisation holds could not be read…".
- **Where:** `features/suggestions/SuggestionsView.tsx`; `POST /api/ideas/suggestions/estimate`, `POST /api/ideas/suggestions`, `GET /api/ideas/suggestions` (BreadthEndpoints); `SuggestionService`; `SuggestWorkflow.cs`.
- **Reachable from:** UI; MCP `ideas_suggest_estimate`, `ideas_suggest` and `ideas_suggestions`.
- **Covered by tests:** `SuggestionsView.test.tsx`; `BreadthTests.Ideas_are_suggested_from_the_portfolio…`; `WorkflowTests.A_suggest_run_…` (two tests); `RunnerIntegrationTests.A_suggest_run_queued_by_the_owner…`; `tests-e2e/breadth.spec.ts` ("shows the cost first, then suggestions…").

### IDEA-08 Take a suggested idea into research
- **Who:** Builder.
- **Starts at:** a suggestion card on `/suggestions`.
- **Needs:** an open suggestion.
- **Level:** Core. **Learn first:** IDEA-07.
- **What you learn:** a suggestion becomes an ordinary idea, with its own research estimate first.
- **Steps:**
  1. Press **"Take this idea"** ("Working it out…").
  2. Read "Researching it costs about {credits}." and the basis, which says the most it can ever cost.
  3. Press **"Research this idea"** ("Starting…") or **"Not now"**.
  4. You are taken to the new idea's page `/ideas/{id}`. It shows "Research in progress" (VERD-02).
- **You know it worked when:** the idea page shows the badge "Research in progress". On `/suggestions` the card moves under "Taken or set aside" with **"Taken — see its research"**.
- **Variations and refusals:**
  - Refused: "It was not taken: {reason} It is still here." Already taken or dismissed: 409.
  - The idea text is built from title, idea, gap, reasons and reuse. The console always sends no constraints; constraints are API/MCP only.
  - The figure on screen comes from a scope-less estimate, but the recorded estimate uses the organisation's history, so they can differ (as in IDEA-02).
- **Where:** `SuggestionsView.tsx` `SuggestionCard`; `POST /api/ideas/estimate`, `POST /api/ideas/suggestions/{id}/take`.
- **Reachable from:** UI; MCP `suggestion_take`.
- **Covered by tests:** `SuggestionsView.test.tsx` ("prices an idea's research before taking it…"); `BreadthTests…one_becomes_an_idea`.

### IDEA-09 Set a suggestion aside
- **Who:** Builder.
- **Starts at:** a suggestion card, **"Set it aside"**.
- **Needs:** an open suggestion.
- **Level:** Core. **Learn first:** IDEA-07.
- **What you learn:** a dismissed suggestion is kept on record, not deleted.
- **Steps:**
  1. Press **"Set it aside"**.
  2. The card leaves the list at once.
  3. It reappears under "Taken or set aside" with the badge "Set aside".
- **You know it worked when:** the "Taken or set aside ({n})" count goes up.
- **Variations and refusals:** if refused, the card comes back and the page says "“{title}” was not set aside: {reason} It is back in the list." No confirmation step.
- **Where:** `POST /api/ideas/suggestions/{id}/dismiss`.
- **Reachable from:** UI, API and MCP `suggestion_dismiss`.
- **Covered by tests:** `SuggestionsView.test.tsx` ("sets an idea aside at once and brings it back when refused"); `tests-e2e/breadth.spec.ts`.

### IDEA-10 Review suggestions already taken or set aside
- **Who:** Viewer or above.
- **Starts at:** `/suggestions`, the fold-out "Taken or set aside ({n})".
- **Needs:** at least one closed suggestion.
- **Level:** Core. **Learn first:** IDEA-08, IDEA-09.
- **What you learn:** suggestions are traceable to the ideas they became.
- **Steps:**
  1. Open the fold-out.
  2. Each row shows a title and either **"Taken — see its research"** (opens the idea) or the badge "Taken" or "Set aside".
- **You know it worked when:** the row's link opens `/ideas/{id}`.
- **Variations and refusals:** a dismissed suggestion cannot be reopened anywhere.
- **Where:** `SuggestionsView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `SuggestionsView.test.tsx` ("…the rest are set apart").

## Research and the verdict (VERD)

### VERD-01 Follow research live
- **Who:** Viewer or above.
- **Starts at:** the run `/runs/{id}` (opened automatically after IDEA-01 or IDEA-02), or **"Watch the research"** on the idea page.
- **Needs:** a research run.
- **Level:** Foundation. **Learn first:** IDEA-01, RUN-01.
- **What you learn:** research argues the case against the idea first, and three researchers work at once.
- **Steps:**
  1. Under "Step by step" you see "Estimated the cost" with its credits, then "Work started".
  2. "Endgame · Hired Iris" (or "Iris is proposed") appears the first time research reaches this scope (BLD-02).
  3. The group "Checked the idea against FrostAura's red lines" runs first: one quick check, with no web search. An idea that plainly crosses a red line stops here (VERD-10); one that is clear, or not plainly either way, is researched in full.
  4. "Research · Research started" says "3 researchers are looking, at the same time… with up to {n} web searches each."
  5. Three contractor groups appear, each with a "Working" badge: "Looked for existing products", "Looked for what they leave undone", "Looked for evidence people will pay". Each can be opened with "Show its {n} steps" and shows search counts and credits. When done, the badge reads "Done" (or "Stopped") with a one-line result, for example "Found 4 existing products, among them …".
  6. The group "Weighed the evidence and wrote the verdict" follows.
  7. "Research · Verdict: build", "Verdict: build it, changed" or "Verdict: do not build" appears.
  8. In auto-mode, "Endgame · Building has started" follows (VERD-11). Otherwise "Endgame · Waiting for your decision".
  9. The run finishes, and the panel **"The verdict is ready"** with **"Read it"** appears.
- **You know it worked when:** the badge reads "Finished" and "The verdict is ready / Read it" shows.
- **Variations and refusals:**
  - If the judge's document is refused once, it is sent back to the judge to fix, in a group named "Asked for the verdict again". If it fails again, the run fails with "The research could not reach a verdict it could record, so none was recorded and nothing will be built. Try again to research it afresh." (VERD-12); what was wrong is in technical mode only.
  - A contractor that returns no usable report is counted as "It did not report back in the agreed form, so its work is not counted."
  - With no connection to the AI models (no key, a key refused, the provider down), the run stops at once: "Endgame could not reach its AI models, so no research was done and nothing was charged. Try again; if it keeps happening, tell FrostAura." No step is corrected or sent back; a contractor that could not reach a model says "It could not reach Endgame's AI models, so it found nothing."
  - With a rule on web search at the research stage (AUTO-05): "May not" means the researchers are not given web search at all, and each says so; "Asks you first" raises one approval per researcher before its first search, titled "Let this step search the web: {step}?"; declined, that researcher works without searching.
  - Whenever the run ends — finished, failed, cancelled or out of budget — its contractors are finished with it, so none stays "Working".
  - Each contractor is named by its role ("Demand researcher (contractor)"); the step's title ("Looked for evidence people will pay") is what it did.
- **Where:** `RunView.tsx`, `timeline.ts`; `ResearchWorkflow.cs`, `VerdictBuilder.cs`.
- **Reachable from:** UI; MCP `run_events`.
- **Covered by tests:** `WorkflowTests.Research_fans_out_registered_contractors…`, `…The_search_budget_is_sized_from_the_estimate…`, `…A_verdict_the_control_plane_refuses_goes_back_to_the_judge_once…`, `…With_no_model_connection_research_stops_plainly_without_correction_rounds`, `…Under_may_not_the_researchers_are_not_offered_web_search…`, `…Under_asks_you_first_each_step_raises_one_plain_approval…`, `…Contractors_of_a_run_that_ended_part_way_are_closed_with_it`; `RunView.test.tsx` ("links a finished research run to its verdict"); `factory.spec.ts` step 2.

### VERD-02 Open an idea's verdict page
- **Who:** Viewer or above.
- **Starts at:** any of these lead to `/ideas/{id}`:
  - **"Read it"** on a finished research run ("The verdict is ready"); research that stopped offers "See the idea" / "Open it" instead, as there is no verdict to read;
  - the home strip's **"Verdict waiting"** card;
  - a notification;
  - "Taken — see its research".
- **Needs:** an idea.
- **Level:** Foundation. **Learn first:** VERD-01.
- **What you learn:** the verdict is a page of its own and stays there.
- **Steps:**
  1. The page loads (skeleton, "Loading the verdict").
  2. Above the verdict sits "Research by {Iris} · {spent} credits, estimated {estimate}". In technical mode the idea id, run id, status, scope and red line are added.
  3. While research runs, the page checks every 5 seconds and shows **"Research in progress"**, "The verdict is being worked out.", "The case against the idea is argued first. You can watch every step as it happens." and **"Watch the research"**.
- **You know it worked when:** the dark verdict banner shows "Verdict · build", "Verdict · change" or "Verdict · do not build".
- **Variations and refusals:** a missing idea shows "This idea could not be found" — with "This was not found, or you cannot see it." and "Back to the org chart" in place of "Try again" (a not-found is an answer, so it does not say "Nothing here is known until it loads."). A failed read shows "The verdict could not be loaded" with a retry. An answer in the wrong shape becomes a failed read naming the field.
- **Where:** `features/verdict/VerdictView.tsx`; `GET /api/ideas/{id}`.
- **Reachable from:** UI; MCP `idea_get`.
- **Covered by tests:** `VerdictView.test.tsx` ("shows a skeleton…", "records a failed read", "says research is still running…").

### VERD-03 Read every section of a verdict
- **Who:** Viewer or above.
- **Starts at:** `/ideas/{id}` once there is a verdict.
- **Needs:** a verdict.
- **Level:** Foundation. **Learn first:** VERD-02.
- **What you learn:** the verdict names the products it found and counts missing demand against building.
- **Steps (top to bottom):**
  1. The banner: stamp "Verdict · {outcome}", the headline, and a two-sentence summary. **"Read the full reasoning"** / **"Hide the full reasoning"** opens "The full reasoning" when the summary is long.
  2. A red-line alert, when one is breached (VERD-10).
  3. **"The case against, argued first"**, as numbered points.
  4. Three cards:
     - **"Who already does this"**: up to 6 products, each with what it does and source links (site name only in normal mode), plus **"Show all {n}"** / **"Show fewer"**. Empty: "Research found nothing already sold that does this."
     - **"What gap is left"**. Empty: "Research named no gap."
     - **"Who would want it"**: paragraphs and "Signals of demand" with sources. If none were found: "No evidence of demand was found. That counts against building."
  5. **"What to change"**, on a change verdict.
  6. **"What would change the verdict"**.
  7. **"No red line is crossed"**, with the reasoning.
  8. The decision controls (VERD-05 to VERD-09), or the decision already taken (VERD-13).
- **You know it worked when:** the three cards and the decision buttons are visible.
- **Variations and refusals:** normal mode strips repository names in brackets from product names. Technical mode shows full URLs.
- **Where:** `VerdictView.tsx`, `verdictModel.ts`.
- **Reachable from:** UI; MCP `idea_get` (raw document).
- **Covered by tests:** `VerdictView.test.tsx` (the shape tests and "shows the verdict as research wrote it…").

### VERD-04 Read how often research says no, and how it was researched
- **Who:** Viewer or above.
- **Starts at:** the side panel of `/ideas/{id}`.
- **Needs:** an idea.
- **Level:** Core. **Learn first:** VERD-03.
- **What you learn:** a verdict that never says no is treated as a fault, so its record is shown.
- **Steps:**
  1. **"How often research says no"**, with the line "Research that never refuses is worthless, so Endgame shows you its record." Then bars for Build, Change and Do not build ("{n} of {total}"). For a first verdict: "This is the first verdict for your organisation." After 5 or more verdicts with no "no": "Research has not said no once in {n} verdicts. Treat that as a fault."
  2. **"When you overruled"**: each overruled idea links to its page, with "Research said {x}." and how it turned out. Empty: "You have not overruled research yet."
  3. **"How this was researched"**: rows "Strands", "Searches", "Sources" ("None recorded" if empty) and "Confidence" ("Not stated" if missing); a per-strand list; "Suggested home: {name}"; the searches themselves in technical mode; **"Every source ({n})"** as a fold-out; any rules applied (for example "No evidence of demand was found…"); and **"See every step"**.
- **You know it worked when:** the bars and the method rows show.
- **Variations and refusals:** the rows "Argued" and "Briefed" and the method summary never appear with today's Runner. `VerdictBuilder.Method` does not write `argued`, `contractors` or `summary`.
- **Where:** `VerdictView.tsx` `RecordAside`; `ReadModels.VerdictRecordAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `VerdictView.test.tsx` ("shows the agreed document… each strand and the method's searches and confidence").

### VERD-05 Build on a "build" verdict
- **Who:** Builder.
- **Starts at:** `/ideas/{id}`, outcome build. Buttons: **"Build it"**, **"Change the idea"**, **"Drop the idea"**.
- **Needs:** verdict build, no red line, not yet decided.
- **Level:** Foundation. **Learn first:** VERD-03.
- **What you learn:** your decision starts the factory, and the build run follows from it.
- **Steps:**
  1. Press **"Build it"**. There is no confirmation.
  2. A build run "Build: {title}" is queued, and you are taken to it (RUN-01, then BLD-01 onwards).
- **You know it worked when:** the build run page opens. On the idea page the panel reads "You chose to build it on {date}." with **"Watch the work that followed"**.
- **Variations and refusals:** if refused, "Your decision was not recorded: {reason}" and the buttons stay. Deciding twice gives 409 ("The idea is building; a decision follows a verdict.").
- **Where:** `VerdictView.tsx` `Decisions`; `POST /api/ideas/{id}/decision {choice:"build"}`; `IdeaService.DecideAsync`.
- **Reachable from:** UI; MCP `idea_decide`.
- **Covered by tests:** `IdeasAndConversationsTests.An_idea_queues_research…`; `VerdictView.test.tsx` (option sets).

### VERD-06 Build a "change" verdict, with or without research's change
- **Who:** Builder.
- **Starts at:** outcome change. Buttons: **"Change the idea"** (primary), **"Build it as described"**, **"Build it with this change"**, **"Drop the idea"**. Under them: "“Build it with this change” builds the idea with research’s change as part of what is asked for; “Build it as described” builds your own words."
- **Needs:** verdict change (**"Build it with this change"** only when research named its change).
- **Level:** Core. **Learn first:** VERD-05.
- **What you learn:** you can accept research's change and have it built in, or keep your own wording.
- **Steps:**
  1. Press **"Build it with this change"** (or **"Build it as described"**). There is no confirmation.
  2. A build run starts and you are taken to it. With the change, the planner is held to the idea **plus** research's change ("Agreed after research, and part of what is built: …"); as described, to the idea plus any change you asked for earlier (VERD-07).
- **You know it worked when:** "You chose to build it on {date}." and the plan's "What you asked for" quotes the change.
- **Variations and refusals:** `applyChange` on any verdict but "change" is 409 ("There is no change from research to apply…").
- **Where:** `VerdictView.tsx` `Decisions`; `POST /api/ideas/{id}/decision {choice:"build", applyChange:true}`; `IdeaService.DecideAsync` (`changes[]`, `appliedChange` on the build's owner message); `BuildWorkflow.WithAgreedChanges`.
- **Reachable from:** UI; MCP `idea_decide` (`applyChange`).
- **Covered by tests:** `TryAgainAndChanges.test.tsx` ("builds a change verdict with research's change applied only when asked to"); `TryAgainAndChangesTests.A_new_verdict_clears_the_decision…`; `WorkflowTests.The_change_agreed_after_research_is_part_of_what_the_planner_is_held_to`.

### VERD-07 Change the idea and have it researched again
- **Who:** Builder.
- **Starts at:** **"Change the idea"**, available on every outcome and on a red line. (The label would read "Change it: {label}" if research gave one, but today's Runner never does.)
- **Needs:** a verdict.
- **Level:** Core. **Learn first:** VERD-03.
- **What you learn:** a change is a new round of research with your note; the new verdict comes back to you, and your change is part of what is built.
- **Steps:**
  1. Press **"Change the idea"** and the form **"What should change?"** opens. It is pre-filled with research's suggested change or with "what would change the verdict".
  2. The hint reads "Research runs again with your change, and you see a new verdict before anything is built."
  3. Press **"Research it again with this change"** (disabled while empty) or **"Not now"**.
  4. The idea goes back to researching and you are taken to the new research run. The note goes to research as "The owner asked for this change after the last verdict: …".
  5. When the new verdict lands it **clears your earlier decision**, so the decision buttons return for it. The earlier decision is kept under **"Earlier decisions"**: "{Name} asked for the idea to be changed after a “{outcome}” verdict on {date}.", your note in quotes, and **"See the research that followed"**.
  6. Whatever you build next, the planner is given the idea's words **plus** every change you asked for.
- **You know it worked when:** a new research run opens; after its verdict, the buttons are back and "Earlier decisions" lists your change.
- **Variations and refusals:** the idea's own text is kept as you first wrote it; the changes travel beside it (`changes[]`).
- **Where:** `VerdictView.tsx` (`Decisions`, `DecisionHistory`); `IdeaService.DecideAsync` (Change), `RecordVerdictAsync` (clears the decision), `OwnerChangesAsync`; `ReadModels.DecisionHistoryAsync`.
- **Reachable from:** UI; API/MCP.
- **Covered by tests:** `VerdictView.test.tsx` ("asks what should change, and sends it as the note"); `TryAgainAndChanges.test.tsx` ("…keeps earlier decisions in the history"); `TryAgainAndChangesTests.A_new_verdict_clears_the_decision_keeps_it_in_the_history_and_the_agreed_changes_reach_the_build`; `IdeasAndConversationsTests.Change_runs_the_research_again_and_drop_ends_it`.

### VERD-08 Overrule a "do not build"
- **Who:** Builder.
- **Starts at:** outcome do-not-build. Buttons: **"Change the idea"** (only if research said what would change it), **"Overrule and build anyway"**, **"Drop the idea"**. The note reads "Overruling is your call. The project will carry a note that research advised against it."
- **Needs:** verdict do-not-build, no red line.
- **Level:** Core. **Learn first:** VERD-03, VERD-04.
- **What you learn:** you can overrule research, and the overrule is recorded and counted.
- **Steps:**
  1. Press **"Overrule and build anyway"**.
  2. The confirmation reads "Build it against the verdict? This is recorded as an overrule." with **"Yes"** / **"No"**.
  3. Press **"Yes"**. A build run starts and you are taken to it.
- **You know it worked when:** the idea page shows a tinted panel "You overruled the verdict and chose to build it on {date}." and "The project carries a note that research advised against it." The idea joins "When you overruled".
- **Variations and refusals:** "build" over a do-not-build gives 409 ("…takes an explicit overrule…"); an overrule of a build verdict gives 409. Auto-mode never overrules.
- **Where:** `VerdictView.tsx`; `DecideAsync` (Overrule).
- **Reachable from:** UI; MCP.
- **Covered by tests:** `VerdictView.test.tsx` ("records an overrule only after it is confirmed", "shows a recorded overrule clearly"); `console.spec.ts` ("…read the verdict, overrule").

### VERD-09 Drop the idea
- **Who:** Builder.
- **Starts at:** **"Drop the idea"** on any verdict.
- **Needs:** a verdict.
- **Level:** Foundation. **Learn first:** VERD-03.
- **What you learn:** dropping ends the idea and keeps its record.
- **Steps:**
  1. Press **"Drop the idea"**.
  2. The confirmation reads "Drop this idea?" with **"Yes"** / **"No"**.
  3. Press **"Yes"**. You stay on the page.
- **You know it worked when:** the panel reads "You dropped the idea on {date}."
- **Variations and refusals:** no run follows. A dropped idea cannot be revived.
- **Where:** `DecideAsync` (default branch, status `dropped`).
- **Reachable from:** UI; MCP.
- **Covered by tests:** `IdeasAndConversationsTests.Change_runs_the_research_again_and_drop_ends_it`.

### VERD-10 See research refuse an idea over a red line
- **Who:** anyone who reads the verdict.
- **Starts at:** `/ideas/{id}`, where the verdict's red-line screen is breached.
- **Needs:** an idea that crosses a red line: tobacco, exploitative gambling or predatory finance; weapons against civilians; animal harm and industrial cruelty; surveillance and authoritarian tooling.
- **Level:** Foundation. **Learn first:** VERD-03.
- **What you learn:** a red line is absolute, and no one can overrule it.
- **Steps:**
  1. The verdict is always "do not build", because code forces it. An idea that plainly crosses a line is refused by the first check, before any researcher starts or any search is made: the run says "Research · Verdict: do not build" with "It was refused before any research was done, so no searches were made, and no one can overrule a red line.", and the verdict says it was not researched. An idea that only might cross one is researched in full and judged.
  2. The alert reads "This idea crosses a red line: {line}", then "FrostAura never builds it, and no one can overrule that — not research, not auto-mode, not you. You can change the idea and have it researched again, or drop it.", then the reasoning.
  3. Only **"Change the idea"** and **"Drop the idea"** are offered, with "Overruling is not offered: no one may build over a red line."
- **You know it worked when:** no build or overrule button is present.
- **Variations and refusals:**
  - Over API/MCP, build or overrule gives 403 `red_line`.
  - In auto-mode the run says "Endgame · It will not be built".
  - The rules list shows "The idea crosses a red line (…), and FrostAura never builds it."
- **Where:** `VerdictView.tsx`, `verdictModel.redLineBreached`; `VerdictBuilder` (red line forces do-not-build); `IdeaService.DecideAsync` (403).
- **Reachable from:** UI; API; MCP.
- **Covered by tests:** `WorkflowTests.A_red_line_is_do_not_build_whatever_the_market_says`, `…An_idea_plainly_over_a_red_line_is_refused_at_once_without_researchers_or_searches`, `…An_idea_the_screen_is_unsure_of_is_researched_in_full`; `VerdictView.test.tsx` ("offers neither build nor overrule…", "over a breached red line offers no overrule…").

### VERD-11 Let auto-mode decide after the verdict
- **Who:** nobody acts; auto-mode decides.
- **Starts at:** the research run, at its end.
- **Needs:** autonomy `auto` at the idea's scope (the default) and a verdict of build or change.
- **Level:** Core. **Learn first:** VERD-01, AUTO-02.
- **What you learn:** in auto-mode a "build" or "change" verdict builds on its own, while a "do not build" always waits for you.
- **Steps:**
  1. The research run calls `POST /internal/ideas/{id}/decision {decision:"build", by:"auto-mode"}`.
  2. "Endgame · Building has started" appears: "Auto-mode is building it now, on that verdict. You can follow the build, pause it or stop it at any time." On a "change" verdict it reads "Auto-mode is building it now, with research's change applied: {change}. You can follow the build, pause it or stop it at any time", and the build is held to that change too.
  3. On the idea page: "Auto-mode chose to build it on {date}." with "Watch the work that followed".
- **You know it worked when:** the idea page shows "Auto-mode chose to build it…".
- **Variations and refusals:**
  - Do-not-build: no call is made; the idea waits for you.
  - Checkpoints mode: 409; "Endgame · Waiting for your decision": "The verdict waits for you: build it, change it or drop it. Autonomy at … is 'checkpoints'…".
  - Red line: "It will not be built".
  - The start screen says what auto-mode will do at the place chosen (IDEA-02).
- **Where:** `ResearchWorkflow.cs`; `FactoryEndpoints` `DecideIdeaAutomatically`; `IdeaService.DecideAutomaticallyAsync`.
- **Reachable from:** internal only (no person calls it).
- **Covered by tests:** `IdeaService.DecideAutomaticallyAsync` applies the change (`applyChange`); `WorkflowTests.With_checkpoints_on_a_build_verdict_waits_for_the_owner`, `…No_evidence_of_demand_turns_a_build_into_do_not_build_which_waits_for_the_owner`.

### VERD-12 See that research did not finish, and research it again
- **Who:** Viewer reads; Builder tries again.
- **Starts at:** `/ideas/{id}` when the latest research run failed or was cancelled.
- **Needs:** a failed or cancelled research run.
- **Level:** Core. **Learn first:** VERD-02.
- **What you learn:** a failed research run records no verdict and nothing is built; it can be started again, its cost shown first.
- **Steps:**
  1. The idea page shows the alert **"Research did not finish"**, "No verdict could be reached.", "Research stopped before it reached a verdict. The trace shows where." and **"See what happened"**.
  2. Below it the panel says why ("This work stopped before it finished. What was finished is kept.", "This work was cancelled. What was finished is kept." or "The credit budget ran out, so this work stopped…") with **"Try again"** and "It picks up where this stopped; you see what it costs first."
  3. Press **"Try again"** ("Working it out…"). It reads "Research starts again with the same idea, and you see the verdict before anything is built.", **"Estimated {credits}"** and the basis.
  4. Press **"Start it again"** ("Starting…") or **"Not now"**. You are taken to the new research run (VERD-01), with the same idea, constraints and change.
- **You know it worked when:** the new research run opens; the idea page now follows it, and "Earlier decisions" says "Research that did not finish was started again on {date}."
- **Variations and refusals:** only the idea's latest research can be tried, once (409); refused: "It was not started again: {reason}"; no estimate: "No estimate could be made: {reason} Nothing was started."
- **Where:** `VerdictView.tsx` `NoVerdictYet`; `runs/TryAgain.tsx`; `POST /api/runs/{id}/retry/estimate`, `POST /api/runs/{id}/retry`; `RetryService`, `IdeaService.RetryResearchAsync`.
- **Reachable from:** UI; MCP `run_retry_estimate`, `run_retry`; the conversation (`try_again`, TALK-18).
- **Covered by tests:** `TryAgainAndChangesTests.Research_that_did_not_finish_is_tried_again_once_with_its_estimate_first`; `TryAgainAndChanges.test.tsx` ("offers to research again when research did not finish…"); `WorkflowTests.A_judge_without_a_verdict_document_fails_the_research_rather_than_guessing`.

### VERD-13 Read a decision already taken
- **Who:** Viewer or above.
- **Starts at:** `/ideas/{id}` after a decision.
- **Needs:** a decision.
- **Level:** Foundation. **Learn first:** VERD-05.
- **What you learn:** every decision says who took it and when.
- **Steps:**
  1. The panel shows one of: "You chose to build it", "You asked for the idea to be changed and researched again", "You overruled the verdict and chose to build it", "You dropped the idea" (or "Auto-mode chose…" / "Auto-mode asked…"), followed by "on {date}."
  2. **"Watch the work that followed"** opens the build run, or the new research run for a change.
- **You know it worked when:** the panel is shown instead of the buttons.
- **Variations and refusals:** after "change", the panel shows until the new verdict lands; then the decision is cleared and kept under "Earlier decisions" (VERD-07). A stopped build shows the try-again panel under it (CHG-03).
- **Where:** `VerdictView.tsx`.
- **Reachable from:** UI.
- **Covered by tests:** `VerdictView.test.tsx`.

## Following and controlling runs (RUN)

### RUN-01 Open a run and follow it live
- **Who:** Viewer or above.
- **Starts at:** `/runs/{id}`, reached from the start screen, a decision, **"Watch the work"** on the org chart, **"Approval needed"**, an employee page, or "See how it got there".
- **Needs:** a run.
- **Level:** Foundation. **Learn first:** IDEA-01.
- **What you learn:** every step of the work is visible as it happens, and a dropped connection loses nothing.
- **Steps:**
  1. The page loads (skeleton, "Loading the work").
  2. The header shows the status badge ("Waiting to start", "Working", "Waiting for you", "Paused", "Finished", "Did not succeed", "Cancelled", or "You declined to start this" for work declined at its start checkpoint), the stream state ("Connecting…", "Live" with a pulsing dot, "Reconnecting…"), the title and "Started {time}".
  3. Steps arrive under "Step by step". Before the first one: "Waiting for the first step". Events are taken in together, a batch at a time, so a long build's thousands of events draw at once rather than one by one.
  4. A run with more than 200 steps shows the latest 200, under "{n} earlier steps folded away; the latest 200 are below." with **"Show 200 earlier steps"** (or as many as are left), which unfolds them 200 at a time.
  5. The stream closes when the run finishes.
- **You know it worked when:** "Live" shows and new steps appear without reloading.
- **Variations and refusals:**
  - Six failed reconnects: "The live connection to this work could not be kept open. What is shown is everything received so far." with **"Reconnect"**.
  - A missing run: "This work could not be found" — with "This was not found, or you cannot see it." and "Back to the org chart" in place of "Try again" (a not-found is an answer, so it does not say "Nothing here is known until it loads."). A failed read: "This work could not be loaded" with a retry.
  - A finished run with no steps: "This work recorded no steps."
- **Where:** `RunView.tsx`, `useRunStream.ts`; `GET /api/runs/{id}`, `GET /api/runs/{id}/events?after=`.
- **Reachable from:** UI; MCP `run_get`, `run_events`.
- **Covered by tests:** `RunView.test.tsx` (including "draws a long build promptly, folding its earlier steps…"); `useRunStream.test.ts`; `RunsAndTasksTests.The_event_stream_is_server_sent_events_resumable…`.

### RUN-02 Read a run in normal mode
- **Who:** Viewer or above.
- **Starts at:** `/runs/{id}` with normal mode on.
- **Needs:** a run.
- **Level:** Foundation. **Learn first:** RUN-01.
- **What you learn:** normal mode tells the work in plain words and never names infrastructure.
- **Steps:**
  1. The count line reads "{n} actions taken" (", {n} refused by your rules" when any were refused). A run that took no action, such as a conversation that only answered, shows no count.
  2. Messages appear as "{speaker} · {title}".
  3. Contractor and agent groups fold away once done, for example "Built: {part}", "Checked: {part}", "Drew up the plan"; "Show its {n} steps" unfolds one. A group still under way is titled in the present tense ("Looking for existing products", "Building: {part}") with "Working"; once the run has ended, a group that never reported back reads "Stopped".
  4. The mechanics are summarised, for example "Read 4 files · Changed 2 files · Ran the tests — 12 passed".
  5. Refused actions read "An action was refused by your rules" / "It was not carried out. The work continues without it."
  6. **"Outcome"** shows the closing plain message. A conversation's outcome is its reply, drawn from its markdown (bold, lists, inline code).
- **You know it worked when:** no ids, file names or model names appear.
- **Variations and refusals:** a line that would name infrastructure is hidden.
- **Where:** `timeline.ts`, `runModel.ts`.
- **Reachable from:** UI.
- **Covered by tests:** `timeline.test.ts`; `plainLanguage.test.ts`; `breadth.spec.ts` ("a normal-mode run never prints a key, an id, a model or a file…").

### RUN-03 Read a run in technical mode
- **Who:** Viewer or above.
- **Starts at:** the same page with technical mode on.
- **Needs:** a run.
- **Level:** Advanced. **Learn first:** RUN-02.
- **What you learn:** every model call, tool call and permission decision is in the log.
- **Steps:**
  1. The heading changes to "Trace", with "{n} model calls · {n} tool calls · {n} denials".
  2. Each event shows ("Model call: …", "Tool: …", "Allowed: …", "Denied: …", "Result: …"), each with **"Raw event #{seq}"**.
  3. The header adds "{kind} run {id} · scope … · last event #{n}".
- **You know it worked when:** the raw-event fold-outs appear.
- **Variations and refusals:** none.
- **Where:** `runModel.describeEvent`.
- **Reachable from:** UI; MCP `run_events`.
- **Covered by tests:** `RunView.test.tsx` ("shows the raw detail in technical mode"); `console.spec.ts`.

### RUN-04 Pause a run
- **Who:** Builder.
- **Starts at:** **"Pause"** on a run that is not finished.
- **Needs:** a run that is queued, running or waiting.
- **Level:** Core. **Learn first:** RUN-01.
- **What you learn:** a paused run stops between steps and loses nothing.
- **Steps:**
  1. Press **"Pause"**. The badge changes to "Paused" at once.
  2. The step "Paused" is logged, and the Runner stops at its next step boundary.
- **You know it worked when:** the badge reads "Paused" and the button now reads "Resume".
- **Variations and refusals:** if refused, the badge goes back and the page says "Could not pause: {reason} The work carries on as it was." (409 "A {status} run cannot be paused.").
- **Where:** `POST /api/runs/{id}/pause`; `RunService.PauseAsync`.
- **Reachable from:** UI; MCP `run_control`. A `reason` can only be sent through API or MCP.
- **Covered by tests:** `RunView.test.tsx` ("pauses optimistically and rolls back…"); `RunsAndTasksTests.Pause_resume_and_cancel…`; `RunnerIntegrationTests.Pause_stops_the_run_between_steps…`; `console.spec.ts`.

### RUN-05 Resume a paused run
- **Who:** Builder.
- **Starts at:** **"Resume"**.
- **Needs:** a paused run.
- **Level:** Core. **Learn first:** RUN-04.
- **What you learn:** a resumed run picks up from its log, not from the beginning.
- **Steps:**
  1. Press **"Resume"**. The run goes back into the queue.
  2. A Runner claims it, replays the log, and the step "Resumed" appears.
- **You know it worked when:** the badge reads "Working".
- **Variations and refusals:** only a paused run can be resumed (409). A run paused for budget may pause again (IDEA-04).
- **Where:** `POST /api/runs/{id}/resume`.
- **Reachable from:** UI; MCP.
- **Covered by tests:** as RUN-04.

### RUN-06 Cancel a run
- **Who:** Builder.
- **Starts at:** **"Cancel"**.
- **Needs:** a run that is not finished.
- **Level:** Core. **Learn first:** RUN-01.
- **What you learn:** cancelling ends the work for good and releases the credits it was holding.
- **Steps:**
  1. Press **"Cancel"**.
  2. The confirmation reads "Stop this work for good?" with **"Yes, cancel it"** / **"Keep going"**.
  3. Press **"Yes, cancel it"**. The badge changes to "Cancelled" and the step "Cancelled" is logged.
- **You know it worked when:** the control buttons disappear and the badge reads "Cancelled".
- **Variations and refusals:**
  - An already finished run gives 409.
  - A cancelled build, change or research can be started again from the run page's **"Try again"** (CHG-03, VERD-12).
- **Where:** `POST /api/runs/{id}/cancel`.
- **Reachable from:** UI; MCP.
- **Covered by tests:** `RunView.test.tsx` ("asks before cancelling"); `RunsAndTasksTests.Pause_resume_and_cancel…`.

### RUN-07 Answer an approval a run is waiting on
- **Who:** Builder at the run's scope.
- **Starts at:** the run page's section "Waiting for your approval", the home **"Approval needed"** card, or the conversation itself (TALK-17).
- **Needs:** a pending approval.
- **Level:** Core. **Learn first:** RUN-01, AUTO-03.
- **What you learn:** a checkpoint pauses the work for your word, your note goes back to the work, and declining is told truthfully.
- **Steps:**
  1. The card shows the badge **"Needs you"**, what will happen if you approve, in plain words, and under it why it asks ("Your rules for this stage ask for your sign-off before this is done. …", "This waits for your sign-off before it is done. …", "{h} credits are left in the budget."). In technical mode the tool line is added ("change_app: … Checkpoint: change_app.").
  2. Optionally type into **"Add a note (optional)"**.
  3. Under the buttons: "Declining skips only this step; the work goes on without it." or, for the start and plan checkpoints, "Declining stops this work."
  4. Press **"Approve"** or **"Decline"**. The card reads "Approved. Sending…" or "Declined. Sending…", then "Approved. The work carries on from here.", "Declined. It was not done; the work continues without it." or "Declined. It was not done, so the work has stopped."
  5. The step "You answered: approved" or "declined" is logged, with your note beneath it; the note is given back to the agent ("Their note: …").
- **You know it worked when:** the card disappears from the list and the badge leaves "Waiting for you".
- **Variations and refusals:**
  - A failed answer: "Your answer was not recorded: {reason}" and the buttons come back. A second answer gives 409. A note is at most 2000 characters.
  - What each approval means: RUN-08 (start), BLD-04 (plan), TALK-07/TALK-17 (conversation), AUTO-05 (an "Asks you first" rule).
- **Where:** `runs/ApprovalCard.tsx`, `runModel.answeredText`; `POST /api/runs/{id}/approvals/{approvalId} {decision, note}`; `ApprovalService` (`onDecline`, `comment`); `AgentLoop.AskAsync`.
- **Reachable from:** UI; MCP `approval_answer` (with `note`).
- **Covered by tests:** `RunView.test.tsx` ("streams… an inline approval", "rolls an approval back…"); `TryAgainAndChanges.test.tsx` ("tells the truth after a decline"); `PermissionTests.An_asks_you_first_rule_raises_an_approval_even_unattended_and_a_decline_carries_the_note`; `RunsAndTasksTests.A_run_waits_on_an_approval…`; `console.spec.ts`.

### RUN-08 Approve the estimate before work starts
- **Who:** Builder.
- **Starts at:** any new run's page.
- **Needs:** autonomy `checkpoints` and the checkpoint "Before work starts" on.
- **Level:** Advanced. **Learn first:** RUN-07, AUTO-03.
- **What you learn:** with the start checkpoint on, you approve the cost before anything begins.
- **Steps:**
  1. The card asks "Start this work? Estimated {n} credits." The detail reads "{h} credits are left in the budget." Both figures are shown with at most two decimals ("277.32").
  2. Press **"Approve"** to start.
  3. Press **"Decline"** (optionally with a note) to end the run. The card says "Declined. It was not done, so the work has stopped." The badge reads "You declined to start this" (not a failure), the outcome "You declined to start this work at its estimate, so nothing was done and nothing was charged." with your note, the cost reads "Charged" with no estimate score, and **"Try again"** is offered. In technical mode the run ends as cancelled with the reason `declined_at_start`.
- **You know it worked when:** after approving, "Work started" and the work appear.
- **Variations and refusals:** this applies to research, build, change, task and suggest runs. A conversation is never held here: a chat message is answered without "Start this work?" (the budget still pauses it, IDEA-04, and each action it takes asks on its own).
- **Where:** `RunExecutor.GateAsync`.
- **Reachable from:** UI.
- **Covered by tests:** `EstimateTests.With_a_start_checkpoint_the_owner_approves_the_estimate_first`, `…A_conversation_is_never_held_at_the_start_checkpoint_but_still_waits_for_budget`.

### RUN-09 See a run waiting for budget, and get it moving
- **Who:** Viewer reads; Builder resumes; Admin or Owner raises budgets.
- **Starts at:** a run with the badge "Paused".
- **Needs:** an estimate larger than the headroom, in any autonomy mode. This is checked at the start, and again for a build once the plan has been estimated.
- **Level:** Core. **Learn first:** IDEA-04.
- **What you learn:** the credit budget is the limit that is always on.
- **Steps:**
  1. The message "Endgame · Waiting for budget" explains the figures (IDEA-04; for a plan: "The plan is estimated at … so building has not started. Raise the budget, then resume.").
  2. Top up or raise the budget (another reader's area). The run aside's **"See credits"** opens the credits page.
  3. Press **"Resume"**.
- **You know it worked when:** the badge reads "Working".
- **Variations and refusals:** as IDEA-04.
- **Where:** `RunExecutor.GateAsync`; `BuildWorkflow` (estimate.plan).
- **Reachable from:** UI.
- **Covered by tests:** `EstimateTests.In_every_autonomy_mode_work_whose_estimate_would_break_the_budget_does_not_begin`; `WorkflowTests.A_plan_whose_estimate_would_break_the_budget_waits_for_budget_in_every_autonomy_mode`.

### RUN-10 See a run stop because the budget ran out mid-way, and try it again
- **Who:** Viewer reads; Builder tries again.
- **Starts at:** a run that "Did not succeed".
- **Needs:** headroom exhausted during the work.
- **Level:** Core. **Learn first:** RUN-09.
- **What you learn:** credits are held before every model call, so a cap is never exceeded, and what was finished is kept.
- **Steps:**
  1. The gateway refuses to hold credits for the next call, and the run is marked budget-exhausted.
  2. A message reads "The credit budget is exhausted, so this run cannot call a model again. Top up or raise the budget; what was finished is kept, and the work can then be tried again." (it shows as "Update", because no speaker is set).
  3. The run fails with "The credit budget ran out, so the work stopped. Top up or raise the budget, then try it again; what was finished is kept."
  4. Above the cost panel: "The credit budget ran out, so this work stopped. What was finished is kept, and nothing more was charged." with **"See credits"** and, for research, a build or a change, **"Try again"** (CHG-03).
- **You know it worked when:** the badge reads "Did not succeed", the panel says the budget ran out, and "Try again" is offered.
- **Variations and refusals:** for other kinds of work (a conversation, a review) only "See credits" is offered.
- **Where:** `RunService.MarkBudgetExhaustedAsync`; `WorkflowOutcome.FromAgent`; `RunView.tsx` `StoppedPanel`.
- **Reachable from:** UI.
- **Covered by tests:** `RunnerIntegrationTests.A_refused_budget_reaches_the_harness_as_terminal`; `TryAgainAndChanges.test.tsx` ("says a budget stop plainly…").

### RUN-11 Read a failed run
- **Who:** Viewer or above.
- **Starts at:** a run with the badge "Did not succeed".
- **Needs:** a failed run.
- **Level:** Core. **Learn first:** RUN-02.
- **What you learn:** a failed run says why in plain words, and keeps the work it did.
- **Steps:**
  1. The step "Stopped: it did not succeed" is logged.
  2. "Endgame · Stopped" gives the reason. Examples:
     - "Planning did not produce a plan that covers everything the idea asks for, so nothing was built. “Try again” plans it afresh."
     - "\"{part}\" still did not work after 3 rounds of repair, each on a stronger model, so the app was not published. Its work so far is saved and the repairs were not charged; “Try again” carries on from it."
     - "The security review still found problems after one repair, so the app was not published. Its work is saved, technical mode lists each finding, and “Try again” carries on from it."
     - "You declined the plan, so nothing was built. “Try again” plans it afresh."
     - "The work stopped on an unexpected fault, which has been recorded. Nothing was lost; use “Try again” to carry on from where it stopped." (other kinds: "…Nothing was lost.")
  3. **"Outcome"** repeats the reason. Technical mode shows the technical summary.
- **You know it worked when:** the Outcome section names the reason.
- **Variations and refusals:** every message that promises a restart points at **"Try again"** on the same page (CHG-03).
- **Where:** `RunExecutor.FinishAsync`; `BuildWorkflow`.
- **Reachable from:** UI.
- **Covered by tests:** `WorkflowTests.Repair_rounds_are_capped…`, `…A_security_finding_blocks_publishing_after_one_repair`, `…Work_that_never_passes_its_check_fails_its_task…`.

### RUN-12 See a run recover after the Runner was interrupted
- **Who:** nobody acts.
- **Starts at:** any run.
- **Needs:** a Runner that dies, or shuts down cleanly, part-way.
- **Level:** Advanced. **Learn first:** RUN-01.
- **What you learn:** work is resumed from its log; finished stages are not repeated or re-billed.
- **Steps:**
  1. The lease lapses, or is released at the next step boundary on a clean shutdown.
  2. Another Runner claims the run and replays the log. Placement, the plan, finished parts, hires and tasks are skipped.
  3. A builder told the workspace was recreated is warned "The workspace was recreated from the last commit; anything uncommitted from before was lost."
- **You know it worked when:** the run continues and finishes, with no repeated "Placed" or "The plan" messages.
- **Variations and refusals:** a Runner that is refused its lease stops quietly.
- **Where:** `RunExecutor`, `WorkflowJournal`, `LeaseKeeper`; `POST /internal/runs/claim`.
- **Reachable from:** none (automatic).
- **Covered by tests:** `RunnerIntegrationTests.A_runner_killed_mid_run_is_resumed…`, `…A_graceful_shutdown_suspends…`; `WorkflowTests.A_build_killed_part_way_resumes…`, `…A_resumed_build_keeps_its_tasks…`.

### RUN-13 Read what a run cost, and what was not charged
- **Who:** Viewer or above.
- **Starts at:** the run page's "Cost" row.
- **Needs:** a run.
- **Level:** Core. **Learn first:** RUN-01.
- **What you learn:** an estimate is shown first and scored against what the work really cost.
- **Steps:**
  1. **"Estimate"** shows "Not yet made" or the figure, with "Shown before the work began".
  2. **"Spent so far"** shows what the work was charged, a bar and "{p}% of the estimate". It is the run's own cost: the billable settlements in its log, counted as the ledger counts them, so a free repair is not in it and the figure matches "cost {y}" once scored. The percentage is the true one ("130% of the estimate"); the bar stops at full and turns to the attention colour above 100%. A small amount is never rounded to 0: it keeps two decimals ("0.05 credits") or reads "less than 0.01 credits".
  3. While running, **"Held for calls in flight"** shows "Reserved before each call, released when it settles".
  4. When finished, **"Estimate against actual"** shows "on the estimate", "{n}% over" or "{n}% under", with "Estimated {x}, cost {y}", and **"Not charged"** shows the credits the work used repairing its own mistakes, "Repairs of the work’s own mistakes, never billed".
  5. The aside **"Where the credits go"** says "Credits are held before each step and settled from what it really cost. Repairing a mistake of its own is never billed." with **"See credits"**.
  6. Free repairs are named in the steps: "Sent back for repair, at no charge: …", and "Fixed what the security review found, at no charge".
- **You know it worked when:** "Estimate against actual" appears on a finished run.
- **Variations and refusals:** "Not charged" appears once the run has finished (from `estimate.scored.nonBillableCredits`); while it runs, each free repair is named in the steps. Work declined at its start never began, so it shows only "Estimate" and "Charged" ("You declined to start it, so nothing was done."), with no score.
- **Where:** `RunView.tsx` `CostPanel`, `RunAside`; `Estimator.Score`.
- **Reachable from:** UI; MCP `credits_get`.
- **Covered by tests:** `runModel.test.ts` (a free repair is not in what was spent); `RunView.test.tsx` ("…says one cost the log and the run agree on"); `TryAgainAndChanges.test.tsx` ("…shows what was not charged…"); `EstimateTests.An_estimate_is_made_before_work_and_scored…`.

### RUN-14 Follow the tasks of a run
- **Who:** Viewer or above.
- **Starts at:** the run aside **"Tasks"**.
- **Needs:** a run that creates tasks (a build).
- **Level:** Core. **Learn first:** RUN-01.
- **What you learn:** each part of the work is a task claimed by a named employee.
- **Steps:**
  1. Tasks appear with the badges "To do", "In progress", "Done", "Did not succeed".
  2. Each shows the holder and a note.
- **You know it worked when:** tasks show "Done" with their summaries.
- **Variations and refusals:** none yet: "No tasks yet. They appear here as the work is broken down." Finished without tasks: "This work was not broken into tasks."
- **Where:** `RunView.tsx` `RunAside`.
- **Reachable from:** UI; MCP `tasks_list`.
- **Covered by tests:** `WorkflowTests.Each_plan_item_is_a_task_the_engineer_claims…`.

## Plan, build, evaluate, review, publish (BLD)

Each of these happens inside one build run "Build: {title}" and is followed on its run page.

### BLD-01 See where the new app is placed
- **Who:** nobody acts; you watch.
- **Starts at:** a build run.
- **Needs:** a build decision.
- **Level:** Core. **Learn first:** VERD-05.
- **What you learn:** Endgame finds the app a home (a division, a project and the app itself) without asking.
- **Steps:**
  1. The division is the idea's own one if it was proposed to a division. Otherwise it is the verdict's proposed division, defaulting to "labs"; it is created if it is new.
  2. The project and the app are created, or reused when their slugs already exist.
  3. "The builder · Placed" reads "{name} will live in a new division, {Division}, as the project {Project}." (or "…will live in {Division}…").
- **You know it worked when:** the message appears, and the org chart shows the new project.
- **Variations and refusals:**
  - **No person confirms or edits the placement.** There is no checkpoint for it.
  - The start screen's "A home for it — Endgame suggests a division and a name." is closer to "decides".
- **Where:** `BuildWorkflow.PlaceAsync`; `POST /internal/tree/nodes`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.Build_places_plans_builds…`; `factory.spec.ts` step 3.

### BLD-02 See hires the factory proposes or makes
- **Who:** nobody acts in auto-mode; an Admin decides a proposal.
- **Starts at:** a research or build run.
- **Needs:** a need raised by the factory:
  - "Iris", market researcher (research reaching a scope);
  - "Sol", division lead (a new division);
  - "Theo", software engineer;
  - "Nadia", QA engineer;
  - "Ravi", operations engineer (a recurring job).
- **Level:** Core. **Learn first:** BLD-01; hiring and the workforce (another reader's area).
- **What you learn:** the workforce is hired as needs appear: at once within budget, or waiting for you.
- **Steps:**
  1. Within budget, with no hire checkpoint: "Endgame · Hired {Name}": "{Name} joins as a {role}, at up to {n} credits a month: {reason}" ("an" before a role that starts with a vowel: "joins as an operations engineer").
  2. Otherwise: "Endgame · {Name} is proposed": "…It waits for you; the work goes ahead meanwhile." The home page shows **"Hire proposed"**, which leads to `/hires/{id}` (another reader's area).
- **You know it worked when:** the employee appears on the org chart, or the proposal waits under Hiring.
- **Variations and refusals:**
  - A failed raise: "Endgame · A hire could not be raised" / "…The work goes ahead without one."
  - The work never stops for a hire; it is unattributed until the hire is accepted.
  - The start screen says how hires happen at the place chosen: in auto-mode "hired as they are needed, inside the budget"; with the hire checkpoint on, "proposed with a cost, and waits for you" (IDEA-02).
- **Where:** `Workforce.HireAsync`; `HireService` (auto-accept); `POST /internal/hires`.
- **Reachable from:** UI for deciding (another reader); MCP `hire_decide`.
- **Covered by tests:** `WorkflowTests.A_new_division_and_a_recurring_job_raise_their_hires…`; `WorkforceTests.A_need_within_budget_is_hired_at_once…`, `…Over_budget_or_at_a_hire_checkpoint…`.

### BLD-03 Read the plan: what you asked for, what was left out and why
- **Who:** Viewer or above.
- **Starts at:** the build run's **"The plan"** panel.
- **Needs:** a plan proposed.
- **Level:** Core. **Learn first:** BLD-01.
- **What you learn:** the plan is a contract: every requirement is covered or left out with a reason.
- **Steps:**
  1. The panel shows the badge "Proposed", then "Agreed", and "{done} of {n} parts done".
  2. The summary.
  3. **"What you asked for"**: the requirements in your words. On a change to an app, the parts it already had are listed apart, under **"What it already did, checked again"**.
  4. **"Parts of the plan"**: each with "To do", "Passed its check" or "Sent back", and a plain outcome line. In technical mode: the id, detail, "Covers …", "Check: …" and evidence.
  5. **"Left out, on purpose"**: each requirement with its reason.
  6. Technical mode shows the files, tests and check behind each part; a part the planner wrote no plain words for says "The files and tests behind each part are in technical mode."
  7. "The builder · The plan" message: "{summary}. {n} parts, each built, then checked in the running app against what you asked for. All {n} things the idea asks for are covered." (or "Left out: … because …").
- **You know it worked when:** the badge reads "Agreed".
- **Variations and refusals:**
  - A plan that never validates fails the run (RUN-11).
  - **The plan cannot be edited by a person.** There is only approve or reject, and only with the checkpoint on (BLD-04).
- **Where:** `RunView.tsx` `PlanPanel`; `BuildWorkflow` (planner, `plan.accepted`).
- **Reachable from:** UI.
- **Covered by tests:** `RunView.test.tsx` ("shows each plan item in plain words…"); `WorkflowTests.Build_places_plans_builds…`.

### BLD-04 Approve or reject the plan
- **Who:** Builder.
- **Starts at:** the approval card "Accept this plan?" on the build run.
- **Needs:** autonomy `checkpoints` and "Before the plan is carried out" on.
- **Level:** Advanced. **Learn first:** BLD-03, RUN-07.
- **What you learn:** with the plan checkpoint on, nothing is built until you agree the plan.
- **Steps:**
  1. Read the plan (the card's detail in technical mode, and the plan panel).
  2. Press **"Approve"**: the plan becomes "Agreed" and building begins.
  3. Press **"Decline"** (optionally with a note): the card says "Declined. It was not done, so the work has stopped." and the run fails with "You declined the plan, so nothing was built. Your note: “…” “Try again” plans it afresh."
- **You know it worked when:** after approving, the badge reads "Agreed".
- **Variations and refusals:** after a decline, **"Try again"** on the run or the idea page plans afresh (CHG-03). A change's plan asks "Accept this plan for the change?".
- **Where:** `BuildWorkflow` (`Checkpoint(run,"plan")`).
- **Reachable from:** UI; MCP.
- **Covered by tests:** `WorkflowTests.A_declined_plan_says_so_and_a_try_again_plans_afresh`.

### BLD-05 See the build re-estimated from the plan
- **Who:** nobody acts.
- **Starts at:** a build run after the plan is agreed.
- **Needs:** a plan.
- **Level:** Advanced. **Learn first:** BLD-03, RUN-13.
- **What you learn:** the estimate is refined once the plan's size is known.
- **Steps:**
  1. The step "Estimated the cost again, from the plan" appears with its credits.
  2. Over budget, the run pauses (RUN-09), in auto-mode and checkpoints mode alike.
- **You know it worked when:** the "Estimate" figure updates.
- **Variations and refusals:** none: the budget holds in every mode.
- **Where:** `BuildWorkflow`, `Estimator.EstimateAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.Before_any_history_a_build_is_estimated…`, `…A_plans_estimate_grows…`, `…A_plan_whose_estimate_would_break_the_budget_waits_for_budget_in_every_autonomy_mode`.

### BLD-06 Follow the build, one part at a time
- **Who:** Viewer or above.
- **Starts at:** a build run.
- **Needs:** an agreed plan.
- **Level:** Core. **Learn first:** BLD-03.
- **What you learn:** each part is built, committed and checked before the next one starts.
- **Steps:**
  1. For each part, the group "Built: {part}" (or "Built part {n} of {m} of the plan") shows activity such as "Changed 3 files · Ran the tests — … passed".
  2. A task "In progress" moves to "Done".
  3. Progress is recorded in the app's history.
- **You know it worked when:** the part's badge in the plan reads "Passed its check".
- **Variations and refusals:** a refused action shows "An action was refused by your rules".
- **Where:** `BuildWorkflow.BuildItemAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.Build_places_plans_builds…`.

### BLD-07 See each part checked in the running app
- **Who:** Viewer or above.
- **Starts at:** a build run, the group "Checked: {part}".
- **Needs:** a built part.
- **Level:** Core. **Learn first:** BLD-06.
- **What you learn:** a separate checker proves each requirement in a private preview with its own data.
- **Steps:**
  1. The step "Checked and passed: {part}" reads "Checked and working: {part} ({x} of {y} of your requirements shown working in the running app).", or the step "Checked and failed: {part}" reads "Sent back for repair, at no charge: …".
  2. The preview and its test data are destroyed afterwards. Any e-mail the preview sent was held, never delivered (KIT-12): a check never reaches a real inbox.
- **You know it worked when:** "Checked and passed".
- **Variations and refusals:**
  - An image that does not build is a failed check.
  - No signed-in caller, or no verdict from the evaluator, means a failed check.
  - Code fails the part unless every requirement has evidence from a real call and every promised test id is present.
- **Where:** `BuildWorkflow.EvaluateAsync`, `EvaluationGate.cs`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.The_evaluator_works_on_a_preview…`.

### BLD-08 See a failed part repaired, free, on a stronger model
- **Who:** Viewer or above.
- **Starts at:** a build run.
- **Needs:** a failed check.
- **Level:** Core. **Learn first:** BLD-07.
- **What you learn:** fixing the agent's own mistake is never billed, and each retry uses a stronger model.
- **Steps:**
  1. "Rebuilt after a check: {part}" runs one tier up (build, build-t1, build-t2, build-t3).
  2. Then "Checked: …" runs again.
  3. At most 3 repair rounds.
- **You know it worked when:** "Checked and passed" follows a "Sent back".
- **Variations and refusals:** still failing after 3 rounds, the run fails and the app is not published (RUN-11). The fault is kept as a "lesson" in the engineer's memory.
- **Where:** `BuildItemAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.A_failed_evaluation_is_repaired_not_billed…`, `…Repair_rounds_are_capped…`.

### BLD-09 See the security review, and its one free fix
- **Who:** Viewer or above.
- **Starts at:** a build run.
- **Needs:** every part passed.
- **Level:** Core. **Learn first:** BLD-07.
- **What you learn:** a security finding blocks publishing.
- **Steps:**
  1. The group "Reviewed the app for misuse of the platform" runs.
  2. "Security review · Security review passed" ("…found nothing that blocks publishing.") or "Security review found problems" ("…they are being fixed now, at no charge.").
  3. On findings: "Fixed what the security review found, at no charge", then "Reviewed the fixes".
- **You know it worked when:** "Security review passed".
- **Variations and refusals:** still failing: "The security review still found {n} problems after the fix, so the app is not published." and the run fails.
- **Where:** `BuildWorkflow.ReviewAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.A_security_finding_blocks_publishing_after_one_repair`, `…The_security_review_is_the_reviewers_work…`.

### BLD-10 See the app published privately
- **Who:** Viewer or above.
- **Starts at:** a build run.
- **Needs:** the review passed.
- **Level:** Foundation. **Learn first:** BLD-09.
- **What you learn:** a new app runs privately; only a person can make it public.
- **Steps:**
  1. "The builder · Running privately": "{name} is built and running privately. Only you and the people you choose can open it until you make it public."
  2. "Finished".
  3. The app appears on the org chart. Opening and sharing it belong to another reader's area.
- **You know it worked when:** the badge reads "Finished" and the app row appears on the org chart.
- **Variations and refusals:** if it cannot start: "{name} is built and its work is saved, but it could not be started: …", and the run fails.
- **Where:** `BuildWorkflow.PublishAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.Build_places_plans_builds…`; `factory.spec.ts` steps 3 and 4.

### BLD-11 See an operations hire for a recurring job
- **Who:** nobody acts.
- **Starts at:** the end of a build.
- **Needs:** an app that declares a schedule.
- **Level:** Advanced. **Learn first:** BLD-10, BLD-02.
- **What you learn:** recurring work brings its own watcher.
- **Steps:** "Ravi", operations engineer, is hired or proposed as in BLD-02.
- **You know it worked when:** "Hired Ravi" (or "Ravi is proposed").
- **Variations and refusals:** none.
- **Where:** `BuildWorkflow.RecurringJobsAsync`.
- **Reachable from:** internal.
- **Covered by tests:** `WorkflowTests.A_new_division_and_a_recurring_job_raise_their_hires…`.

### BLD-12 Design (icons and brand assets): not present
- **Who:** not applicable. **Starts at:** not applicable. **Needs:** not applicable.
- **Level:** not applicable. **Learn first:** not applicable. **What you learn:** not applicable. **You know it worked when:** not applicable.
- **Steps:** none. The spec's design stage has no separate stage in code, and the start screen says so: its step reads "Build, check, review". The build goes placement → plan → build → evaluate → review → publish.
- **Variations and refusals:** not applicable.
- **Where:** `BuildWorkflow.cs` (no design stage).
- **Reachable from:** nowhere.
- **Covered by tests:** none found.

## Autonomy and rule sets (AUTO)

### AUTO-01 Read the autonomy in effect at a level
- **Who:** Viewer or above.
- **Starts at:** the home page's **"Autonomy for {node}"**, which opens `/autonomy?scope=…`.
- **Needs:** an organisation.
- **Level:** Core. **Learn first:** IDEA-02.
- **What you learn:** a setting made higher up holds for everything beneath it, and each value says where it was set.
- **Steps:**
  1. The heading reads "How much {name} does on its own", with "Set once for the organisation, narrowed for a division, project or app. The credit budget is the limit that is always on."
  2. Pick a level under **"Level"** (indented with "— ").
  3. Each value says "Set here", "Inherited from {name}", "Not set anywhere: auto-mode by default" or "Not set anywhere: off".
  4. The side panel: "One rule, used everywhere", and "What never changes": "The credit budget is always on.", "No one may make an app public but a person.", "Nothing is built over a red line.", "Repairing its own mistake is never billed."
- **You know it worked when:** the origin labels show.
- **Variations and refusals:** non-admins see "You can read these. An Admin or the Owner sets them." and disabled controls. Loading and failure: "The autonomy settings could not be loaded".
- **Where:** `features/autonomy/AutonomyView.tsx`; `GET /api/autonomy`.
- **Reachable from:** UI; MCP `autonomy_get` (returns raw settings, not the same view).
- **Covered by tests:** `AutonomyView.test.tsx` ("shows each value with the level that set it…", "a Viewer reads but cannot change").

### AUTO-02 Switch between auto-mode and checkpoints
- **Who:** Admin or Owner.
- **Starts at:** `/autonomy`, **"How it works"**.
- **Needs:** Admin.
- **Level:** Core. **Learn first:** AUTO-01.
- **What you learn:** auto-mode runs the whole lifecycle; checkpoints stop it where you choose.
- **Steps:**
  1. Choose **"Auto-mode"** ("The workforce runs the whole lifecycle on its own, inside the budget. A verdict of “do not build” still waits for you.") or **"Checkpoints"** ("The workforce stops for your sign-off at the checkpoints you switch on below.").
  2. It changes at once.
- **You know it worked when:** the choice is outlined and "Set here" shows.
- **What it changes:**
  - **Checkpoints mode:** no auto-build after a verdict (VERD-11); the three checkpoints take effect. The budget pause at the start and the plan holds in both modes (IDEA-04, BLD-05).
  - **Auto-mode:** auto-build on build and change verdicts.
- **Variations and refusals:** refused: "Not changed: {reason}" and the change is rolled back.
- **Where:** `PUT /api/autonomy`.
- **Reachable from:** UI; MCP `autonomy_set`; the conversation (AUTO-07).
- **Covered by tests:** `AutonomyView.test.tsx`.

### AUTO-03 Turn a checkpoint on or off
- **Who:** Admin.
- **Starts at:** `/autonomy`, **"Checkpoints"**.
- **Needs:** Admin.
- **Level:** Core. **Learn first:** AUTO-02.
- **What you learn:** checkpoints only stop work in checkpoints mode.
- **Steps:**
  1. Toggle one of:
     - **"Before work starts"** ("Wait for your word once the estimate is known."), see RUN-08;
     - **"Before the plan is carried out"** ("Show you the plan and wait for you to agree it."), see BLD-04;
     - **"Before anyone is hired"** ("Every hire waits for you, even inside the budget."), see BLD-02.
  2. In auto-mode the page notes "Checkpoints stop work only in checkpoints mode. They are kept for when you switch."
- **You know it worked when:** the switch shows On and "Set here".
- **Variations and refusals:** refused: "Not changed: …".
- **Where:** `PUT /api/autonomy {checkpoints}`.
- **Reachable from:** UI; MCP; the conversation.
- **Covered by tests:** `AutonomyView.test.tsx` ("switches a checkpoint at once, and back with the reason when refused"); `EstimateTests.With_a_start_checkpoint…`.

### AUTO-04 Go back to the inherited setting
- **Who:** Admin.
- **Starts at:** **"Use the inherited setting"**, shown beside a value set at this level.
- **Needs:** a value set here.
- **Level:** Core. **Learn first:** AUTO-02.
- **What you learn:** removing a setting lets the one from above apply again.
- **Steps:**
  1. Press **"Use the inherited setting"**.
  2. The origin changes to "Inherited from …" or "Not set anywhere…".
- **You know it worked when:** "Set here" disappears.
- **Variations and refusals:** refused: "Not changed: …".
- **Where:** `DELETE /api/autonomy?key=`.
- **Reachable from:** UI; MCP `cascade_remove`.
- **Covered by tests:** `AutonomyView.test.tsx`.

### AUTO-05 Set rules for a stage
- **Who:** Admin.
- **Starts at:** `/autonomy`, **"Rules for each stage"**. The cards are: "Every stage", "Research", "Planning", "Building", "Checking the work", "Security review", "The conversation".
- **Needs:** Admin.
- **Level:** Advanced. **Learn first:** AUTO-01.
- **What you learn:** a stage's own rules add to those for every stage, and the nearest level's rules win.
- **Steps:**
  1. Press **"Set rules here"**, or **"Change"** if rules are already set here.
  2. In each of the lists **"May not"**, **"Asks you first"** and **"May do"**:
     - in normal mode, pick a tool from **"Choose…"** and press **"Add"**;
     - in technical mode, type `tool` or `tool(pattern)` (placeholder "tool or tool(pattern)") and press **"Add"** or Enter;
     - remove a rule with the × chip.
  3. Press **"Save for {level}"**, or **"Cancel"**.
- **You know it worked when:** the card shows your rules and "Set here". Overriding a higher level shows "Replaces the rules set at …".
- **What it changes:** every agent's permission check at that stage. "May not" is refused whatever else applies. "May do" is allowed.
- **Variations and refusals:**
  - Refused: "The rules were not saved: {reason} They are as they were." (400 for a malformed rule or stage).
  - **"Asks you first" asks.** A matching call raises an approval (RUN-07) and the work waits for your answer, even though nobody watches the run; declined, the step is not taken and the work goes on without it. **"Search the web"** (`web_search`) is the AI model's own ability, and the same rules hold for it: under "May not" it is not offered at all, and under "Asks you first" each step asks once before its first search and works without searching if declined. The rule set's separate `checkpoints` list is kept as it was ("Also stops for you at: …") and is API/MCP only.
  - Empty list labels: "Nothing extra is refused", "Nothing waits for you", "Only what the job allows".
- **Where:** `AutonomyView.tsx` `StageRules`; `PUT /api/autonomy/rule-sets`; `PermissionPolicy.Decide`.
- **Reachable from:** UI (deny, ask, allow); API/MCP `rule_set_set` (adds `checkpoints`).
- **Covered by tests:** `AutonomyView.test.tsx` ("sets a stage's rules here and removes them again", "technical mode shows the rules as the harness reads them"); `PermissionTests` (all, including `An_asks_you_first_rule_raises_an_approval_even_unattended_and_a_decline_carries_the_note`).

### AUTO-06 Remove the rules set here
- **Who:** Admin.
- **Starts at:** **"Remove here"** on a stage card.
- **Needs:** rules set at this level.
- **Level:** Advanced. **Learn first:** AUTO-05.
- **What you learn:** removing rules lets the inherited ones apply again.
- **Steps:**
  1. Press **"Remove here"**. There is no confirmation.
  2. The card shows the inherited rules or "No rules set for this stage".
- **You know it worked when:** "Set here" disappears.
- **Variations and refusals:** refused: "Not removed: …"; 404 if nothing is set.
- **Where:** `DELETE /api/autonomy/rule-sets`.
- **Reachable from:** UI; MCP `cascade_remove`.
- **Covered by tests:** `AutonomyView.test.tsx`.

### AUTO-07 Change autonomy by asking the conversation
- **Who:** Builder (the conversation needs Builder) who approves the change.
- **Starts at:** the docked conversation.
- **Needs:** none.
- **Level:** Advanced. **Learn first:** IDEA-05, AUTO-02.
- **What you learn:** an agent may change only a short list of settings, and only on your word.
- **Steps:**
  1. Ask for the change, for example "turn on the plan checkpoint here".
  2. The approval appears in the conversation itself, titled with what will change, for example "Turn on the “Before the plan is carried out” checkpoint here?" (TALK-17). Approve it.
  3. The setting is written as made by an agent.
- **You know it worked when:** the autonomy page shows the value "Set here".
- **Variations and refusals:**
  - Only `autonomy`, the three checkpoints, `sleep.*` and `workforce.idle_days` can be changed. Anything else gives 403 `setting_not_allowed`.
  - **A Builder can change autonomy this way although the autonomy page requires Admin** (`PUT /internal/cascade` checks no person role).
- **Where:** `AdjustSettingTool`; `PUT /internal/cascade`.
- **Reachable from:** UI (conversation); MCP `conversation_post`.
- **Covered by tests:** `RunnerContractTests…changes_only_the_settings_an_agent_may` (per UC-114).

## Changing an app after it is built (CHG)

### CHG-01 Ask for a change to an app from its page
- **Who:** Builder at the app.
- **Starts at:** the app page `/apps/{id}`, the panel **"Change {app}"** (`features/apps/ChangeRequest.tsx`, mounted by the app page).
- **Needs:** an app that has been built and published, with no other build or change of it under way.
- **Level:** Core. **Learn first:** BLD-10.
- **What you learn:** a change goes through the same stages as a build — but research is not repeated — and what the app already does is checked again before the new version goes out.
- **Steps:**
  1. The panel reads "Describe the change in your own words. It is checked against FrostAura’s red lines, planned from your words, built and checked part by part in a private preview, and everything {app} does now is checked again before the new version is published. Who may open it does not change."
  2. Type into **"What should change?"** and press **"See what it costs"** ("Working it out…").
  3. Read **"Estimated {credits}"** and the basis. Press **"Make this change"** ("Starting…") or **"Not now"**. Editing the text throws the estimate away.
  4. You are taken to the change's run, titled "Change: {first line}" (RUN-01).
  5. On the run: the request is screened against the red lines; "The builder · The plan" lists what the change asks for, quoted, and a last part **"Everything the app did before still works"**; each part is built and "Checked: …" in a private preview; the old parts are checked again with nothing built first; then the security review (BLD-09).
  6. "The builder · New version running": "The new version of {app} is running, with the change and everything it did before checked in the running app. Who may open it has not changed. Its history shows the change."
- **You know it worked when:** the run reads "Finished", and the app's history (CHG-04) shows the change's versions by the employee who made them, the newest live.
- **Variations and refusals:**
  - Never built: 409 "This app has not been built yet". Another build or change under way: 409 "This app is already being worked on". The panel says "The change was not started: {reason}".
  - An employee who works on the app is paused: 409 "{Name}, who works on this app, is paused, so no new work is started for them. Resume them first."
  - A request that crosses a red line: the run stops with "This change crosses a red line ({line}). FrostAura never builds it, and no one can overrule that, so nothing was changed."
  - Something that worked before is broken by the change: "Sent back for repair, at no charge: Everything the app did before still works…", repaired one tier up, at most 3 rounds; still broken, the run stops and the app keeps running its previous version.
  - With the plan checkpoint on, "Accept this plan for the change?" waits for you (BLD-04).
  - A change that stopped can be tried again (CHG-03).
- **Where:** `ChangeRequest.tsx`; `POST /api/apps/{id}/changes/estimate`, `POST /api/apps/{id}/changes` (WorkEndpoints); `ChangeService`; `TaskWorkflow` → `BuildWorkflow.ChangeAsync`; `Prompts/change-screen.md`.
- **Reachable from:** UI; MCP `app_change_estimate`, `app_change`; the conversation (CHG-02).
- **Covered by tests:** `WorkflowTests.A_change_is_screened_planned_from_the_request_built_checked_with_what_worked_before_reviewed_and_republished`, `…A_change_that_breaks_what_worked_before_is_repaired_unbilled_before_it_is_published`, `…A_change_over_a_red_line_changes_nothing`; `TryAgainAndChangesTests.A_built_app_is_changed_by_a_run_that_shows_its_estimate_first_and_one_change_at_a_time`; `TryAgainAndChanges.test.tsx` ("changing a built app").

### CHG-02 Ask the conversation to change an app
- **Who:** Builder.
- **Starts at:** the conversation about an app (TALK-04), or any conversation, naming the app.
- **Needs:** a built app inside the conversation's part of the tree.
- **Level:** Core. **Learn first:** CHG-01, TALK-07.
- **What you learn:** the conversation asks for the change on your word, and the change then runs as in CHG-01.
- **Steps:**
  1. Describe the change, for example "Let members reset a counter back to zero."
  2. The assistant calls `change_app`. In the conversation a card asks **"Change {app name}: {your words}?"** with **"Approve"** / **"Decline"** and **"Add a note (optional)"** (TALK-17).
  3. Approve. The change's run starts with its estimate first; the assistant replies that it has started.
- **You know it worked when:** a "Change: …" run appears and the reply says so.
- **Variations and refusals:** declined: "Declined. It was not done; the work continues without it." and the assistant says it was not done. An app outside the conversation's scope is refused by the tool. The refusals of CHG-01 come back as "The change could not be started (409): …".
- **Where:** `RunnerTools.ChangeAppTool`; `POST /internal/apps/changes`; `ConversationWorkflow`.
- **Reachable from:** UI (conversation); MCP `conversation_post`.
- **Covered by tests:** `WorkflowTests.The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully`; `TryAgainAndChangesTests` (the internal change).

### CHG-03 Try again after a failed, cancelled, budget-stopped or declined build
- **Who:** Builder.
- **Starts at:** the stopped run's page, or the idea page under "You chose to build it…".
- **Needs:** the idea's latest build (or a change's run) that failed, was cancelled, stopped for budget or had its plan declined.
- **Level:** Core. **Learn first:** RUN-11.
- **What you learn:** trying again carries on from where the work stopped: what was placed, agreed and finished is kept, not rebuilt or charged again.
- **Steps:**
  1. The panel says why it stopped: "This work stopped before it finished. What was finished is kept.", "This work was cancelled. What was finished is kept.", "The credit budget ran out, so this work stopped. What was finished is kept, and nothing more was charged." (with **"See credits"**) or "The plan was declined, so nothing was built."
  2. Press **"Try again"** ("Working it out…"). It reads, for example, "1 of its 2 parts are already built and checked; they are kept, not built or charged again." (or "The plan agreed before is kept, and all {n} of its parts are built." / "It is planned afresh, then built part by part."), **"Estimated {credits}"** — priced for what is left — and the basis.
  3. Press **"Start it again"** ("Starting…") or **"Not now"**. You are taken to the new run.
  4. The new run says "Endgame · Carrying on": "This picks up where the earlier attempt stopped: {n} of {m} parts were already built and checked, so they are kept, not rebuilt or charged again." The plan shows those parts as "Built and checked in the earlier attempt; kept, not built or charged again."
- **You know it worked when:** the new run finishes; the idea's "Watch the work that followed" now opens it.
- **Variations and refusals:** a declined plan is planned afresh; a part that failed is built again with fresh repair rounds; only the latest attempt can be tried, once (409); work that has not stopped is "409 not_retryable". While an employee on the project is paused, a build or change is not started again: "It was not started again: {Name}, who works on this app, is paused…".
- **Where:** `runs/TryAgain.tsx`, `RunView.tsx` `StoppedPanel`, `VerdictView.tsx`; `POST /api/runs/{id}/retry/estimate`, `POST /api/runs/{id}/retry`; `RetryService`, `IdeaService.RetryBuildAsync`, `FactoryEstimates`; `BuildWorkflow.CarryOverAsync`.
- **Reachable from:** UI; MCP `run_retry_estimate`, `run_retry`; the conversation (`try_again`, TALK-18).
- **Covered by tests:** `WorkflowTests.A_build_tried_again_keeps_its_placement_plan_and_finished_parts_and_builds_only_the_rest`, `…A_declined_plan_says_so_and_a_try_again_plans_afresh`; `TryAgainAndChangesTests.A_stopped_build_is_built_again_priced_for_what_is_left_and_carrying_on_from_the_earlier_attempt`; `TryAgainAndChanges.test.tsx`.

### CHG-04 Restore an earlier version
- **Who:** Builder (another reader covers the details).
- **Starts at:** the app page's history.
- **Needs:** an app with versions.
- **Level:** Core. **Learn first:** BLD-10.
- **What you learn:** going back is a person's change too; a change by the factory (CHG-01) appears in the same history.
- **Steps:** see the other reader's entry (`POST /api/apps/{id}/versions/{commit}/restore`; a public app becomes private).
- **You know it worked when:** see the other reader's entry.
- **Variations and refusals:** see the other reader's entry.
- **Where:** BreadthEndpoints.
- **Reachable from:** UI; MCP `app_restore`.
- **Covered by tests:** `breadth.spec.ts` ("history names who made each version…"); `VersionsAndExportTests`.

### CHG-05 Give an employee a task on an app (internal only)
- **Who:** not reachable by a person; a person's change is CHG-01.
- **Starts at:** `POST /internal/runs {kind:"task", scope: app}` (service token only), with an owner message that is not a change.
- **Needs:** an app scope.
- **Level:** Developer. **Learn first:** CHG-01.
- **What you learn:** the Runner keeps a plain task for internal work; anything a person asks for goes through CHG-01's stages.
- **Steps:** a builder agent works in the app's workspace on the request and commits; nothing is published.
- **You know it worked when:** a commit lands in the app's history.
- **Variations and refusals:** an owner message with `kind: change` makes it a change (CHG-01).
- **Where:** `Endgame.Runner/Workflows/TaskWorkflow.cs`; `InternalEndpoints` `POST /internal/runs`.
- **Reachable from:** internal/test only.
- **Covered by tests:** `RunnerIntegrationTests`, `RunnerContractTests`.

### CHG-06 Change how an app runs or who may open it
This is another reader's area (app settings, sharing, going public): `POST /api/apps/{id}/settings`. Listed only so this section is complete.

---

## Gaps and oddities found
1. **Fixed on 2026-11-25 (lane C):** changing a built app (CHG-01, CHG-02); trying again (CHG-03, VERD-12, RUN-10, RUN-11); the second verdict's buttons and the agreed change reaching the build (VERD-06, VERD-07, VERD-11); "Asks you first" asking (AUTO-05); "The work carries on from here." after a decline (RUN-07); the run page's not-charged amount and budget stop (RUN-10, RUN-13); MCP suggestion dismiss and estimate.
2. ~~The checkpoints mode skips the budget pause~~ — fixed: the budget pause at the start and at the plan holds in every mode (IDEA-04, BLD-05).
3. ~~The console cannot target a division~~ — fixed (IDEA-02): the start screen chooses the organisation or a division.
4. ~~The estimate shown can differ from the one recorded~~ — fixed: both name the same place (IDEA-02).
5. ~~Some start-screen copy is untrue in auto-mode~~ — fixed: the steps follow the autonomy at the place chosen (IDEA-02).
6. **Some fields are written but never shown.** "Change it: {label}", "Estimated {n}" under "What would change the verdict", and the method rows "Argued" and "Briefed" never render, because the Runner does not write those fields.
7. **Endpoints or tools with no screen.** The `reason` on pause and cancel, constraints on taking a suggestion, and rule-set checkpoints have no screen. The internal `POST /internal/runs` for task runs is only used by tests.
8. **Doc mismatches.** The spec's design stage (icons, brand assets) does not exist (BLD-12). The spec says a person can "step in and change anything at any point"; a person can pause, cancel, approve or decline with a note, try again, or ask for a change, but cannot edit a plan or a placement.
9. **Smaller permission and refusal oddities.**
    - The conversation lets a Builder change autonomy and checkpoints, which the autonomy page reserves for Admins (AUTO-07).
    - ~~A Viewer sees the full form and is refused only on submit~~ — fixed (IDEA-02); the home screen's "New idea" button is still shown to a Viewer.
    - An auto-mode decision other than "build" returns 403, while UC-104 lists every auto-mode refusal as 409.
10. **A change's check of what worked before reads the progress file.** Parts built before the progress file existed, or by hand, are not re-checked by name; the evaluator still runs the app's own tests.
