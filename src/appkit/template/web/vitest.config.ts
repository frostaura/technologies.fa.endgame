import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["src/test-setup.ts"],
    // The kit goes through Vite like the app's own code, so `@endgame/appkit/testing`'s router is the
    // same copy of react-router the app uses (Node would otherwise load a second, CommonJS one).
    server: { deps: { inline: ["@endgame/appkit"] } },
  },
});
