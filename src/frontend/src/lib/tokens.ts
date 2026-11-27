/**
 * The design tokens — the one place in the console where a colour, radius, shadow or typeface is
 * written down. `tailwind.config.ts` holds no values of its own; it reads them from here, and
 * `tokens.test.ts` fails the suite if a hex literal appears anywhere else in the source.
 *
 * Two tiers. {@link primitives} are raw values named by hue; {@link roles} give them meaning.
 * Components use role classes (`bg-surface`, `text-ink-muted`, `bg-success-tint`), never primitives.
 *
 * Colour reaches CSS as RGB channels (`--color-primary: 47 91 255`) and Tailwind reads it as
 * `rgb(var(--color-primary) / <alpha-value>)`. The channel form is load-bearing: an opaque
 * `var()` cannot take Tailwind's opacity modifiers, and `bg-primary/10` would then emit no CSS.
 *
 * Module scope stays free of browser and Node APIs: Tailwind imports this in Node, the app in a browser.
 */

export const primitives = {
  white: "#FFFFFF",
  ground: "#F5F6FB",
  ink: { 900: "#0B1020", 700: "#3B4350", 600: "#535B70", 500: "#434A5E" },
  line: { DEFAULT: "#E4E7F2", strong: "#C9CEDF", field: "#868DA3" },
  slate: { 100: "#EEF0F7" },
  navy: "#141B4D",
  blue: { 50: "#EEF2FF", 100: "#DCE4FF", 200: "#C6D2FF", 300: "#A9B8FF", 500: "#2F5BFF", 600: "#2447D6", 700: "#1E3FCC" },
  violet: { 50: "#F3EEFF", 200: "#D9CCFF", 400: "#8D7BE8", 500: "#6B4BF0", 600: "#5B3FD6", 800: "#3F2E87" },
  teal: { 50: "#E3F8FB", 600: "#0B8FA6", 700: "#0B6E7F" },
  mint: "#7DF0DC",
  green: { 50: "#E9FBF1", 500: "#12A15E", 800: "#0E6B42" },
  coral: { 50: "#FFF1EC", 100: "#FFE3DC", 200: "#FFC9BA", 300: "#FFB6A3", 25: "#FFF8F5", 500: "#D9432B", 900: "#5C2A1F" },
  red: { 50: "#FFF1EC", 700: "#B42318", 800: "#8A1C0F" },
  orange: { 700: "#C2410C" },
  amber: { 50: "#FFF4E0", 500: "#D98A00", 800: "#8A4B00" },
  magenta: { 600: "#B4237A" },
} as const;

const p = primitives;

/** Semantic roles. Every leaf is a primitive reference; `DEFAULT` names the bare role. */
export const roles = {
  ground: p.ground,
  surface: p.white,
  ink: { DEFAULT: p.ink[900], body: p.ink[700], muted: p.ink[600] },
  /** `field`: the edge of a text box, a select or a check box — 3:1 against both surfaces (WCAG 1.4.11). */
  border: { DEFAULT: p.line.DEFAULT, strong: p.line.strong, field: p.line.field },
  /** The quiet chip and track: sleeping, private, unknown. */
  quiet: { DEFAULT: p.slate[100], text: p.ink[500] },
  primary: {
    DEFAULT: p.blue[500],
    hover: p.blue[700],
    link: p.blue[600],
    tint: p.blue[50],
    line: p.blue[200],
    soft: p.blue[300],
    ink: p.white,
    /** Secondary text set on the primary band. */
    "ink-soft": p.blue[100],
  },
  /**
   * People and the factory once had hues of their own. The house look is black on white with one accent,
   * so these two are kept only for the organisation graph's node kinds and the avatar fills; a tag, a
   * card, a band or an icon never uses them (`design.test.ts` holds their use from growing).
   */
  violet: { DEFAULT: p.violet[500], text: p.violet[600], deep: p.violet[800], line: p.violet[200], dash: p.violet[400], tint: p.violet[50] },
  teal: { DEFAULT: p.teal[600], text: p.teal[700], tint: p.teal[50] },
  /** Money and health. */
  success: { DEFAULT: p.green[500], text: p.green[800], tint: p.green[50] },
  /**
   * The status palette is closed: neutral (`quiet`), info (`primary`), good (`success`), warn and bad
   * (`attention`). `warn` is something that waits on a person or is held; it is never a failure.
   */
  warn: { DEFAULT: p.amber[500], text: p.amber[800], tint: p.amber[50] },
  /** Anything that failed or is refused: the "bad" status. */
  attention: {
    DEFAULT: p.coral[500],
    text: p.red[700],
    strong: p.red[800],
    deep: p.coral[900],
    tint: p.coral[50],
    wash: p.coral[25],
    chip: p.coral[100],
    line: p.coral[200],
    dash: p.coral[300],
  },
  /** The verdict band. */
  night: p.navy,
  /** The lit node of the mark. */
  live: p.mint,
  /** Avatar fills for named employees, picked by a stable hash of the name. */
  avatar: { a: p.blue[500], b: p.violet[500], c: p.teal[600], d: p.orange[700], e: p.magenta[600], f: p.green[800] },
} as const;

