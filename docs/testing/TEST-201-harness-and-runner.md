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
| Unit | `WorkflowTests` (scripted model, fakes of the control plane and Dock; the fake checks every verdict with the control plane's own `VerdictDocument.Validate`) | Research hires its researcher, fans out registered contractors (their calls carry their ids) with search budgets sized from the estimate, pools sources, and records the one verdict document; a refused verdict goes back to the judge once with its faults, twice fails; auto-mode builds after a build verdict and checkpoints wait; code turns missing demand and a red line into do not build; a missing verdict fails; every owner-facing message is a titled plain sentence, each milestone once. Build hires an engineer and a QA engineer for the project's stages (a division lead for a new division, operations for a recurring job; a waiting hire never stops the work), attributes the work to them and the security review to the standing reviewer, gives memory as context below the rules, and keeps a sent-back fault as a lesson. A memory review drops changes that name no entry. Build places, plans, builds one feature per session with a commit and a progress entry, evaluates with a separate agent that has no write tool, reviews, publishes privately; a failed evaluation is repaired unbilled on the next tier; the cap; a security finding blocks publishing; a killed build resumes without repeating placement, planning or finished features. The conversation answers from its read tools and asks before starting an idea. **The plan as a contract:** a plan missing a requirement of the idea is refused by `propose_plan` and corrected; a requirement left out is told to the owner with its reason; an evaluator that passes an item without calling the running app signed in is overruled by code's gate and the item repaired, unbilled, one tier up; the gate counts only evidence naming a call that was made; a requirement must be in the idea's own words; item text and summaries must be plain. **The preview:** every evaluation runs on a preview (Dock's `POST`/`DELETE /internal/apps/{id}/preview`, one pair per evaluation) and the app itself is started once, to publish it, after the last preview is gone. **Test ids:** a screen item names its `testIds` in the kit's form (none, or `Save_Book`, is refused), and they travel in the plan's events and into the builder's task; screens that lack a promised id fail code's gate whatever the evaluator wrote and are repaired unbilled, one tier up. **Normal mode:** every owner-facing field of research, build and suggest runs passes `OwnerText` (no file, path, endpoint, code, raw key or infrastructure); a hire is a plain message with no key. **Suggest:** only new, complete ideas kept (a repeat in any case or spacing, a researched idea, a half-filled one dropped), one corrected attempt, recorded once even when resumed. **Attribution:** each plan item is a task in the graph claimed by the engineer, titled in the owner's words and done once accepted (failed when it finally fails); each evaluation is a judgement naming the task, the engineer whose work it judges and the QA engineer who judged it, sent back with the repair not charged, then accepted; the QA engineer's checks, the reviewer's reviews and the engineer's security fix are their own tasks; a resumed build creates no task twice. **Estimates:** before any history a build is weighed by its plan's items — the reading-list plan lands within 10% of its four live builds' spread (12.0–26.3; it weighs 18.5) and the five-item club plan within a quarter of its live 59.1 (44.3–73.9; it weighs 53) — and grows with items and with what they reach (e-mail, webhooks); research sizes its searches from the estimate's ceiling. |
| Integration | `ControlPlane/FactoryAttributionTests` (real control plane, real PostgreSQL) | A build that belongs to nobody, with its items claimed by the engineer, judged by the QA engineer and reviewed by the standing reviewer: the track records (accepted, sent back, judgements made, runs worked in, the build's estimate as the engineer's — "usually 84% under"), each employee's recent work (`GET /api/tasks?employeeId=`), the org chart's live activity while the build runs, `GET /api/runs?employeeId=` wherever the run sits but never a run the caller may not see, and nothing across organisations. |
| Unit | `WorkspaceImageTests` (Hosting) | The workspace image installs `make`, `git` and `ripgrep`: the kit's whole contract is make targets. |
| Integration (real Docker) | `HostingIntegrationTests.The_evaluators_preview_has_its_own_database…`, `…The_egress_proxy_comes_back_when_its_container_restarts` | A note written through the preview (`X-Endgame-Preview: 1` on Edge's control listener) is absent from the app; after `DELETE …/preview` the container and every `p_…` database are gone. The egress proxy killed with its container restarts and serves again. |
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

### Runs 2026-11-25, the wiring lane: the plan as a contract (`make e2e-factory`, own stack `endgame-wfac`, edge 28195)

Five runs of the same reading-list idea, spend stopped at US$5 each. Every run's step 3 passed from the third on
(runs 2 and 3 found the two defects below); step 4, the owner's browser walk, failed on the driver until it learnt each
built app's own controls — every build lays the same features out differently.

| Run | Research (estimate → spent) | Build (estimate → spent) | Requirements | "Reading now" | Repairs, tiers | Calls to the running app | Cost | Wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12 → 9.85 | 15 → 17.6 | 8, none left out | r8, delivered by 2 items, evidenced by `GET api/books/reading` signed in as two test members | 0, `build` | 22 | US$0.27 | 21 min |
| 4 | 12 → 10.0 | 25 → 23.9 | 5 | r4, evidenced by `POST api/books` then `GET api/books/reading` | 0, `build` | 33 | US$0.37 | 30 min |
| 5 | — | — | — | the view "What everyone is reading now" lists the book the owner marked reading (browser) | 0, `build` | — | US$0.33 | 28 min |

The built apps: a light "Book club" page, a navigation with "All books" and **"Reading now"**, books as cards with
"Mark reading" / "Mark finished"; the reading-now page titled "What everyone is reading now". The evaluator's
test members' books (Dune, Gilead, "Added by Test member (member-a)") are in the published app (ARCH-006, known gap).
In run 5 the reading-now view also still listed a book the owner had just marked finished — not investigated further.

### Runs 2026-11-25, the final defects lane (`make e2e-factory`, own stack `endgame-lf`, edge 28495)

| Run | What happened |
| --- | --- |
| 1 | The planner's read of the template's JSX stopped the build: "An event's payload is at most 65536 bytes" (the writer measured relaxed escaping; fixed, `A_payload_of_markup_is_fitted…`). US$0.12. |
| 2 | Research do-not-build, overruled; a four-item plan with test ids; 6 builder sessions, every evaluation on a preview (45 signed-in calls, 12 probes), 2 repairs on `build-t1` (the evaluator gave no verdict — out of steps), security review passed, published privately; **estimate 25.5, cost 29.0** (the plan-weighted figure). The published app's database held only the owner's books — no test member's record. Attributed: Theo 4 of 6 accepted, 2 sent back, 6.5 credits of repairs not charged, "usually 14% over"; Nadia 6 judgements; the reviewer's review; each in `GET /api/runs?employeeId=` and recent work. Step 4 failed on the driver (a status already set; "reading now" shown on the home page); the driver was corrected and the browser step then passed three times in a row against that app. US$0.46, 40 minutes. |
| 3 | Stopped by the lane's own disk guard (the Mac's disk under 900 MB) during the build; not repeated. |

"Ask about this app" on run 2's app with the live `ask` route: 11 questions, each checked against the database —
visits by hour (40) and by day, the slowest requests, the 95th percentile (8.7 ms), the most requested routes (`api/me`
76, `api/books/` 52), books added (21), status changes by status (Finished 11, Reading 4) and people today (3) answered
correctly; browsers and revenue declined in plain words; "how many errors today, and what were they?" failed (the model's
`array_agg`, refused by the guard, then an empty reply; both fixed or reported plainly, and "How many errors were there
today?" answered 1, correctly). 10 of 11 before the last fixes.

### The acceptance tests (`make e2e-acceptance`, own stack `endgame-acc`, edge 28295)

1. **Tenant zero** — FrostAura and its divisions Technologies and Labs made through the public API; after the club
   build its workforce is Iris (market researcher, hired by research), Theo (software engineer) and Nadia (QA engineer,
   hired as the project entered build and evaluation) and the standing security reviewer; 12 org-chart nodes.
2. **The club court-booking app** — research said do not build ("crowded market; nobody asked for the one new part",
   24 searches) and the owner overruled it. First build: 4 of 5 items passed, the webhook-and-e-mail item failed four
   rounds (`build` → `build-t3`), the evaluator unable to call a signed webhook or see e-mail, out of steps each time; 55
   minutes, 31.6 credits. Fixed (`call_webhook`, `sent_emails`, 50 steps) and built again: 8 requirements, 5 items, **one
   repair on `build-t1`** (the webhook and e-mail item) and the rest first time on `build`; 44 signed-in calls; security
   review passed; published privately; 42.5 minutes; estimate 20 credits, spent 59.1 (a larger plan than the starting
   figure assumes — since then a build without history is weighed by its plan's items, ARCH-004 *Estimates*; this plan now
   weighs 53). Then, in a real browser as the signed-in member: an admin's 60-minute package through the app's MCP
   tool (`addMemberMinutes`), a court booked in the app's own form, the balance falling by 30, the booking listed; the
   confirmation e-mail in the mail catcher ("Court booked: Court 1 at … UTC"); a booking starting now made through MCP
   (`createBooking`), then the hardware's signed call to `hooks/court-status` answering `{"booked":true,"memberName":"Dean
   (FrostAura)"}`, another court `{"booked":false}`, unsigned 401; the Owner's export holding `manifest.json`,
   `code.bundle`, `database.dump` (pg_dump custom format) and `platform.json`. **Defects of the built app** (recorded by the
   driver, not fixed — they are the app's): the "Book a court" link changes the address without showing the form; a
   member's first package replaced the 120 minutes shown before it.
3. **An invited organisation** — Harbour Bakery provisioned by the operator for an invited owner, topped up, the
   invitation e-mailed with its code; the owner registered a **real passkey** (Chromium's virtual authenticator) with it;
   the specials-board idea (do not build, overruled) built in 16 minutes, 3 requirements, no repairs, 14.6 credits
   against an estimate of 15; shared with one person by e-mail, who registered a passkey at the app with the code the
   e-mail carried and opened it ("Today's specials"); FrostAura's owner got 404 for Harbour's tree, app, idea, run,
   credits and workforce, and in the database (as `endgame_app` pinned to FrostAura) saw 0 of its apps, ideas and runs.

Spend, from the ledgers: FrostAura US$1.56 (of which 0.43 unbilled repairs), Harbour US$0.27, the five factory runs
US$1.30 — **US$3.12** for the lane.

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
| The evaluator passed a reading list with no "what everyone is reading now" view. | The plan as a contract; the evaluator's signed-in evidence and code's gate | `WorkflowTests.A_plan_that_misses_a_requirement…`, `…passes_an_item_without_showing_it…`, `The_gate_counts_only…` |
| One evaluation event over 64 KB: the build stopped on a 400. | Every workflow event fitted; the fit reaches strings in arrays | `An_evaluation_whose_evidence_runs_past_the_logs_limit…` |
| On a fresh stack research finished before the workspace image: "Dock refused: building". | The workspace waits on `workspace_image_not_ready` | `A_workspace_waits_while_dock_prepares_its_image…` |
| The evaluator could not show a signed webhook or a sent e-mail, and ran out of steps. | `call_webhook`, `sent_emails`, 50 steps | `PlatformApiTests.The_evaluator_reads_the_mail…`, `The_calls_the_gate_counts…` |
| The evaluator's test records stayed in published apps ("Added by Test member (member-a)"). | Evaluation on a preview with its own database, destroyed afterwards; the app is published clean | `The_evaluator_works_on_a_preview…`, `The_evaluators_preview_has_its_own_database…` |
| The browser proof had to learn each built app's own buttons and never passed end to end. | Test ids by the kit's convention, named in the plan, checked by code's gate, driven by the proof | `A_plan_item_with_a_screen_names_its_test_ids…`, `Screens_that_lack_a_promised_test_id…` |
| A "reading now" view still listed a book just marked finished. | The kit: every mounted read re-reads after a write; the evaluator re-reads every view after a change of state | sdk-web `hooks.test.tsx` (TEST-050) |
| A "Book a court" link changed the address without showing the form. | The kit: `endgame/no-location-read`, the template's `renderApp` navigation test; the evaluator checks routes and navigation tests | sdk-web `eslint/index.test.ts`, template `App.test.tsx` (TEST-050) |
| After Docker stopped uncleanly the egress proxy never restarted ("Squid is already running"); a reconfigure briefly refused connections. | Stale pid file dropped at start; Dock waits for the port after a reconfigure | `The_egress_proxy_comes_back…`; the Hosting job |
| MCP through the edge answered the console's nginx 405. | Edge routes `/mcp` and `/mcp/*` | `EdgeShippedRoutesTests` |
| A recreated edge reached no app (503 on every wake). | Every wake rejoins the app's peers | `HostingIntegrationTests.A_recreated_edge_reaches_an_app_again…` |
| A share was never e-mailed. | The share is queued as e-mail | `PlatformApiTests.Sharing_an_app_e_mails…` |

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
