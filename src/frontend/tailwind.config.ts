import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { coarseQuery, cssVariables, layout, lowQuery, masks, motion, pageAt, radius, railQuery, screens, shortQuery, surfaces, tableAt, tableTracks, tailwindColors, typography, viewportQueries } from "./src/lib/tokens";

/**
 * The Tailwind theme. It holds no values: every colour, radius, shadow, typeface and motion comes
 * from `src/lib/tokens.ts`. The plugin writes the role variables under `:root`.
 */
const tokenVariables = plugin(({ addBase }) => {
  addBase({ ":root": { colorScheme: "light", ...cssVariables() } });
});

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    screens,
    extend: {
      colors: tailwindColors(),
      borderColor: { DEFAULT: "rgb(var(--color-border) / <alpha-value>)" },
      borderRadius: radius,
      boxShadow: { card: "var(--shadow-card)", raised: "var(--shadow-raised)", press: "var(--shadow-press)", toggle: "var(--shadow-toggle)", cue: "var(--shadow-cue)", menu: "var(--shadow-menu)" },
      fontFamily: {
        sans: [...typography.fontFamily.sans],
        display: [...typography.fontFamily.display],
        mono: [...typography.fontFamily.mono],
      },
      fontSize: Object.fromEntries(Object.entries(typography.fontSize).map(([k, [size, rest]]) => [k, [size, { ...rest }]])),
      maxWidth: layout.width,
      width: layout.width,
      maxHeight: layout.height,
      spacing: {
        nav: layout.nav,
        bar: layout.bar,
        rail: layout.rail,
        "nav-safe": layout.navSafe,
        "sheet-gap": layout.sheetGap,
        "safe-t": layout.safe.top,
        "safe-b": layout.safe.bottom,
        "safe-l": layout.safe.left,
        "safe-r": layout.safe.right,
        "visible-top": layout.visible.top,
        chrome: layout.chrome,
        thumb: layout.height.thumb,
      },
      height: { visible: layout.visible.height, dock: layout.height.dock, thumb: layout.height.thumb },
      gridTemplateColumns: layout.columns,
      gridTemplateRows: layout.rows,
      minHeight: { touch: layout.touch, nav: layout.nav, bar: layout.bar },
      lineHeight: { touch: layout.touch },
      borderWidth: { touch: layout.touchPad },
      minWidth: { touch: layout.touch, field: layout.field, thumb: layout.height.thumb },
      margin: { wire: layout.wireInset },
      keyframes: motion.keyframes,
      animation: motion.animation,
      animationDelay: motion.delay,
      transitionTimingFunction: motion.ease,
      transitionProperty: motion.property,
      backgroundImage: surfaces,
      backgroundSize: { stripe: "40px 100%", shimmer: "200% 100%" },
    },
  },
  plugins: [
    tokenVariables,
    // `low:` — a window with little height: the conversation pane folds its header, strip and cost line to one line each.
    plugin(({ addVariant }) => {
      addVariant("low", `@media ${lowQuery}`);
    }),
    // `fade-y` (a list's ends fade out) and `text-vertical` (a rail's label, read bottom to top), from the tokens.
    plugin(({ addUtilities }) => {
      addUtilities({
        ".fade-y": { maskImage: masks["fade-y"], WebkitMaskImage: masks["fade-y"] },
        ".text-vertical": { writingMode: "vertical-rl", transform: "rotate(180deg)" },
        ".wrap-balance": { textWrap: "balance" },
        // At most as wide as its column, measured with its own margins: a control pulled outside its box by a negative margin
        // keeps the room it was given (100% would cut it to the box it left). 100% where the keyword is not known.
        ".max-w-column": { maxWidth: ["100%", "-webkit-fill-available", "stretch"] },
      });
    }),
    // `short:` — a phone on its side: little height, so headers and bars draw slimmer.
    plugin(({ addVariant }) => {
      addVariant("short", `@media ${shortQuery}`);
    }),
    // `phone:` — exactly where the console draws its phone layout (`useViewport`), upright or on its side.
    plugin(({ addVariant }) => {
      addVariant("phone", `@media ${viewportQueries.phone}`);
    }),
    // `touch:` — worked by touch (a phone or a tablet): controls are a thumb's size.
    plugin(({ addVariant }) => {
      addVariant("touch", `@media ${coarseQuery}`);
    }),
    // `rail:` — a phone on its side: the side rail, the one-line header, two columns. Registered last, so it wins.
    plugin(({ addVariant }) => {
      addVariant("rail", `@media ${railQuery}`);
    }),
    // The page column (`main` in `AppShell`, the named container `page`) and its thresholds (`pageAt`): a page switches its
    // layout on the room it has — beside a docked pane, a side panel or neither — never on the window's width. The rule is
    // scoped under `.page-column`, so a `page-*:` class outranks a window class (`lg:`, `xl:`) on the same property: the room
    // the page really has is the last word.
    plugin(({ addComponents, addVariant }) => {
      addComponents({ ".page-column": { containerType: "inline-size", containerName: "page" } });
      for (const [name, at] of Object.entries(pageAt)) addVariant(`page-${name}`, `@container page (min-width: ${at}) { .page-column & }`);
    }),
    // The one table (`components/ui/table.tsx`): a list of cards in a narrow box, a table from its threshold up —
    // measured on the table's own box (a container query), so it switches wherever it has the room.
    plugin(({ addComponents, theme }) => {
      const wide = (at: string) => ({
        [`@container table (min-width: ${tableAt[at as keyof typeof tableAt]})`]: {
          [`.tbl-frame[data-at="${at}"] > .tbl-head, .tbl-frame[data-at="${at}"] .tbl-row`]: {
            display: "grid",
            gridTemplateColumns: "var(--table-cols)",
            alignItems: "center",
          },
          [`.tbl-frame[data-at="${at}"] .tbl-cell`]: { display: "block" },
          [`.tbl-frame[data-at="${at}"] .tbl-cell-label`]: { display: "none" },
          [`.tbl-frame[data-at="${at}"] [data-kind="figure"]`]: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
          [`.tbl-frame[data-at="${at}"] [data-kind="action"]`]: { display: "flex", justifyContent: "flex-end" },
        },
      });
      addComponents({
        ".tbl-frame": { containerType: "inline-size", containerName: "table" },
        ".tbl-head": { display: "none" },
        ".tbl-row": { display: "flex", flexDirection: "column", rowGap: theme("spacing.1.5") },
        ".tbl-cell": { display: "grid", gridTemplateColumns: `${tableTracks.cardLabel} minmax(0, 1fr)`, columnGap: theme("spacing.3"), alignItems: "baseline" },
        ".tbl-cell[data-primary], .tbl-cell[data-kind='action']": { display: "block" },
        // A select in a cell keeps a field's width in the card form rather than stretching across the card.
        ".tbl-cell [data-select]": { maxWidth: theme("maxWidth.xs") },
        ...wide("narrow"),
        ...wide("medium"),
        ...wide("wide"),
      });
    }),
    // `delay-*` for animations, read from the same stagger scale.
    plugin(({ matchUtilities, theme }) => {
      matchUtilities({ "animate-delay": (value: string) => ({ animationDelay: value }) }, { values: theme("animationDelay") });
    }),
  ],
};

export default config;
