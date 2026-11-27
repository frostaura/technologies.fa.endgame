import { expect, test, type Page } from "@playwright/test";

/**
 * The app page's layout at every size, in the built demo (the apps visual lane): nothing scrolls
 * sideways even with long names; the address breaks only after a "/"; "Open the app" is the primary
 * button only when the app can be used; "Save" sits on its field's row; every dashboard tile has its
 * "Take off" at its top right and a single number is a short tile; the side panel's chosen card is
 * unmistakable; a full dashboard opens short; and from 2000 px (beside the docked conversation and the side panel) the
 * page uses a second column.
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

    test("every chart a tile draws shows its marks: bars in the accent with their value at the end, a line over its grid", async ({ page }) => {
      await open(page, "app-busy");
      await openFolds(page);
      const list = page.getByRole("list", { name: "Kept questions" });
      const bars = list.locator("[data-share]");
      expect(await bars.count()).toBeGreaterThan(3);
      for (const bar of await bars.all()) {
        const look = await bar.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const value = el.nextElementSibling?.getBoundingClientRect();
          const tile = el.closest("li")?.getBoundingClientRect();
          return { w: r.width, h: r.height, bg: getComputedStyle(el).backgroundColor, gap: value ? value.left - r.right : -1, valueEnd: value?.right ?? 0, tileEnd: tile?.right ?? 0 };
        });
        expect(look.w, "a bar is drawn").toBeGreaterThan(8);
        expect(look.h).toBeGreaterThan(8);
        expect(look.bg, "a bar is in the accent").toBe("rgb(47, 91, 255)");
        expect(look.gap, "its value sits at the bar's end").toBeLessThanOrEqual(12);
        expect(look.valueEnd, "its value stays inside the tile").toBeLessThanOrEqual(look.tileEnd);
      }
      const line = list.locator("li").filter({ has: page.locator("polyline") });
      expect(await line.locator("[data-tick]").count()).toBeGreaterThanOrEqual(3);
      expect(await line.locator("svg line").count()).toBeGreaterThanOrEqual(3);
      expect(await line.locator("[data-point]").count()).toBeGreaterThanOrEqual(5);
      // The days along the bottom never run into each other, and stay inside the tile.
      const days = await line.locator("[data-xlabel]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })));
      expect(days.length).toBeGreaterThanOrEqual(2);
      days.forEach((day, i) => {
        if (i > 0) expect(day.l, "two days overlap").toBeGreaterThanOrEqual((days[i - 1]?.r ?? 0) + 4);
      });
      const tile = await line.boundingBox();
      if (tile) expect(days[days.length - 1]?.r ?? 0).toBeLessThanOrEqual(tile.x + tile.width);
      await noSideways(page);
    });

    test("the figure tiles' captions are never cut", async ({ page }) => {
      for (const scenario of ["app-busy", "app-paused", "app-crashed", "app-not-published"]) {
        await open(page, scenario);
        const cut = await page
          .getByRole("region", { name: "Today" })
          .locator("span.truncate")
          .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
        expect(cut, `${scenario}: a caption is cut`).toEqual([]);
      }
    });

    test("\"Also at\" opens the other address on its own line under the first", async ({ page }) => {
      await open(page, "app-busy");
      const address = page.getByTestId("app-address");
      await address.getByRole("button", { name: "Also at" }).click();
      const first = await address.locator("p").first().boundingBox();
      const other = await page.getByTestId("also-at").boundingBox();
      expect(first && other).toBeTruthy();
      if (first && other) {
        expect(other.y, "the other address is under the first").toBeGreaterThanOrEqual(first.y + first.height - 1);
        expect(Math.abs(other.x - first.x), "both start at one edge").toBeLessThanOrEqual(1);
      }
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

    if (size.width >= 2000) {
      test("from 2000 px the page uses a second column", async ({ page }) => {
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

/**
 * The demo's hosted app is drawn with the app kit's header (src/appkit/sdk-web/src/ui/layout.tsx): on a phone two rows —
 * the app's name beside a 44px avatar button whose menu holds the person's name, e-mail and "Sign out" — and nothing wider
 * than the screen; on a desktop one row with the name and "Sign out" in it.
 */
test.describe("the hosted app's header, as the kit draws it", () => {
  for (const size of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    test(`at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, "app-busy");
      await page.getByRole("link", { name: "Open the app" }).click();
      const header = page.locator("[data-slot=app-header]");
      await expect(header).toBeVisible();
      await noSideways(page);
      const signOut = header.getByRole("link", { name: "Sign out" });
      if (size.width < 640) {
        const avatar = header.getByRole("button", { name: "Your account" });
        const box = await avatar.boundingBox();
        expect(box && box.width >= 44 && box.height >= 44, "the avatar is a 44px target").toBe(true);
        await expect(signOut.first()).toBeHidden();
        await avatar.click();
        const menu = page.getByTestId("user-menu");
        await expect(menu).toBeVisible();
        await expect(menu).toContainText("@");
        await expect(menu.getByRole("link", { name: "Sign out" })).toBeVisible();
        const name = await header.getByTestId("nav-home").boundingBox();
        expect(name && box && Math.abs(name.y + name.height / 2 - (box.y + box.height / 2)) <= 2, "the name and the avatar share the first row").toBe(true);
      } else {
        await expect(signOut.first()).toBeVisible();
        await expect(header.getByRole("button", { name: "Your account" })).toBeHidden();
      }
    });
  }
});
