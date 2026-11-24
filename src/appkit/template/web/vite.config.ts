import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * base: "./" makes every built asset URL relative; the server's <base href> anchors them, so the
 * same build works under /<org>/<division>/<project>/ and at the root of a subdomain. Never change it.
 * The build goes straight into the API's wwwroot, which serves it.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "../api/wwwroot", emptyOutDir: true },
});
