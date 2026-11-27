# ARCH-011 — The console's design system

| Field | Value |
| --- | --- |
| **ID** | ARCH-011 |
| **Title** | The console's design system: tiers, primitives, status vocabulary, palette |
| **Status** | Current |
| **Covers** | `src/frontend/src/lib/tokens.ts`, `tailwind.config.ts`, `src/frontend/src/components/ui/**`, `src/frontend/src/components/states.tsx`, `src/frontend/src/features/shell/**`, `src/frontend/src/design.test.ts` |

## Context

Three blind visual reviews of the console (desktop, the real stack, the console inside the academy's
frame) and a fourth at phone and tablet sizes found about 240 problems. Most were the same few
missing pieces seen on many screens: a side panel drawn as a full-height white slab, sentences set
in big-number slots, chips that wrap, five tints and three gradient heroes on one screen, dashed
boxes that read as placeholders, four confirmation styles, a header that wraps at 768 px, and a
phone on its side drawn as a stretched portrait. This document is the shared layer that replaces
them. Every feature lane builds on it; none re-draws it.

The house look is **black on white with one accent** (`primary`, blue). Status colour lives only in
small tags and meters. `docs/design/canvas/` remains the reference for layout, copy tone and motion;
where it shows a gradient band or hue-coded icons, this document wins.

## Layout tiers

Widths are the console's own viewport (inside the academy's frame, the frame's width).

| Tier | Width | What the shell does |
| --- | --- | --- |
| phone | < 640, or short and < 1024 | One column, the compact sticky header (it tucks away on scroll down and returns on scroll up), the bottom bar, sheets. |
| **rail** (`rail:`) | height < 500 and width < 1024 — a phone on its side | The bar becomes a 4.5 rem rail at the left edge; the header is one line; the page and its side panel sit side by side; bottom sheets come in from the right. |
| tablet | 640–1023 | The full header on one row (Sign out and System as icons); the side panel's cards under the page, two across. |
| desktop | ≥ 1024 | The page beside the side panel (22 rem). |
| `xl` | ≥ 1280 | The trail moves into the header row; Sign out and the credits pill's "left" show their words. |
| `3xl` | ≥ 1600 | `ContentGrid` sets independent sections two across; the side panel widens to 26 rem. |
| `4xl` | ≥ 2000 | The whole console (header, page, panel) is capped at `layout.width.frame` (2200 px) and centred. |

Text runs at a readable measure (`max-w-prose`) wherever it is a paragraph. `touch:` marks any screen
worked by touch (a coarse pointer, or the phone layouts): every control there is at least 44 px, on a
tablet as on a phone.

## Primitives

