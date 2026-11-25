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
- **Step scripts** (`src/academy/scripts/<FLOW-ID>.json`) say what each step shows. Schema:
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
  index are bundled. Progress (not started / seen / done, and where the learner left off) lives in
  `localStorage`, every access guarded.
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
| `highlight` | `{ selector? , testId? , text?, note? }` — `{}` clears | an echo of `id` |
| `act` | `{ actions: Action[], instant?: true }` | `step-done { id }` once every action has played (an echo before it is an acknowledgement) |
| `clock` | `{ play: true }` · `{ pause: true }` · `{ seek: ms }` | an echo of `id` |
| `reset` | `{}` | an echo of `id` |

`Action` is one of `{ click: Target }`, `{ type: { into: Target, text } }`,
`{ select: { into: Target, value } }`, `{ press: key }`, `{ wait: ms }`, `{ clock: … }`; a `Target`
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
Moving on by one step plays only that step. Jumping, going back, or "Show me again" sends `reset`,
`goto` the script's start, replays every earlier step's `goto`/`clock`/`act` with `instant: true`
and no spotlight, then plays the target step in full. Requests play strictly in order; one
superseded by a newer step still plays, instantly and without its spotlight, so the console never
skips a state.

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
| `make academy-dev` | Vite on :5470 with the test double at `/demo/` |
| `make academy-lint` / `academy-test` | ESLint (zero warnings) and tsc; Vitest |
| `make academy-build` | the site into `src/academy/dist/` (`SITE_URL` sets the QR code) |
| `make academy-assemble` | runs `make demo-build` when that target exists, then assembles `site/` |
| `make academy-pdf` | `site/academy.pdf` and `site/operator-handbook.pdf`, headless Chromium |
| `make academy-e2e` | Playwright against `site/` served under `/technologies.fa.endgame/` |
| `make academy-shots` | plays every step script against the built demo (fixed clock and viewport, reduced motion, each act awaited) and saves one WebP per demo step and per variation's last step under `public/shots/<FLOW-ID>/`, with `index.json`; a picture identical to the step before is named, not saved again, and unchanged files are not rewritten. `ACADEMY_FLOWS` limits it; `SHOTS_PORT` (default 5691) moves its server |
| `make site` | shots, build, assemble, PDFs — the print version sets each step's picture beside its text |
| `npm run script:new -- <FLOW-ID>` | scaffolds `scripts/<FLOW-ID>.json` from the parsed flow |

`DEMO_DIST` (default `src/demo/dist`) names the demo build that `site/demo/` is copied from.

## Data

Nothing is stored server-side. The browser keeps `endgame-academy:progress:v1` in `localStorage`
(per flow: seen or done; the last flow and step); "Forget my progress" on the About page clears it.

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

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| Hash routing, one classic iife script, content bundled | Works under any sub-path, on Pages without rewrites, and from `file://`, where module scripts and `fetch` are refused | History routing (needs rewrites); fetching JSON at runtime (fails from `file://`) |
| The README's track tables decide each flow's path and how it is reached | They are the documented academy path; the per-flow "Level" agrees with them | Deriving paths from the Level field alone |
| A prebuilt MiniSearch index with ids and hyphenated words kept whole | Typing a flow id or a message seen on screen must find the flow | A runtime-built index; a hosted search service (a network call) |
| The bridge is postMessage with an envelope and echoed ids | The demo is a separate build by another lane; a message contract can be diffed and tested from both sides | Reaching into the iframe's DOM (couples the academy to the console's markup) |
| Spotlights by visible text, quoted exactly as the flow quotes it | The console carries almost no `data-testid`s, and the flows already name every control's words | CSS selectors into the console's markup |
| PDFs rendered from the site's own print route | One source; the print version is a page like any other | A second, PDF-only template |
| Captured images are generated, not committed (`public/shots/*/` is git-ignored); the Pages workflow makes them | They are reproducible from the scripts and the demo, and committing hundreds of binaries would churn the repository on every screen change | Committing them (repository growth, stale pictures) |

## Not built yet

- Lane D's demo console. Until it ships, `site/` has no `demo/`, and every live step degrades as
  described above.
- Scripts for the remaining flows (15 of 321 are scripted); a later lane writes them with
  `npm run script:new`.
- A variation for every refusal in "What else can happen": scripts carry them flow by flow.

## Links

`docs/flows/README.md` (the fields and the academy path) · `src/academy/schema/step-script.schema.json`
· `src/academy/tests-e2e/academy.spec.ts`
