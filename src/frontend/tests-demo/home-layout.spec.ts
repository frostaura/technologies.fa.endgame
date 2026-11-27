import { expect, test, type Page } from "@playwright/test";

/**
 * The home page and Manage at desktop and tablet sizes, in the built demo: what the visual reviews
 * found broken stays fixed. The org chart is a masonry (no column ends with a hole under a short
 * division, every column's first division starts on one line), its wires end at their last project,
 * the shortcut row is one line that never wraps, the graph views stay inside their card, and Manage is two
 * panes from 1024 up.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

async function open(page: Page, scenario: string, route?: string, persona = "owner") {
  await page.goto(`${SUB}?scenario=${scenario}&persona=${persona}&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  if (route) await page.evaluate((r) => (window as unknown as { endgameDemo: { goto: (a: { route: string }) => Promise<void> } }).endgameDemo.goto({ route: r }), route);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
}

/**
 * What the visual reviews found broken in the graph views stays fixed: nothing in the panel reaches
 * past its card, no word is cut short (an element whose text overflows it) or set under 14 px, and
 * the key shows exactly the marks drawn below it.
 */
async function graphHolds(page: Page, tab: string) {
  const r = await page.evaluate(() => {
    const panel = document.querySelector("#chart-panel") as HTMLElement;
    const edge = panel.getBoundingClientRect();
    const out: string[] = [];
    const cut: string[] = [];
    const small: string[] = [];
    for (const el of panel.querySelectorAll<HTMLElement>("*")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || el.closest(".sr-only")) continue;
      const text = (el.textContent ?? "").slice(0, 30);
      if (b.right > edge.right + 1 || b.left < edge.left - 1) out.push(`${el.tagName}: ${text}`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") cut.push(text);
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 14) small.push(`${text} (${getComputedStyle(el).fontSize})`);
    }
    const key = panel.querySelector("ul[aria-label='Key']");
    const marks = (els: Element[]) => [...new Set(els.map((m) => m.getAttribute("data-mark")))].sort();
    const all = [...panel.querySelectorAll("[data-mark]")];
    return { out, cut, small, key: marks(all.filter((m) => key?.contains(m))), body: marks(all.filter((m) => !key?.contains(m))) };
  });
  expect(r.out, `${tab}: past its card`).toEqual([]);
  expect(r.cut, `${tab}: cut short`).toEqual([]);
  expect(r.small, `${tab}: text under 14 px`).toEqual([]);
  expect(r.key, `${tab}: the key does not match the marks drawn`).toEqual(r.body);
}

async function noSideways(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "the page scrolls sideways").toBeLessThanOrEqual(cw);
}

