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

The conversation is always one pane, docked at the right, scoped to the page's subject — never a
card inside a page. A page hands it to the shell (`AppShell`'s `talk`, built by
`usePageConversation`); the shell places it by the viewport.

| Page | Scope of its conversation |
| --- | --- |
| Home (`/`) | The level selected on the org chart: organisation, division, project, app or employee |
| An app (`/apps/{id}`) | That app |
| An employee (`/employees/{id}`) | That employee (not a contractor, not someone let go) |
| A piece of work (`/runs/{id}`) | The level the work belongs to (`run.scope`: its app, project or division) |
| A verdict (`/ideas/{id}`) | The level the idea belongs to (`idea.scope`) |
| Every other page (credits, people, secrets, autonomy, hiring, notifications, account, the tree, God mode) | None: a tool page has no subject to talk to; the phone's "Talk" and the tablet header's chat icon (present on every tablet page) go home and open the conversation there |

| Width | Placement |
| --- | --- |
| Desktop (≥ 1,024 px), every width up to and past 2,560 | Docked to the **window's** right edge, under the sticky header, full remaining height. Only the page column is capped (`max-w-frame`) and centred in the room the pane leaves; the header bar runs the whole width. Narrow `dock` (26 rem) or `dock-wide` (34 rem, the default from 1,880 px); "Make the pane wider" pushes the page aside only from 1,500 px (`WIDER_FROM`); below that the wide pane is a drawer over the page's edge, so the page never drops below about 960 px |
| Side cards beside a docked pane | In the page column: beside the page from `3xl` (1,600 px), under it two across from 1,024 to 1,599 px; with the pane collapsed, beside it from `lg`. Real pages (app, employee, run, verdict) pass both `aside` and `talk` |
| Collapsed | A 3.5 rem rail at the window's edge: the avatar, a chat mark, "Talk to {name}" read up the rail, typing dots while a reply is written, a dot per piece of work under way, and an unread marker when a reply finished while it was closed |
| Full width | The page is hidden; header, strip, thread and composer share one centred `prose` column |
| Tablet (640–1,023 px) | A drawer from the right (`Sheet side="side"`, `dock` wide), opened from the header's chat icon (on a page with no subject the icon goes home and opens the drawer there); the composer is always on screen. Pages may also place `TalkLauncher` |
| Phone (and a phone on its side) | The full-screen sheet, from the bottom bar's "Talk" or the page's launcher |
| A low window (`low:`, under 800 px tall: 1,366×700, tablets and phones on their side) | The pane header is one line (the title first, the level's × beside it), the "also happening" strip folds into a count in the header, the cost line is one line, and under 500 px tall the composer's tools are icons only, so a work card can be seen whole |

The header names who is being talked to and the level, with the level just above as a way back up
and an × that talks to the whole organisation again; on a desktop it carries narrow/wide, full
width and collapse. The "also happening" strip is a solid band with a divider, every row with the
same dot, the security reviewer "reviewing" whatever the work is. The thread fades at both ends
(`fade-y`). Width and collapsed are remembered per person (`localStorage`, keyed by user id) — a
per-device convenience, not state.

The **empty state** says who answers here and what it can do at this level, then three suggested
prompts as content-sized chips, built from the scope's real data; never canned filler.

### A turn, in a fixed order

Each message a person sent, then everything its run said and did, always in this order:
the answerer's name → one steps row ("*n* steps · what they were ▾ · See how it got there ↗",
opening the list beneath) → the reply → each approval it asked for — waiting, the question
itself; answered, a **receipt** (what was proposed, Approved/Declined, by whom from
`approval.answered.byName`, when, the note) → what was said after the answer, in a bubble of its
own → Endgame's own notices → the work it started, one card each, after the words that
announce it (`turnModel.ts`: `turnsOf`, `receiptsOf`, `segmentsOf`).

A turn is a run on the control plane, so it is never lost: a history turn whose run has not
ended is followed live again after a reload ("Working on it", then the reply); one that ended
with nothing said (`turns[].endedWithoutReply`, or a failed or cancelled run with no reply and
no notice) says "The reply was interrupted" with its reason and **Try again**. A message the
control plane refused says "Not sent: {why} · Send again" under its bubble. "New reply" appears
only when something marked as news (`data-arrival`: a live reply, a card it started) is drawn
below what can be seen — never for an earlier turn filling in as it is scrolled to — and is docked
above the composer, outside the thread.

## Composer

