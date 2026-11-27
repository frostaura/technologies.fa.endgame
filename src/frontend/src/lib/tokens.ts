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
  /** The cue at the foot of a sheet or menu that scrolls: there is more below. */
  cue: "inset 0 -16px 14px -14px rgb(11 16 32 / 0.22)",
  /** A menu or popover: a defined edge and a clear lift off the page. */
  menu: "0 2px 6px rgb(11 16 32 / 0.08), 0 16px 36px rgb(11 16 32 / 0.16)",
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
export const breakpoints = { sm: 640, md: 768, lg: 1024, hd: 1100, xl: 1280, "2xl": 1536, "3xl": 1600, "4xl": 2000, short: 500, railMin: 560 } as const;

/** Tailwind's `screens`, from {@link breakpoints}. Plain widths only, so `max-sm:` and friends exist. */
export const screens = {
  sm: `${breakpoints.sm}px`,
  md: `${breakpoints.md}px`,
  lg: `${breakpoints.lg}px`,
  /** The desktop header holds the mode switch and Sign out on its own row only from here; below, they are in the account menu. */
  hd: `${breakpoints.hd}px`,
  xl: `${breakpoints.xl}px`,
  "2xl": `${breakpoints["2xl"]}px`,
  "3xl": `${breakpoints["3xl"]}px`,
  "4xl": `${breakpoints["4xl"]}px`,
} as const;

/**
 * The `short:` variant: a phone on its side — little height, and WIDER than it is tall. A short window that is
 * upright (a portrait phone with its keyboard open, 375×450) is not short: it keeps the phone layout.
 */
export const shortQuery = `(max-height: ${breakpoints.short - 0.02}px) and (orientation: landscape)`;

/**
 * A phone on its side: short, wider than it is tall, at least `railMin` wide (room for the rail and a column
 * beside it) and not wide enough for the desktop. It gets a layout of its own (the `rail:` variant) — a slim
 * side rail in place of the bottom bar, a one-line header, one full-width column beside the rail, and sheets
 * that come in from the side. Anything narrower or upright stays the phone layout, so content is never
 * crushed beside a rail.
 */
export const railQuery = `${shortQuery} and (min-width: ${breakpoints.railMin}px) and (max-width: ${breakpoints.lg - 0.02}px)`;

/** A screen worked by touch (any phone or tablet), or drawn as a phone: every control there is a thumb's size (`touch:`). */
export const coarseQuery = `(pointer: coarse), (max-width: ${breakpoints.sm - 0.02}px), ${railQuery}`;

/** The media queries the shell's script reads, from the same numbers. */
export const viewportQueries = {
  phone: `(max-width: ${breakpoints.sm - 0.02}px), ${railQuery}`,
  desktop: `(min-width: ${breakpoints.lg}px)`,
} as const;

/**
 * Where a {@link Table} stops being a list of cards and becomes a table: the width of the table's OWN box (a
 * container query), not the window's — a table beside a side panel or a docked pane switches when it has the
 * room, wherever that is. A page picks the threshold its columns need.
 */
export const tableAt = { narrow: "36rem", medium: "48rem", wide: "60rem" } as const;

/** A table's column widths by kind (`components/ui/table.tsx`): fixed by kind, never by content, so rows line up. */
export const tableTracks = {
  grow: "minmax(0, 2fr)",
  text: "minmax(0, 1fr)",
  figure: "minmax(5.5rem, 0.6fr)",
  status: "minmax(8rem, 0.8fr)",
  date: "minmax(9.5rem, 0.8fr)",
  action: "minmax(7rem, auto)",
  /** The width of a column's name beside its value, in a table's card form. */
  cardLabel: "7.5rem",
} as const;

