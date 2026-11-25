import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In the stack the console is a static bundle behind the edge, which sends /api to the control
 * plane. In `vite dev` this proxy plays the edge's part: /api goes to VITE_API_TARGET, by default
 * the edge of a running stack (`make up`, port 8095), so the dev server shows real health.
 * 127.0.0.1 rather than localhost: on macOS localhost resolves to ::1 first.
 *
 * `VITE_DEMO=1` builds the static demo instead (ARCH-009): the same console from src/demo/main.tsx,
 * with its fake control plane, as ONE self-contained index.html (scripts, styles, fonts and the
 * icon sprite inlined) in dist-demo/, so it opens from any sub-path or straight from a file. The
 * product build never imports src/demo at all.
 */

const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8095";
const demo = process.env.VITE_DEMO === "1";
const root = import.meta.dirname;

/** The demo's page: its own entry, a relative favicon, and the icon sprite inlined (a file:// page cannot `<use>` another file). */
function demoPage(): Plugin {
  const sprite = readFileSync(path.join(root, "public/brand/icons.svg"), "utf8").replace(/\bid="([^"]+)"/g, 'id="icon-$1"');
  return {
    name: "endgame-demo-page",
    enforce: "pre",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
        .replace('src="/src/main.tsx"', 'src="/src/demo/main.tsx"')
        .replace('href="/brand/favicon.svg"', 'href="./brand/favicon.svg"')
        .replace("<title>Endgame</title>", "<title>Endgame — demo</title>")
          .replace('<div id="root"></div>', `${sprite}\n    <div id="root"></div>`),
    },
    transform(code, id) {
      if (!id.startsWith(path.join(root, "src")) || !/\.(tsx?|jsx?)$/.test(id)) return null;
      if (!code.includes("/brand/")) return null;
      return { code: code.replace(/`\/brand\/icons\.svg#/g, "`#icon-").replace(/(["'`])\/brand\//g, "$1./brand/"), map: null };
    },
  };
}

/** Fold the built script and stylesheet into index.html, so the page needs no other request. */
function singleFile(): Plugin {
  return {
    name: "endgame-demo-single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName === "index.html");
      if (!html || html.type !== "asset") return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk" && file.isEntry) {
          const tag = new RegExp(`<script[^>]*src="\\.?/?${file.fileName.replace(/[.]/g, "\\.")}"[^>]*></script>`);
          page = page.replace(tag, "");
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          page = page.replace("</body>", () => `<script>${code}</script>\n</body>`);
          Reflect.deleteProperty(bundle, name);
        } else if (file.type === "asset" && file.fileName.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="\\.?/?${file.fileName.replace(/[.]/g, "\\.")}"[^>]*>`);
          page = page.replace(tag, () => `<style>${String(file.source)}</style>`);
          Reflect.deleteProperty(bundle, name);
        }
      }
      html.source = page;
    },
  };
}

export default defineConfig({
  plugins: demo ? [react(), demoPage(), singleFile()] : [react()],
  resolve: { alias: { "@": path.resolve(root, "src") } },
  base: demo ? "./" : "/",
  server: {
    port: 5465,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: demo
    ? {
        outDir: "dist-demo",
        emptyOutDir: true,
        sourcemap: false,
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        modulePreload: false,
        rolldownOptions: { output: { format: "iife" }, transform: { define: { "import.meta": "{}" } } },
      }
    : { outDir: "dist", sourcemap: true },
});