- A text area that grows to 8 lines (fewer in a phone's sheet: `composer-sheet`); Enter sends,
  Shift+Enter is a new line. Its toolbar has **one form for the pane's width**: tools named under
  their icons wherever the pane is 400 px or wider, icons with tooltips below (and on a window
  under 500 px tall); it never changes while someone types or a reply is written. While a reply is
  being written and the box is empty, Send is **Stop** in the same place
  (`POST /api/runs/{id}/control` `cancel`); a disabled Send is pale, with no ring.
- **Attachments** by button, drag-and-drop onto the pane, or paste: compact chips with name, size
  or "Adding…", remove, and a thumbnail for images, wrapping onto rows; past two rows the rest fold
  into "+n". Uploaded as soon as they are added (`POST /api/conversations/attachments`), sent with
  the message by id. A refused file keeps its chip in its error state with its reason on it, so
  several refusals stand together; an image where the answerer reads text only is marked on its
  chip too. "Wait for the files to be added." is said only if Send is pressed while one uploads.
- **"What it can use here"** (`GET /api/conversations/capabilities`): who answers and how
  strongly it thinks; the tools it may use, in the hire page's plain names; the work it can start
  here; the skills the builders here load; the platform services the apps here have; web search as
  "May / Asks you first / May not" under the autonomy rules; the organisation's AI assistants.
  Two **one-message narrowings** are offered where they apply — "Don't search the web for this
  one", "Answer only: start no work" — sent as `narrow` and enforced by the Runner. Nothing widens.
- **"/" menu**: the actions the conversation can take at this scope (from `capabilities.actions`),
  each with its own icon and a two-line description. **"@" menu**: an employee or an app beneath
  this scope (a role that repeats the name is shown as its kind); choosing one re-targets the
  message. Both stay open with "nothing matches". Menus open above the composer with a gap and the
  thread dimmed behind; on a phone or a tablet they and "What it can use here" are sheets the
  conversation's full width. **Escape closes only the topmost layer** — a menu, then the panel,
  then the sheet. "What it can use here" uses one neutral chip style.
- The cost line is kept (rule 11), one short line (`messageCostShort`) the same before and after a
  reload, the full sentence (`messageCostLine`) in its tooltip, and counts the attachments
  (`POST /api/conversations/estimate` with `attachmentIds`): "Files counted."

## The work card

The card leads with the work in at most two lines (the whole request behind "Show what was asked")
and its status, so the eye lands on the plan. It is never wider than reading width (`max-w-prose`).
Under the title: who is doing it, **working time and waiting-for-you time apart** (from
`approval.requested`/`approval.answered`), and the credit meter — over its estimate the bar is
full and the excess is said ("· 7.6 over"); an estimate made again from the plan is said on the
card ("Re-estimated after planning: about 15 credits (was about 10)", `estimate.made` `stage: plan`
with `previousCredits` and `reason`). The plan: one equal segment per part and one for the security
review; each part's name clamped to two lines with its tag beneath and every chevron in one column;
nodes joined centre to centre — an empty ring waits, a ring with a moving arc works. Parts a try
again carried over (`plan.carried`) read **"Done before"** and count as done. A task names its
holder (`task.claimed.holder`, a role while nobody is hired, `holderKind`), "Being worked on" when
it is worked with no name, and "Unassigned" only when nobody has it and nothing is done. Researchers
sit side by side, as rows below 400 px, saying in the present tense what each is looking for, then
"Reported · *n* searches". A finished card folds to **one outcome row**: the sentence, then
Open {app} / Read the verdict / Try again at natural width, the whole run, and the cost; the plan is
a press away. Other work at the level sits in the "also happening" strip, not in the thread.

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
`GET /internal/runs/{id}/attachments` (Runner). `GET /api/conversations` `turns[]` gains
`replied`, `endedWithoutReply`, `interruption`; `approval.answered` gains `byName`; `task.claimed`
gains `holderKind`; `estimate.made` (plan) gains `reason`, `previousCredits`. A turn's run, its
files, its opening message and estimate are written in one transaction. Approval titles from the
conversation name places by their display names (`PlaceNames` reads `/internal/contents`) and quote
the owner's own words, cut at a word; the assistant may answer in Markdown (lists, tables, headings
for long answers, code when asked) and link apps, people, work and ideas as chips.
Shapes: `src/frontend/src/store/types.ts`.

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| Blobs in PostgreSQL | No blob store exists; the control plane mounts no volume; backups already cover the database | A file volume (a second thing to back up), an object store (a third service) |
| "Connectors" are the platform's own services, skills, tools and inbound MCP assistants | Endgame has two outside services only (assumptions log, entry 51) | Third-party integrations |
| Narrowing only, per message | The autonomy rules are the owner's; a message may ask for less, never more | A per-message widening |
| One docked pane, scoped to the page, on every page with a subject | A conversation inline in a page sat 1,800 px down, scrolled inside the page's scroll, and differed from home (round-2 review) | Inline cards on app and employee pages; an organisation-level pane on every page (tool pages have no subject, and the pane would narrow every one of them) |
| The pane at the window's edge, the page column capped | At 2,560 a capped frame left the pane 180 px short of the edge | Capping the whole frame |
| Turns rebuilt from the server, followed again while unfinished | A reply in flight lived only in the tab's memory, so a reload lost it | Keeping drafts of replies in browser storage |

## Links

Spec §"The conversation" · ARCH-004 (run log, conversations) · ARCH-006 (the harness) ·
ARCH-009 (demo, the `talk-*` scenarios) · flows TALK-01 to TALK-23.
