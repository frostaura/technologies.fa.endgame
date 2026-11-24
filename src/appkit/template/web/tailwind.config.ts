import type { Config } from "tailwindcss";
import { endgameContent, endgamePreset } from "@endgame/appkit/tailwind";

/** Every colour, radius and typeface comes from the kit's token layer. Add none here. */
const config: Config = {
  presets: [endgamePreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", ...endgameContent],
};

export default config;
