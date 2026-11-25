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
  url citations are counted into the agent's state (and replayed from `accounting`).
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

`check_preview` remains, signed out, to confirm that what needs signing in answers 401. Two requirements cannot be shown
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
custom events from it (the live run before this showed 17 `book.created` events for 8 real books). What still reaches the
platform from a preview: e-mail it asks to send (to the test members' `.invalid` addresses), under the app's id.

**Screens are predictable.** A plan item with anything on screen lists the `testIds` its screens carry, by the app kit's
convention (`page-<view>`, `nav-<view>`, `<entity>-list`, `<entity>-item`, `new-<entity>`, `open-<entity>`,
`<entity>-<field>`, `save-<entity>`, `set-<field>-<value>`); `propose_plan` refuses a screen item with none or one not in
that form. Code's gate reads `web/src` (`rg data-testid=`) after the evaluator answers and fails the item for every
promised id that is not there (`missingTestIds`), whatever the evaluator wrote. The evaluator is told to re-read every
view of the data after each change of state (a finished book must leave "reading now") and to check navigation the way a
person moves: each link reaches a route that renders its page, pages read the address through the router only, and the
item's tests click through it with the kit's `renderApp`. The factory's browser proof drives built apps by these ids.

## Not verified

Tasks harder than a multi-file feature in a small app; long sessions that need compaction;
sub-agents; anything in a large repository. These are measured by the harness's own benchmark as
it is built.
