/**
 * The academy's shared control styles, so a button looks the same wherever it is drawn and a
 * change of look is one edit. Every value is a token class from the console's preset.
 */
const pill = "inline-flex min-h-touch items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export const ui = {
  primary: `${pill} bg-primary text-primary-ink shadow-press hover:bg-primary-hover`,
  outline: `${pill} border-2 border-ink text-ink hover:bg-ink hover:text-primary-ink`,
  success: `${pill} bg-success-text text-primary-ink hover:bg-ink`,
  quiet: `${pill} border text-ink hover:bg-ground`,
  /** On the dark (night) panels. */
  light: `${pill} bg-surface text-ink hover:bg-primary-tint`,
  lightOutline: `${pill} border-2 border-primary-ink-soft text-primary-ink hover:bg-surface/10`,
  danger: `${pill} bg-attention-text text-primary-ink hover:bg-attention-strong`,
  /** A square, label-less control with an accessible name: 44 px, the smallest comfortable touch. */
  icon: "inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-ground disabled:cursor-not-allowed disabled:opacity-40",
  /** A small control in the player's rows: the same pill, a step shorter in weight. */
  small: "inline-flex min-h-touch items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium text-ink transition-colors hover:bg-ground disabled:cursor-not-allowed disabled:opacity-40",
  /** The one card: a surface with a hairline and the soft card shadow; a link card lifts on hover. */
  card: "rounded-lg border bg-surface shadow-card",
  cardLink: "group flex h-full flex-col rounded-lg border bg-surface p-5 shadow-card transition-shadow hover:border-primary-line hover:shadow-raised sm:p-6",
  /** The one page container: one left edge on every page, growing to `max-w-site` on wide screens. */
  container: "mx-auto w-full max-w-site px-4 sm:px-6 lg:px-10",
  eyebrow: "text-eyebrow font-semibold uppercase",
  /** A neutral chip: kinds and routes. Colour is kept for state. */
  chip: "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-body",
  /** A figure: one typeface, fixed-width digits, so numbers line up and never jump. */
  figure: "font-display font-bold tabular-nums text-ink",
  /** A link set as text, on paper and on screen alike. */
  textLink: "font-medium text-primary-link underline decoration-primary-line underline-offset-4 hover:decoration-primary",
} as const;
