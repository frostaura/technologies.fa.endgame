# ARCH-010 — The Endgame Academy

| Field | Value |
| --- | --- |
| **ID** | ARCH-010 |
| **Title** | The Endgame Academy: documentation and step-by-step training, beside a live console |
| **Status** | Current |
| **Covers** | `src/academy/`, `.github/workflows/pages.yml`, the `academy-*` and `site` Makefile targets |

## Context

The academy is the product's documentation and training: every flow in `docs/flows/` taught step by
step, with a live, interactive copy of the console beside the steps that moves to each step's state.
Clients learn the product from it; FrostAura's operators learn God mode and running the platform
from its separate operator handbook. It is a static site on GitHub Pages at
`https://frostaura.github.io/technologies.fa.endgame/`, and it must also work from `file://` and as
a PDF.

Constraints: the markdown in `docs/flows/` is the single source of truth (nothing is hand-copied);
the site makes no network call except to its own static files; one token layer, shared with the
console; zero warnings; no placeholder copy.

## Components and boundaries

```
docs/flows/0*.md + README.md ─▶ tools/parse-flows.ts ─┐
src/academy/scripts/<ID>.json ─▶ tools/validate-scripts.ts ─┼─▶ src/generated/ (git-ignored)
                                 SITE_URL ─▶ QR code ─┘        content · scripts · search index · site
                                                                        │
                                              Vite + React + Tailwind ◀─┘   (console preset imported)
                                                        │
                       make site ─▶ site/ ── academy at the root, demo under demo/, 404.html, PDFs
                                                        │
                                   pages.yml ─▶ upload-pages-artifact ─▶ deploy-pages
```

- **The content pipeline** (`tools/build-content.ts`, `npm run content`) parses the five area files
  and the README's academy path into typed JSON (`src/content/types.ts`): id, title, area and
  section, who (and roles derived from it), starts at (and a console route found in it), needs,
  level, learn-first resolved to flow ids, what you learn, numbered steps with nested lists and
  tables, you know it worked when, variations and refusals, where, reachable from (normalised to
  screen / api / cli / automatic / none, taking the README's own classification where it has one),
  and tests. It is strict and loud: every flow it could not read in full shape is printed with its
  file and line, and a flow with no steps fails the build unless the README lists it under "Not
  placed in a track". A learn-first cycle is reported and broken where it closes.
- **The paths** are the README's tracks (Foundation → Core → Advanced → Developer, and the separate
  Operator handbook), each reordered so every learn-first comes ahead of the flow that needs it.
- **Step scripts** (`src/academy/scripts/<FLOW-ID>.json`) say what each step shows (and its variations, below). Schema:
  `schema/step-script.schema.json`; TypeScript twin: `src/content/scripts.ts`; a unit test holds the
  enums of the two together. Validated at build against the schema and the parsed flows (flow
  exists, step exists, no step twice, images on disk). Coverage is printed by the build and shown on
  the "About this academy" page.
- **Variations** (`variations: [{ title, persona, scenario, start, steps }]` in a script) are the
  branches under "What else can happen" — a refusal, a validation message, an empty state, a limit —
  each played in the live console from its own start, as its own persona and world. Their steps are
  numbered 1, 2, … within the variation and each carries a `note` (there is no flow text beside
  them). The flow page lists them as "Watch it in the live console"; choosing one plays it in the
  stage, with Previous, Next and "Back to the steps".
- **A hand-over** (`persona` on a demo step, with its `goto`): from that step on someone else is
  signed in to the same world — an operator tops up or enters an organisation, then its Owner reads
  the operator log. The player keeps it for every later step (`personaAt`); a jump replays it.
- **The site** (`src/academy/src/`) is React with hash routing and relative URLs, built as one
  classic deferred script (iife) so it runs from `file://`. Content, scripts and the prebuilt search
  index are bundled. Progress lives on the device (see **Progress** below).
- **The step is the address.** `#/flow/<ID>/step/<n>` is the one source of truth for the step being
  read: the highlighted card, "Step n of m", the console and its caption all follow it. Choosing a
  step and the arrow keys push an address (so Back and Forward walk the steps); scrolling the steps
  column replaces it with the step crossing its reading line; an address changed by hand moves the
  step.
