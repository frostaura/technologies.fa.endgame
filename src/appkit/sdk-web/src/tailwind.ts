import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin.js";
import { cssVariables, layout, radius, tailwindColors, typography } from "./tokens.js";

/**
 * The Tailwind preset every Endgame app uses. It carries every colour, radius, shadow and typeface
 * from the token layer and writes the role variables under `:root`. An app's config is then just:
 *
 * ```ts
 * import { endgamePreset, endgameContent } from "@endgame/appkit/tailwind";
 * export default { presets: [endgamePreset], content: ["./index.html", "./src/**\/*.{ts,tsx}", ...endgameContent] };
 * ```
 */
export const endgamePreset: Partial<Config> = {
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
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ":root": { colorScheme: "light", ...cssVariables() } });
    }),
  ],
};

/** Where the kit's primitives live, so Tailwind keeps the classes they use. */
export const endgameContent: string[] = ["./node_modules/@endgame/appkit/dist/**/*.js"];
