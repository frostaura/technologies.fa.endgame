import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { serve } from "./serve.ts";
import type { DemoStep, ScriptStep, StepScript } from "../src/content/scripts.ts";

/**
 * `make academy-shots`: plays every step script against the built demo, as the academy plays it,
 * and saves one image per demo step — and one for where each variation ends — under
 * `public/shots/<FLOW-ID>/<step>.webp` (`v<n>.webp` for a variation) and a smaller JPEG beside each
 * for print, with `public/shots/index.json`
 * naming each. The print version (academy.pdf, operator-handbook.pdf) sets each image beside its
 * step, and the stage falls back to it when the live console cannot load.
 *
 * Deterministic: a fixed clock for dates, a fixed viewport, reduced motion, each act played as the
 * academy plays the step being shown and awaited to its end, the page settled before the picture. A step whose picture is the same as the one before it
 * names that image rather than saving another, and a file whose bytes have not changed is not
 * written again.
 *
 *   node tools/capture-shots.ts [demoDir]     ACADEMY_FLOWS=APP,ASK limits it to those flows.
 */

const root = path.resolve(import.meta.dirname, "..");
const demoDir = path.resolve(process.argv[2] ?? path.join(root, "../demo/dist"));
const scriptsDir = path.join(root, "scripts");
const out = path.join(root, "public/shots");
const port = Number(process.env.SHOTS_PORT ?? 5691);
const VIEWPORT = { width: 1180, height: 760 };
const QUALITY = Number(process.env.SHOTS_QUALITY ?? 0.72);
/** The demo's clock for anything it dates: one fixed moment, so "3 days ago" never drifts between runs. */
const NOW = new Date("2026-11-25T10:00:00Z");
const PRINT_WIDTH = 880;
const PRINT_QUALITY = 0.7;
const WORKERS = Number(process.env.SHOTS_WORKERS ?? 4);

interface Play {
  key: string;
  flow: string;
  persona: string;
  scenario: string;
  start: string;
  steps: ScriptStep[];
  /** Which steps get a picture: every demo step, or (a variation) only where it ends. */
  shoot: (step: DemoStep, last: boolean) => string | null;
}

export interface ShotIndex {
  format: 1;
  viewport: { width: number; height: number };
  shots: Record<string, string>;
  hashes: Record<string, string>;
}

function plays(): Play[] {
  const only = (process.env.ACADEMY_FLOWS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const wanted = (id: string) => !only.length || only.some((p) => id === p || id.startsWith(`${p}-`));
  const scripts = readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(scriptsDir, f), "utf8")) as StepScript)
    .filter((s) => wanted(s.flow));
  return scripts.flatMap((s) => [
    { key: s.flow, flow: s.flow, persona: s.persona, scenario: s.scenario, start: s.start, steps: s.steps, shoot: (st: DemoStep) => `${s.flow}/${st.step}` },
    ...(s.variations ?? []).map((v, i) => ({ key: `${s.flow} variation ${i + 1}`, flow: s.flow, persona: v.persona, scenario: v.scenario, start: v.start, steps: v.steps, shoot: (_st: DemoStep, last: boolean) => (last ? `${s.flow}/v${i + 1}` : null) })),
  ]).filter((p) => p.steps.some((st) => st.kind === "demo"));
}

const sha = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** Encodes in the browser itself, so no image library is needed: WebP for the site, JPEG for print. */
async function encode(encoder: Page, png: Buffer, type: "image/webp" | "image/jpeg", quality: number, width?: number): Promise<Buffer> {
  const b64 = await encoder.evaluate(async ([data, t, q, w]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    const scale = w ? Math.min(1, w / img.naturalWidth) : 1;
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d");
    if (g) {
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
    }
    return c.toDataURL(t, q).split(",")[1] ?? "";
  }, [png.toString("base64"), type, quality, width ?? 0] as const);
  return Buffer.from(b64, "base64");
}

/**
 * Waits until the console has stopped loading — no skeleton shimmering, no busy region — and has
 * been quiet for a moment, so a picture never shows a half-drawn screen. A busy region the step
 * itself rings (a wake in progress) is what the picture is of, and is not waited out.
 */
async function settle(page: Page) {
  await page
    .waitForFunction(() => ![...document.querySelectorAll('.animate-shimmer, [aria-busy="true"], [role="status"][aria-label^="Loading"]')].some((el) => !el.closest("[data-demo-chrome]") && el.getClientRects().length > 0 && !el.matches("[data-demo-ringed]") && !el.querySelector("[data-demo-ringed]")), null, { timeout: 8000, polling: 100 })
    .catch(() => undefined);
  await page.waitForTimeout(450);
}

