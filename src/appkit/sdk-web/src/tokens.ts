/**
 * The design tokens of every Endgame app — the same values as the console's own token layer
 * (src/frontend/src/lib/tokens.ts), so generated apps share the family look. An app's
 * `tailwind.config.ts` takes them through the preset in `./tailwind`, and holds no values itself.
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
  blue: { 50: "#EEF2FF", 500: "#2F5BFF", 700: "#1E3FCC" },
  violet: { 50: "#F3EEFF", 500: "#6B4BF0" },
  teal: { 600: "#0B8FA6" },
  green: { 50: "#E9FBF1", 500: "#12A15E", 800: "#0E6B42" },
  amber: { 50: "#FFF4E0", 500: "#D98A00", 800: "#8A4B00" },
  red: { 50: "#FFF1EC", 700: "#B42318" },
} as const;

const p = primitives;

/** Semantic roles. Every leaf is a primitive reference; `DEFAULT` names the bare role. */
export const roles = {
  ground: p.ground,
  surface: p.white,
  /** `body`: running text; `muted`: what is secondary (a date, a caption). */
  ink: { DEFAULT: p.ink[900], body: p.ink[700], muted: p.ink[600] },
  /**
   * `DEFAULT` divides and outlines cards; `strong` outlines a secondary button; `field` is the edge of every text box,
   * select and check box — 3:1 against both surfaces (WCAG 1.4.11), so a person can see where to type.
   */
  border: { DEFAULT: p.line.DEFAULT, strong: p.line.strong, field: p.line.field },
  /** The quiet tag and track: a fact with no judgement (to do, private, not started). */
  quiet: { DEFAULT: p.slate[100], text: p.ink[500] },
  primary: { DEFAULT: p.blue[500], hover: p.blue[700], tint: p.blue[50], ink: p.white },
  violet: { DEFAULT: p.violet[500], tint: p.violet[50] },
  teal: { DEFAULT: p.teal[600] },
  /** Finished well: done, confirmed, paid. */
  success: { DEFAULT: p.green[500], text: p.green[800], tint: p.green[50] },
  /** Waits on a person or is held: pending, waiting for you. Never a failure. */
  warn: { DEFAULT: p.amber[500], text: p.amber[800], tint: p.amber[50] },
  /** Failed or refused, and the destructive button. */
  attention: { text: p.red[700], tint: p.red[50] },
} as const;

/** Corner radii: controls, cards, panels. */
export const radius = { sm: "14px", md: "18px", lg: "24px", full: "9999px" } as const;

/** Elevation. Soft and low: a card lifts off the ground, it does not float. */
export const shadow = {
  card: "0 1px 2px rgb(11 16 32 / 0.04), 0 8px 24px -12px rgb(11 16 32 / 0.10)",
  raised: "0 2px 4px rgb(11 16 32 / 0.05), 0 16px 40px -16px rgb(11 16 32 / 0.16)",
} as const;

export const typography = {
  fontFamily: {
    sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
    display: ["Space Grotesk Variable", "Space Grotesk", "Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
    mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  },
} as const;

/** Named widths. `page` bounds the console so lines stay readable on an ultrawide. */
export const layout = {
  /** `page` bounds every page and the header alike, so their edges line up; `aside` is a page's side panel; `form` a form's column. */
  width: { page: "96rem", aside: "22rem", form: "42rem" },
  /**
   * Grid columns the page layouts are built from: a page beside its side panel, a form's measured column beside its preview
   * or help (the pair stays together rather than leaving a gap between them), and cards that fill the width — as many
   * columns of at least 17rem as fit, so a list uses a desktop and is one column on a phone.
   */
  grid: { "page-aside": "minmax(0, 1fr) 22rem", "form-aside": "minmax(0, 42rem) minmax(18rem, 28rem)", cards: "repeat(auto-fill, minmax(min(17rem, 100%), 1fr))" },
  /** A phone's safe area — the notch and the home indicator — for pages drawn edge to edge (`viewport-fit=cover`). */
  safe: { top: "env(safe-area-inset-top, 0px)", bottom: "env(safe-area-inset-bottom, 0px)", left: "env(safe-area-inset-left, 0px)", right: "env(safe-area-inset-right, 0px)" },
  /** The smallest comfortable touch target. */
  touch: "44px",
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
