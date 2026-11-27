import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The academy is a static site with relative URLs throughout, so it works under
 * /technologies.fa.endgame/ on GitHub Pages and straight from file://. A module script is refused
 * on file://, so the build is one classic, deferred script (iife, no code splitting).
 *
 * In `vite dev` the stand-in demo (`test-double/demo/`, the bridge's test double) answers at
 * /demo/ so the stepper can be driven before lane D's demo exists. It is never built or published.
 */
const classicScript = (): Plugin => ({
  name: "academy-classic-script",
  apply: "build",
  enforce: "post",
  transformIndexHtml(html) {
    const scripts: string[] = [];
    const rest = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>\s*/g, (_m, src: string) => {
      scripts.push(`<script defer src="${src}"></script>`);
      return "";
    });
    return rest.replace(/ crossorigin(?=[ >])/g, "").replace("</head>", `  ${scripts.join("\n")}\n  </head>`);
  },
});

const standInDemo = (): Plugin => ({
  name: "academy-stand-in-demo",
  apply: "serve",
  configureServer(server) {
    const dir = path.resolve(import.meta.dirname, "test-double/demo");
    server.middlewares.use("/demo", (req, res, next) => {
      const name = (req.url ?? "/").split("?")[0]?.replace(/^\/+/, "") || "index.html";
      const file = path.join(dir, path.basename(name));
      if (!existsSync(file)) return next();
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/html");
      res.end(readFileSync(file));
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), classicScript(), standInDemo()],
  server: { port: 5470, strictPort: true, host: "127.0.0.1" },
  build: {
    outDir: "dist",
    sourcemap: false,
    assetsInlineLimit: 0,
    // One classic script by design (it must run from file://, where chunks cannot load), carrying
    // every flow, script, search index and print row: it grows with the product's flows (CLAUDE.md
    // rule 14). This is the budget it is held to, with room for a season of new flows; past it, the
    // content itself must be made smaller, not split.
    chunkSizeWarningLimit: 2600,
    rolldownOptions: { output: { format: "iife", codeSplitting: false } },
  },
});
