import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { serve } from "./serve.ts";
import { cropFor, printedPoints, type Box, type Scene } from "./print-crop.ts";
import { PRINT_SHOT, printMmPerPx } from "../src/theme/tokens.ts";
import type { DemoStep, ScriptStep, StepScript } from "../src/content/scripts.ts";

/**
 * `make academy-shots`: plays every step script against the built demo, as the academy plays it,
 * and saves one image per demo step — and one for where each variation ends — under
 * `public/shots/<FLOW-ID>/<step>.webp` (`v<n>.webp` for a variation), a print copy of each under
 * `public/shots/print/`, and `public/shots/index.json` naming both. The print version
 * (academy.pdf, operator-handbook.pdf) sets each print copy beside or under its step, and the stage
 * falls back to the WebP when the live console cannot load.
 *
 * Deterministic: a fixed clock for dates, a fixed viewport, reduced motion, each act played as the
 * academy plays the step being shown and awaited to its end, the page settled — nothing loading,
 * no animation running — before the picture. A step whose picture is the same as the one before it
 * names that image rather than saving another, and a file whose bytes have not changed is not
 * written again.
 *
 * The print copy is the whole component the step rings, with padding (`tools/print-crop.ts`), as a
 * JPEG: Chromium embeds a JPEG as it is, where a WebP is stored uncompressed. Print copies are named
 * by their bytes, so the same picture in two steps or two flows is one file, which Chromium embeds
 * in a PDF once. A print copy all but identical to the step before's is that picture.
 *
 *   node tools/capture-shots.ts [demoDir]     ACADEMY_FLOWS=APP,ASK limits it to those flows;
 *   SHOTS_OUT=<dir> writes elsewhere; PRINT_TEXT_PX / PRINT_QUALITY try other print copies;
 *   PRINT_DEBUG=<dir> writes each print crop's screen reading there, to see why a crop fell where it did.
 */

const root = path.resolve(import.meta.dirname, "..");
const demoDir = path.resolve(process.argv[2] ?? path.join(root, "../demo/dist"));
const scriptsDir = path.join(root, "scripts");
/** Where the pictures go: `public/shots/`, or `SHOTS_OUT` (a scratch copy to try a change on). */
const out = path.resolve(process.env.SHOTS_OUT ?? path.join(root, "public/shots"));
const port = Number(process.env.SHOTS_PORT ?? 5691);
const VIEWPORT = { width: 1180, height: 760 };
/** A flow taught on the phone's console at every size (`device: "phone"`, SHL-07) is pictured on it too. */
const PHONE = { width: 390, height: 640 };
const QUALITY = Number(process.env.SHOTS_QUALITY ?? 0.72);
/** The demo's clock for anything it dates: one fixed moment, so "3 days ago" never drifts between runs. */
const NOW = new Date("2026-11-25T10:00:00Z");
/**
 * Print copies: JPEG quality, and how many pixels the smallest text in each gets. The screen is
 * captured at twice its pixels and drawn down so its smallest text is `PRINT_TEXT_PX` pixels high
 * (never more than one pixel per CSS pixel, never under 0.7): 12 px console text keeps 10 px, still
 * crisp, and a crop whose smallest text is 14 px is drawn at 0.71. Together with the quality that
 * is what keeps academy.pdf a download (under 15 MB) rather than a payload.
 */
const PRINT_QUALITY = Number(process.env.PRINT_QUALITY ?? 0.4);
const PRINT_TEXT_PX = Number(process.env.PRINT_TEXT_PX ?? 10);
export const printScale = (font: number) => (font > 0 ? Math.min(1, Math.max(0.7, PRINT_TEXT_PX / font)) : 0.8);
/**
 * The print copies' shape: the crop rules, the print scale and the encoding. When any of them
 * changes, every print copy is captured again rather than reused.
 */
const printFormat = () => sha(Buffer.from([readFileSync(path.join(import.meta.dirname, "print-crop.ts"), "utf8"), JSON.stringify(PRINT_SHOT), PRINT_QUALITY, PRINT_TEXT_PX, PAPER_HIDES].join("\n"))).slice(0, 12);
/** What a print copy never shows: the caption bubble, the soft cursor and the ring's number — on paper the step's own words sit beside it. */
const PAPER_HIDES = "[data-demo-note], [data-demo-cursor], [data-demo-marker] { visibility: hidden !important; }";
const SCALE = 2;
const WORKERS = Number(process.env.SHOTS_WORKERS ?? 4);