- **The console's two sizes** (`theme/tokens.ts` `CONSOLE`, `stage/geometry.ts`). The framed console
  is always drawn at a fixed size and scaled to fit its frame, so a lesson plays on the layout its
  script was written for and nothing in it reflows from step to step: a laptop's 1280 × 800 for every
  desktop and tablet window (the conversation pane docked, every desktop control there), and a
  phone's 390 × 640 — its bottom tab bar — in a phone-shaped frame for a phone held either way. A
  script with `device: "phone"` (SHL-07, "Use the console on a phone") is taught on the phone's at
  every size. The frame's size depends only on the window, never on the step: the largest frame of
  the console's shape that fits the space, set at its top; a terminal, request, e-mail, code or
  picture step fills the same frame from the top and says when it scrolls ("More below").
- **The player's layouts** (`pages/FlowPage.tsx`, `stage/Stage.tsx`). On a wide screen (`split:`,
  not a phone on its side) the player is one view under the header (`h-player`): a compact title
  band, the frame as the hero beside a side column (`grid-cols-player-sm`, 22 rem, under 1536 wide;
  30 rem from 1536) that scrolls on its own and fades at both ends, and under the frame the caption
  strip and the controls. On a window of laptop height (`compact:`, 920 px or less) the lede moves to
  the top of the side column and the strip is two lines, so the console keeps the height. On a phone
  held upright the full title is above the frame and the phone frame is as tall as the screen allows;
  on a tablet held upright the title, chips and lede are above the laptop's console across the page;
  on both the controls are fixed to the bottom edge and the page keeps their height free. On a phone
  on its side (`phone-side:`) the site's header steps aside, the frame takes the whole height, and a
  strip beside it carries the way back, the title, the step's words and the controls.
- **One caption, never over the console.** A step's caption is set in one fixed-height strip under
  the frame at every size, starting with the step's number — the number the ring in the console
  carries on its corner (ARCH-009). On a desk or tablet it is the highlight's note (or the step's own
  `note`); on a phone, the step's own words, two lines, with "More" to read the rest and the note.
  The academy sends a spotlight its number and never its words. The frame is named with
  `aria-label`, never `title`.
- **One row of controls.** Previous · where you are · Try it yourself · Show me again · Next, each in
  a fixed place (`components/StepPager.tsx`): an action that does not apply to a step is disabled in
  its place, never removed, so nothing in the row moves. "Try it yourself" clears the ring, gives the
  frame an accent edge and the strip "You're driving — Back to the lesson"; the frame offers it on
  hover and focus. On a phone, "Larger console" is a full-screen sheet with Close and the controls.
- **Progress** (`src/progress/`) is plain data and pure functions (`model.ts`: seen, done, resume,
  clamp, merge, the streak, the export code; `derive.ts`: per-path counts, next up, milestones), a
  store over `localStorage` (`store.ts`), and one instance wired to the content (`lib/progress.ts`).
  A step is *seen* once it has been on screen for 800 ms; a flow is *done* when its last step is
  seen, or by "Mark as done". It is read synchronously before the first paint, so nothing that
  shows progress moves the page when it appears. Details under **Data**.
