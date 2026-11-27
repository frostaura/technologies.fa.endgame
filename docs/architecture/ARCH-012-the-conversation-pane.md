# ARCH-012 — The conversation pane

| Field | Value |
| --- | --- |
| **ID** | ARCH-012 |
| **Title** | The conversation pane: layout, composer, attachments, "what it can use here", and the work card |
| **Status** | Current |
| **Covers** | Console `features/conversation/`, `features/home/ConversationDock.tsx`; control plane `POST/GET /api/conversations*`, `conversation_attachments`; Runner `ConversationWorkflow`; the model gateway's input modalities; the demo's conversation fakes |

## Context

A conversation is how a person talks to the organisation, a division, a project, an app or one
employee (spec §"The conversation"). It answers, and it can start work: an idea's research, a
change to an app, a stopped piece of work tried again, a setting changed. Each of those asks the
person first. Before this design the pane was the shell's side column with a text box in it: on a
wide screen it floated, it showed no attachments or tools, and work it started was a line of text
and a link.

## Layout

- **Desktop (≥ 1024 px):** a panel docked to the right edge under the header, full remaining
  height (`sticky top-0 h-[calc(100dvh-header)]`), its own surface and left border. Three rows:
  the **header** (avatar, "Talking to {name}", the level — Organisation · Division · Project · App ·
  Employee — and actions: narrow/wide, collapse, open full width), the **thread** (scrolls, fills),
  the **composer** (pinned to the foot). Two widths, `dock` (26 rem) and `dock-wide` (34 rem, the default from 1,880 px wide);
  collapsed it is a 3.5 rem rail with the avatar and an "Open conversation" button. Full width
  hides the page and centres the thread at `prose` width. Width, collapsed and full width are
  remembered per person (`localStorage`, keyed by user id) — per-device convenience, not state.
- **Beside a page's side cards** (the shell's side panel, ARCH-011): the pane is always its own
  full-height column at the right edge of the frame; side cards stay in the page column. From
  `3xl` (1,600 px) they sit beside the page, between it and the pane; from 1,024 to 1,599 px, while
  the pane is open, they move under the page's main column, two across, so the page never has less
  than about 640 px; with the pane collapsed to its rail they go back beside the page from 1,024 px.
  At `4xl` the frame (header, page, cards and pane) is capped at 2,200 px and centred.
- **Tablet:** the pane stays in the page (as built in round 4), restyled as the same framed panel.
- **Phone on its side** (`rail:`): the conversation is the sheet, which comes in from the right.
- **The look** is the design system's (ARCH-011): neutral surfaces and the one accent; states as the
  five-tone status tag (Waiting → neutral; Working on it now, Being checked → info; Passed → good;
  Sent back for repair, Needs a look → warn; Did not pass → bad); people as `PersonChip`s coloured
  from their id; `Spinner` for anything under way.
- **Phone:** the full-screen sheet of round 4 (follows the latest, "New reply", "Sending…" /
  "Working on it"), with the same header, thread and composer inside it.
- **Empty state:** who answers here and what it can do at this level, then three suggested prompts
  built from the scope's real data (an app that is down, the busiest app this month, what waits in
  "Needs you", an idle employee, the newest project); never canned filler.

## Composer

- A text area that grows to 8 lines; its tools are named on screen while the box is empty and fold to icons once the person types; Enter sends, Shift+Enter is a new line; a stop button while
  a reply is being written (`POST /api/runs/{id}/control` `cancel`).
- **Attachments** by button, drag-and-drop onto the pane, or paste: chips with name, size,
  remove, and a thumbnail for images. Uploaded as soon as they are added
  (`POST /api/conversations/attachments`), sent with the message by id.
- **"What it can use here"** (`GET /api/conversations/capabilities`): who answers and how
  strongly it thinks; the tools it may use, in the hire page's plain names; the work it can start
  here; the skills the builders here load; the platform services the apps here have; web search as
  "May / Asks you first / May not" under the autonomy rules; the organisation's AI assistants.
  Two **one-message narrowings** are offered where they apply — "Don't search the web for this
  one", "Answer only: start no work" — sent as `narrow` and enforced by the Runner. Nothing widens.
- **"/" menu**: the actions the conversation can take at this scope (from `capabilities.actions`).
  **"@" menu**: an employee or an app beneath this scope; choosing one re-targets the message
  (the selection moves there, as clicking it on the org chart does).
