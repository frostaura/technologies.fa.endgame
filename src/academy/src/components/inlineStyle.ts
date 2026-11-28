/**
 * How each inline style is set on the page. `inlineStyle.test.ts` holds every one to WCAG AA
 * contrast against the ground it is drawn on. (Every card is light: there is no dark panel to set
 * them on.)
 */
export const INLINE_STYLE: { strong: string; code: string; link: string; id: string; variable: string } = {
  strong: "font-semibold text-ink",
  code: "rounded-xxs bg-quiet px-1 py-px font-mono text-xs text-ink [overflow-wrap:anywhere]",
  link: "font-medium text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
  id: "font-mono text-xs font-semibold text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary",
  /** A placeholder reads as words inside the sentence, not a box: italic, with a dotted underline. */
  variable: "font-sans italic text-ink-body underline decoration-border-field decoration-dotted decoration-1 underline-offset-4",
};