- **Small screens.** Below the `split:` query (`theme/tokens.ts`: 1024 px wide, or a phone or small
  tablet on its side) a sideways swipe over the stage or the steps walks them (`lib/swipe.ts`; a
  mostly vertical stroke, a short one, or one that starts in a field or something that scrolls
  sideways is left alone). Choosing a step in the list goes back up to the frame. On a phone the
  header is the mark, the way back to where the learner left off, search and a menu; the rest opens
  as a sheet from the bottom edge (`components/Sheet.tsx`, the browser's `<dialog>`). Heights use
  `svh` (the stage never jumps as the address bar collapses), the full-screen demo `dvh`;
  `viewport-fit=cover` with safe-area padding keeps content off the notch and the home indicator.
  Every control is at least 44 px.
- **The demo at phone width.** The phone frame draws the real console at 390 × 640, which is its
  phone layout with the bottom bar; its ring and cursor are drawn inside the frame (fixed to the
  frame's viewport, and `reveal` scrolls only the demo's own page), so they stay on screen with it.
- **Placeholders** in the flow text (`{Org}`, `{credits}`, `{reason}`) are set as a small variable
  token of what they stand for ("your organisation's name", "number of credits"; otherwise the word
  in the braces, de-camel-cased — `src/content/placeholders.ts`), on the site and in the PDFs. The
  flow files keep their braces; code spans are left as written.
- **Inline styles on a dark panel** (`Inline tone="dark"`, the "You know it worked when" panel) have
  their own colours; `components/inlineStyle.test.ts` holds every inline style to WCAG AA on the
  ground it is drawn on.
- **The stage** beside a flow's steps shows, per step: the live console (`demo`), a terminal that
  types the command and prints its output (`terminal`), a request and its response (`request`), the
  e-mail as it arrives (`email`), code a hosted app runs, set like the terminal with what it returns
  (`code`: `language`, `code`, optional `output`), or a captured screenshot (`image`). When the live
  console cannot load, a demo step shows the image `make academy-shots` captured for it. An unscripted screen flow opens
  the live console on the route named in its "Starts at". With nothing to play, the stage shows the
  flow's facts (worked-when, where in the code, the tests that prove it).
- **The bridge** (`src/bridge/`) is the only way the academy touches the demo. The demo is lane D's
  build of the real console on mock data, served at `./demo/index.html?embed=1`. The academy never
  reaches into the frame's DOM.
- **The test double** (`test-double/demo/`) implements the demo side of the bridge and shows what it
  was asked to do. `vite dev` serves it at `/demo/`; the browser test routes `./demo/**` to it. It is
  never built or published.

## Interfaces

### The bridge (postMessage)

Envelope, both directions: `{ source, id, op, args? }`. The academy sends with
`source: "endgame-academy"`, target origin `"*"` (a `file://` page has origin `null`); it accepts a
message only when `event.source` is the frame's own window and `source` is `"endgame-demo"`.

| Academy → demo | Args | Answered by |
| --- | --- | --- |
| `goto` | `{ route, persona, scenario }` | an echo of `id` |
| `highlight` | `{ selector? , testId? , text?, marker?, region?, none? }` — `{}` clears | an echo of `id`, with `found` |
| `act` | `{ actions: Action[], instant?: true }` | `step-done { id }` once every action has played (an echo before it is an acknowledgement) |
| `clock` | `{ play: true }` · `{ pause: true }` · `{ seek: ms \| moment }` | an echo of `id` |
| `reset` | `{}` | an echo of `id` |

`Action` is one of `{ click: Target }`, `{ hover: Target }`, `{ type: { into: Target, text } }`,
`{ select: { into: Target, value } }`, `{ press: key }`, `{ wait: ms | Target }`, `{ clock: … }`,
`{ attach: { files: [{ name, text? | base64? }] } }` (files into the open conversation's composer); a `Target`
is `{ selector? | testId? | text? }`, where `text` is the visible label of a control, quoted exactly
as the flow quotes it. `instant: true` asks for the end state without the motion (catching up).

| Demo → academy | Args |
| --- | --- |
| `ready` | sent once when the demo can take ops |
| `route` | `{ route }` whenever the console's address changes |
| `step-done` | `{ id }` of the `act` that finished |
| `error` | `{ message }`; as the echo of a request it fails that request |

Timeouts: no `ready` within 8 s marks the console unavailable for that page; an op unanswered in
10 s (an `act` in 30 s) is dropped and the next one plays. The academy then says once, plainly,
that the live console could not be loaded, and every step still shows its text and facts.

**Playback** (`src/bridge/player.ts`). Ops for a step go in the order goto, clock, act, highlight.
Moving on by one step plays only that step; a step the script leaves out, or one shown another way,
sends only `highlight {}`, so no step shows the ring of another. Jumping, going back, or "Show me
again" sends `reset`,
`goto` the script's start, replays every earlier step's `goto`/`clock`/`act` with `instant: true`
and no spotlight, then plays the target step in full. Requests play strictly in order; one
superseded by a newer step still plays, instantly and without its spotlight, so the console never
skips a state. A step with no spotlight of its own sends `highlight {}`, and the demo clears the
ring and note as a step's actions start, so the step before's caption never stands over the new
state.

**One moment per step.** A step's live play, a link straight to it, and its captured picture show
the same moment: the end of that step's actions and spotlight. Nothing in the demo moves on a timer
of its own that a step relies on — the device sheet waits for a step to choose on it or to `wait`
(ARCH-009) — and `make academy-shots` plays each step's actions as the learner's console does (not
instantly), so a busy moment a step teaches ("Inviting…") is what its picture shows.

### Personas and scenarios

`persona` and `scenario` are the demo's own (ARCH-009); the schema lists the ones scripts use
(`properties.persona.enum`, `properties.scenario.enum`, held to `src/content/scripts.ts` by a unit
test), and a name is added there when a script first needs it. Routes may name the scenario's records as `{idea}`,
`{run}`, `{app}`, `{employee}`, `{hire}`; the demo resolves them. The scripts written so far assume
the `established` world is the organisation **Northwind**, with the division **Technologies**, its
project **Court booking**, and the Admin **Ada Lovelace**.

### Commands

| Command | What it does |
| --- | --- |
| `make academy-install` | installs the academy, and the console's packages if missing (the preset needs them) |
| `make academy-content` | the content pipeline alone, with its report |
| `make academy-readme` | rewrites the counted parts of `docs/flows/README.md` (totals, the track tables, "What has no screen") from the five flow files; `make academy-lint` fails when they differ, so a flow added to a file cannot be left off its path |
| `make academy-dev` | Vite on :5470 with the test double at `/demo/` |
| `make academy-lint` / `academy-test` | ESLint (zero warnings) and tsc; Vitest |
| `make academy-build` | the site into `src/academy/dist/` (`SITE_URL` sets the QR code) |
| `make academy-assemble` | runs `make demo-build` when that target exists, then assembles `site/` |
| `make academy-pdf` | `site/academy.pdf` and `site/operator-handbook.pdf`, headless Chromium |
| `make academy-e2e` | Playwright against `site/` served under `/technologies.fa.endgame/` |
| `make academy-shots` | plays every step script against the built demo (fixed clock and viewport, reduced motion, each act played as the academy plays the step and awaited) and saves one WebP per demo step and per variation's last step under `public/shots/<FLOW-ID>/`, with `index.json`; a picture identical to the step before is named, not saved again, and unchanged files are not rewritten. `ACADEMY_FLOWS` limits it; `SHOTS_PORT` (default 5691) moves its server |
| `make site` | shots, build, assemble, PDFs — the print version sets each step's picture beside or under its text: a crop to the whole card the step rings, with padding, never cutting a line of words (`tools/print-crop.ts`), printed so its smallest words are 7.5 pt, or the whole screen; never the cursor or the step's number. Each picture is a JPEG named by its bytes, so one shared by several steps is embedded once; the PDFs carry an outline of every path and flow. Each PDF page past the cover has a running header and its number, and the contents give each flow's page (`tools/render-pdf.ts` renders twice, reading the pages from the first pass's named destinations) |
| `npm run script:new -- <FLOW-ID>` | scaffolds `scripts/<FLOW-ID>.json` from the parsed flow |

`DEMO_DIST` (default `src/demo/dist`) names the demo build that `site/demo/` is copied from.

## Data

Nothing is stored server-side, and there are no accounts (assumption 50): progress is per device.
The browser keeps `endgame-academy:progress:v2` in `localStorage`:

```
{ v: 2,
  flows: { "<FLOW-ID>": { step, furthest, done, started, seen, doneAt } },   // epoch ms; 0 = unknown
  last:  { flow, step, at } | null,                                          // "pick up where you left off"
  days:  ["2026-11-26", …] }                                                 // local days with a step shown, ≤ 400
```

- **Keyed by flow id, read against today's content**: an alias is filed under its flow, a step past
  a flow's new end is clamped to it, and a flow that is gone (or has no steps) is dropped without a
  word. The first version (`…:v1`, seen/done only) is carried forward once and removed.
- **Unavailable storage** (a private window, blocked site data, a full quota) is probed once; the
  store then keeps progress in memory for the visit and the progress page says so quietly. Another
  tab's change arrives through the `storage` event.
- **Pick up where you left off**: the cover, the Learn page and the progress page carry a card with
  the flow, "Step n of m" and its segments; the header carries a "Resume" pill (or "Next up", once
  that flow is finished). Opening a flow begun and not finished, with no step in the address, lands
  on its step, and the pager offers "Start from the beginning".
- **Derived, never stored**: per-path counts (the operator handbook apart from the client paths),
  *next up* (the next flow not done in the path's order — after the one just finished, then from the
  top — with any missing "Learn first" put ahead of it, however deep), the badge per finished path,
  the milestones (first, 10, 25, 50, 100 flows where the academy has that many; a whole path; every
  path, each dated from `doneAt`), and the streak (days in a row ending today or yesterday). So a
  reset, an import or a content change can never leave a badge the record does not prove.
- **The end of a flow**: Next on the last step is "Finish", which brings in "You know it worked
  when" and — once the flow is done — "Done — next: …", the path's count, any milestone it earned,
  and the next flow one tap away (in the panel and in the pager). A polite live region says it.
- **"Your progress"** (`#/progress`): the overall figure, the paths and their badges, milestones,
  the operator handbook apart, and the controls: export as a file or an `EGA2.` code (base64url of
  a compact JSON), import by pasting or choosing a file (merged: the furthest step of each flow, the
  earliest start, the newest place, every day), and reset after a confirmation. One line says it
  stays on the device.
- Progress is never drawn on paper: the print route renders no shell, so the PDFs carry none of it.

## Invariants

- The markdown is the only source of flow text; `src/generated/` is never committed
  (`src/academy/.gitignore`).
- A flow with no steps fails the build unless the README lists it as not placed —
  `tools/parse-flows.ts`, proved by `tools/parse-flows.test.ts`.
- Every script validates against the schema and the flows, or the build fails —
  `tools/validate-scripts.ts` and its test.
- No colour literal in the academy's source; every colour, radius, shadow, font and motion is the
  console's, through its Tailwind preset — `src/theme/tokens.test.ts`, and ESLint refuses arbitrary
  Tailwind values.
- Client navigation (paths, browse, search) never lists an operator-handbook flow —
  `tests-e2e/academy.spec.ts`.
- The site requests nothing but its own files; the QR code is generated at build.
- The Pages workflow runs on push to `main` and manual dispatch only, never on a schedule.
- Nothing on a phone scrolls sideways: every page type is checked at 390 × 844 with touch
  (`document.documentElement.scrollWidth <= clientWidth`) — `tests-e2e/academy.spec.ts`.
- Progress never leaves the device, and the model's rules (seen, done, resume, clamp, merge, reset,
  import and export, storage unavailable) are held by `src/progress/*.test.ts`.

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| Hash routing, one classic iife script, content bundled | Works under any sub-path, on Pages without rewrites, and from `file://`, where module scripts and `fetch` are refused | History routing (needs rewrites); fetching JSON at runtime (fails from `file://`) |
| The README's track tables decide each flow's path and how it is reached | They are the documented academy path; the per-flow "Level" agrees with them | Deriving paths from the Level field alone |
| A prebuilt MiniSearch index with ids and hyphenated words kept whole | Typing a flow id or a message seen on screen must find the flow | A runtime-built index; a hosted search service (a network call) |
| The bridge is postMessage with an envelope and echoed ids | The demo is a separate build by another lane; a message contract can be diffed and tested from both sides | Reaching into the iframe's DOM (couples the academy to the console's markup) |
| Spotlights by visible text, quoted exactly as the flow quotes it | The console carries almost no `data-testid`s, and the flows already name every control's words | CSS selectors into the console's markup |
| PDFs rendered from the site's own print route | One source; the print version is a page like any other | A second, PDF-only template |
| Progress per device, in `localStorage`, moved between devices by a file or a code | The site is static with no server, and makes no request beyond its own files; accounts would add a service and personal data for a learning aid | Accounts and a sync service; a URL that carries the progress (it would leak into history and shared links) |
| On a wide screen the player is one view with the steps in a column that scrolls beside the console, rather than a long page with a sticky console | The console, the title and every control are in view on arrival at any size, the console never slides under the header, and on a 2560 screen the console gets the width | A long page with the console sticky beside the steps (controls fell below the fold; the console was capped at about 850 px) |
| The console is drawn at one fixed size per device — a laptop's 1280 × 800, a phone's 390 × 640 — and scaled to a frame whose size depends only on the window | Every lesson plays on the layout its script was written and checked against, at every window size; the console never reflows, rewraps or changes zoom between steps; a phone learner sees the phone's real console, bottom bar and all | Drawing the console at whatever width the frame had (774–982 px on a laptop: the conversation stacked, desktop controls missing; a 341 × 449 phone frame showed the rail layout no phone shows) |
| One caption strip under the frame, and the step's number on the ring | A caption never covers what it explains, never jumps between inside and outside the frame, and never changes the frame's height | A bubble placed beside the ring inside the console (it covered neighbouring content, drifted from its ring, and resized the frame when it moved out) |
| `svh` for the stage, `dvh` only for the full-screen demo | The stage must not resize as the address bar collapses mid-scroll (the frame would reflow under the learner) | `vh` (too tall with the bar shown on iOS); `dvh` (jumps) |
| Captured images are generated, not committed (`public/shots/*/` is git-ignored); the Pages workflow makes them | They are reproducible from the scripts and the demo, and committing hundreds of binaries would churn the repository on every screen change | Committing them (repository growth, stale pictures) |

## Not built yet

- Lane D's demo console. Until it ships, `site/` has no `demo/`, and every live step degrades as
  described above.
- Scripts for any flow still without one; the build prints how many are scripted, and the About
  page shows it.
- A variation for every refusal in "What else can happen": scripts carry them flow by flow.

## Links

`docs/flows/README.md` (the fields and the academy path) · `src/academy/schema/step-script.schema.json`
· `src/academy/tests-e2e/academy.spec.ts`
