# ARCH-006 — The harness

Endgame's own agent loop. These rules come from a benchmark run on 2026-11-24: a throwaway .NET
loop with six tools built real features in a small .NET and React app, inside a workspace
container, across eight model configurations, three repeats each, with hidden acceptance checks.
US$4.56 was spent across 144 runs. The harness is built to these rules; the spike's code is not reused.

## The answer

**Our own loop works, on cheap models.** The cheapest tier that passed every hidden check on all
six tasks, three times each, cost about two-thirds of a cent per task.

| Configuration | Passed | Cost per task | Notes |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | 18 of 18 | $0.0065 | Cheapest reliable tier. |
| `qwen/qwen3.7-plus` | 18 of 18 | $0.0106 | |
| `z-ai/glm-5.2` | 18 of 18 | $0.0252 | |
| `anthropic/claude-sonnet-5.5` | 18 of 18 | $0.0630 | Half the steps of the cheap tiers. |
| `typesafe/jev-router` | 17 of 18 | $0.1059 | Dearest of all; routed to frontier models. |
| `qwen/qwen3.7-flash` | 15 of 18 | $0.0023 | Misses exact wording and the hardest task. |
| `mistralai/mistral-small-3.2-24b-instruct` | 2 of 18 | $0.034 | Breaks the edit tool with wrong line endings. |
| `meta-llama/llama-3.1-8b-instruct` | 0 of 18 | $0.003 | Hundreds of tool calls per turn; edits nothing. |

**The task set was too easy to separate the four passing tiers.** Treat "the cheapest tier is
enough" as true for small, well-specified changes only. The real harness therefore escalates:
build on the cheap tier, and move a piece of work up a tier when its evaluation fails.

**The Jev router cost seventeen times the cheapest tier for a slightly worse result.** Endgame
routes by task type itself (`ARCH-003`).

## Tools

