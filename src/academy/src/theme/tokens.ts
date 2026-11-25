/**
 * The academy's additions to the console's token layer. Every colour, radius, shadow, typeface and
 * motion comes from the console (`src/frontend/src/lib/tokens.ts`, through its Tailwind preset);
 * this file adds only the sizes a documentation site needs that a console screen does not.
 * No colour may be declared here.
 */
export const academy = {
  fontSize: {
    cover: ["88px", { lineHeight: "0.98", letterSpacing: "-0.045em" }],
    "cover-sm": ["52px", { lineHeight: "1", letterSpacing: "-0.04em" }],
    title: ["48px", { lineHeight: "1.04", letterSpacing: "-0.035em" }],
    "title-sm": ["34px", { lineHeight: "1.08", letterSpacing: "-0.03em" }],
    lead: ["22px", { lineHeight: "1.45", letterSpacing: "-0.01em" }],
    step: ["17px", { lineHeight: "1.6", letterSpacing: "-0.005em" }],
  },
  width: { rail: "17rem", steps: "34rem", qr: "13rem", "qr-sm": "9rem", read: "42rem", search: "40rem" },
  height: { stage: "calc(100vh - 7rem)", "stage-sm": "52vh", frame: "38rem", "frame-sm": "26rem", shot: "24rem" },
  /** The stepper's sticky offset under the header. */
  inset: { header: "4.5rem", "header-sm": "7.75rem" },
} as const;
