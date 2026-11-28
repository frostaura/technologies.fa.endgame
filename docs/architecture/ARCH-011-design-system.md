# ARCH-011 — The console's design system

| Field | Value |
| --- | --- |
| **ID** | ARCH-011 |
| **Title** | The console's design system: tiers, primitives, status vocabulary, palette |
| **Status** | Current |
| **Covers** | `src/frontend/src/lib/tokens.ts` (including `pageAt`, the page column's thresholds), `src/frontend/src/lib/format.ts`, `src/frontend/src/lib/estimates.ts`, `tailwind.config.ts`, `src/frontend/src/components/ui/**`, `src/frontend/src/components/{Fold,Sheet,BottomNav,states}.tsx`, `src/frontend/src/features/shell/**`, `src/frontend/src/design.test.ts`, `src/frontend/tests-demo/{phone,shared-layer}.spec.ts` |

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
| phone | < 640 (any height, upright or not) | One column; the compact header, which is pinned and slides away on scroll down and back on scroll up, naming the PARENT until the page's title scrolls under it and then this place's short name (one name, never the title twice); the bottom bar (five slots, always; its balance tab says "Credits" with the figure as a badge); sheets. A short upright window — a phone with its keyboard open, 375×450 — stays this layout. |
| **rail** (`rail:`) | height < 500, **wider than it is tall**, width 560–1023 — a phone on its side | The bar becomes a 4.5 rem rail at the left edge; the header is one line; the page is ONE full-width column beside the rail, its side cards under it two across; bottom sheets are a panel at the right sized to what they hold. Never applied to an upright window: content is never crushed beside a rail. |
| tablet | 640–1023 | The header on ONE row that never wraps: the mark, the organisation switcher, the Credits chip, Talk (on every page: it opens the conversation's drawer from the right, ARCH-012), the bell and the account menu, which holds the mode switch, System and Sign out below `hd`; where you are on a row of its own. The side panel's cards under the page, two across. |
| desktop | ≥ 1024 | The page beside the side panel (22 rem). |
| `hd` | ≥ 1100 | The mode switch, System (an icon link of its own, never inside the switch) and Sign out sit in the header row. |
| `xl` | ≥ 1280 | The trail moves into the header row; Sign out shows its word. |
| `3xl` | ≥ 1600 | `ContentGrid` sets independent sections two across; the side panel widens to 26 rem. |
| `4xl` | ≥ 2000 | The whole console (header, page, panel) is capped at `layout.width.frame` (2200 px) and centred — except beside the docked conversation, where only the page column is capped and the header runs the window's width over the pane (ARCH-012). |

### The page column

The tiers above are the WINDOW's. A page that changes its own layout — sections side by side, tiles three across, a
column beside its main one — asks the room it really has: the shell's page column (`main`, the named container `page`,
class `page-column`), which beside the docked conversation and the side panel is far narrower than the window (a 1920
window leaves it about 900 px with the pane open, about 1,380 with the pane collapsed to its rail). Its thresholds are
`pageAt` in the token layer, used through three variants that are container queries on `main`:

| Variant | Page column | Use it for |
| --- | --- | --- |
| `page-medium:` | ≥ 48 rem | Two of something small side by side (a dashboard's tiles two across) |
| `page-wide:` | ≥ 60 rem | Two independent sections side by side (an app's Change and Ask, its History and Sharing); small tiles three across |
| `page-split:` | ≥ 73.75 rem (1,180 px) | A main column with a 32 rem one beside it (`grid-cols-run-wide`): a run's steps, and its figures and plan |

A `page-*:` class outranks a window class (`lg:`, `xl:`) on the same property — the room the page has is the last word.
A page never measures its own width in script to choose a layout, never switches its sections on the `4xl` window tier,
and writes no arbitrary container query: a new threshold is a named entry in `pageAt`, exactly as the table's are in
`tableAt`.

Text runs at a readable measure (`max-w-prose`) wherever it is a paragraph. `touch:` marks any screen
worked by touch (a coarse pointer, or the phone layouts): every control there is at least 44 px, on a
tablet as on a phone (the demo suite walks every main screen at 375, 768, 834 and 1024 with touch).

The header's balance is a neutral chip — "Credits", the figure, a small dot: green with room to spend, amber
below zero, red only at a real limit (nothing left to spend, the overdraft included), grey for an organisation
never topped up. Never a coloured pill. God mode is one slim bar (32 px; 44 where worked by touch) — "God mode",
the way out, and a chevron that expands what it means.

## Primitives

| Primitive | File | Use it for | Rules |
| --- | --- | --- | --- |
| `AppShell` | `features/shell/AppShell.tsx` | Every page's frame | Pages pass `crumbs`, `aside` or `talk`, and children. Never draw a page's own outer columns. |
| Side panel | `AppShell` (`SidePanel`) | Whatever a page passes as `aside` | Each top-level block is drawn as a card that ends with its content. The column sticks while it fits the screen and scrolls with the page when it does not. |
| `SideCard` | `components/ui/page.tsx` | A titled card in the side panel | — |
| `useShowAll(items, n)` | `components/ui/page.tsx` | Any list that can outgrow a screen (a run's tasks, an employee's memory) | Shows the first `n` and "Show all N". |
| `PageHeader`, `TITLE`, `SECTION` | `components/ui/page.tsx` | The page's h1 (one size: 3xl, 2xl on a phone) and a section's h2 | **A page's title is words only, on every page** — never an icon beside it. A page is told apart by its title and the trail above it; icons stay where they are consistent: the navigation, side-card and section headings, folds, empty states. A page whose h1 is drawn by hand uses `TITLE`. |
| `ContentGrid` | `components/ui/page.tsx` | Independent sections | One column, two from 1600. `masonry`: sections of very different heights flow down two columns, each under the one before, never in rows that leave holes (the verdict's evidence). |
| `Button`, `buttonVariants` | `components/ui/button.tsx` | **Every button**, and a link that looks like one | At most as wide as its column, measured with its own margins (`max-w-column`: `stretch`, 100% where the keyword is unknown), so a quiet button pulled to its column's edge by a negative margin keeps its words; only a label really wider than its column is cut, whole in the tooltip. Three heights: `sm` 32, `md` 40 (default), `lg` 48 — each at least 44 where worked by touch; `icon` a square of 40 (44). ONE radius (`rounded-xs`). One label size per height (sm/md `text-sm`, lg `text-base`). Variants: `primary`, `secondary` (outlined), `quiet` (words in the link colour), `danger` (only inside `ConfirmCard`), `danger-outline` (the control that asks to remove). One disabled look: a grey fill and muted words, never a faded colour. A page passes only layout classes. Pills are chips, never buttons. A raw `<button>` is for what is not a button visually (a pressable row or card, a tab, a switch, a chevron row). |
| `Stat`, `StatRow`, `NO_VALUE` | `components/ui/stat.tsx` | **Every label and number** | Two looks only: boxed, and `plain` (in a hero or a card already drawn). The value is short: a number, a few characters ("73%", "53% under") or one word ("Healthy"); it is NEVER ellipsised — when its slot is too narrow its type steps down until it fits. The label wraps rather than being cut. The caption is one line from `sm` up (cut, whole in the tooltip); on a phone it wraps and is never cut. It is the tile's last slot, so a caption that wraps moves no tile's top, value or meter; an explanation goes in the text or `Alert` beside it. A meter (and the shared `Bar`) is drawn at its real width from the first frame and eases to a new width on change — never a grow-in from zero, which a page seen or captured in its first frames shows as empty. Tabular body figures. A `StatRow` has a fixed number of equal slots; `meters` reserves the meter's place in every tile so captions align. |
| `formatNumber`, `formatCredits`, `signedNumber` | `lib/format.ts` | **Every number of credits**, on every page and in every run, part and step | ONE precision rule: from 10, whole and grouped ("1,840"); under 10, up to two decimals, trailing zeros dropped ("7.47", "0.2", "1.5"); under a hundredth, "<0.01"; a debt with a true minus tight to its digits ("−120"); a change "+3,000"; "1 credit" singular only when what shows is exactly 1. The only exception is `approxCredits`, a usual cost said in a sentence, which reads "less than 0.1 credits" below a tenth. No `toFixed` or hand-written sign anywhere else. |
| `spentAgainst`, `ESTIMATE_FLOOR` | `lib/estimates.ts` | **Every "spent" against an estimate** | Finished work says "Spent", with no bar; work under way "Spent so far", with a bar. Against an estimate under 1 credit there is no percentage and no red: "Under 1 credit, as estimated", or "Estimated under 1 credit". Above it, the true percentage, the bar red only past 100%. |
| `Table`, `TableRow`, `Cell` | `components/ui/table.tsx` | **Every list with columns** (People, Recent work, hiring, credits budgets, autonomy rules, the operator log, an answer's rows) | One header style (sentence case, small, muted, on the ground band; it wraps, never cuts). Columns sized by kind, never by content: `grow` (the name), `text`, `figure` (right-aligned, tabular), `status`, `date`, `action`. Below its threshold (`at`: narrow 36 rem, medium 48, wide 60) — measured on the TABLE'S OWN BOX by a container query, so it switches beside a side panel or a pane as well as on a small screen — every row is a card: the primary cell as its title, each other cell with its column's name beside it. A row's confirmation or form is its `after`. |
| `Badge` (the status tag) | `components/ui/badge.tsx` | A status | Five tones only (below). One line; cut with a tooltip. |
| `Chip`, `PersonChip` | `components/ui/chip.tsx` | A name, a count, a person | One line, never wraps, solid. A person's avatar colour comes from their stable id. |
| `ConfirmCard` | `components/ui/confirm.tsx` | **Every confirmation** — drop, cancel, decline, delete, remove, revoke, stop sharing, let go, bring back — and **every short in-place form** (`destructive={false}` + `onSubmit`: change a budget, reassign, correct a memory, set a cap, top up) | One layout: the question, optional detail, optional fields, then on one line a confirm (destructive-styled when it removes) and an outlined safe choice of EQUAL size. It is IN THE FLOW directly after the row or cell that holds its trigger (a `TableRow`'s `after`), so it pushes what follows down and never covers the next row, and it anchors itself horizontally to the control that was pressed (under it, starting at its left edge, or ending at its right edge when the control sits at the right). Escape cancels. It scrolls itself fully into view above a phone's bottom bar. |
| `Alert`, `StatusTag`, `STATES` | `components/ui/alert.tsx` | A state panel (icon, title, explanation, the one action) and the states pages get wrong | A page names the state; tone and icon come from `STATES` (below). |
| `Failed` | `components/states.tsx` | A read that failed | An error icon (never the shield). A 401/403/404 on a whole page is the `NotFoundPage`. |
| `NotFoundPage` | `components/states.tsx` | Nothing at this address, not yours to see | Fills the frame: what happened, then the places to go. |
| `Empty` | `components/states.tsx` | A read that worked and found nothing | Quiet text and one action. No box. |
| `Working`, `Spinner` | `components/states.tsx` | Something being worked out | A spinner beside the words; `Spinner inherit` inside a busy button. |
| `Fold`, `Disclosure` | `components/Fold.tsx` | A section a phone folds away; a disclosure on every layout | ONE fold: always a card that fills its column, with one header row open or closed (title, the line about it while closed, a chevron at the right); what it holds opens inside the same card under a rule, and a card it holds is flattened — never a card in a card, never a fold in a fold, never the browser's own triangle. |
| `Sheet` | `components/Sheet.tsx` | Every sheet: More, Needs you, Where you are, the conversation (the conversation lane uses it too) | One family: a grab handle, at most 85% of the visible height, a cue at its foot while there is more to scroll, its close at one inset. On a phone on its side a bottom sheet is a panel at the right sized to its content. |
| `Chip`, `Badge`, `Select`, `LINK`, `MENU` | `components/ui/{chip,badge,field,layout}.ts(x)` | A name; a status; a choice; a text link; a menu or popover | One chip height (32; 44 when pressed by touch) and one tone. One tag height (24), sentence case. The house select: the browser's control underneath (a phone opens its own picker), the house edge and chevron on top. One link style: the link colour, medium, underlined. One menu look: a defined edge and lift, inner padding, 8 px off its trigger, scrolling inside so it ends on a whole item. |
| Trail | `features/shell/crumbs.ts` | The breadcrumb, desktop and phone | Always from the organisation; ancestors linked; the current place in ink; one separator; a place named like its parent shown once. `crumbShort` (a crumb's `short`, or its label cut at 32) is the header's and the trail's name; the h1 carries the full title. |

## The status vocabulary

| Tone | Colour | Means | Statuses |
| --- | --- | --- | --- |
| `neutral` | grey | A fact, no judgement | Private, Asleep, Archived, To do, Waiting to start, Cancelled, Withdrawn, Declined, Revoked, Expired, Not built (yet), Health unknown, Nothing to do, Free, Let go, Taken / Set aside, No longer waiting, Not published (as "—"), roles (Owner, Admin, Builder, Viewer), "You declined to start this" |
| `info` | blue tint (the accent) | Under way, or a plain setting | Working, In progress, Building, Planning, Researching, Awake, Always on, Waking, Public, Shared with N, Proposed, Hire proposed, Set here, Said here, Working in it now, Waiting for FrostAura |
| `good` | green | Finished well | Healthy, Done, Finished, Live now, Passed its check, Agreed, Hired, Added, Active, Registered, In credit, Fits the budget |
| `warn` | amber | Waits on a person, or is held | Waiting for you, Needs you, Verdict waiting, Approval needed, Paused, Struggling, Sent back, Below zero, Nothing to do for N days |
| `bad` | red | Failed or refused | Did not succeed, Down, Stopped, Refused, At its limit, More than the budget has room for, Research did not finish |

In code, `STATES` (`components/ui/alert.tsx`) fixes the ones pages got wrong, so a page names the state and
cannot pick the colour: **paused by its budget** is `warn` (amber, a pause icon) with the action that fixes it —
raise the budget — never the red crashed panel and never "Rebuild and restart"; **an approval asked** is `info`
and **answered** `neutral`, both with a hand, never the red danger shield (no state draws a shield); **cancelled,
withdrawn, declined** are `neutral` everywhere; a withdrawn, declined or accepted hire shows no budget warning;
**failed** and **crashed** are `bad`.

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
- The live dot (work under way, a run playing live, the dock's working line) breathes its own opacity (`animate-pulse`,
  one keyframe); it never spreads a ring. Every animation stops under reduced motion.
- The token layer holds nothing dead: every grid track, animation, keyframe, colour role, width and height it names is
  drawn somewhere in the console or the academy. A token whose last use goes is deleted in the same change.

## Do and don't (from the reviews)

- Don't put "Not measured yet" in a figure slot (console-desktop 33). Do: value "—", caption "Not measured yet".
- Don't let "Ruth · Software engineer" wrap inside its pill (console-desktop 9). Do: `PersonChip`, cut with a tooltip.
- Don't draw "3 contractors · researching" with a dashed outline (console-desktop 13). Do: a solid `Chip` with a spinner.
- Don't stretch a side card to the page's height (real-stack 20, the 6,292 px notifications panel). Do: cards that end with their content, sticky while they fit.
- Don't show 60 memory cards beside a short page (real-stack 50). Do: `useShowAll`.
- Don't use a pink pill for "Drop this idea?" and a full card for "Let Kasper go?" (console-desktop 22). Do: `ConfirmCard` for both.
- Don't open a confirmation 600 px from the Remove that asked for it (round two, console-desktop 38). Do: the card in the flow under the row, anchored to the trigger.
- Don't let a balance read "1…" (round two, console-small 22). Do: a `Stat` whose type steps down to fit.
- Don't show "217%" in red against an estimate of 0.05 credits (round two, real-stack 26). Do: `spentAgainst`, "Under 1 credit, as estimated".
- Don't draw a budget pause as the red crashed panel (round two, console-desktop 28). Do: `Alert state="paused-by-budget"` with "Raise the budget".
- Don't take the rail for a portrait window with its keyboard open (round two, console-small 1). Do: the rail only wider than tall and at least 560 px wide.
- Don't mark a never-published app "Healthy" (console-desktop 34). Do: "—" with "Not published yet".
- Don't use a shield with a tick for a failure (console-desktop 61). Do: `Failed`'s error icon.
- Don't stretch the portrait layout across a phone on its side (console-small 4). Do: the rail tier.

## Guards

`src/frontend/src/design.test.ts` (Vitest, part of `make test-frontend`), each rule with a cheap check:

- no figure-sized text outside `Stat`; a `Stat` value is never `truncate`d;
- no `toFixed`/`toLocaleString` for a figure outside `lib/format.ts`;
- `border-dashed` only in the drop-zone allowlist; chips and tags never wrap; tags never `uppercase`;
- the status tones are exactly the five; the budget pause, approvals and cancellations are never `bad`; no shield;
- violet and teal may only fall; no gradient or aura; field edges at 3:1 and every tag at 4.5:1;
- captions cut only from `sm` up; meters and bars never grow in from zero; the live dot animates opacity only, and
  every looping animation stops under reduced motion;
- page titles: `PageHeader` takes no icon, no `h1` anywhere draws an `Icon` or a lucide icon, and no console `h1` sets its
  size by a hand-written class (it is `TITLE` or `PageHeader`);
- the page column is the container `page` with thresholds from `pageAt` only; no `4xl:` column switch in a feature; no
  arbitrary container query;
- the token layer holds no dead track, animation, keyframe, colour role, width or height (console and academy read);
- buttons: capped by `max-w-column`, never `max-w-full`; no raw `<button>` drawing a radius with a fill or edge outside a per-file allowlist that may only
  fall; no shape class passed to a `Button`; the five variants, three heights, one radius, one disabled look;
  the retired variant names only in the conversation lane's files;
- a `danger` button only inside `ConfirmCard`, which anchors itself and draws equal choices;
- no hand-built table of three or more columns (`*:grid-cols-[a_b_c]`): it is the `Table`; the table's card form
  is a container query;
- no raw `<select>`; no native `<details>` outside its allowlist;
- the rail needs `orientation: landscape` and `railMin`; the mode switch never holds System; the balance chip
  is never a tinted pill; a bottom sheet is at most 85% tall.

`tokens.test.ts` keeps every colour in the token file. In the built demo (`make demo-e2e`):
`tests-demo/phone.spec.ts` holds 44 px targets on a phone and on touch tablets at 768, 834 and 1024, a one-row
tablet header with two organisations in both modes, and the rail layout on a phone on its side;
`tests-demo/shared-layer.spec.ts` opens every confirmation in the demo and holds it within reach of its trigger
(under it, and beside it on the page), and holds a short upright window (375×450, 390×480) to the phone layout
with its field and primary action usable above the bar.

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
