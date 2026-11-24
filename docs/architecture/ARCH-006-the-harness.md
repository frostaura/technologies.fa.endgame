# ARCH-006 — The harness

Endgame's own agent loop. These rules come from a benchmark run on 2026-11-24: a throwaway .NET
loop with six tools built real features in a small .NET and React app, inside a workspace
container, across eight model configurations, three repeats each, with hidden acceptance checks.
About US$4.40 was spent. The harness is built to these rules; the spike's code is not reused.

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
| `mistralai/mistral-small-3.2-24b-instruct` | about 2 of 18 | $0.026 | Breaks the edit tool with wrong line endings. |
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

## The workspace

One fresh container per run: no network, no capabilities, no new privileges, not root, no socket,
limits on CPU, memory and processes. Its image has packages pre-restored, so build, test and
migrations work offline and a run starts in about a third of a second. Files are written through
the container as the agent's own user. A baseline commit is made first so the run's diff is exact.

## Checking the work

Acceptance checks the agent cannot see or edit, run after it finishes: tests it could have gamed
are restored first; then build, tests, front-end build and tests. Each check must fail on the
untouched starting state. The production evaluator keeps this shape and adds the live preview.

## Not verified

Tasks harder than a multi-file feature in a small app; long sessions that need compaction;
sub-agents; anything in a large repository. These are measured by the harness's own benchmark as
it is built.
