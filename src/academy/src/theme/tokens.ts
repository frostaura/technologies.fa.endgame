/**
 * The academy's additions to the console's token layer. Every colour, radius, shadow, typeface and
 * motion comes from the console (`src/frontend/src/lib/tokens.ts`, through its Tailwind preset);
 * this file adds only the sizes a documentation site needs that a console screen does not.
 * No colour may be declared here.
 */

/**
 * When a flow's steps sit beside the stage rather than under it: a wide screen, or a phone or small
 * tablet held on its side, whose height is too short to stack the console over the steps. The same
 * query drives the `split:` variant and the player's own reading line, so CSS and script agree.
 */
export const SPLIT_QUERY = "(min-width: 1024px), (orientation: landscape) and (min-width: 640px) and (max-height: 600px)";

/** A window too short to stack a title over the console: the player then gives the console the whole height. */
export const SHORT_QUERY = "(max-height: 600px)";

/** A device with a precise pointer that hovers: keyboard hints and the scan-to-follow QR are for it, not for a touch screen. */
export const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * The PDFs' step pictures (`tools/print-crop.ts`, `PrintPage`). Each prints so its smallest text
 * comes out at `smallestPt`, never larger than `mmPerPx` millimetres to the console's CSS pixel
 * (at which 12 px text prints at 7 pt) and never wider than the page's text column `columnMm`
 * (A4 less its two 12.7 mm margins). A crop is never wider than `maxWidthPx` nor taller than
 * `maxHeightPx`, the most the column holds at `mmPerPx`. A picture up to `besideMm` wide sits
 * beside its step's words; a wider one goes under them.
 */
export const PRINT_SHOT = { mmPerPx: 0.206, smallestPt: 7.5, columnMm: 184, maxWidthPx: 890, maxHeightPx: 640, besideMm: 100 } as const;

/** The millimetres one CSS pixel of a step picture prints at, from its width and its smallest text (with no text, the `mmPerPx` cap). */
export function printMmPerPx(width: number, font: number): number {
  const forText = font > 0 ? (PRINT_SHOT.smallestPt * 25.4) / 72 / font : PRINT_SHOT.mmPerPx;
  return Math.min(PRINT_SHOT.mmPerPx, forText, PRINT_SHOT.columnMm / width);
}

/**
 * The console in the academy's frame is always drawn at one of two fixed sizes and scaled to fit,
 * so every lesson plays on the layout its script was written against and nothing reflows between
 * steps: `desk`, a laptop's console (its conversation pane docked, every desktop control there),
 * for every desktop and tablet window; `phone`, a phone's console (its bottom tab bar), for a
 * phone held either way and for a flow about the phone itself. `chrome` is the frame's address bar
 * (desk) and `bezel` the phone frame's edge, in screen pixels.
 */
export const CONSOLE = {
  desk: { width: 1280, height: 800, chrome: 36, bezel: 1 },
  phone: { width: 390, height: 640, chrome: 0, bezel: 4 },
} as const;
export type ConsoleSize = keyof typeof CONSOLE;

