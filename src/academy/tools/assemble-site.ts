import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SITE_URL } from "./build-content.ts";

/**
 * Assembles the GitHub Pages site at the repository's `site/`: the academy at the root, the demo
 * console under `demo/` when it has been built, a 404.html that returns to the app, and
 * `.nojekyll`. Every URL inside is relative, so the same folder works under
 * /technologies.fa.endgame/ and from file://.
 */

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "../..");

export function assemble(out = path.join(repo, "site"), demoDist = process.env.DEMO_DIST ? path.resolve(repo, process.env.DEMO_DIST) : path.join(repo, "src/demo/dist")) {
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "index.html"))) throw new Error("site: the academy is not built; run `make academy-build` first");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(dist, out, { recursive: true });
  let demo = false;
  if (existsSync(path.join(demoDist, "index.html"))) {
    cpSync(demoDist, path.join(out, "demo"), { recursive: true });
    demo = true;
  }
  const base = new URL(process.env.SITE_URL?.trim() || DEFAULT_SITE_URL).pathname;
  writeFileSync(
    path.join(out, "404.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Endgame Academy</title>
<meta http-equiv="refresh" content="0; url=${base}">
<script>location.replace(${JSON.stringify(base)} + "#/missing");</script>
</head>
<body><p><a href="${base}">The Endgame Academy</a></p></body>
</html>
`,
  );
  writeFileSync(path.join(out, ".nojekyll"), "");
  // The assembled site is build output: never tracked.
  writeFileSync(path.join(out, ".gitignore"), "*\n");
  return { out, demo };
}

if (import.meta.main) {
  const { out, demo } = assemble();
  process.stdout.write(`Assembled ${path.relative(repo, out)}/: the academy at the root${demo ? ", the demo under demo/" : ""}.\n`);
  if (!demo)
    process.stdout.write(
      "  No demo build was found (lane D's `make demo-build` writes it; set DEMO_DIST to point elsewhere).\n  The academy ships without ./demo/: each live step shows its text and facts, and says once that the live console could not be loaded.\n",
    );
}