/** Corner radii: controls, cards, panels. */
export const radius = { xxs: "4px", xs: "8px", sm: "14px", md: "18px", lg: "24px", full: "9999px" } as const;

/** Elevation. Soft and low: a card lifts off the ground, it does not float. */
export const shadow = {
  card: "0 1px 2px rgb(11 16 32 / 0.05), 0 10px 28px rgb(11 16 32 / 0.05)",
  raised: "0 2px 4px rgb(11 16 32 / 0.06), 0 18px 40px rgb(47 91 255 / 0.16)",
  press: "0 8px 20px rgb(47 91 255 / 0.22)",
  toggle: "0 1px 2px rgb(11 16 32 / 0.12)",
} as const;

/**
 * Motion, as drawn in the approved design. Every animation is switched off under
 * `prefers-reduced-motion` by the base layer in `index.css`.
 */
export const motion = {
  ease: { out: "cubic-bezier(.2,.7,.2,1)", spring: "cubic-bezier(.2,.9,.3,1.2)" },
  keyframes: {
    rise: { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "none" } },
    grow: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
    pulse: { "0%": { boxShadow: "0 0 0 0 rgb(18 161 94 / 0.55)" }, "100%": { boxShadow: "0 0 0 10px rgb(18 161 94 / 0)" } },
    ring: { "0%": { boxShadow: "0 0 0 0 rgb(47 91 255 / 0.5)" }, "100%": { boxShadow: "0 0 0 12px rgb(47 91 255 / 0)" } },
    halo: { "0%": { boxShadow: "0 0 0 0 rgb(107 75 240 / 0.5)" }, "100%": { boxShadow: "0 0 0 16px rgb(107 75 240 / 0)" } },
    /** A signal travelling along an edge of the organisation graph. */
    flow: { from: { strokeDashoffset: "24" }, to: { strokeDashoffset: "0" } },
    drift: {
      "0%": { transform: "translate(0,0) scale(1)" },
      "50%": { transform: "translate(70px,-24px) scale(1.25)" },
      "100%": { transform: "translate(0,0) scale(1)" },
    },
    travel: { "0%": { top: "0", opacity: "0" }, "12%": { opacity: "1" }, "88%": { opacity: "1" }, "100%": { top: "100%", opacity: "0" } },
    sheen: { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "40px 0" } },
    bob: { "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" }, "40%": { transform: "translateY(-5px)", opacity: "1" } },
    stamp: {
      "0%": { opacity: "0", transform: "scale(1.6) rotate(-6deg)" },
      "60%": { opacity: "1", transform: "scale(.96) rotate(0)" },
      "100%": { transform: "scale(1)" },
    },
    shimmer: { from: { backgroundPosition: "-200% 0" }, to: { backgroundPosition: "200% 0" } },
    /** A sheet rising from the foot of the screen; one coming in from the side; the page dimming behind it. */
    sheet: { from: { transform: "translateY(24px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
    slide: { from: { transform: "translateX(32px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
    fade: { from: { opacity: "0" }, to: { opacity: "1" } },
  },
  animation: {
    rise: "rise .7s cubic-bezier(.2,.7,.2,1) both",
    grow: "grow 1.1s .35s cubic-bezier(.2,.7,.2,1) both",
    pulse: "pulse 1.8s ease-out infinite",
    ring: "ring 1.8s ease-out infinite",
    halo: "halo 2s ease-out infinite",
    flow: "flow 1.2s linear infinite",
    drift: "drift 12s ease-in-out infinite",
    travel: "travel 3.2s linear infinite",
    sheen: "sheen 1s linear infinite",
    bob: "bob 1.2s ease-in-out infinite",
    stamp: "stamp .6s .35s cubic-bezier(.2,.9,.3,1.2) both",
    shimmer: "shimmer 1.6s linear infinite",
    sheet: "sheet .22s cubic-bezier(.2,.7,.2,1) both",
    slide: "slide .22s cubic-bezier(.2,.7,.2,1) both",
    fade: "fade .2s ease-out both",
    live: "grow 1.1s .35s cubic-bezier(.2,.7,.2,1) both, sheen 1s linear infinite",
  },
  /** Stagger between siblings that rise in. */
  delay: { 1: "80ms", 2: "160ms", 3: "240ms", 4: "320ms", 5: "400ms" },
} as const;

/** The live-progress stripe and the skeleton shimmer, set as background images. */
export const surfaces = {
  stripe: "repeating-linear-gradient(115deg, rgb(255 255 255 / 0.3) 0 10px, rgb(255 255 255 / 0) 10px 20px)",
  shimmer: "linear-gradient(90deg, rgb(228 231 242 / 0.6) 0%, rgb(245 246 251 / 0.9) 50%, rgb(228 231 242 / 0.6) 100%)",
} as const;

/** Blur radius of the aura blobs on the coloured bands. */
export const blur = { aura: "48px" } as const;

export const typography = {
  fontFamily: {
    sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
    display: ["Space Grotesk Variable", "Space Grotesk", "Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
    mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  },
  /** The display sizes the design uses above Tailwind's own scale. */
  fontSize: {
    hero: ["44px", { lineHeight: "1", letterSpacing: "-0.03em" }],
    balance: ["64px", { lineHeight: "1", letterSpacing: "-0.03em" }],
    eyebrow: ["12px", { lineHeight: "1.3", letterSpacing: "0.08em" }],
  },
} as const;

/**
 * Where the layout changes, as widths of the console's own viewport (inside a frame, the frame's
 * width — so a narrow frame shows the phone layout with no special case). Tailwind's own values,
 * written down once so CSS (`sm:`, `lg:`) and the shell's script (`useViewport`) agree.
 *
 * - phone: below `sm` — one column, the compact header and the bottom bar. A phone on its side is
 *   short rather than narrow: below `lg` and under `short` tall it is a phone too.
 * - tablet: `sm` to `lg` — the full header, two columns where a screen has them, the conversation
 *   in a side sheet.
 * - desktop: `lg` and up — the conversation and side panels beside the page.
 *
 * The desktop has three tiers of its own (ARCH-011): `xl` (1280) the page beside its side panel;
 * `3xl` (1600) the page may set independent sections two across and the side panel widens; `4xl`
 * (2000) the same, with the whole console capped at `layout.width.frame` and centred.
 */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536, "3xl": 1600, "4xl": 2000, short: 500 } as const;

/** Tailwind's `screens`, from {@link breakpoints}. Plain widths only, so `max-sm:` and friends exist. */
export const screens = {
  sm: `${breakpoints.sm}px`,
  md: `${breakpoints.md}px`,
  lg: `${breakpoints.lg}px`,
  xl: `${breakpoints.xl}px`,
  "2xl": `${breakpoints["2xl"]}px`,
  "3xl": `${breakpoints["3xl"]}px`,
  "4xl": `${breakpoints["4xl"]}px`,
} as const;

/** The `short:` variant: a phone on its side. */
export const shortQuery = `(max-height: ${breakpoints.short - 0.02}px)`;

/** The media queries the shell's script reads, from the same numbers. */
export const viewportQueries = {
  phone: `(max-width: ${breakpoints.sm - 0.02}px), ${shortQuery} and (max-width: ${breakpoints.lg - 0.02}px)`,
  desktop: `(min-width: ${breakpoints.lg}px)`,
} as const;

/** Named widths. `frame` caps the whole console (header, page and side panel) so nothing spans an ultrawide. */
export const layout = {
  width: { frame: "137.5rem", page: "96rem", aside: "22rem", "aside-wide": "26rem", dock: "26rem", form: "40rem", prose: "45rem", aura: "20rem", bubble: "85%", reply: "92%" },
  /** The organisation graph's frame: tall enough to read, short enough to keep the page in view. A bottom sheet's tallest. */
  height: { graph: "40rem", sheet: "calc(var(--visible-height, 100dvh) - 2.5rem)", visible: "var(--visible-height, 100dvh)" },
  /** The smallest comfortable touch target. */
  touch: "44px",
  /** The clear band above and below a 32px control (a switch) that makes it a touch target without drawing it larger. */
  touchPad: "6px",
  /** The phone's bottom bar, above the home indicator's safe area; pages leave this much room under their last line. */
  nav: "4rem",
  /** The phone's header row. */
  bar: "3.5rem",
  /** A bottom sheet stops this far short of the top, so the page behind still shows it is a sheet. */
  sheetGap: "2.5rem",
  /** The device's safe area: the notch, the rounded corners, the home indicator (`viewport-fit=cover`). */
  safe: { top: "env(safe-area-inset-top, 0px)", bottom: "env(safe-area-inset-bottom, 0px)", left: "env(safe-area-inset-left, 0px)", right: "env(safe-area-inset-right, 0px)" },
  /** The bottom bar with the safe area under it: what a page leaves free at its foot on a phone. */
  navSafe: "calc(4rem + env(safe-area-inset-bottom, 0px))",
  /**
   * What is left of the screen above the on-screen keyboard. A sheet that holds a text box sizes to it,
   * so the box stays above the keyboard; the shell keeps the variables current from `visualViewport`.
   */
  visible: { height: "var(--visible-height, 100dvh)", top: "var(--visible-top, 0px)" },
  /** The narrowest a labelled field may be squeezed to in a row beside its button; below it the row wraps. */
  field: "12rem",
  /** Grid tracks: a chart's label column beside its bars; a table of figures with a name column. */
  columns: { "chart-row": "minmax(3rem, 9rem) minmax(0, 1fr)", "name-figures": "minmax(0, 2fr) repeat(4, minmax(0, 1fr))" },
  /** Where the org chart's connecting wire sits under a division's badge. */
  wireInset: "39px",
} as const;

// ---------------------------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------------------------

/** `#2F5BFF` → `"47 91 255"`. */
export function channels(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

type Tree = { readonly [key: string]: string | Tree };

/** Every role flattened to its CSS name: `primary.DEFAULT` → `primary`, `ink.muted` → `ink-muted`. */
export function flatRoles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
      if (typeof value === "string") out[name] = value;
      else walk(value, name);
    }
  };
  walk(roles, "");
  return out;
}

/** The custom properties written under `:root`. */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, hex] of Object.entries(flatRoles())) out[`--color-${name}`] = channels(hex);
  for (const [name, value] of Object.entries(shadow)) out[`--shadow-${name}`] = value;
  return out;
}

type ColorTree = { [key: string]: string | ColorTree };

/** Tailwind's `colors`: the role tree with every leaf read through its variable. */
export function tailwindColors(): ColorTree {
  const build = (node: Tree, prefix: string): ColorTree => {
    const out: ColorTree = {};
    for (const [key, value] of Object.entries(node)) {
      const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
      out[key] = typeof value === "string" ? `rgb(var(--color-${name}) / <alpha-value>)` : build(value, name);
    }
    return out;
  };
  return build(roles, "");
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).split(" ").map((c) => {
    const v = Number(c) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
