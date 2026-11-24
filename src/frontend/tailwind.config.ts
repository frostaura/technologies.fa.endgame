import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { cssVariables, layout, radius, tailwindColors, typography } from "./src/lib/tokens";

/**
 * The Tailwind theme. It holds no values: every colour, radius, shadow and typeface comes from
 * `src/lib/tokens.ts`. The plugin writes the role variables under `:root`.
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
      boxShadow: { card: "var(--shadow-card)", raised: "var(--shadow-raised)" },
      fontFamily: {
        sans: [...typography.fontFamily.sans],
        display: [...typography.fontFamily.display],
        mono: [...typography.fontFamily.mono],
      },
      maxWidth: layout.width,
      width: { aside: layout.width.aside },
    },
  },
  plugins: [tokenVariables],
};

export default config;