/** Named widths. `frame` caps the whole console (header, page and side panel) so nothing spans an ultrawide. */
export const layout = {
  width: {
    /** The whole console's cap from the 4xl tier. */
    frame: "137.5rem",
    page: "96rem",
    aside: "22rem",
    "aside-wide": "26rem",
    /** The conversation pane docked at the right: narrow, wide, and collapsed to a rail (ARCH-012). */
    dock: "26rem",
    "dock-wide": "34rem",
    "dock-rail": "3.5rem",
    form: "40rem",
    prose: "45rem",
    aura: "20rem",
    bubble: "85%",
    reply: "92%",
    /** A menu or panel that opens over the composer. */
    popover: "24rem",
    /** An attachment chip's name before it is cut short. */
    chip: "11rem",
  },
  /** The organisation graph's frame: tall enough to read, short enough to keep the page in view. A bottom sheet's tallest. */
  height: {
    graph: "40rem",
    /** A bottom sheet's tallest: 85% of what is visible, so the page behind always shows it is a sheet. */
    sheet: "calc(var(--visible-height, 100dvh) * 0.85)",
    visible: "var(--visible-height, 100dvh)",
    /** The docked conversation: the viewport under the shell's sticky header (`--shell-chrome`, kept current by the shell). */
    dock: "calc(100dvh - var(--shell-chrome, 0px))",
    /** The conversation placed in a page (a tablet, an app's or an employee's page): tall enough to talk, never the whole page. */
    pane: "min(46rem, 80dvh)",
    /** The composer's text box at its tallest before it scrolls (about eight lines). */
    composer: "12rem",
    /** A thumbnail of an attached image. */
    thumb: "4.5rem",
    /** The panel of what it can use, and the "/" and "@" menus, at their tallest. */
    popover: "min(28rem, 50dvh)",
  },
  /** How far below the top a sticky panel sits: under the shell's header. */
  chrome: "var(--shell-chrome, 0px)",
  /** The smallest comfortable touch target. */
  touch: "44px",
  /** The clear band above and below a 32px control (a switch) that makes it a touch target without drawing it larger. */
  touchPad: "6px",
  /** The phone's bottom bar, above the home indicator's safe area; pages leave this much room under their last line. */
  nav: "4rem",
  /** The phone's header row. */
  bar: "3.5rem",
  /** The side rail that stands in for the bottom bar on a phone on its side. */
  rail: "4.5rem",
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
  columns: {
    "chart-row": "fit-content(9rem) minmax(0, 1fr)",
    /** A line that grows and the thing that ends it (a figure, an action): the money pages' rows. */
    "grow-end": "minmax(0, 1fr) auto",
    /** A control before its words (a switch, a dot), and the words; then, optionally, what ends the row. */
    "lead-grow": "auto minmax(0, 1fr)",
    "lead-grow-end": "auto minmax(0, 1fr) auto",
    "dot-grow": "0.5rem minmax(0, 1fr)",
    "dot-grow-end": "0.5rem minmax(0, 1fr) auto",
    /** A wide credits page: the budget tree, and the month's figures and top-ups beside it. */
    "main-side": "minmax(0, 1fr) 24rem",
    /** God mode's organisation row: who it is, then its four figures. */
    "name-wide": "minmax(13rem, 1.1fr) minmax(0, 2.4fr)",
    /** A form's first field wider than the two after it. */
    "wide-two": "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)",
    /** A run's timeline row: mark | who and what | time over cost (a phone) … */
    step: "2rem minmax(0, 1fr) 5.5rem",
    /** … and mark | who and what | cost | time, the same two right-hand columns on every row. */
    "step-wide": "2rem minmax(0, 1fr) 6.5rem 5.25rem",
    /** A run page from 1600: the steps, and the plan beside them. */
    "run-wide": "minmax(0, 1fr) minmax(0, 32rem)",
    /** A numbered item with its tag: number | words, and on a wide card | tag. */
    numbered: "1.75rem minmax(0, 1fr)",
    "numbered-tagged": "1.75rem minmax(0, 1fr) auto",
    /** One task on one line: its state | what it is | who has it | the way to more. */
    task: "7.25rem minmax(0, 1fr) auto 1rem",
  },
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