| Rule | Why |
| --- | --- |
| `edit_file(path, old_string, new_string, replace_all)` — exact match, exactly once unless `replace_all`, all or nothing. | Under 1.5% failed edits on every capable model. |
| A failed edit says why and what to do: not found (and whether it matches with whitespace ignored, quoting the file's real text); not unique (how many times, on which lines); a pasted line-number prefix; identical old and new; empty old string (use write). | These messages are what made cheap models recover. |
| **Normalise line endings to the file's own before matching.** | One model sent Windows line endings and failed 179 edits. |
| `read_file` shows line numbers, says they are not part of the file, and pages with a footer naming the next offset. | |
| File contents cross the container boundary as base64. | Line-by-line reads change newlines and break exact matching. |
| Tool output keeps the head and the tail (a third and two thirds), with colour codes switched off. | Errors come at the end. |
| A path outside the workspace root gets an error that names the fix. | Weak models often write root-relative paths. |
| Shell commands are bounded by the container, not by path. | The container is the boundary; nothing else is mounted writable. |

## The loop

- **Cap tool calls per turn** and switch parallel calls off where the model allows it.
- **Detect a repeated identical failing call and stop early.**
- Malformed calls: arguments may arrive as a string, an object or empty; a parse error goes back as
  a tool result; an unknown tool gets the list of real ones; a tool call written as plain text gets
  a corrective nudge, at most three times.
- **A stop hook:** if the agent stops having edited since its last build or test, remind it once to
  verify.
- Limits that were ample: 50 steps and 16,000 output tokens. Hitting the step limit was always a
  weak model looping.
- Retry only rate limits, server errors, timeouts and empty replies. Never retry a bad request or a
  refused payment.
- **"Could not reach a model" is not "answered in the wrong form".** A call that no model answered — no provider
  configured (`model_provider_unconfigured`, `ModelFailure.Unavailable`, not retried), the provider refusing the
  platform's key (502 with `upstreamStatus` 401/402/403, also `Unavailable`), or server errors, timeouts, rate limits and
  refusals once the retries are spent — stops the agent as `model_unreachable` (`AgentResult.Unreachable`), never
  `model_error`. Workflows stop the run there with a plain outcome and run no correction rounds; what the gateway said
  goes into `run.finished`'s `detail`, never its `summary`, which normal mode shows.
- **Reading a refusal never fails.** Every body from another service is read with `Json.ParseTolerant` /
  `ProblemBody.Read`: empty, non-JSON, non-object and duplicate-key bodies (the lease refusal carries `status` twice: the
  problem's number and the run's status) all give a usable `ServiceProblemException`, with the run's status in
  `RunStatus`. A lease refused because the run has finished is the normal end, not a fault; the lease keeper retries
  anything else until the lease would lapse and never takes the run down.
- **Progress during a long step.** An agent with `ProgressReports` (the planner, builders, evaluators) writes a plain
  message every eight actions — what it did since the last one, counted from its real calls, never a file name — so the
  owner's timeline moves during a five-minute plan.
- **Send only the parameters a model lists as supported.** A parameter it lacks makes the call fail.
- Return the assistant's message to the model exactly as it came, reasoning details included.
- **Pin the provider order for a run.** Calls otherwise spread across providers, which weakens
  caching and varies tool-call behaviour. Mark the system message and the newest message for
  caching on the models that need it explicit.

## Sub-agents, memory and the owner's view (as built)

- **Parallel where independent.** A turn of two or more `spawn` calls whose sub-agents only read (the default read-only tool
  set), within the fan-out cap, runs them at once: every call is requested first, they work concurrently, and their results
  enter the conversation in call order, so replay is unchanged. Anything that writes runs one at a time.
- **Builders stay sequential — decided, not deferred by accident.** Parallel builders would each need a workspace of their own
  (Dock holds one per run), a merge by commit order with the checks re-run after each merge, and a resolution when two items
  touch the same file — and the plans the factory makes are three to six items of one app whose later items use the earlier
  ones' entities and endpoints (back end before the screens that use it), so few are independent. The gain is minutes on a
  build that is already short (16–28 minutes live), against a new failure mode in the most expensive stage. The factory's
  builders therefore work one plan item per session, in plan order; this is revisited when plans with genuinely independent
  items are common.
- **Memory is context.** An employee's curated memory follows its rules, framed as notes that never outrank them; `remember`
  keeps a note. A contractor keeps none: what it learned goes to its briefer.
- **Search budgets.** `AgentLimits.MaxSearchesPerCall` is sent as the call's `limits.maxSearches`; the reply's `searches` and
  url citations are counted into the agent's state (and replayed from `accounting`). A researcher has none (0) unless its
  workflow gives it a budget.
- **Web search is permission-checked like a tool.** It is the route's own capability, not a tool call, so before a session's
  first model call the loop asks the policy about `web_search` (read-only, the agent's stage). Allowed: nothing is logged.
  "May not": `tool.denied` (call id `capability:web_search`), the session's calls carry `maxSearches: 0`, and a nudge tells
  the model it may not search. "Asks you first": one approval for the step ("Let this step search the web: {title}?",
  `continues`); declined, the same as "may not". The decision is replayed from its event, so a resumed session never asks
  again.
- **Bookkeeping is not for people.** The loop's own `message` events carry a `kind` and no `text` (`reply`, `detail`,
  `nudge`, `note` instead); sub-agent events carry a `title`, a plain `brief` and a one-sentence `summary`, the raw report in
  `report` (ARCH-004, *Run log*).

## The workspace

One fresh container per run: no network, no capabilities, no new privileges, not root, no socket,
limits on CPU, memory and processes. Its image has packages pre-restored, so build, test and
migrations work offline and a run starts in about a third of a second. Files are written through
the container as the agent's own user. A baseline commit is made first so the run's diff is exact.

## Checking the work

Acceptance checks the agent cannot see or edit, run after it finishes: tests it could have gamed
are restored first; then build, tests, front-end build and tests. Each check must fail on the
untouched starting state. The production evaluator keeps this shape and adds the running app.

**The plan is a faithful contract with the idea.** A live run passed a reading-list app that had no "what everyone is
reading now" view, because nothing tied the plan to the idea's words and the evaluator judged by tests and a signed-out
probe. Now (`PlanContract.Faults(idea)`, `ProposePlanTool(idea)`, `EvaluationGate`):

| Rule | Enforced by |
| --- | --- |
| The planner lists every requirement of the idea, each quoted in the idea's own words (at least 60 % of its meaningful words appear in the idea). | `propose_plan` refuses, naming the requirement. |
| Every requirement is covered by an item, or listed in `leftOut` with a reason the owner reads; every item covers at least one requirement. | `propose_plan` refuses with every fault; the planner corrects and sends it again. The build announces what was left out and why. |
| Item text and the summary are plain words; files and endpoints go in `detail`. | `propose_plan` refuses (`OwnerText`). |
| The evaluator shows each requirement its item covers working in the **running** app, signed in as a test member (`call_app`: a session from `POST /internal/apps/{id}/test-session`, the call through Edge's `/internal/apps/{id}/call/{path}`), and cites those calls as `METHOD path`. | Code's gate reads the calls the evaluator made from the run log and fails an item whose every requirement is not marked met with evidence naming a call that was made, or that never called the app at all, whatever the evaluator wrote. The failure goes to repair, unbilled, one tier up. |

`check_preview` remains, signed out, to confirm that what needs signing in answers 401 — and it is the only way to show
a requirement for people who do not sign in (R2-11; `PlanRequirement.NeedsNoSignIn`: "with no account", "without
signing in"). The planner keeps such a requirement and builds it to work signed out; `propose_plan` refuses an item
covering one whose check does not say it is made signed out, and the plan tells the owner it works for those people
once they make the app public (ARCH-005, *Who may open an app*). The gate counts the evaluator's signed-out calls
(read back from `check_preview`'s results, `… — METHOD path signed out`) for every requirement of such a part, and
for a no-sign-in requirement only those. Evidence may name a call by its path with placeholders for the ids it made
(`PUT api/trips/{tripId}/items/{itemId}`). Before this, both real builds of a dive-club packing list failed that part
after three free repair rounds: the evaluator had shown it working signed out (201), but only signed-in calls counted
and its `{token}` paths matched nothing. Two requirements cannot be shown
by a signed-in call alone, and the live club build failed on both until the evaluator had: `call_webhook` (a declared
webhook called as its device would, signed by the control plane with the vault's secret, which the evaluator never
holds; counted by the gate like a `call_app` call) and `sent_emails` (what the app asked the platform to send). The
evaluator has 50 steps and is told to answer by its 40th: a live evaluator of a five-requirement item ran out at 30.

**The evaluator works on a preview, never on the app.** The live builds' published apps carried the evaluator's test
records ("Added by Test member (member-a)") because the preview was the app. Now every evaluation round starts a
preview — the evaluated image as `app-<id:N>-pv` beside the app on its network, with a database made afresh for it,
exporting no telemetry, never published, sampled or charged as the app — and destroys it with its database when the
round ends (even when the run is cancelled). The evaluator's `call_app`, `check_preview` and `call_webhook` always name the
preview (`X-Endgame-Preview: 1` on Edge's control listener). The app itself is built and started once, to publish it, with
its own clean database. The preview runs with `ENDGAME_PREVIEW=true`, so the kit exports no telemetry and records no
custom events from it (the live run before this showed 17 `book.created` events for 8 real books). The preview carries a
platform token of its own (`POST /internal/apps/{id}/token?preview=true`), which never replaces the app's: e-mail it asks
to send is checked as the app's would be and **held** (`email_messages.status = 'held'`), never delivered, and
`sent_emails` shows it as held, so an e-mail requirement is still evidenced.

**Screens are predictable.** A plan item with anything on screen lists the `testIds` its screens carry, by the app kit's
convention (`page-<view>`, `nav-<view>`, `<entity>-list`, `<entity>-item`, `new-<entity>`, `open-<entity>`,
`<entity>-<field>`, `save-<entity>`, `set-<field>-<value>`); `propose_plan` refuses a screen item with none or one not in
that form. Code's gate reads `web/src` (`rg data-testid=`) after the evaluator answers and fails the item for every
promised id that is not there (`missingTestIds`), whatever the evaluator wrote. The evaluator is told to re-read every
view of the data after each change of state (a finished book must leave "reading now") and to check navigation the way a
person moves: each link reaches a route that renders its page, pages read the address through the router only, and the
item's tests click through it with the kit's `renderApp`. The factory's browser proof drives built apps by these ids.

**A requirement about how a screen presents something is shown by the screen's own test, run by code.** Some
requirements are about a screen, not data: "Make the trip leader's readiness view the product and treat the checklist as
just its content", "on their phone", a layout, what a view leads with (`PlanRequirement.IsAboutScreen` — view as a noun,
screen, page, layout, phone, mobile, design, colour, highlight, "the product"; never a no-sign-in requirement, never a
phone number). No call can show that: a call shows the data, not what the screen does with it. For such a requirement
the gate also accepts the screen's own test, named in the evidence — in the mark's `tests` list
(`web/src/trips/TripPage.test.tsx > leads with readiness, above the share link`) or quoted in its evidence — and counts
it only when **code** ran the app's front-end suite itself (`ScreenTests.Command`: vitest's JSON report) and saw that
test pass. A name matches a test's title or full name, or at three words or more the start of exactly one title (within
the file named, when one is); a phrase that fits two tests names none. The test counts only beside the data the screen
presents: some requirement's evidence must cite a call made to the running app, so a mocked screen test never stands in
for the app. A test never shows a requirement about data, never shows what worked before in a change's check (the
`keep` part, `KeepCheck`), and a named test that failed is a fault of its own. The planner is told to
check such a requirement by the data call plus the screen's test named by its title, never by anything nobody can run
(looking at the page on a phone). The real four-part dive-club build (run `cafe1c2e`) failed its part 3 four checks
running on exactly this: the evaluator cited the passing test "leads with readiness, above the share link and the kit
list" every round, and the gate, counting calls alone, refused it.

**Something a person has of their own is checked by coming back later.** A built "Dive Trip Ready" asked a returning,
signed-in diver to join again and stored a second row for the same person; every requirement had been shown once, by one
call, and nothing came back. A requirement where a signed-in person makes or joins something of their own
(`PlanRequirement.IsOwnRecord` — join, sign up, register, enrol, RSVP, claim, subscribe, check in, book a place, keep or
tick off their own; present forms only, so "sees how many have joined" is not one; never in a part for people who do not
sign in) is marked "[their own: check coming back later]" for the evaluator, who makes the call as one member, makes the
same call again as that member (every `call_app` signs in afresh: same user id, new session), and reads it back. `call_app`
writes what it sent on its own line (`Sent: …`), and code reads every call back in order (`CallAppTool.AttemptsIn`):
`EvaluationGate.ComingBack` finds, among the writes the evidence names, one the same member made twice with the same body,
and holds the second answer to the first record — the same `id` (top level, or inside the one object answered), or 409.
A second 201 or another id is `not-met` and goes to repair with the reason ("made a second record (id m1, then id m2)");
no repeat, or no read after it, is `unshown` and checked again. The app kit's convention it holds apps to is in the
template's `AGENTS.md` ("A person's own record").

**A refusal of how the work was shown is checked again, not sent to the builder.** When the evaluator said the item
works (no faults of its own) or gave no verdict at all, and the only reason it failed is that code could not verify how a
requirement was shown (`recheck` on the gated answer: every failing requirement `unshown` or `unchecked`, no missing test
ids), the same build gets one second look by a fresh evaluator (`evaluator-<item>-<round>-recheck`, not billed), told what
code refused, word for word. Its calls and the first look's both count. In run `cafe1c2e` the builder was instead sent to
repair the evaluator's citation three times — it added a refresh button, then rewrote the page — and the fourth check ran
out of steps.

**Repairs converge.** The gate records how each failing requirement failed (`failing`: `r4:unshown`, `r3:not-met`,
`item:unchecked`, `testids:…`, `item:faults`). The repair brief (`repair.md`, `BuildWorkflow.RepairBrief`) quotes, per
failed requirement, its words, what the checker wrote and code's reason, with what to do for that kind; then every fault;
then what earlier rounds of this part said they did and the files they changed, so a round starts there instead of
re-reading the app. The next check is told what the last one sent back. When two checks running fail the same way, the
next repair is told plainly to change its approach; when three do, the part stops there (`stoppedEarly` on the final
judgement) with a plain outcome — "failed its check three times in a row for the same reason — “…” could not be shown
working" — instead of a fourth round on a stronger model. Failures of the evaluator's own free-form faults are never
counted as "the same". The fault that lists the calls made says each shape once, ids folded to `{id}`.

## Checkpoints, asked rules and the person's answer

- **An "asks you first" rule asks.** A rule set's `ask` rule raises an approval even in an unattended run: the rule is
  the person's own wish to be asked, so it is its own checkpoint (`PermissionPolicy`, the rule's `<level>:<rule>`). Only
  the default — a tool no rule allows — is still denied when nobody is watching.
