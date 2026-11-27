# UC-205 — Converse with the organisation (Runner side)

| Field | Value |
| --- | --- |
| **ID** | UC-205 |
| **Title** | The owner asks a question in a scope and gets an answer from the organisation's own data |
| **Primary actor** | Owner; the assistant agent answers |
| **Scope** | Runner (`ConversationWorkflow`); control plane (`POST /api/conversations`, `/internal/*` reads) |
| **Cascade level** | The scope the owner selected, and beneath it |
| **Status** | Built |

## Main flow

1. `POST /api/conversations` queues a `conversation` run with the owner's message.
2. The assistant reads with `read_organisation` (contents, overview, workforce, tasks, runs, credits) at that scope or
   beneath it, with the last six turns of the conversation in context. "Contents" is every division, project and app
   there, each app with its state (live, sleeping, building, never built, paused, down, archived), and the counts home
   shows; the overview leads with it, and the prompt says to count from it, never from recent runs (R5-1).
3. It may start an idea (`start_idea`), ask for a change to a built app (`change_app`), try stopped work again
   (`try_again`) or change a setting (`adjust_setting`) only through tools the permission pipeline checks; each is a
   checkpoint, so the person confirms it first, in the conversation — asked in plain words ("Start researching an idea:
   …?", "Change the app: …?", "Try again: …?", "Turn on the “Before the plan is carried out” checkpoint here?"), the tool
   and its arguments being technical detail. The person's note comes back with the answer.
4. The answer is a `message {from: assistant, text}` on the run; with an employee, it is that employee's answer, from its
   job, mandate and memory, on its own model tier, and carries `by`.

## Alternate and failure flows

- **A1 — a read fails.** The tool says so and the assistant must say it could not read, never "nothing there".
- **A2 — the owner declines.** The tool is denied ("…declined this call, so it was not done", with the note); the
  assistant says it did not do it.
- **A3 — the budget runs out.** Endgame's own notice (`from: runner`, `code: budget_exhausted`) is written into the
  conversation; no reply.

## Acceptance

- `WorkflowTests.A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea`,
  `…Talking_to_an_employee_is_answered_by_that_employee_from_its_job_and_memory`, `…A_conversation_the_budget_stops_says_so_in_the_conversation`,
  `…The_conversation_asks_in_plain_words_before_changing_an_app_or_trying_work_again_and_a_decline_is_told_truthfully`.
