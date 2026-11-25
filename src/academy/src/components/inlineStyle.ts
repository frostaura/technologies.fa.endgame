/** The panel an inline run sits on: the page (light) or a dark panel ("You know it worked when"). */
export type Tone = "light" | "dark";

/**
 * How each inline style is set on each ground. `inlineStyle.test.ts` holds every one to WCAG AA
 * contrast against the ground it is drawn on.
 */
export const INLINE_STYLE: Record<Tone, { strong: string; code: string; link: string; id: string; variable: string }> = {
  light: {
    strong: "font-semibold text-ink",
    code: "rounded-xxs bg-quiet px-1 py-px font-mono text-xs text-ink",
    link: "font-medium text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
    id: "font-mono text-xs font-semibold text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
    variable: "whitespace-nowrap rounded-xxs border border-primary-line bg-primary-tint px-1 py-px font-sans text-xs font-medium not-italic text-primary-link",
  },
  dark: {
    strong: "font-semibold text-primary-ink",
    code: "rounded-xxs bg-primary-ink/15 px-1 py-px font-mono text-xs text-primary-ink",
    link: "font-medium text-live underline decoration-live/60 underline-offset-2 hover:decoration-live",
    id: "font-mono text-xs font-semibold text-live underline decoration-live/60 underline-offset-2 hover:decoration-live",
    variable: "whitespace-nowrap rounded-xxs border border-primary-ink/40 bg-primary-ink/15 px-1 py-px font-sans text-xs font-medium not-italic text-primary-ink",
  },
};
