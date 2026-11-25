import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { parseFlows } from "./parse-flows.ts";
import { validateScripts, schemaPath } from "./validate-scripts.ts";
import { buildIndex } from "../src/content/search.ts";

/**
 * The content pipeline: docs/flows/0*.md → typed JSON, the step scripts validated against it, the
 * search index, the coverage report and the QR code of the site's address. Writes
 * `src/generated/` (git-ignored) and fails loudly on anything it cannot read.
 */

export const DEFAULT_SITE_URL = "https://frostaura.github.io/technologies.fa.endgame/";

const root = path.resolve(import.meta.dirname, "..");
const docs = path.resolve(root, "../../docs/flows");
const out = path.join(root, "src/generated");

/** The QR code as one SVG path in a `size`×`size` grid, drawn by the page in `currentColor`. */
export function qrPath(text: string): { size: number; path: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  let d = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
  return { size, path: d };
}

function main() {
  const siteUrl = process.env.SITE_URL?.trim() || DEFAULT_SITE_URL;
  const content = parseFlows(docs);
  const scripts = validateScripts(content.flows);
  const fatal = content.problems.filter((p) => p.fatal);
  const warnings = content.problems.filter((p) => !p.fatal);

  const log = (s = "") => process.stdout.write(s + "\n");
  log(`Academy content: ${content.flows.length} flows, ${content.flows.reduce((n, f) => n + f.steps.length, 0)} steps, from ${content.generatedFrom.length} files.`);
  log(`  Paths: ${content.tracks.map((t) => `${t.level} ${t.flows.length}`).join(" · ")} · not placed ${content.unplaced.length}`);
  if (warnings.length) {
    log(`  ${warnings.length} flow(s) read with a shape problem (carried, not fatal):`);
    for (const p of warnings) log(`    ${p.file}:${p.line} ${p.flow} — ${p.message}`);
  }
  const c = scripts.coverage;
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "0%");
  log(`  Script coverage: ${c.flowsWithScript}/${c.flows} flows (${pct(c.flowsWithScript, c.flows)}), ${c.stepsWithMedia}/${c.steps} steps with media (${pct(c.stepsWithMedia, c.steps)}).`);
  log(`  By kind: ${Object.entries(c.byKind).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}`);
  log(`  Variations with a console of their own: ${c.variations}.`);

  if (fatal.length || scripts.problems.length) {
    for (const p of fatal) log(`  FATAL ${p.file}:${p.line} ${p.flow} — ${p.message}`);
    for (const p of scripts.problems) log(`  FATAL script ${p}`);
    process.exitCode = 1;
    throw new Error(`academy content: ${fatal.length + scripts.problems.length} fatal problem(s)`);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "content.json"), JSON.stringify(content));
  writeFileSync(path.join(out, "scripts.json"), JSON.stringify(scripts.scripts));
  writeFileSync(path.join(out, "search-index.json"), JSON.stringify(buildIndex(content.flows)));
  writeFileSync(
    path.join(out, "site.json"),
    JSON.stringify({ siteUrl, qr: qrPath(siteUrl), coverage: c, builtFrom: content.generatedFrom }, null, 2),
  );
  mkdirSync(path.join(root, "public/schema"), { recursive: true });
  copyFileSync(schemaPath, path.join(root, "public/schema/step-script.schema.json"));
  // The console's own brand files, served beside the academy rather than copied into it.
  cpSync(path.resolve(root, "../frontend/public/brand"), path.join(root, "public/brand"), { recursive: true });
  log(`  Wrote src/generated/ for ${siteUrl}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