- The cost line is kept (rule 11) and counts the attachments (`POST /api/conversations/estimate`
  with `attachmentIds`).

## The work card

The card leads with the work in one line (the whole request behind "Show what was asked") and its status, so the eye lands on the plan. Other work at the level sits in an "Also happening here" line under the pane header, not in the thread.

Every reply that used tools or started work is drawn as a card driven by the run's event stream
(`useRunStream`, batched every 50 ms); work the conversation started (`message` `kind:
"work.started"`, carrying the started run's id) is followed in the same card. A card in the
history restores from the server: `GET /api/conversations` lists each turn's run with its tool
count and the work it started. Derivation is `features/conversation/workModel.ts`, one pass over
the log, memoised by the log's length.

| Event | What the card shows |
| --- | --- |
| `run.started` / `run.finished` | status chip (Working · Waiting for you · Finished · Stopped), elapsed time, outcome sentence |
| `estimate.made` / `model.replied` (`settledCredits`, billable) | credits spent against the estimate, as a slim meter |
| `plan.proposed` / `plan.accepted` | the plan: a thin summary track, then every part by name in a stepper with its state as a tag, "n of m parts done" |
| `task.created` / `task.claimed` / `task.done` / `task.failed` | the tasks under each part, who holds each, its outcome |
| `tool.requested` (`agent` `builder-<item>-<round>`, `evaluator-<item>-<round>`) | the part's state (working now / being checked) and grouped tool counts ("read 12 files, changed 4, ran the tests 3 times"); each action in technical mode |
| `evaluation.passed` / `evaluation.failed` (`round`, `needsLook`, `final`) | passed · sent back for repair *n* · needs a look · failed |
| `subagent.started` / `subagent.finished` | research: the three researchers side by side, state and searches used |
| `approval.requested` / `approval.answered` | the approval inside the card (the plan approval shows the plan visual) |
| `message` `kind: "work.started"` | follow the started run in the same card |
| `message` (no kind) | the reply, rendered as markdown |

## Attachments

Stored by the control plane in PostgreSQL (`conversation_attachments`, tenant row-level security,
`bytea` content) — nothing on local disk. Scoped like the conversation and checked like it
(Builder to upload, Viewer to read), deleted with its conversation. An unsent upload is its
uploader's alone and is cleared after a day.

| Limit | Value | Constant |
| --- | --- | --- |
| Files per message | 10 | `ConversationAttachments.MaxFiles` |
| Size of one file | 10 MB | `ConversationAttachments.MaxFileBytes` |
| All files of one message | 25 MB | `ConversationAttachments.MaxMessageBytes` |
| Image size | 40 megapixels | `ConversationAttachments.MaxPixels` |
| Text read from one file | 200,000 characters | `ConversationAttachments.MaxTextCharacters` |

Accepted: PNG, JPEG, WebP, GIF (checked by their bytes, not their names); PDF (text extracted with
PdfPig); text-like files (`.txt .md .csv .json` and code) that are valid UTF-8 with no NUL bytes.
Not accepted: SVG, archives, executables, anything whose bytes contradict its name. To the model:
images as `image_url` parts when every model on the answering route accepts images
(`ModelEntry.InputModalities`), otherwise refused before sending; text as fenced blocks.

## Interfaces

`GET /api/conversations/capabilities?scope=&employeeId=` · `POST /api/conversations/attachments`
(multipart: `scope`, `employeeId`, `file`) · `GET /api/conversations/attachments/{id}/content` ·
`DELETE /api/conversations/attachments/{id}` · `POST /api/conversations` gains `attachmentIds`
and `narrow` · `POST /api/conversations/estimate` gains `attachmentIds` · `GET /api/conversations`
gains `attachments` on owner messages and `turns` (each run's tool count and the work it started) ·
`GET /internal/runs/{id}/attachments` (Runner). Shapes: `src/frontend/src/store/types.ts`.

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| Blobs in PostgreSQL | No blob store exists; the control plane mounts no volume; backups already cover the database | A file volume (a second thing to back up), an object store (a third service) |
| "Connectors" are the platform's own services, skills, tools and inbound MCP assistants | Endgame has two outside services only (assumptions log, entry 51) | Third-party integrations |
| Narrowing only, per message | The autonomy rules are the owner's; a message may ask for less, never more | A per-message widening |

## Links

Spec §"The conversation" · ARCH-004 (run log, conversations) · ARCH-006 (the harness) ·
ARCH-009 (demo) · flows TALK-01 to TALK-21.
