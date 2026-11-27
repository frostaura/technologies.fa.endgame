import { inflateSync } from "node:zlib";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { serve } from "./serve.ts";
import { roles } from "../../frontend/src/lib/tokens.ts";

/**
 * Renders the print version to `academy.pdf` and `operator-handbook.pdf` inside the assembled
 * site, with headless Chromium, so both download from the cover. Every page past the cover carries
 * a running header (the document's name) and its page number; the contents give each flow's page.
 * Those page numbers come from a first pass: Chromium writes each flow's anchor (`#flow-<ID>`) as a
 * named destination on the page it landed on, which `flowPages` reads back; the second pass prints
 * them. The numbers sit at the end of contents lines that already exist, so they move nothing.
 *
 *   node tools/render-pdf.ts [siteDir]
 */

const dir = path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, "../../../site"));
const port = Number(process.env.PDF_PORT ?? 5690);

/** The PDF's objects, inflated where they are compressed object streams, as text: enough to read its page tree and named destinations. */
function objects(pdf: Buffer): Map<number, string> {
  const out = new Map<number, string>();
  const text = pdf.toString("latin1");
  const plain = /(\d+) 0 obj([\s\S]*?)endobj/g;
  for (const m of text.matchAll(plain)) {
    const body = m[2] ?? "";
    out.set(Number(m[1]), body);
    // An object stream holds further objects, deflated.
    if (/\/Type\s*\/ObjStm/.test(body)) {
      const start = text.indexOf("stream", m.index ?? 0) + "stream".length;
      const from = text[start] === "\r" ? start + 2 : start + 1;
      const end = text.indexOf("endstream", from);
      try {
        const raw = inflateSync(pdf.subarray(from, end)).toString("latin1");
        const n = Number(/\/N (\d+)/.exec(body)?.[1] ?? 0);
        const first = Number(/\/First (\d+)/.exec(body)?.[1] ?? 0);
        const head = raw.slice(0, first).trim().split(/\s+/).map(Number);
        for (let i = 0; i < n; i++) {
          const num = head[i * 2] ?? 0;
          const off = first + (head[i * 2 + 1] ?? 0);
          const next = i + 1 < n ? first + (head[(i + 1) * 2 + 1] ?? 0) : raw.length;
          out.set(num, raw.slice(off, next));
        }
      } catch {
        // Not a stream this reader understands: its objects are simply not consulted.
      }
    }
  }
  return out;
}

/** Each flow's page, 1-based, from the named destinations Chromium writes for `#flow-<ID>` anchors. */
export function flowPages(pdf: Buffer): Record<string, number> {
  const objs = objects(pdf);
  // The page objects, in order: walk the page tree from its root.
  const pages: number[] = [];
  const rootRef = [...objs.values()].map((b) => /\/Type\s*\/Catalog[\s\S]*?\/Pages (\d+) 0 R/.exec(b)?.[1]).find(Boolean);
  const walk = (n: number) => {
    const body = objs.get(n) ?? "";
    if (/\/Type\s*\/Pages\b/.test(body)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "";
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    } else pages.push(n);
  };
  if (rootRef) walk(Number(rootRef));
  const index = new Map(pages.map((p, i) => [p, i + 1]));
  const out: Record<string, number> = {};
  for (const body of objs.values()) {
    // A /Dests dictionary (/flow-ID-01 [12 0 R /XYZ ...]) or a names array ((flow-ID-01) [12 0 R ...]);
    // either may point at an array object instead (… 40 0 R).
    for (const m of body.matchAll(/(?:\/|\()flow-([A-Z]+-\d+)\)?\s*(?:\[\s*(\d+) 0 R|(\d+) 0 R)/g)) {
      let page = m[2] ? Number(m[2]) : undefined;
      if (!page && m[3]) page = Number(/\[\s*(\d+) 0 R/.exec(objs.get(Number(m[3])) ?? "")?.[1] ?? 0);
      const at = page ? index.get(page) : undefined;
      if (at && m[1]) out[m[1]] = at;
    }
  }
  return out;
}

/** The running header and the page number, set in the console's muted ink (Chromium draws them outside the page's own CSS). */
const muted = roles.ink.muted;
const HEADER = (title: string) => `<div style="width:100%;font:8px Inter,system-ui,sans-serif;color:${muted};padding:0 12mm">${title}</div>`;
const FOOTER = `<div style="width:100%;font:8px Inter,system-ui,sans-serif;color:${muted};padding:0 12mm;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

async function render(page: Page, route: string, title: string): Promise<Buffer> {
  await page.goto(`http://127.0.0.1:${port}/academy/${route}`);
  await page.waitForSelector("html[data-print=ready]");
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  return page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", bottom: "16mm" },
    displayHeaderFooter: true,
    headerTemplate: HEADER(title),
    footerTemplate: FOOTER,
  });
}

async function main() {
  const server = await serve(dir, port, "/academy/");
  const browser = await chromium.launch();
  try {
    for (const [route, file, title] of [
      ["#/print", "academy.pdf", "The Endgame Academy"],
      ["#/print/operator", "operator-handbook.pdf", "The Endgame operator handbook · FrostAura only"],
    ] as const) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // The numbers are known only once laid out: render, read where each flow landed, render again with them.
      const first = await render(page, route, title);
      const pages = flowPages(first);
      // A fresh page for the second pass: the numbers are in place before the print version first renders.
      const second = await browser.newPage();
      second.on("pageerror", (e) => errors.push(e.message));
      await second.addInitScript((p) => ((window as unknown as { __pages?: Record<string, number> }).__pages = p), pages);
      const pdf = await render(second, route, title);
      await second.close();
      writeFileSync(path.join(dir, file), pdf);
      if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
      process.stdout.write(`Rendered ${path.join(path.relative(process.cwd(), dir), file)} (${Object.keys(pages).length} flows with page numbers)\n`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.main) await main();