for (const [width, height] of [
  [1024, 768],
  [1280, 800],
  [1920, 1080],
  [2560, 1300],
] as const) {
  test.describe(`home at ${width}`, () => {
    test.use({ viewport: { width, height } });

    test("the chart's columns start level, each division hangs under the shortest, and its wire ends at its last project", async ({ page }) => {
      await open(page, "default", "/");
      await noSideways(page);
      const chart = page.getByRole("region", { name: "Organisation chart" });
      await expect(chart).toBeVisible();
      const tops = await chart.locator("[data-chart-column] > div:first-child").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, `column tops ${tops.join(", ")}`).toBe(1);
      // Masonry: when a column's last division was placed, that column was the shortest, so it starts no lower than any other column ends.
      const columns = await chart.locator("[data-chart-column]").evaluateAll((cols) => cols.map((c) => [...c.children].map((d) => ({ top: d.getBoundingClientRect().top, bottom: d.getBoundingClientRect().bottom }))));
      for (const [i, col] of columns.entries()) {
        const last = col[col.length - 1];
        if (col.length < 2 || !last) continue;
        const others = columns.filter((_, k) => k !== i).map((c) => c[c.length - 1]?.bottom ?? 0);
        expect(last.top - 24, "a division waited under a column that was not the shortest").toBeLessThanOrEqual(Math.min(...others) + 1);
      }
      // Each division's wire: one node per branch, and the last branch's wire ends at its node.
      for (const list of await chart.locator("ol[aria-label^='In ']").all()) {
        const nodes = await list.locator(":scope > li > [data-node]").count();
        const branches = await list.locator(":scope > li").count();
        expect(nodes).toBe(branches);
        const ends = await list.locator(":scope > li:last-child").evaluate((li) => {
          const wire = li.querySelector("[data-wire]")?.getBoundingClientRect();
          const node = li.querySelector("[data-node]")?.getBoundingClientRect();
          return { wire: wire?.bottom ?? 0, node: node ? node.top + node.height / 2 : 0 };
        });
        expect(Math.abs(ends.wire - ends.node), "the wire runs past its last project").toBeLessThanOrEqual(2);
      }
      // Archived divisions are folded away after the chart, not left in its columns.
      await expect(chart.locator("[data-archived]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Archived \(1\)/ })).toBeVisible();
    });

    test("the shortcut row is one line, and what does not fit is under More", async ({ page }) => {
      await open(page, "default", "/");
      const nav = page.getByRole("navigation", { name: "Manage" });
      const box = await nav.boundingBox();
      expect(box?.height ?? 0, "the shortcut row wrapped").toBeLessThanOrEqual(60);
      const shown = await nav.locator(":scope > a").count();
      const more = nav.getByRole("button", { name: "More" });
      if (shown < 8) {
        await more.click();
        await expect(nav.locator("[data-fold-body] a")).toHaveCount(8 - shown);
      } else await expect(more).toHaveCount(0);
    });

    test("neither graph view leaves its card, cuts a word while there is room, or sets text under 14 px", async ({ page }) => {
      for (const scenario of ["default", "messy-tree"]) {
        await open(page, scenario, "/");
        for (const tab of ["Who works on what", "How data flows"]) {
          await page.getByRole("tab", { name: tab }).click();
          await expect(page.getByRole("list", { name: "Key" })).toBeVisible();
          await noSideways(page);
          await graphHolds(page, tab);
        }
        // With the room, the data flow is a matrix of apps by services that fills the card's width.
        const table = page.getByRole("table", { name: "How data flows" });
        if (width >= 1920) await expect(table).toBeVisible();
        if (await table.isVisible()) {
          const fit = await page.evaluate(() => ({ panel: document.querySelector("#chart-panel")?.getBoundingClientRect().width ?? 0, table: document.querySelector("table[aria-label='How data flows']")?.getBoundingClientRect().width ?? 0 }));
          expect(fit.table, "the matrix leaves its card half empty").toBeGreaterThanOrEqual(fit.panel - 4);
        }
      }
    });

    test("Manage is two panes, the outline's names whole", async ({ page }) => {
      await open(page, "default", "/tree?scope=northwind%2Ftechnologies");
      await noSideways(page);
      const outline = await page.getByRole("navigation", { name: "Every part of the organisation" }).boundingBox();
      const part = await page.getByRole("region", { name: "Division: Technologies" }).boundingBox();
      expect(outline && part, "both panes are drawn").toBeTruthy();
      expect((part?.x ?? 0) - ((outline?.x ?? 0) + (outline?.width ?? 0)), "the part is not beside the outline").toBeGreaterThan(0);
      expect(Math.abs((part?.y ?? 0) - (outline?.y ?? 0))).toBeLessThanOrEqual(2);
      // The page's right edge is the part's: no third column beside it.
      const right = await page.evaluate(() => document.querySelector("main")?.getBoundingClientRect().right ?? innerWidth);
      expect(right - ((part?.x ?? 0) + (part?.width ?? 0))).toBeLessThanOrEqual(80);
      const cut = await page
        .getByRole("navigation", { name: "Every part of the organisation" })
        .locator("button span.break-words")
        .evaluateAll((spans) => spans.filter((s) => s.scrollWidth > s.clientWidth + 1).length);
      expect(cut).toBe(0);
    });
  });
}

test.describe("home on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the More sheet's pages are not drawn again at the top level; a division gets its own folded row", async ({ page }) => {
    await open(page, "default", "/");
    await noSideways(page);
    await expect(page.getByRole("navigation", { name: "Manage" })).toBeHidden();
    await page.getByRole("button", { name: /Technologies/ }).first().click();
    await expect(page.getByRole("button", { name: /^Pages for Technologies/ })).toBeVisible();
  });

  test("the graph views are cards, whole on the screen, marked as the key marks them, with thumb-sized links", async ({ page }) => {
    for (const scenario of ["default", "messy-tree"]) {
      await open(page, scenario, "/");
      for (const tab of ["Who works on what", "How data flows"]) {
        await page.getByRole("tab", { name: tab }).click();
        const list = page.getByRole("list", { name: tab });
        await expect(list).toBeVisible();
        await noSideways(page);
        await graphHolds(page, tab);
        for (const link of (await list.getByRole("link").all()).slice(0, 12)) expect((await link.boundingBox())?.height ?? 0, "a link under 44 px").toBeGreaterThanOrEqual(44);
      }
    }
  });
});

for (const [width, height] of [
  [768, 1024],
  [812, 375],
] as const) {
  test.describe(`the graph views at ${width}×${height}, by touch`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test("stay inside their card, whole, with thumb-sized links", async ({ page }) => {
      await open(page, "messy-tree", "/");
      for (const tab of ["Who works on what", "How data flows"]) {
        await page.getByRole("tab", { name: new RegExp(`^(${tab}|Who works|Data flow)$`) }).first().click();
        await expect(page.getByRole("list", { name: "Key" })).toBeVisible();
        await noSideways(page);
        await graphHolds(page, tab);
        for (const link of (await page.locator("#chart-panel a").all()).slice(0, 12)) expect((await link.boundingBox())?.height ?? 0, "a link under 44 px").toBeGreaterThanOrEqual(44);
      }
    });
  });
}
