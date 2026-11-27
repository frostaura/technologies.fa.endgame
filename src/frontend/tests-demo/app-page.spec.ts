import { expect, test, type Page } from "@playwright/test";

/**
 * The app page's layout at every size, in the built demo (the apps visual lane): nothing scrolls
 * sideways even with long names; the address breaks only after a "/"; "Open the app" is the primary
 * button only when the app can be used; "Save" sits on its field's row; every dashboard tile has its
 * "Take off" at its top right and a single number is a short tile; the side panel's chosen card is
 * unmistakable; a full dashboard opens short; and from 1600 px the page uses a second column.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1300 },
  { width: 812, height: 375 },
] as const;

type Demo = { endgameDemo: { settled: (ms: number) => Promise<void> } };

async function open(page: Page, scenario: string, persona = "owner") {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto(`${SUB}?scenario=${scenario}&persona=${persona}&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as Partial<Demo>).endgameDemo);
  await page.evaluate(() => (window as unknown as Demo).endgameDemo.settled(6000));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return problems;
}

/** Opens every folded section, as a person reading the whole page on a phone would. */
async function openFolds(page: Page) {
  const rows = page.locator("[data-fold] > button[aria-expanded=false]");
  for (let n = await rows.count(); n > 0; n = await rows.count()) await rows.first().click();
}

async function noSideways(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "the page scrolls sideways").toBeLessThanOrEqual(cw);
}

for (const size of SIZES) {
  test.describe(`the app page at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: size.width < 1024, isMobile: size.width < 640 || size.height < 500 });

    test("long names never push the page sideways, and the address breaks only after a slash", async ({ page }) => {
      const problems = await open(page, "app-long-names");
      await openFolds(page);
      await noSideways(page);
      const address = page.getByTestId("app-address");
      await expect(address.getByRole("button", { name: "Copy the address" })).toBeVisible();
      // Every part between slashes is drawn on one line (its rectangles share one top).
      const split = await address
        .locator("p")
        .first()
        .locator("span.whitespace-nowrap")
        .evaluateAll((parts) => parts.filter((p) => new Set([...p.getClientRects()].map((r) => Math.round(r.top))).size > 1).map((p) => p.textContent));
      expect(split, "a part of the address broke mid-word").toEqual([]);
      expect(problems).toEqual([]);
    });

    test("\"Open the app\" is primary only when the app can be used", async ({ page }) => {
      await open(page, "app-busy");
      await expect(page.getByRole("link", { name: "Open the app" })).toHaveClass(/bg-primary/);
      await expect(page.getByTestId("open-note")).toHaveCount(0);
      await open(page, "app-not-published");
      await expect(page.getByRole("link", { name: "Open the app" })).not.toHaveClass(/bg-primary/);
      await expect(page.getByTestId("open-note")).toContainText("Nothing is published yet");
    });

    test("every dashboard tile has \"Take off\" at its top right, and a single number is a short tile", async ({ page }) => {
      await open(page, "app-busy");
      await openFolds(page);
      // The tiles themselves, not the rows of an answer's own table inside one.
      const tiles = page.getByRole("list", { name: "Kept questions" }).locator(":scope > li");
      const n = await tiles.count();
      expect(n).toBeGreaterThan(1);
      for (let i = 0; i < n; i++) {
        const tile = await tiles.nth(i).boundingBox();
        const off = await tiles.nth(i).getByRole("button", { name: /^Take off “/ }).boundingBox();
        expect(tile && off).toBeTruthy();
        if (!tile || !off) continue;
        expect(off.y - tile.y, "Take off is not at the tile's top").toBeLessThan(32);
        expect(tile.x + tile.width - (off.x + off.width), "Take off is not at the tile's right").toBeLessThan(24);
      }
      const number = await tiles.filter({ hasText: "5,920" }).boundingBox();
      const table = await tiles.filter({ has: page.locator("[data-table]") }).boundingBox();
      expect((number?.height ?? 0) < (table?.height ?? 0), "the number tile is stretched to the table's height").toBe(true);
      // The first row of tiles starts on one line.
      if (size.width >= 1280 && size.height >= 500) {
        const tops = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(Math.abs((tops[0] ?? 0) - Math.min(...tops))).toBeLessThanOrEqual(1);
      }
    });

    test("the side panel's chosen card is unmistakable, and \"Save\" sits on its field's row", async ({ page }) => {
      await open(page, "app-asleep");
      await openFolds(page);
      for (const legend of ["Running", "Who can open it"]) {
        const set = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: legend }) });
        await expect(set.locator("label[data-chosen]")).toHaveCount(1);
        await expect(set.locator("label[data-chosen]")).toHaveClass(/border-primary/);
      }
      const field = page.getByLabel("Sleeps after this many idle minutes");
      const save = page.getByRole("form", { name: "Idle minutes before it sleeps" }).getByRole("button", { name: "Save" });
      const f = await field.boundingBox();
      const s = await save.boundingBox();
      expect(f && s).toBeTruthy();
      if (f && s) expect(Math.abs(f.y + f.height / 2 - (s.y + s.height / 2)), "Save is not on its field's row").toBeLessThanOrEqual(2);
    });

    test("a full dashboard opens short", async ({ page }) => {
      await open(page, "dashboard-full");
      await openFolds(page);
      const list = page.getByRole("list", { name: "Kept questions" });
      await expect(list.locator(":scope > li")).toHaveCount(6);
      await page.getByRole("button", { name: /^Show all \d+ questions$/ }).click();
      await expect(list.locator(":scope > li")).toHaveCount(30);
      await noSideways(page);
    });

    if (size.width >= 1600) {
      test("from 1600 px the page uses a second column", async ({ page }) => {
        await open(page, "app-busy");
        const change = await page.getByTestId("change-request").boundingBox();
        const ask = await page.getByRole("region", { name: "Asking about this app" }).boundingBox();
        expect(change && ask).toBeTruthy();
        if (change && ask) {
          expect(Math.abs(change.y - ask.y), "Change and Ask are not side by side").toBeLessThanOrEqual(1);
          expect(ask.x).toBeGreaterThan(change.x + change.width);
        }
      });
    }
  });
}
