import type { Config } from "tailwindcss";
import consolePreset from "../frontend/tailwind.config.ts";
import { academy } from "./src/theme/tokens.ts";

/**
 * The console's Tailwind config is the preset — its colours, radii, shadows, fonts and motion,
 * imported rather than copied, so the academy and the product are one brand. The academy adds
 * only the sizes in `src/theme/tokens.ts`.
 */
const config: Config = {
  presets: [consolePreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: Object.fromEntries(Object.entries(academy.fontSize).map(([k, [size, rest]]) => [k, [size, { ...rest }]])),
      maxWidth: academy.width,
      width: academy.width,
      height: academy.height,
      minHeight: academy.height,
      inset: academy.inset,
    },
  },
};

export default config;
