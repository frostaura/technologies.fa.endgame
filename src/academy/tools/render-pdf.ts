import path from "node:path";
import { chromium } from "@playwright/test";
import { serve } from "./serve.ts";

/**
 * Renders the print version to `academy.pdf` and `operator-handbook.pdf` inside the assembled
 * site, with headless Chromium, so both download from the cover.
 *
 *   node tools/render-pdf.ts [siteDir]
 */

const dir = path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, "../../../site"));
const port = Number(process.env.PDF_PORT ?? 5690);
const server = await serve(dir, port, "/academy/");
const browser = await chromium.launch();
try {
  for (const [route, file] of [
    ["#/print", "academy.pdf"],
    ["#/print/operator", "operator-handbook.pdf"],
  ] as const) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/academy/${route}`);
    await page.waitForSelector("html[data-print=ready]");
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: path.join(dir, file), format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm" } });
    if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
    process.stdout.write(`Rendered ${path.join(path.relative(process.cwd(), dir), file)}\n`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