| Primitive | File | Use it for | Rules |
| --- | --- | --- | --- |
| `AppShell` | `features/shell/AppShell.tsx` | Every page's frame | Pages pass `crumbs`, `aside` or `talk`, and children. Never draw a page's own outer columns. |
| Side panel | `AppShell` (`SidePanel`) | Whatever a page passes as `aside` | Each top-level block is drawn as a card that ends with its content. The column sticks while it fits the screen and scrolls with the page when it does not. |
| `SideCard` | `components/ui/page.tsx` | A titled card in the side panel | — |
| `useShowAll(items, n)` | `components/ui/page.tsx` | Any list that can outgrow a screen (a run's tasks, an employee's memory) | Shows the first `n` and "Show all N". |
| `PageHeader`, `TITLE`, `SECTION` | `components/ui/page.tsx` | The page's h1 (one size: 3xl, 2xl on a phone) and a section's h2 | Title icons are ink, never tinted. |
| `ContentGrid` | `components/ui/page.tsx` | Independent sections | One column, two from 1600. `masonry`: sections of very different heights flow down two columns, each under the one before, never in rows that leave holes (the verdict's evidence). |
| `Stat`, `StatRow`, `NO_VALUE` | `components/ui/stat.tsx` | **Every big number** | The value is short: a number, a few characters ("73%", "53% under") or one word ("Healthy"). Anything longer is the caption; the value is then "—". Tabular body figures. A `StatRow` has a fixed number of equal slots; `meters` reserves the meter's place in every tile so captions align. |
| `Badge` (the status tag) | `components/ui/badge.tsx` | A status | Five tones only (below). One line; cut with a tooltip. |
| `Chip`, `PersonChip` | `components/ui/chip.tsx` | A name, a count, a person | One line, never wraps, solid. A person's avatar colour comes from their stable id. |
| `ConfirmCard` + `danger` button | `components/ui/confirm.tsx` | Drop, cancel, decline, delete, remove, revoke, stop sharing, let go | A white card in place: the question, what follows, a destructive confirm and a quiet way back. Escape cancels. It scrolls itself fully into view above a phone's bottom bar. `onSubmit` + children for one that takes a reason. |
| `Failed` | `components/states.tsx` | A read that failed | An error icon (never the shield). A 401/403/404 on a whole page is the `NotFoundPage`. |
| `NotFoundPage` | `components/states.tsx` | Nothing at this address, not yours to see | Fills the frame: what happened, then the places to go. |
| `Empty` | `components/states.tsx` | A read that worked and found nothing | Quiet text and one action. No box. |
| `Working`, `Spinner` | `components/states.tsx` | Something being worked out | A spinner beside the words; `Spinner inherit` inside a busy button. |
| `Fold` | `components/Fold.tsx` | A section a phone folds away | Open, every fold's row is the same section heading. |
| Trail | `features/shell/crumbs.ts` | The breadcrumb, desktop and phone | Always from the organisation; ancestors linked; the current place in ink; one separator; a place named like its parent shown once. `crumbShort` (a crumb's `short`, or its label cut at 32) is the header's and the trail's name; the h1 carries the full title. |

## The status vocabulary

| Tone | Colour | Means | Statuses |
| --- | --- | --- | --- |
| `neutral` | grey | A fact, no judgement | Private, Asleep, Archived, To do, Waiting to start, Cancelled, Withdrawn, Declined, Revoked, Expired, Not built (yet), Health unknown, Nothing to do, Free, Let go, Taken / Set aside, No longer waiting, Not published (as "—"), roles (Owner, Admin, Builder, Viewer), "You declined to start this" |
| `info` | blue tint (the accent) | Under way, or a plain setting | Working, In progress, Building, Planning, Researching, Awake, Always on, Waking, Public, Shared with N, Proposed, Hire proposed, Set here, Said here, Working in it now, Waiting for FrostAura |
| `good` | green | Finished well | Healthy, Done, Finished, Live now, Passed its check, Agreed, Hired, Added, Active, Registered, In credit, Fits the budget |
| `warn` | amber | Waits on a person, or is held | Waiting for you, Needs you, Verdict waiting, Approval needed, Paused, Struggling, Sent back, Below zero, Nothing to do for N days |
| `bad` | red | Failed or refused | Did not succeed, Down, Stopped, Refused, At its limit, More than the budget has room for, Research did not finish |

"Declined by you" and "Not published" are never red or green. A verdict's kind is one tag on a white
hero: build `good`, change `info`, do not build `bad`.

## Palette

`tokens.ts` roles, and where each may appear:

- `ink`, `ink-body`, `ink-muted` — text. `surface` (white) — cards and heroes. `ground` — the page.
- `primary` — the one accent: buttons, links, the selected state, meters.
- `quiet`, `success`, `warn`, `attention` — status tags and meters only; `attention` also for the
  error alert and the danger button. Never a card's fill or a hero.
- `border`, `border-strong`; `border-field` (≥ 3:1 on both surfaces) for every text box, select and check box.
- `violet`, `teal` — retired from the look. Kept only for chart series and avatar fills;
  `design.test.ts` allows their per-file counts to fall, never rise. The org chart draws every
  division's letter in ink, and the two organisation views ("Who works on what", "How data flows")
  tell their relations apart by the shape of a mark — an arrow out in the accent, an arrow in
  outlined in ink, a hollow ring, the rule a report is indented on — each named in a key that shows
  exactly the marks drawn; neither file may use them at all.
- No gradient band, no drifting aura, no `bg-night`.

## Do and don't (from the reviews)

- Don't put "Not measured yet" in a figure slot (console-desktop 33). Do: value "—", caption "Not measured yet".
- Don't let "Ruth · Software engineer" wrap inside its pill (console-desktop 9). Do: `PersonChip`, cut with a tooltip.
- Don't draw "3 contractors · researching" with a dashed outline (console-desktop 13). Do: a solid `Chip` with a spinner.
- Don't stretch a side card to the page's height (real-stack 20, the 6,292 px notifications panel). Do: cards that end with their content, sticky while they fit.
- Don't show 60 memory cards beside a short page (real-stack 50). Do: `useShowAll`.
- Don't use a pink pill for "Drop this idea?" and a full card for "Let Kasper go?" (console-desktop 22). Do: `ConfirmCard` for both.
- Don't mark a never-published app "Healthy" (console-desktop 34). Do: "—" with "Not published yet".
- Don't use a shield with a tick for a failure (console-desktop 61). Do: `Failed`'s error icon.
- Don't stretch the portrait layout across a phone on its side (console-small 4). Do: the rail tier.

## Guards

`src/frontend/src/design.test.ts` (Vitest, part of `make test-frontend`): no figure-sized text outside
`Stat`; `border-dashed` only in the drop-zone allowlist; chips and tags never wrap; the status tones
are exactly the five; violet and teal may only fall; no gradient or aura; field edges at 3:1 and every
tag at 4.5:1. `tokens.test.ts` keeps every colour in the token file. `tests-demo/phone.spec.ts`
(part of `make demo-e2e`) holds 44 px targets on a phone and on a touch tablet, a one-row tablet
header in both modes, and the rail layout on a phone on its side.

## Risks and open questions

- The apps an Endgame app factory builds are on this system through the app kit (`@endgame/appkit/ui`): the same tokens
  (the 3:1 `border-field`, the five status tones), one `AppHeader`, and page layouts (`PageHeader`, `PageLayout`,
  `CardGrid`, `FormCard` + `FormActions`, `Checklist`, `NotFoundState`) that a list, a form and a record are built from. On a phone the
  kit's `AppHeader` is two compact rows (the name beside an avatar that opens the person's name and "Sign out"; then the
  places, scrolling sideways, never wrapping), and a form's field errors live in the kit's `useFormErrors`, which clears a
  field's error as soon as it is changed and focuses the first wrong field on a failed submit. The
  template's `AGENTS.md` ("What good looks like") is the builder's checklist; `pageShapes.test.tsx` (the kit's
  `expectPageShape`) and ESLint's `endgame/use-kit-fields` fail an app below it. The demo's reading list
  (`src/demo/hosted/kit.tsx`) carries the same class strings.