export const academy = {
  fontSize: {
    cover: ["88px", { lineHeight: "0.98", letterSpacing: "-0.045em" }],
    "cover-sm": ["52px", { lineHeight: "1", letterSpacing: "-0.04em" }],
    title: ["48px", { lineHeight: "1.04", letterSpacing: "-0.035em" }],
    "title-sm": ["34px", { lineHeight: "1.08", letterSpacing: "-0.03em" }],
    lead: ["22px", { lineHeight: "1.45", letterSpacing: "-0.01em" }],
    "lead-sm": ["19px", { lineHeight: "1.45", letterSpacing: "-0.01em" }],
    step: ["17px", { lineHeight: "1.6", letterSpacing: "-0.005em" }],
    figure: ["40px", { lineHeight: "1", letterSpacing: "-0.03em" }],
    /** The player's title band: one or two lines, so the console keeps the height. */
    "player-title": ["28px", { lineHeight: "1.15", letterSpacing: "-0.025em" }],
    "player-title-sm": ["22px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
  },
  width: {
    /** The one page container: wide screens give the extra to content, up to this, never to gutters. */
    site: "137.5rem",
    /** The player's side column of steps and details, beside the console. */
    side: "26rem",
    "side-xl": "30rem",
    rail: "17rem",
    steps: "34rem",
    qr: "13rem",
    "qr-sm": "9rem",
    read: "42rem",
    search: "22rem",
    "search-lg": "28rem",
    sheet: "34rem",
    ring: "3.25rem",
    "ring-lg": "7rem",
    medal: "3.5rem",
    /** The step controls' fixed places, so nothing in the row moves from step to step. */
    prev: "7.5rem",
    try: "10rem",
    again: "10.25rem",
    next: "9rem",
    "next-sm": "5.5rem",
    /** The strip beside the frame of a phone on its side. */
    "side-strip": "20rem",
    /** The search results panel under the header's box: wide enough for a title on two lines, never wider than the window. */
    "search-panel": "min(37.5rem, calc(100vw - 2rem))",
  },
  /** The player: the console beside its side column, or on top of the steps on a phone. */
  gridTemplateColumns: {
    player: "minmax(0, 1fr) 26rem",
    /** Under 1536 wide: a narrower column, so the console keeps the width. */
    "player-sm": "minmax(0, 1fr) 22rem",
    "player-xl": "minmax(0, 1fr) 30rem",
    /** Cards that fill their row: as many as fit at this width, never an orphan stretched alone. */
    cards: "repeat(auto-fill, minmax(17rem, 1fr))",
    "cards-sm": "repeat(auto-fill, minmax(13rem, 1fr))",
    /** A grid of flow ids: every cell one width, so the ids line up in columns. */
    ids: "repeat(auto-fill, minmax(5.5rem, 1fr))",
    /** A reading column beside a column that takes the rest (About). */
    about: "minmax(0, 42rem) minmax(0, 1fr)",
    /** A contents line in the PDFs: the id, the title (hanging under itself when it wraps), the page. */
    contents: "4.5rem 1fr auto",
    /** A step in the PDFs beside its picture: the words take what the picture, at its print size, leaves. */
    "print-step": "minmax(0, 1fr) auto",
  },
  /** The PDF cover: the mark, the title block in the middle, the colophon at the foot. */
  gridTemplateRows: { cover: "auto 1fr auto" },
  /**
   * Heights on a phone use the small viewport (`svh`): it is the height with the address bar shown,
   * so the stage never grows and shrinks as the bar collapses while the learner scrolls, and what
   * fits with the bar also fits without it. Only the full-screen demo, which should fill whatever
   * is there, follows the dynamic height (`dvh`).
   */
  height: {
    /** The header, a fixed height so nothing below it shifts: desktop, phone, and a window on its side. */
    header: "4.5rem",
    "header-sm": "3.8125rem",
    "header-short": "3.3125rem",
    /** The player on a wide screen: everything under the header, so the console and its controls are all in view on arrival. */
    player: "calc(100svh - 4.5rem)",
    "player-short": "calc(100svh - 3.3125rem)",
    /** The console on a phone held upright: at least 60 % of the screen, the caption under it. */
    "frame-phone": "60svh",
    /** The frame's browser bar. */
    chrome: "2.25rem",
    /** The caption strip under the frame: three lines of a step's words, the same height on every step. */
    caption: "4.75rem",
    /** On a phone: two lines, with "More" to read the rest. */
    "caption-sm": "3.75rem",
    stage: "calc(100svh - 7rem)",
    "stage-short": "calc(100svh - 4.5rem)",
    "stage-sm": "50svh",
    /** The larger console on a phone: everything but the header, the flow's one-line title, the step pager and a gap. */
    "stage-full": "calc(100svh - 3.8125rem - 2.5rem - var(--pager-h, 5rem) - 0.5rem)",
    "screen-d": "100dvh",
    frame: "38rem",
    "frame-sm": "26rem",
    shot: "24rem",
    ring: "3.25rem",
    "ring-lg": "7rem",
    medal: "3.5rem",
  },
  maxHeight: { sheet: "88dvh" },
  /** The stepper's sticky offset under the header. */
  inset: { header: "4.5rem", "header-sm": "3.8125rem", "header-short": "3.3125rem", chrome: "2.25rem" },
  /** The notch, the rounded corners and the home indicator, once the page draws under them (`viewport-fit=cover`). */
  padding: {
    "safe-l": "env(safe-area-inset-left, 0px)",
    "safe-r": "env(safe-area-inset-right, 0px)",
    "safe-b": "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
    "sheet-b": "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
  },
  /** `short:` — a phone on its side (or any window under 600 px tall): the stage's controls fold into one row. */
  screens: { split: { raw: SPLIT_QUERY }, short: { raw: SHORT_QUERY }, mouse: { raw: MOUSE_QUERY }, touch: { raw: "(hover: none), (pointer: coarse)" }, tall: { raw: "(min-height: 1000px)" }, compact: { raw: "(max-height: 920px)" }, "phone-side": { raw: "(max-height: 600px) and (max-width: 1023px)" } },
} as const;
