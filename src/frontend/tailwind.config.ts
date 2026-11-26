import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { blur, cssVariables, layout, motion, radius, surfaces, tailwindColors, typography } from "./src/lib/tokens";

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
      spacing: { aura: layout.width.aura },
      gridTemplateColumns: layout.columns,
      minHeight: { touch: layout.touch },
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
    // `delay-*` for animations, read from the same stagger scale.
    plugin(({ matchUtilities, theme }) => {
      matchUtilities({ "animate-delay": (value: string) => ({ animationDelay: value }) }, { values: theme("animationDelay") });
    }),
  ],
};

export default config;
