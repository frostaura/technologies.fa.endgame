import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { blur, cssVariables, layout, motion, radius, screens, shortQuery, surfaces, tailwindColors, typography, viewportQueries } from "./src/lib/tokens";

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
      boxShadow: { card: "var(--shadow-card)", raised: "var(--shadow-raised)", press: "var(--shadow-press)", toggle: "var(--shadow-toggle)" },
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
        aura: layout.width.aura,
        nav: layout.nav,
        bar: layout.bar,
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
      height: { visible: layout.visible.height, dock: layout.height.dock, pane: layout.height.pane, thumb: layout.height.thumb },
      gridTemplateColumns: layout.columns,
      minHeight: { touch: layout.touch, nav: layout.nav, bar: layout.bar },
      lineHeight: { touch: layout.touch },
      borderWidth: { touch: layout.touchPad },
      minWidth: { touch: layout.touch, field: layout.field },
      margin: { wire: layout.wireInset },
      keyframes: motion.keyframes,
      animation: motion.animation,
      animationDelay: motion.delay,
      transitionTimingFunction: motion.ease,
      backgroundImage: surfaces,
      backgroundSize: { stripe: "40px 100%", shimmer: "200% 100%" },
      blur,
    },
  },
  plugins: [
    tokenVariables,
    // `short:` — a phone on its side: little height, so headers and bars draw slimmer.
    plugin(({ addVariant }) => {
      addVariant("short", `@media ${shortQuery}`);
    }),
    // `phone:` — exactly where the console draws its phone layout (`useViewport`), upright or on its side.
    plugin(({ addVariant }) => {
      addVariant("phone", `@media ${viewportQueries.phone}`);
    }),
    // `delay-*` for animations, read from the same stagger scale.
    plugin(({ matchUtilities, theme }) => {
      matchUtilities({ "animate-delay": (value: string) => ({ animationDelay: value }) }, { values: theme("animationDelay") });
    }),
  ],
};

export default config;