- **The approval says what will happen, in words.** A tool that knows its own plain wording implements `IApprovalTitle`
  (`start_idea`, `change_app`, `try_again`, `adjust_setting` — the last names the setting as the autonomy and app screens
  do, never its key, and names the place by its name); the rest get the loop's generic sentence. Under the title is a plain
  sentence of why it asks (`ApprovalDetail.For`); the tool, its arguments and the rule travel as the approval's separate
  `technical` field, never in `detail`.
- **One request, one approval.** A tool refuses arguments it cannot act on in `Target`, before the permission check, so
  nobody is asked about a change that would then be refused: `adjust_setting` takes only `AgentSettings.Allowed` with a
  value each key holds (its title and its reply are one pure function of key, value and place), and `change_app` refuses a
  request about who may open the app, credits, the overdraft or exporting it (`ChangeAppTool.PersonsAct`) — a person's act,
  on its own screen, never a build.
- **The answer comes back with its note.** `IApprovalGate.AskAsync(title, detail, onDecline)` returns the answer and the
  person's note; the tool result says it was approved or declined and quotes the note, and a declined call tells the agent
  to carry on without it or say plainly it was not done. `onDecline` is `continues` for a tool call and `stops` for the
  start and plan checkpoints, whose decline ends the run — so the console can tell the truth after a decline.

