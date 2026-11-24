# TEST-201 — The harness, the Runner and the factory

| Field | Value |
| --- | --- |
| **ID** | TEST-201 |
| **Covers** | UC-201 · UC-202 · UC-203 · UC-204 · UC-205 · ARCH-006 · ARCH-004 (run log) |
| **Status** | Current |

## What must be true

Every rule in ARCH-006 holds in the production harness; a run survives the death of its Runner; the factory's
stages keep their gates whatever the models say; and the harness builds real features on cheap models.

## Tests

All under `src/backend/Endgame.Tests/Harness/`, run by `make test`.

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `ToolTests` | The edit contract and every failure message: not found (with the whitespace-insensitive match quoting the file's text, the first line found, or nothing), not unique (count and lines), a pasted line-number prefix, identical strings, an empty old string, missing arguments; line endings normalised both ways; a byte-order mark kept; `read_file` numbering and paging footer; `write_file` keeping endings; a root-relative path's error naming the fix; head-and-tail output with colour stripped; list, search, commit. |
| Unit | `PermissionTests` | Table-driven pipeline: the `.git` floor and protected paths beat every allow; the run's deny; cascade deny, ask and allow per stage; plan mode; plan-required; unattended denial; a checkpoint raising an approval, approved and rejected; an unreadable deny rule denies everything; every decision an event naming its rule. |
| Unit | `KernelTests` | The loop: results fed back in order; verbatim echo with reasoning details; malformed, empty and object arguments; unknown tools; text-written tool calls nudged at most three times; the verify-after-edit stop hook once; a lint hook that says how to fix the fault; repeated identical failures stop the run; per-turn cap; step limit; budget refusal terminal and never retried; only transient failures retried; provider pinned after the first reply; cache marks on Qwen and Anthropic models; repair sent non-billable; pause, cancel and a lost lease honoured between steps; a budget slice; a workspace refusal is a tool error. |
| Unit | `ReplayAndContextTests` | Replay rebuilds exactly the live state; a run killed at any event resumes from its log and finishes the same way, every call with exactly one result; an in-flight call answered as interrupted; a finished agent never calls the model again; compaction keeps plan, tasks, notes and recent results, never splits a call from its result, and replays; sub-agent isolation, tool subset, nested events, credits rolled up; fan-out cap; plan mode and plan-before-edit; skills by name and trigger, loaded on demand; the task graph's create, claim, complete and a lost race. |
| Integration | `RunnerIntegrationTests` (real control plane, real PostgreSQL, OpenRouter faked) | The gateway client streams a tool call and reads the settlement; a refused budget reaches the harness as terminal; **a Runner killed with a model call in flight is resumed by another Runner from the log and the run succeeds** (gapless log, one result per call, one `run.started`, estimate scored); pause mid-call stops the run at the next step boundary and resume finishes it; graceful shutdown suspends and releases the lease at once. |
| Unit | `EstimateTests` | An estimate before work and its score against the gateway's settlements (billable and not); the median of past runs; auto-mode refusing to begin over budget; an estimate the control plane made is kept; the start checkpoint; a resumed run not gated twice. |
| Unit | `WorkflowTests` (scripted model, fakes of the control plane and Dock) | Research fans out, argues against first, names every product, and code turns missing demand and a red line into do not build; a missing verdict fails. Build places, plans, builds one feature per session with a commit and a progress entry, evaluates with a separate agent that has no write tool, reviews, publishes privately; a failed evaluation is repaired unbilled on the next tier; the cap; a security finding blocks publishing; a killed build resumes without repeating placement, planning or finished features. The conversation answers from its read tools and asks before starting an idea. |
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

## Against the running system

The Runner has not been run inside `make up` against Dock and the control plane together: the factory's build stage
needs the control-plane and Edge endpoints listed in the lane's report (tree nodes, app tokens, credits headroom,
estimate history, the preview probe), which do not exist yet. What runs for real: the harness on real models (the
benchmark), the Runner against the real control plane and database (`RunnerIntegrationTests`), and the tools against
the real Dock (`DockWorkspaceTests`).

## States covered

A failed read in the conversation is reported as a failure, never as nothing there. A failed evaluation, a missing
verdict and a missing review report are each a failure, never a pass by default.