interface Play {
  key: string;
  flow: string;
  persona: string;
  scenario: string;
  start: string;
  steps: ScriptStep[];
  /** The console the flow is taught on: the phone's for a flow about the phone itself. */
  device?: "phone";
  /** Which steps get a picture: every demo step, or (a variation) only where it ends. */
  shoot: (step: DemoStep, last: boolean) => string | null;
}

export interface ShotIndex {
  format: 1;
  printFormat?: number | string;
  viewport: { width: number; height: number };
  shots: Record<string, string>;
  /** Each picture's print copy: its JPEG under print/, whether it goes under the step's words (wider than sits beside them), its size in CSS pixels and its smallest text. */
  print?: Record<string, PrintCopy>;
  hashes: Record<string, string>;
}

export interface PrintCopy {
  file: string;
  whole: boolean;
  width: number;
  height: number;
  font: number;
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
    { key: s.flow, flow: s.flow, persona: s.persona, scenario: s.scenario, start: s.start, steps: s.steps, device: s.device, shoot: (st: DemoStep) => `${s.flow}/${st.step}` },
    ...(s.variations ?? []).map((v, i) => ({ key: `${s.flow} variation ${i + 1}`, flow: s.flow, persona: v.persona, scenario: v.scenario, start: v.start, steps: v.steps, device: s.device, shoot: (_st: DemoStep, last: boolean) => (last ? `${s.flow}/v${i + 1}` : null) })),
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

/** True when two print copies of one size differ in no more than a few stray pixels: the same picture, captured twice. */
async function nearlySame(encoder: Page, a: Buffer, b: Buffer): Promise<boolean> {
  return encoder.evaluate(async ([x, y]) => {
    const load = async (data: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      return img;
    };
    const [p, q] = await Promise.all([load(x), load(y)]);
    if (p.naturalWidth !== q.naturalWidth || p.naturalHeight !== q.naturalHeight) return false;
    const pixels = (img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g?.drawImage(img, 0, 0);
      return g?.getImageData(0, 0, c.width, c.height).data;
    };
    const [d, e] = [pixels(p), pixels(q)];
    if (!d || !e) return false;
    let differ = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(Math.abs((d[i] ?? 0) - (e[i] ?? 0)), Math.abs((d[i + 1] ?? 0) - (e[i + 1] ?? 0)), Math.abs((d[i + 2] ?? 0) - (e[i + 2] ?? 0))) > 24) differ++;
    }
    return differ / (d.length / 4) < 0.0005;
  }, [a.toString("base64"), b.toString("base64")] as const);
}

/**
 * Waits until the console has stopped loading — no skeleton shimmering, no busy region — and has
 * been quiet for a moment, so a picture never shows a half-drawn screen. A busy region the step
 * itself rings (a wake in progress) is what the picture is of, and is not waited out. Then until no
 * animation is still running (a dialog fading in or out, a sheet sliding), in the page or its
 * frames; one that repeats forever (a spinner) is part of the screen.
 */
