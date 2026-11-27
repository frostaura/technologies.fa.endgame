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
  "May not": `tool.denied` (call id `capability:web_search`, `by: "rule"`), the session's calls carry `maxSearches: 0`, and a
  nudge tells the model it may not search. "Asks you first": one approval for the step ("Let this step search the web:
  {title}?", `continues`); declined, the same as "may not", but `by: "owner"` with `declined` ("search the web for what
  they leave undone", `WebSearch.Declined`), so the run page says "You declined: …" and keeps "refused by your rules" for a
  rule that never asked (R6-1). A tool call declined at its approval carries the same two fields
  (`ApprovalDetail.Declined`: "change part of the app"). The decision is replayed from its event, so a resumed session never asks
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

**A form holds up against bad input — decided from the page's own tests, run by code.** A factory-built "Club dives" app
went completely blank on its "Add a dive" page — a form with a `datetime-local` field and a live preview card beside it, the
pattern the kit's new-note page teaches — when a six-digit year (`202612-12-12T08:00`, typed into the field's year segment)
reached `Intl.DateTimeFormat(…).format(new Date(value))` and threw `RangeError` while rendering (R7-1). The gate had passed
it: until then the evaluator could do nothing with a built app's front end but read its code, run `make test` and `make
lint`, and call the API (`call_app`, `check_preview`, `call_webhook`, `sent_emails`); it has no browser, and code ran the
app's front-end tests only to count a test named for a requirement about a screen. Nothing fed a page a value, so no check
could see a page break. Now, for every form field a part's plan names (`FormInputs.IsFieldId`: an `<entity>-<field>` test id,
not a page, link, list, item or button) that `web/src` writes on an input, select or textarea (`FormInputs.FindAsync` reads
the element and its `type`: text, number, date — `date`, `datetime-local`, `month`, `week` — or select; a checkbox, radio,
time or file is not asked), code runs the app's front-end suite itself (`ScreenTests.Command`) and needs the field's own
bad-input test — titled `holds up against bad input: <test id>` (the kit's `BAD_INPUT_TEST`), written with the kit's
`holdsUpAgainstBadInput` (`@endgame/appkit/testing`) — to have passed. That helper feeds the field a six-digit year and a date
before any limit, a number far past any, an option that is not there, a blank required field and text past its `maxLength`,
and fails unless the page stays on screen (no throw, no error boundary) and, on submit, refuses each it cannot take beside the
field. A field with no such passing test fails the part `form:<id>:untested` ("…has no test that feeds it a bad value…", with
how to write one); one whose test failed fails it `form:<id>:broken` ("The form broke on a bad value in its date field
dive-when: … failed when code ran the app's front-end tests…"). Both are the builder's to fix — never a second look — and
go to repair with "Fix the page, not the test". Over an evaluator that said it all works the failure is `overruled`, with the
tests that decided it as its trigger, so the escalation guard below stops a part whose repair changed only tests and whose
form fault then repeats, rather than escalating it (the console then says "the factory’s own run of the page’s tests
disagreed twice"); with `SameFailureThrice` it cannot loop. A part with no form is not asked, and its tests are not run for
it; nor is the check of what worked before (`keep`). It is a check of test results, never of the evidence's wording: the
fixtures are the fragile and robust pages with the reports vitest wrote when their suites were really run against the kit
(`Fixtures/form-fragile-add-a-dive.json` fails, `form-robust-add-a-dive.json` passes; `FormInputsTests`,
`WorkflowTests.A_form_that_breaks_on_a_bad_date_fails_its_part_by_the_tests_code_ran`). The planner is told an item with a
form says each field's test in its check, the builder and the `write-a-screen` skill how to write it, the evaluator that code
runs them. The kit keeps the page itself from blanking — `AppErrorBoundary` at the root and around the routed page,
formatting through `formatDate`, `formatDateTime` and `formatNumber`, which never throw, and `endgame/no-unsafe-format`
(TEST-050).

**Something a person has of their own is checked by coming back later.** A built "Dive Trip Ready" asked a returning,
signed-in diver to join again and stored a second row for the same person; every requirement had been shown once, by one
call, and nothing came back. A requirement where a signed-in person makes or joins something of their own
(`PlanRequirement.IsOwnRecord` — join, sign up, register, enrol, RSVP, claim, subscribe, check in, book a place, keep or
tick off their own; present forms only, so "sees how many have joined" is not one; never in a part for people who do not
sign in) is marked "[their own: check coming back later]" for the evaluator, who makes the call as one member, makes the
same call again as that member (every `call_app` signs in afresh: same user id, new session), and reads it back. `call_app`
writes what it sent on its own line (`Sent: …`), and code reads every call back in order (`CallAppTool.AttemptsIn`):
`EvaluationGate.ComingBack` finds, among the writes the evidence names, one the same member made twice with the same body,
and holds the second answer to the first record — the same `id` (top level, or inside the one object answered), or 409;
a repeat answered with no record (204, an empty 200) is held to the member's next read of it, which must show the same
id. A second 201 or another id is `not-met` and goes to repair with the reason ("made a second record (id m1, then id
m2), with nothing given up between"); no repeat, or no read after it, is `unshown` and checked again. The evidence only
has to name the write: the repeat and the read are decided from the logged calls, in order, never from the evidence's
prose. A repeat counts only while the record is still the person's (an *episode*): a successful DELETE of the path by
that member, or of the record's own path (`…/me`, `…/{its id}`), or a read by them showing it gone (`"id": null`, or a
404 where the same read answered before) ends it, and a join after that is a fresh one whose new record is right. The
read back must be that member's, of the record (its path, `…/me` or `…/{id}`), after the repeat and before it was
given up. The first live build after this check — "Dive Seat Sheet", run `67018a21` — failed a correct app after three
repair rounds on both counts: it compared a first join with a join made after the seat was given up (201 X, 200 X,
DELETE, 201 Y), and it asked for the read in the prose although it was in the call log. Its four failed evaluations are
replayed from the run's own log in `ComingBackRealRunTests` and all pass. The app kit's convention it holds apps to is in
the template's `AGENTS.md` ("A person's own record"). Reading that record requires sign-in like the writes, and what anyone
may see — how many joined — is a field of the public resource: the security review's checklist says so, and the kit's own
example once did not (R6-5: a build copied its `EndgameUser?` read for "GET dives/{id}/signup", and the review blocked
publishing on it). The template's `AppRulesTests` (`AppChecks`) now fails any app, the template included, whose endpoint
takes the person without `.RequireUser()`, and `KitConventionTests` fails the platform if the kit, the checklist and the
planner's and builder's guidance stop saying the same.

**A refusal of how the work was shown is checked again, not sent to the builder.** When the evaluator said the item
works (no faults of its own) or gave no verdict at all, and the only reason it failed is that code could not verify how a
requirement was shown (`recheck` on the gated answer: every failing requirement `unshown` or `unchecked`, no missing test
ids), the same build gets one second look by a fresh evaluator (`evaluator-<item>-<round>-recheck`, not billed), told what
code refused, word for word. Its calls and the first look's both count. In run `cafe1c2e` the builder was instead sent to
repair the evaluator's citation three times — it added a refresh button, then rewrote the page — and the fourth check ran
out of steps. **Nor after the second look:** when that look is still refused only on how it was shown (`recheck` again),
the gated answer is `unverified`, and the part stops there, at whatever round, never repaired and never escalated
(`BuildWorkflow.Unverified`; the judgement is `final` and `unverified`, its summary "Not sent back for repair: code could
not verify how it was shown…", and the owner is told it could not be checked, that nothing in it was shown not to work,
and that "Try again" carries on from it). Before this, the second look's refusal went to the builder like any other: run
`67018a21` spent three repair rounds and about 44 unbilled credits (43.5) on a correct app this way, and ended on its final round on
a refusal of evidence.

**Repairs converge.** The gate records how each failing requirement failed (`failing`: `r4:unshown`, `r3:not-met`,
`item:unchecked`, `testids:…`, `item:faults`). The repair brief (`repair.md`, `BuildWorkflow.RepairBrief`) quotes, per
failed requirement, its words, what the checker wrote and code's reason, with what to do for that kind; then every fault;
then what earlier rounds of this part said they did and the files they changed, so a round starts there instead of
re-reading the app. The next check is told what the last one sent back. When two checks running fail the same way, the
next repair is told plainly to change its approach; when three do, the part stops there (`stoppedEarly` on the final
judgement) with a plain outcome — "failed its check three times in a row for the same reason — “…” could not be shown
working" — instead of a fourth round on a stronger model. Failures of the evaluator's own free-form faults are never
counted as "the same". The fault that lists the calls made says each shape once, ids folded to `{id}`.

**The check needs a look — the escalation guard.** A fault the gate's code decides over an evaluator that marked the
requirement met (`overruled` on the gated answer: the check of coming back later, `not-met`, with the call sequence
that decided it — `member-a PUT api/dives/{id}/signup → 201 (id …)`; and a form's bad-input check over an evaluator that
said it all works, `form:<field>` `broken` or `untested`, with the tests code ran) goes to repair like any other. But when the repair
that follows changed no application code (only tests, documents or nothing, read from its own `edit_file`/`write_file`
calls in the log; `BuildWorkflow.IsApplicationCode`) or its builder's reply disputes the fault ("I couldn't find a fault in
the code, so I made no changes"; `DisputesTheFault`), and the same code-decided fault then repeats with nothing else
failing, the part stops (`BuildWorkflow.NeedsLook`): the judgement is `final`, `needsLook`, with `trigger` — each overruled
requirement and the calls code read — and the owner is told the check needs a look and that nothing in it was shown not to
work. It is never repaired again nor escalated: a stronger model cannot fix the factory's own check. It takes precedence over
the three-in-a-row stop. Run `67018a21` spent three repair rounds on ever stronger models and about 44 unbilled credits on a
correct app whose gate was wrong (seq 1287 and 1749 decided "a second record"; the repair between changed only tests);
replayed from its log (`CheckNeedsLookTests`, the fixture now holding each round's failing kinds and each repair's files and
reply), it stops before round 3.

## The security review

After every part has passed, the organisation's standing security reviewer checks the app against its checklist
(`security-review-checklist`); a finding blocks publishing (`BuildWorkflow.ReviewAsync`, `SecurityFindings`), with two
rules learned from the live "Dive Seat Sheet" retry (run `d09672a3`), whose parts all passed first time and which was not
published: its first review found a real fault (a read of the person's own record without sign-in), the one repair fixed
the code and left `docs/app.md` saying "Signed in? No" for that endpoint, and the second review failed on that line alone.

| Rule | Enforced by |
| --- | --- |
| The repair's brief (`Prompts/security-repair.md`) tells the builder to bring the app's documents in line with every endpoint it changes — its `docs/app.md` row ("Signed in?"), `docs/data.md`, the endpoint's `WithDescription`. An app on the current kit cannot drift at all: its `AppRulesTests` fails `make test` when `docs/app.md`'s table and the code disagree (`AppChecks`). | `SecurityRepairBrief` |
| A finding only about documentation — in a document (`docs/…`, a `.md` file), not called `code` by the reviewer, not about a secret — is not a blocker: the documents are corrected once, unbilled (`builder-security-docs`, `Prompts/security-docs.md`), and the app is published without another review when the correction changed documents only (read from its own edits in the log). A correction that changed more is reviewed like any change. A key in a document still blocks. | `SecurityFindings.IsDocumentation`, `FixDocumentsAsync` |
| A blocking finding is repaired, unbilled. A second repair (`SecurityRepairRounds` = 2) is earned only when the first demonstrably cleared what it was given — no finding now is one of those, by file, checklist section and line within `SameLineWindow` — and what is left is different and no larger; it is told what the first did. A finding that comes back, or more findings, end it. Hard stop: `MaxSecurityReviews` = 3, and no repair is made that no review is left to check. | `SecurityFindings.Narrower`, `ReviewAsync` |

Replayed from the run's own log (`Fixtures/run-d09672a3-security-review.json`), the build now ends published after a free
correction of `docs/app.md`, with the same two reviews (`WorkflowTests.Replaying_the_real_runs_reviews_ends_published…`).

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
