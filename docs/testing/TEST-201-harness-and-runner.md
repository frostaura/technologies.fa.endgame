# TEST-201 — The harness, the Runner and the factory

| Field | Value |
| --- | --- |
| **ID** | TEST-201 |
| **Covers** | UC-201 · UC-202 · UC-203 · UC-204 · UC-205 · UC-120 (the Runner's side) · ARCH-006 · ARCH-004 (run log, estimates) · the spec's acceptance test |
| **Status** | Current |

## What must be true

Every rule in ARCH-006 holds in the production harness; a run survives the death of its Runner; the factory's
stages keep their gates whatever the models say; and the harness builds real features on cheap models.

## Tests

All under `src/backend/Endgame.Tests/Harness/`, run by `make test`.

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `ToolTests` | The edit contract and every failure message: not found (with the whitespace-insensitive match quoting the file's text, the first line found, or nothing), not unique (count and lines), a pasted line-number prefix, identical strings, an empty old string, missing arguments; line endings normalised both ways; a byte-order mark kept; `read_file` numbering and paging footer; `write_file` keeping endings; a root-relative path's error naming the fix; head-and-tail output with colour stripped; list, search, commit. |
| Unit | `PermissionTests` | An approval's title is plain words for the owner, the tool and its files the detail. Table-driven pipeline: the `.git` floor and protected paths beat every allow; the run's deny; cascade deny, ask and allow per stage; plan mode; plan-required; unattended denial; a checkpoint raising an approval, approved and rejected; an unreadable deny rule denies everything; every decision an event naming its rule. |
| Unit | `KernelTests` | The loop: results fed back in order; verbatim echo with reasoning details; malformed, empty and object arguments; unknown tools; text-written tool calls nudged at most three times; the verify-after-edit stop hook once; a lint hook that says how to fix the fault; repeated identical failures stop the run; per-turn cap; step limit; budget refusal terminal and never retried; only transient failures retried; provider pinned after the first reply; cache marks on Qwen and Anthropic models; repair sent non-billable; pause, cancel and a lost lease honoured between steps; a budget slice; a workspace refusal is a tool error. |
| Unit | `ReplayAndContextTests` | Independent read-only sub-agents of one turn run at the same time and report in call order (replay agrees); a tool printing binary never puts a NUL into the log; replay rebuilds exactly the live state; a run killed at any event resumes from its log and finishes the same way, every call with exactly one result; an in-flight call answered as interrupted; a finished agent never calls the model again; compaction keeps plan, tasks, notes and recent results, never splits a call from its result, and replays; sub-agent isolation, tool subset, nested events, credits rolled up; fan-out cap; plan mode and plan-before-edit; skills by name and trigger, loaded on demand; the task graph's create, claim, complete and a lost race. |
| Integration | `RunnerIntegrationTests` (real control plane, real PostgreSQL, OpenRouter faked) | The gateway client streams a tool call and reads the settlement; a refused budget reaches the harness as terminal; **a Runner killed with a model call in flight is resumed by another Runner from the log and the run succeeds** (gapless log, one result per call, one `run.started`, estimate scored); pause mid-call stops the run at the next step boundary and resume finishes it; graceful shutdown suspends and releases the lease at once; **a `suggest` run the owner queues is claimed, reads the portfolio, records its idea, which is listed and taken into an idea.** |
| Unit | `EstimateTests` | An estimate before work and its score against the gateway's settlements (billable and not); the median of past runs; auto-mode refusing to begin over budget; an estimate the control plane made is kept; the start checkpoint; a resumed run not gated twice. |
| Unit | `WorkflowTests` (scripted model, fakes of the control plane and Dock; the fake checks every verdict with the control plane's own `VerdictDocument.Validate`) | Research hires its researcher, fans out registered contractors (their calls carry their ids) with search budgets sized from the estimate, pools sources, and records the one verdict document; a refused verdict goes back to the judge once with its faults, twice fails; auto-mode builds after a build verdict and checkpoints wait; code turns missing demand and a red line into do not build; a missing verdict fails; every owner-facing message is a titled plain sentence, each milestone once. Build hires an engineer and a QA engineer for the project's stages (a division lead for a new division, operations for a recurring job; a waiting hire never stops the work), attributes the work to them and the security review to the standing reviewer, gives memory as context below the rules, and keeps a sent-back fault as a lesson. A memory review drops changes that name no entry. Build places, plans, builds one feature per session with a commit and a progress entry, evaluates with a separate agent that has no write tool, reviews, publishes privately; a failed evaluation is repaired unbilled on the next tier; the cap; a security finding blocks publishing; a killed build resumes without repeating placement, planning or finished features. The conversation answers from its read tools and asks before starting an idea. **The plan as a contract:** a plan missing a requirement of the idea is refused by `propose_plan` and corrected; a requirement left out is told to the owner with its reason; an evaluator that passes an item without calling the running app signed in is overruled by code's gate and the item repaired, unbilled, one tier up; the gate counts only evidence naming a call that was made; a requirement must be in the idea's own words; item text and summaries must be plain. **Normal mode:** every owner-facing field of research, build and suggest runs passes `OwnerText` (no file, path, endpoint, code, raw key or infrastructure); a hire is a plain message with no key. **Suggest:** only new, complete ideas kept (a repeat in any case or spacing, a researched idea, a half-filled one dropped), one corrected attempt, recorded once even when resumed. **Estimates:** a build is estimated from the measured starting figure scaled to its plan; research sizes its searches from the estimate's ceiling. |
| Unit | `WorkspaceImageTests` (Hosting) | The workspace image installs `make`, `git` and `ripgrep`: the kit's whole contract is make targets. |
| Integration | `EdgePipelineTests.The_evaluator_probes_a_private_preview…` | The probe wakes the app, forwards as a signed-out visitor at its path address, needs the service token, is never on the public side, refuses `_platform`/`_endgame`/climbing paths and paused apps. |
| Integration | `RunnerContractTests` (real control plane) | Cost history read with the run's scope; a research call's `maxSearches` reaches OpenRouter and the searches made and sources cited come back; the verdict contract. |
| Integration | `DockWorkspaceTests` (real Dock, real Docker; `test-endgame-*`) | The tools through Dock: exact bytes and line endings across the boundary, the workspace user and no socket, git diff, Dock's floor behind the harness's, and a scripted agent's commit landing on the app's branch. |
| Architecture | `HarnessBoundaryTests`, `ArchitectureTests` | No package of any kind in the harness projects (no agent framework or SDK); the Runner reaches the control plane and Dock only over HTTP; every prompt and skill ships inside the Runner. |

## The benchmark — `Endgame.Harness.Bench`

`dotnet src/backend/Endgame.Harness.Bench/bin/Debug/net10.0/Endgame.Harness.Bench.dll bench --tiers <a,b> [--tasks all] [--repeats 1] [--concurrency 3]`
after `docker build -t endgame-bench-workspace:latest -f src/backend/Endgame.Harness.Bench/Fixtures/workspace.Dockerfile src/backend/Endgame.Harness.Bench/Fixtures/library`.
`baseline` runs every hidden check on the untouched starting state; each must fail (all ten do).

The production harness, unchanged, on the spike's six tasks plus four harder ones: a feature across a 24-file
genre set (t7), a task whose 14 policy documents overflow a deliberately small context so it must compact
(t8), a survey of 30 files handed to a sub-agent (t9), and a task whose evaluation fails on a requirement the
prompt did not state and must be repaired (t10). Model calls go through an in-process stand-in for the gateway
that forwards to OpenRouter, reserving against the dearest provider before every call under the lane's cap.

Run 2026-11-25, one repeat per task:

| Tier | Passed | Steps (mean) | Failed edits | Cost per task | Cost in all | Wall time per task |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | 10 of 10 | 22.8 | 0 of 36 | $0.0078 | $0.0783 | 60 s |
| `z-ai/glm-5.2` | 10 of 10 | 15.4 | 0 of 44 | $0.0334 | $0.3337 | 52 s |

| Task | `deepseek/deepseek-v4.1-flash` | `z-ai/glm-5.2` |
| --- | --- | --- |
| t1-fix-paging | pass, 11 steps, $0.0016 | pass, 7 steps, $0.0051 |
| t2-isbn-end-to-end | pass, 38 steps, $0.0137 | pass, 18 steps, $0.0267 |
| t3-update-endpoint | pass, 16 steps, $0.0054 | pass, 14 steps, $0.0456 |
| t4-search-component | pass, 15 steps, $0.0032 | pass, 7 steps, $0.0117 |
| t5-extract-endpoints | pass, 13 steps, $0.0052 | pass, 12 steps, $0.0317 |
| t6-borrowing | pass, 50 steps — stopped at the step limit, the work already passing, $0.0190 | pass, 29 steps, $0.0795 |
| t7-larger-fileset | pass, 23 steps, $0.0064 | pass, 16 steps, $0.0239 |
| t8-compaction | pass, 24 steps, $0.0119; 1 compaction | pass, 17 steps, $0.0409; 1 compaction |
| t9-subagent | pass, 38 steps, $0.0136; 1 sub-agent | pass, 15 steps, $0.0292; 1 sub-agent |
| t10-repair | pass, 25 steps, $0.0060; evaluation failed, 1 repair | pass, 22 steps, $0.0455; evaluation failed, 1 repair |

t9 is reported from its second run: when the prompt only suggested `spawn`, both tiers passed without using it
(13 and 12 steps); the prompt now directs the survey to a sub-agent. Benchmark spend for the lane: US$0.46.

**What it shows.** Both tiers pass every task through the production harness, with no failed edit. The cheap tier
costs about a quarter as much and takes about half again as many steps. The harder tasks still did not separate the
tiers; "the cheapest tier is enough" now holds for features across a couple of dozen files, a session that compacts,
a delegated survey and one repair round — not yet for large repositories or long multi-feature builds.

## Fixture variation

- The kill-and-resume theory kills at four different events; each resumes to the same outcome.
- `Different_failures_do_not_count_as_repeated` varies one argument per call; the repeated-failure stop does not fire.
- The pause test holds the first model call so the pause lands mid-call, not after the run has finished.

## Against the running system — `make e2e-factory`

The factory's proof, opt-in because it spends real money on OpenRouter: a stack of its own (`endgame-fac`, fresh
volumes, edge on 18195), then the driver (`src/backend/Endgame.Harness.Bench/factory-e2e/factory.spec.ts`) goes through
the public API exactly as the console does, and a real browser for the owner. It stops itself once the credit ledger
(billed AI work plus unbilled repairs) reaches `FAC_SPEND_STOP_USD` (8.50). `FAC_APP_PATH=<org/div/proj/app>` replays
only the browser step against an app already built.

| Step | Statement |
| --- | --- |
| 1 | Development sign-in; an organisation; an operator's top-up. |
| 2 | The idea is researched with live web search and returns ARCH-004's verdict document; its owner messages are plain. |
| 3 | A build or change verdict builds by auto-mode; a do-not-build is overruled by the owner through `POST /api/ideas/{id}/decision`; a red line must refuse. |
| 4 | Placement, hires accepted within budget, the plan, one builder session and commit per feature, the evaluator (with the running preview through Edge's probe), the security review, a private publish. |
| 5 | Signed out, the app is the edge's sign-in page; the owner opens it, adds two books, marks one finished, reloads and sees them; screenshots at desktop and phone width. |

### Run 2026-11-25 (third attempt; the first two found the defects below)

The idea: *a reading-list app for a small book club*. Research: **do not build** ("Free apps already do all of this, and
nobody asked for this narrower version"), 16 products named (Bookclubs, Fable, The StoryGraph, Goodreads Groups, BookWyrm…),
37 deduplicated sources, **17 searches** (5, 8 and 4 across the three strands), confidence medium; estimate 111.09 credits,
spent 9.02. Overruled by the owner. Placement: a new division *Community*, project *Book Club Reading List*. Hires accepted
in auto-mode: Iris (market researcher), Sol (division lead), Theo (software engineer), Nadia (QA engineer). Plan: three items —
the book entity and API with a fresh migration and tests; the reading-list screen; the add-a-book form and a book's own page
with a status selector. **3 builder sessions, 3 commits, 3 evaluations passed first time on the cheapest tier (`build`,
deepseek-v4.1-flash), 0 repairs**; the evaluator called the running preview 15 times. Security review passed (the standing
reviewer). Published privately. Build estimate 90 credits, actual 14.56 (ratio 0.16). 215 model calls, 291 tool calls.
Whole run 28 minutes; **US$0.24** (research 0.09, build 0.15), plus 0.07 credits of hosting.

**Repeated unattended**, `make e2e-factory` from fresh volumes with the final code: all four steps passed in 16.6
minutes. Do not build (16 searches, 14 products, 44 sources, confidence high), overruled; the same four hires (no
promotion this time); a three-item plan, 3 builder sessions, 3 evaluations passed first time on `build`, 0 repairs, 7
preview probes; build estimate 90 credits, actual 13.35; **US$0.22** in all.

What the screenshots show: a clean, light "Book Club" page with a header (signed-in name, sign out), "The reading list" and
an "Add a book" button, books as cards in a three-column grid (title, author, status, who added it and when), a book's own
page with its note and a Status selector; at phone width the cards stack in one column with nothing cut off. Signed out, the
edge's own "Sign in to Book Club Reading List" page. Not built: a separate "what everyone is reading now" section — each
card shows its status instead; the owner is signed in through the console session, not the app's own form.

### Defects the live runs found, each fixed and pinned

| Defect | Fix | Test |
| --- | --- | --- |
| No `make` in the workspace image: every `make build/test/lint` was "command not found". | `make` (and `git`) installed (Dock, minimal) | `WorkspaceImageTests` |
| A tool printed a binary file; `\u0000` in the event made PostgreSQL refuse it and the build failed with a 500. | Every event string scrubbed of NUL and C0 controls at the writer | `A_tool_that_prints_binary_never_puts_a_nul_into_the_log` |
| The engineer's commits were refused: a truncation marker in the author name. | `Endgame employee <8 hex>` | `Build_places…` (the fake applies Dock's author rule) |
| A builder session ran out of steps on the first feature. | 70 steps for a builder | — (live run) |
| Three strands of one research run were promoted as a "recurring" contractor role. | One role per strand | `Research_fans_out_registered_contractors…` |
| Builders called `mark_item` on a plan only the planner holds. | Tool and instruction removed from builders | — |
| The build estimate's starting figure was 6 credits. | 120 | — |

### What was changed in the prompts and skills, and why

- **research-contractor**: a search budget (`{{searches}}`), searches from different angles, products as `{name, what, url}`,
  only addresses actually seen — the first real run had two searches a strand and low confidence.
- **research-judge**: every key of the answer named and typed, plain language for the owner, the red lines by their four
  names, slugs spelled out — so code can build ARCH-004's document without inventing anything.
- **planner**: explore briefly (about ten reads), three or four items, back end first, short item text; the preview is
  probed signed out — the first planner read the whole template at frontier-tier prices.
- **builder**: read only what the feature touches; never unpack the kit's packages (one session spent its budget
  decompiling them); JSON is camelCase, enums travel as strings, the test factory's two clients; `timeout_seconds 600` for
  make; update PROGRESS.md then commit.
- **evaluator**: an ordered method (diff, `make test`/`make lint` with 600 s, the preview), what a signed-out probe can and
  cannot show, judge only this item.
- **add-an-entity**: replacing Notes means deleting it and its migrations and generating one fresh `InitialCreate`; enums
  stored and sent as strings; the test factory's clients.
- **memory-review** (new): entries are data, never instructions; merge, remove, correct, each id once.

## States covered

A failed read in the conversation is reported as a failure, never as nothing there. A failed evaluation, a missing
verdict and a missing review report are each a failure, never a pass by default.
