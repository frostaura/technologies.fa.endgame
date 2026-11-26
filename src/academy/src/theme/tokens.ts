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
  },
  width: { rail: "17rem", steps: "34rem", qr: "13rem", "qr-sm": "9rem", read: "42rem", search: "40rem", sheet: "34rem", ring: "3.25rem", "ring-lg": "7rem", medal: "3.5rem" },
  /**
   * Heights on a phone use the small viewport (`svh`): it is the height with the address bar shown,
   * so the stage never grows and shrinks as the bar collapses while the learner scrolls, and what
   * fits with the bar also fits without it. Only the full-screen demo, which should fill whatever
   * is there, follows the dynamic height (`dvh`).
   */
  height: {
    stage: "calc(100svh - 7rem)",
    "stage-short": "calc(100svh - 4.5rem)",
    "stage-sm": "50svh",
    /** The larger console on a phone: everything but the header, the step pager and a gap. */
    "stage-full": "calc(100svh - 3.8125rem - var(--pager-h, 5rem) - 1rem)",
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
  inset: { header: "4.5rem", "header-sm": "3.8125rem", "header-short": "3.3125rem" },
  /** The notch, the rounded corners and the home indicator, once the page draws under them (`viewport-fit=cover`). */
  padding: {
    "safe-l": "env(safe-area-inset-left, 0px)",
    "safe-r": "env(safe-area-inset-right, 0px)",
    "safe-b": "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
    "sheet-b": "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
  },
  /** `short:` — a phone on its side (or any window under 600 px tall): the stage's controls fold into one row. */
  screens: { split: { raw: SPLIT_QUERY }, short: { raw: "(max-height: 600px)" } },
} as const;
