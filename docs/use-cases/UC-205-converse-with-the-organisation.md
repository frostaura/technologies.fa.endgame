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
2. The assistant reads with `read_organisation` (overview, workforce, tasks, runs, credits) at that scope or beneath
   it, with the last six turns of the conversation in context.
3. It may start an idea (`start_idea`) or change a setting (`adjust_setting`) only through tools the permission
   pipeline checks; each is a checkpoint, so the owner confirms it first — asked in plain words ("Start researching an
   idea: …?"), the tool and its arguments being technical detail.
4. The answer is a `message {from: assistant, text}` on the run.

## Alternate and failure flows

- **A1 — a read fails.** The tool says so and the assistant must say it could not read, never "nothing there".
- **A2 — the owner declines.** The tool is denied; the assistant says it did not do it.

## Acceptance

- `WorkflowTests.A_conversation_answers_from_its_read_tools_and_asks_before_starting_an_idea`.
