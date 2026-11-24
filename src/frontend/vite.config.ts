import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In the stack the console is a static bundle behind the edge, which sends /api to the control
 * plane. In `vite dev` this proxy plays the edge's part: /api goes to VITE_API_TARGET, by default
 * the edge of a running stack (`make up`, port 8095), so the dev server shows real health.
 * 127.0.0.1 rather than localhost: on macOS localhost resolves to ::1 first.
 */
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8095";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5465,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});