async function settle(page: Page) {
  await page
    .evaluate(() => (window as unknown as { endgameDemo?: { settled?: (ms: number) => Promise<void> } }).endgameDemo?.settled?.(4000))
    .catch(() => undefined);
  await page
    .waitForFunction(() => ![...document.querySelectorAll('.animate-shimmer, [aria-busy="true"], [role="status"][aria-label^="Loading"]')].some((el) => !el.closest("[data-demo-chrome]") && el.getClientRects().length > 0 && !el.matches("[data-demo-ringed]") && !el.querySelector("[data-demo-ringed]")), null, { timeout: 8000, polling: 100 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
  await page
    .waitForFunction(
      () => {
        const docs: Document[] = [document];
        for (const f of document.querySelectorAll("iframe")) {
          try {
            if (f.contentDocument) docs.push(f.contentDocument);
          } catch {
            // Another origin's frame: not ours to wait on.
          }
        }
        return docs.every((d) => d.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
      },
      null,
      { timeout: 5000, polling: 50 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

/**
 * Reads the screen for `cropFor`: the ringed control and the ring, the control's ancestors (and
 * whether each reads as a card: a border, a shadow, its own ground, or a list item, section, form,
 * group, region or dialog), the open dialog, the main region, and every line of text, in the page's
 * coordinates (a frame's contents offset by the frame).
 */
async function readScene(page: Page): Promise<Scene> {
  return page.evaluate(() => {
    type B = { x: number; y: number; width: number; height: number };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rectOf = (r: DOMRect, dx: number, dy: number): B => ({ x: r.left + dx, y: r.top + dy, width: r.width, height: r.height });
    const docs: { doc: Document; dx: number; dy: number }[] = [{ doc: document, dx: 0, dy: 0 }];
    for (const f of document.querySelectorAll("iframe")) {
      try {
        const r = f.getBoundingClientRect();
        if (f.contentDocument && r.width > 0) docs.push({ doc: f.contentDocument, dx: r.left + f.clientLeft, dy: r.top + f.clientTop });
      } catch {
        // Another origin's frame: its text is not read.
      }
    }
    // The demo's own marks are never part of the picture; its other chrome (the device's passkey sheet) is.
    const MARKS = "[data-demo-spotlight], [data-demo-note], [data-demo-cursor], [data-demo-marker]";
    const shown = (el: Element) => !el.closest(MARKS) && (el as HTMLElement).checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) !== false;
    const INTERACTIVE = "button, a, input, textarea, select, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [role=radio]";
    const SEMANTIC = new Set(["li", "article", "section", "form", "dialog", "fieldset", "table", "aside"]);
    const ROLES = new Set(["group", "region", "dialog", "alertdialog"]);
    const clear = (c: string) => c === "transparent" || /^rgba\(\d+, \d+, \d+, 0\)$/.test(c);
    const card = (el: Element) => {
      if (el.matches(INTERACTIVE)) return false;
      const cs = getComputedStyle(el);
      const sides = (["Top", "Right", "Bottom", "Left"] as const).filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none").length;
      const shadow = cs.boxShadow !== "none" && cs.boxShadow.split(/,(?![^(]*\))/).some((part) => !/rgba\(\d+, \d+, \d+, 0\)/.test(part) && !/^\s*0px 0px 0px 0px/.test(part.replace(/rgba?\([^)]*\)/, "").trim()));
      const parent = el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : "";
      const ground = !clear(cs.backgroundColor) && cs.backgroundColor !== parent;
      return sides >= 3 || shadow || ground || SEMANTIC.has(el.tagName.toLowerCase()) || ROLES.has(el.getAttribute("role") ?? "");
    };
    let target: B | null = null;
    const ancestors: { box: B; card: boolean }[] = [];
    for (const { doc, dx, dy } of docs) {
      const ringed = doc.querySelector("[data-demo-ringed]");
      if (!ringed) continue;
      target = rectOf(ringed.getBoundingClientRect(), dx, dy);
      // Up through the control's own document, then on through the frame that holds it.
      let offset = { dx, dy };
      let el: Element | null = ringed;
      while (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) ancestors.push({ box: rectOf(r, offset.dx, offset.dy), card: card(el) });
        const up: Element | null = el.parentElement ?? (el.ownerDocument.defaultView?.frameElement ?? null);
        if (!el.parentElement && up) offset = { dx: 0, dy: 0 };
        el = up;
      }
      break;
    }
    const ringEl = document.querySelector("[data-demo-spotlight]:not([hidden])");
    const rr = ringEl?.getBoundingClientRect();
    const ring = rr && rr.width > 0 ? rectOf(rr, 0, 0) : null;
    let dialog: B | null = null;
    let main: B | null = null;
    for (const { doc, dx, dy } of docs) {
      const open = [...doc.querySelectorAll("[role=dialog], [role=alertdialog], dialog[open]")].filter((d) => shown(d) && d.getBoundingClientRect().width > 0);
      const top = open[open.length - 1];
      // A dialog drawn as a full-screen layer: its panel is the largest card inside it that is not the whole screen.
      const panel = top ? [top, ...top.querySelectorAll("*")].filter((el) => shown(el) && card(el) && el.getBoundingClientRect().width < vw * 0.9 && el.getBoundingClientRect().height < vh * 0.95).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] : undefined;
      if (top) dialog = rectOf((panel ?? top).getBoundingClientRect(), dx, dy);
      const m = doc.querySelector("main");
      if (m && shown(m) && m.getBoundingClientRect().width > 0) main = rectOf(m.getBoundingClientRect(), dx, dy);
    }
    // Every bordered or shadowed box, and every control: a crop's edge never runs through one.
    const boxes: B[] = [];
    for (const { doc, dx, dy } of docs) {
      for (const el of doc.body.querySelectorAll("*")) {
        if (el.closest(MARKS)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 16 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
        const cs = getComputedStyle(el);
        const sides = (["Top", "Right", "Bottom", "Left"] as const).filter((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none").length;
        if (sides >= 3 || cs.boxShadow !== "none" || el.matches(INTERACTIVE)) {
          if (shown(el)) boxes.push(rectOf(r, dx, dy));
        }
      }
    }
    const lines: (B & { font: number })[] = [];
    for (const { doc, dx, dy } of docs) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue?.trim() && n.parentElement && !n.parentElement.closest("script, style, title") && shown(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const range = doc.createRange();
      // Text a box clips (an ellipsis, a scroller) shows only inside that box: its rects are cut to it.
      const clips = new Map<Element, DOMRect | null>();
      const clipOf = (el: Element): DOMRect | null => {
        if (clips.has(el)) return clips.get(el) ?? null;
        const cs = getComputedStyle(el);
        const own = cs.overflowX !== "visible" || cs.overflowY !== "visible" ? el.getBoundingClientRect() : null;
        const up = el.parentElement ? clipOf(el.parentElement) : null;
        const clip = own && up ? new DOMRect(Math.max(own.left, up.left), Math.max(own.top, up.top), Math.max(0, Math.min(own.right, up.right) - Math.max(own.left, up.left)), Math.max(0, Math.min(own.bottom, up.bottom) - Math.max(own.top, up.top))) : (own ?? up);
        clips.set(el, clip);
        return clip;
      };
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const font = parseFloat(getComputedStyle(n.parentElement as Element).fontSize) || 0;
        const clip = clipOf(n.parentElement as Element);
        range.selectNodeContents(n);
        for (const raw of range.getClientRects()) {
          const r = clip ? new DOMRect(Math.max(raw.left, clip.left), Math.max(raw.top, clip.top), Math.min(raw.right, clip.right) - Math.max(raw.left, clip.left), Math.min(raw.bottom, clip.bottom) - Math.max(raw.top, clip.top)) : raw;
          const box = rectOf(r, dx, dy);
          if (box.width < 1 || box.height < 1 || box.x >= vw || box.y >= vh || box.x + box.width <= 0 || box.y + box.height <= 0) continue;
          lines.push({ ...box, font });
        }
      }
    }
    return { viewport: { width: vw, height: vh }, target, ring, ancestors, dialog, main, lines, boxes };
  });
}

async function capture(browser: Browser, play: Play, base: string, index: ShotIndex, encoder: Page, earlier: Record<string, PrintCopy>): Promise<string[]> {
  const context = await browser.newContext({ viewport: play.device === "phone" ? PHONE : VIEWPORT, deviceScaleFactor: SCALE, reducedMotion: "reduce", colorScheme: "light", locale: "en-GB", timezoneId: "UTC" });
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
    let previous: { hash: string; file: string; print: PrintCopy; paper?: Buffer } | null = null;
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
      const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide", scale: "css" });
      const hash = sha(png);
      if (previous && previous.hash === hash) {
        index.shots[key] = previous.file;
        (index.print ??= {})[key] = previous.print;
        continue;
      }
      const file = `${key}.webp`;
      const target = path.join(out, file);
      const known: boolean = index.hashes[file] === hash && existsSync(target);
      if (!known) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, await encode(encoder, png, "image/webp", QUALITY));
        index.hashes[file] = hash;
      }
      const before = earlier[key];
      let print: PrintCopy | undefined = known && before && existsSync(path.join(out, before.file)) ? before : undefined;
      let paper: Buffer | undefined;
      if (!print) {
        const scene = await readScene(page);
        const crop = cropFor(scene);
        if (process.env.PRINT_DEBUG) writeFileSync(path.join(process.env.PRINT_DEBUG, `${key.replace("/", "_")}.json`), JSON.stringify({ scene, crop }));
        const hide = await page.addStyleTag({ content: PAPER_HIDES });
        paper = await page.screenshot({ type: "png", animations: "disabled", caret: "hide", scale: "device", clip: crop.box as Box });
        await hide.evaluate((el) => (el as Element).remove());
        if (previous?.paper && (await nearlySame(encoder, previous.paper, paper))) print = previous.print;
        else {
          const jpeg = await encode(encoder, paper, "image/jpeg", PRINT_QUALITY, Math.round(crop.box.width * printScale(crop.font)));
          const name = `print/${sha(jpeg).slice(0, 16)}.jpg`;
          mkdirSync(path.join(out, "print"), { recursive: true });
          if (!existsSync(path.join(out, name))) writeFileSync(path.join(out, name), jpeg);
          print = { file: name, whole: crop.box.width * printMmPerPx(crop.box.width, crop.font) > PRINT_SHOT.besideMm, width: crop.box.width, height: crop.box.height, font: crop.font };
        }
      }
      index.shots[key] = file;
      (index.print ??= {})[key] = print;
      previous = { hash, file, print, ...(paper ? { paper } : {}) };
    }
  } finally {
    await context.close();
  }
  return problems;
}