## The conversation, as the one it is with

A conversation turn with an employee (`run.EmployeeId`) is answered **as that employee**: its name, role and mandate
from `GET /internal/employees/{id}` are added to the prompt, its curated memory follows as context, it runs on its own
model tier (thinking power) and may `remember` (`AgentFactory.As`). The answer carries `by` (the employee's name). The
conversation's tools are `read_organisation`, `start_idea`, `change_app`, `try_again` and `adjust_setting`. Its
`read_organisation` "contents" (and the head of its "overview") is what is in the tree at the scope, counted as home
counts it, each app with its state; the levels in the prompt and the overview are only the path down to the scope, and
an organisation conversation that had nothing else answered "we run 1 app" of three, from recent runs (R5-1). Every one
that acts is a checkpoint the person answers in the conversation itself. A turn the budget stops writes Endgame's own
notice into the conversation (`from: runner`, `code: budget_exhausted`) instead of leaving it silent; a turn that could
not reach a model says so in its reply. Its prompt is given the places' names (and must use them, never paths) and the
acts only a person can do, with where each is done. A conversation is never held at the start checkpoint (the budget
pause still applies), and the Runner answers conversations in a lane of their own (`RunLanes`, `ConversationConcurrency`,
default 2, beside `Concurrency` for every other kind), so chats and long runs never wait on each other.

## Research

Research begins with one red-line screen of the idea on the summary route (`Prompts/idea-screen.md`, `{ screen: clear |
unclear | breach, line, reasoning }`). A clear breach with a named line records the do-not-build verdict at once, from the
screen alone ("Not researched: …"), with no contractor and no search; anything else, including an unreadable answer, is
researched in full and the judge screens again. Contractors are named by their role ("Demand researcher"); the step's
title is their activity. Whenever a run ends — finished, failed, cancelled, declined or out of budget — the Runner
finishes every contractor the log shows briefed and not finished (`RunExecutor.OpenContractors`).

## The start checkpoint and a decline

Declining "Start this work?" is not a failure: the run finishes `cancelled` with `reason: declined_at_start`, the
closing message "You declined" quotes the person's note, and the estimate is not scored.

## Requirements are whole statements

A plan's requirements quote the idea, one whole statement each: `PlanContract.Faults` refuses a requirement that is an
example or a qualifier cut off its statement ("as a line above the list", "for example …"), and a quoted clause is read as
a statement of its own (a leading "and" dropped, the first letter capitalised). When a build carries a change agreed after
research, the planner is told the change wins: what it replaces goes to `leftOut`, "replaced by the change agreed after
research", never beside it as a second requirement.

## Trying again

A retried build or change (`retryOf` in the owner message) reads the earlier run's journal and records into its own:
placement (and a change's red-line screen and earlier parts), the **agreed** plan with `plan.accepted { by:
earlier-attempt }`, the plan's estimate (the try's own estimate, made for what is left, stands), and every item that
passed its check. Those items are neither built nor checked again, so they are not billed twice; a `plan.carried`
message lists them and the owner hears "Carrying on". A plan that was declined was never recorded, so it is planned
afresh; a part that failed is built again with fresh repair rounds. The workspace is recreated from the app's last
commit, which holds every finished part.

## Changing a built app

A change is a `task` run whose owner message has `kind: change` (`TaskWorkflow` → `BuildWorkflow.ChangeAsync`), through
the build's own stages, not a fork of them:

1. **Red-line screen** of the request (research is not repeated: it is the same product) — one call on the summary
   route, `{ breached, line, reasoning }`; a breach, or no answer in that form, changes nothing.
2. **Placement** is the app itself, from the run's scope; nothing is created.
3. **The plan** is the same contract as a build's, faithful to the request's words (`ProposePlanTool(request)`), with the
   plan checkpoint honoured. Code then adds its own last item, `keep` — "Everything the app did before still works" —
   whose requirements are the parts `PROGRESS.md` lists (`k1…`). A builder's own note under a to-do heading (to do, next,
   later, planned, …) or saying it is not done is not a part the app has, and is not checked.
4. **Each part** is built, committed and checked by the separate evaluator on a preview with its own data; `keep` has
   nothing to build, so it is checked first and repaired, unbilled and one tier up, only if the check finds something
   broken. A change's parts are recorded in `PROGRESS.md` keyed by the run (`<run>-<item>`), never hiding the build's.
5. **The security review**, then **the new version** is built and the app restarted; who may open it does not change.
   The app's history shows the change's commits by the employee who made them, and restore works as before.

## Not verified

Tasks harder than a multi-file feature in a small app; long sessions that need compaction;
sub-agents; anything in a large repository. These are measured by the harness's own benchmark as
it is built.