async function capture(browser: Browser, play: Play, base: string, index: ShotIndex, encoder: Page): Promise<string[]> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light", locale: "en-GB", timezoneId: "UTC" });
  const page = await context.newPage();
  const problems: string[] = [];
  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`${base}index.html?embed=1`);
    await page.waitForFunction(() => "endgameDemo" in window);
    const call = (op: string, ...args: unknown[]) =>
      page.evaluate(async ([o, a]) => (window as unknown as { endgameDemo: Record<string, (...x: unknown[]) => unknown> }).endgameDemo[o as string]?.(...(a as unknown[])), [op, args] as const);
    await call("goto", { route: play.start, persona: play.persona, scenario: play.scenario });
    await settle(page);
    const demo = play.steps.filter((s): s is DemoStep => s.kind === "demo");
    let previous: { hash: string; file: string } | null = null;
    for (const [i, step] of demo.entries()) {
      try {
        // A step may hand the same world to someone else (the operator acts, the Owner reads), as the flow page plays it.
        if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
        if (step.clock) await call("clock", step.clock);
        // Played as the learner's console plays it, not caught up: the picture is the step's own
        // moment ("Inviting…" while the server works, the device sheet waiting), the same moment
        // a link straight to the step shows (ARCH-010).
        if (step.act) await call("act", step.act, false);
        await settle(page);
        if (step.highlight) await call("highlight", step.highlight);
      } catch (e) {
        problems.push(`${play.key} step ${step.step}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? ""}`);
      }
      const key = play.shoot(step, i === demo.length - 1);
      if (!key) continue;
      // Whatever the step started (a send, a sign-in, a refresh) has drawn its result, then the picture.
      await settle(page);
      const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      const hash = sha(png);
      if (previous && previous.hash === hash) {
        index.shots[key] = previous.file;
        continue;
      }
      const file = `${key}.webp`;
      const target = path.join(out, file);
      if (index.hashes[file] !== hash || !existsSync(target) || !existsSync(target.replace(/\.webp$/, ".jpg"))) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, await encode(encoder, png, "image/webp", QUALITY));
        // The PDFs take a JPEG beside it: Chromium embeds a JPEG as it is, where a WebP would be stored uncompressed.
        writeFileSync(target.replace(/\.webp$/, ".jpg"), await encode(encoder, png, "image/jpeg", PRINT_QUALITY, PRINT_WIDTH));
        index.hashes[file] = hash;
      }
      index.shots[key] = file;
      previous = { hash, file };
    }
  } finally {
    await context.close();
  }
  return problems;
}

function sizeOf(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = sizeOf(p);
      files += s.files;
      bytes += s.bytes;
    } else if (entry.name.endsWith(".webp")) {
      files += 1;
      bytes += statSync(p).size;
    }
  }
  return { files, bytes };
}

async function main() {
  if (!existsSync(path.join(demoDir, "index.html"))) throw new Error(`academy-shots: no demo build at ${demoDir}; run \`make demo-build\` first`);
  const list = plays();
  const indexFile = path.join(out, "index.json");
  const filtered = !!process.env.ACADEMY_FLOWS;
  const old: ShotIndex | null = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as ShotIndex) : null;
  const sameShape = old?.viewport.width === VIEWPORT.width && old.viewport.height === VIEWPORT.height;
  const index: ShotIndex = { format: 1, viewport: VIEWPORT, shots: filtered && sameShape ? { ...old.shots } : {}, hashes: sameShape && old ? { ...old.hashes } : {} };
  if (filtered) index.shots = Object.fromEntries(Object.entries(index.shots).filter(([k]) => !list.some((p) => k.startsWith(`${p.flow}/`))));
  mkdirSync(out, { recursive: true });

  const server = await serve(demoDir, port, "/demo/");
  const browser = await chromium.launch();
  const encoder = await browser.newPage();
  const problems: string[] = [];
  const started = Date.now();
  try {
    const queue = [...list];
    await Promise.all(
      Array.from({ length: Math.max(1, WORKERS) }, async () => {
        for (let play = queue.shift(); play; play = queue.shift()) problems.push(...(await capture(browser, play, `http://127.0.0.1:${port}/demo/`, index, encoder)));
      }),
    );
  } finally {
    await browser.close();
    server.close();
  }

  // Images no step names any more are removed, so the set never grows stale.
  const named = new Set(Object.values(index.shots));
  if (!filtered) {
    for (const flowDir of readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const f of readdirSync(path.join(out, flowDir.name))) {
        const rel = `${flowDir.name}/${f}`;
        if (!named.has(rel.replace(/\.jpg$/, ".webp"))) {
          rmSync(path.join(out, rel));
          index.hashes = Object.fromEntries(Object.entries(index.hashes).filter(([k]) => k !== rel));
        }
      }
      if (readdirSync(path.join(out, flowDir.name)).length === 0) rmSync(path.join(out, flowDir.name), { recursive: true });
    }
  }
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  writeFileSync(indexFile, `${JSON.stringify({ ...index, shots: sorted(index.shots), hashes: sorted(index.hashes) }, null, 2)}\n`);
  const { files, bytes } = sizeOf(out);
  process.stdout.write(
    `Captured ${Object.keys(index.shots).length} steps from ${list.length} plays in ${Math.round((Date.now() - started) / 1000)} s: ${files} images, ${(bytes / 1024 / 1024).toFixed(1)} MB (${files ? Math.round(bytes / files / 1024) : 0} KB each on average), in ${path.relative(process.cwd(), out)}/\n`,
  );
  if (problems.length) {
    for (const p of problems) process.stdout.write(`  ${p}\n`);
    throw new Error(`academy-shots: ${problems.length} step(s) did not play; make demo-e2e names them`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
