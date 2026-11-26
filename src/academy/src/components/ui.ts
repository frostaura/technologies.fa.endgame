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
  card: "rounded-lg border bg-surface shadow-card",
  eyebrow: "text-eyebrow font-semibold uppercase",
} as const;
