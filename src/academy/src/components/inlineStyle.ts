/** The panel an inline run sits on: the page (light) or a dark panel ("You know it worked when"). */
export type Tone = "light" | "dark";

/**
 * How each inline style is set on each ground. `inlineStyle.test.ts` holds every one to WCAG AA
 * contrast against the ground it is drawn on.
 */
export const INLINE_STYLE: Record<Tone, { strong: string; code: string; link: string; id: string; variable: string }> = {
  light: {
    strong: "font-semibold text-ink",
    code: "rounded-xxs bg-quiet px-1 py-px font-mono text-xs text-ink [overflow-wrap:anywhere]",
    link: "font-medium text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
    id: "font-mono text-xs font-semibold text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
    /** A placeholder reads as words inside the sentence, not a box: italic, with a dotted underline. */
    variable: "font-sans italic text-ink-body underline decoration-border-field decoration-dotted decoration-1 underline-offset-4",
  },
  dark: {
    strong: "font-semibold text-primary-ink",
    code: "rounded-xxs border border-primary-ink/25 px-1 py-px font-mono text-xs text-primary-ink [overflow-wrap:anywhere]",
    link: "font-medium text-live underline decoration-live/60 underline-offset-2 hover:decoration-live",
    id: "font-mono text-xs font-semibold text-live underline decoration-live/60 underline-offset-2 hover:decoration-live",
    variable: "font-sans italic text-primary-ink underline decoration-primary-ink/60 decoration-dotted decoration-1 underline-offset-4",
  },
};
