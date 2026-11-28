import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The academy is a static site with relative URLs throughout, so it works under
 * /technologies.fa.endgame/ on GitHub Pages and straight from file://. A module script is refused
 * on file://, so the code is one classic, deferred script (iife, no code splitting), and the
 * content it reads — every flow, step script, the search index, the shot and print rows — is a
 * second classic script beside it (`academyData`), loaded first.
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

/**
 * The academy's content, split from its code: the generated JSON (src/generated/) is written once
 * into `assets/academy-data-<hash>.js`, a classic script that sets `window.__academyData`, and each
 * import of it in the code reads that global instead of carrying the data in the code's bundle. A
 * classic script loads from file:// where a module chunk cannot, and the two scripts are deferred in
 * document order, so the data is there before the code runs. `vite dev` and the unit tests import
 * the JSON as usual.
 */
const DATA = ["content", "scripts", "site", "search-index", "shots", "prints"] as const;
const academyData = (): Plugin => {
  const dir = path.resolve(import.meta.dirname, "src/generated");
  let file = "";
  let source = "";
  return {
    name: "academy-data",
    apply: "build",
    enforce: "pre",
    buildStart() {
      const parts = DATA.map((name) => `${JSON.stringify(name)}:${readFileSync(path.join(dir, `${name}.json`), "utf8").trim()}`);
      source = `window.__academyData={${parts.join(",")}};\n`;
      file = `assets/academy-data-${createHash("sha256").update(source).digest("hex").slice(0, 10)}.js`;
    },
    // Each import of a generated file becomes a module of its own that reads the global.
    resolveId(source, importer) {
      if (!importer || !source.endsWith(".json")) return null;
      const name = DATA.find((n) => path.resolve(path.dirname(importer), source) === path.join(dir, `${n}.json`));
      return name ? `\0academy-data:${name}` : null;
    },
    load(id) {
      return id.startsWith("\0academy-data:") ? `export default window.__academyData[${JSON.stringify(id.slice("\0academy-data:".length))}];` : null;
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: file, source });
    },
    transformIndexHtml: {
      order: "post",
      // Ahead of every other script, so it runs first among the deferred ones.
      handler: (html) => html.replace(/<meta charset="UTF-8" \/>/, (m) => `${m}\n    <script defer src="./${file}"></script>`),
    },
  };
};

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
  plugins: [academyData(), react(), classicScript(), standInDemo()],
  server: { port: 5470, strictPort: true, host: "127.0.0.1" },
  build: {
    outDir: "dist",
    sourcemap: false,
    assetsInlineLimit: 0,
    // The code's one classic script; the content is its own script beside it (`academyData`).
    chunkSizeWarningLimit: 2400,
    rolldownOptions: { output: { format: "iife", codeSplitting: false } },
  },
});