function sizeOf(dir: string, ext: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = sizeOf(p, ext);
      files += s.files;
      bytes += s.bytes;
    } else if (entry.name.endsWith(ext)) {
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
  // Print copies of an older shape are captured again; the current shape's are reused while their screen has not changed.
  const samePrint = old?.printFormat === printFormat();
  const earlier: Record<string, PrintCopy> = sameShape && samePrint ? (old.print ?? {}) : {};
  const index: ShotIndex = { format: 1, printFormat: printFormat(), viewport: VIEWPORT, shots: filtered && sameShape ? { ...old.shots } : {}, print: filtered && sameShape ? { ...(old.print ?? {}) } : {}, hashes: sameShape && samePrint && old ? { ...old.hashes } : {} };
  if (filtered) {
    index.shots = Object.fromEntries(Object.entries(index.shots).filter(([k]) => !list.some((p) => k.startsWith(`${p.flow}/`))));
    index.print = Object.fromEntries(Object.entries(index.print ?? {}).filter(([k]) => !list.some((p) => k.startsWith(`${p.flow}/`))));
  }
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
        for (let play = queue.shift(); play; play = queue.shift()) problems.push(...(await capture(browser, play, `http://127.0.0.1:${port}/demo/`, index, encoder, earlier)));
      }),
    );
  } finally {
    await browser.close();
    server.close();
  }

  // Images no step names any more are removed, so the set never grows stale: a flow's WebPs, and
  // the print copies under print/ (shared between steps and flows, so only after a full run).
  const named = new Set([...Object.values(index.shots), ...Object.values(index.print ?? {}).map((p) => p.file)]);
  if (!filtered) {
    for (const dir of readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const f of readdirSync(path.join(out, dir.name))) {
        const rel = `${dir.name}/${f}`;
        if (!named.has(rel)) {
          rmSync(path.join(out, rel));
          index.hashes = Object.fromEntries(Object.entries(index.hashes).filter(([k]) => k !== rel));
        }
      }
      if (readdirSync(path.join(out, dir.name)).length === 0) rmSync(path.join(out, dir.name), { recursive: true });
    }
  }
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  const sortedPrint = Object.fromEntries(Object.entries(index.print ?? {}).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  writeFileSync(indexFile, `${JSON.stringify({ ...index, shots: sorted(index.shots), print: sortedPrint, hashes: sorted(index.hashes) }, null, 2)}\n`);
  const { files, bytes } = sizeOf(out, ".webp");
  const paper = sizeOf(out, ".jpg");
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  // The smallest console text any print copy carries, at the size it prints in the PDFs.
  const sizes = Object.values(index.print ?? {}).filter((p) => p.font > 0).map((p) => printedPoints(p.font, p.width));
  const smallest = sizes.length ? Math.min(...sizes) : 0;
  const under = sizes.filter((pt) => pt < 7).length;
  process.stdout.write(
    `Captured ${Object.keys(index.shots).length} steps from ${list.length} plays in ${Math.round((Date.now() - started) / 1000)} s: ${files} images, ${mb(bytes)} MB (${files ? Math.round(bytes / files / 1024) : 0} KB each on average), and ${paper.files} print copies, ${mb(paper.bytes)} MB (smallest text ${smallest.toFixed(1)} pt; ${under} under 7 pt), in ${path.relative(process.cwd(), out)}/\n`,
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
