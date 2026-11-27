import { expect, test, type Page } from "@playwright/test";

/**
 * The idea pages laid out on real-sized data, in the built demo: the verdict as a document with a
 * decision (a white hero, the decision beside the page in a card that stays in view, the evidence in
 * sections that size to their content, two across from 1600), the new-idea page using a wide screen,
 * and the portfolio's ideas as a grid of same-shaped cards. Nothing runs past its card, nothing uses
 * the browser's own disclosure triangle, and on a phone the decision and the start are on the first
 * screen.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

async function open(page: Page, scenario: string, route?: string) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto(`${SUB}?scenario=${scenario}&persona=owner&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  if (route) await page.evaluate((r) => (window as unknown as { endgameDemo: { goto: (a: { route: string }) => Promise<void> } }).endgameDemo.goto({ route: r }), route);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
  // The cards rise into place as the page opens: measure where they settle.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  return problems;
}

/** Every element inside the page that is wider than the card it sits in, or scrolls the page sideways. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push("the page scrolls sideways");
    for (const card of document.querySelectorAll<HTMLElement>("main section, [data-side-panel] > *, main li")) {
      const box = card.getBoundingClientRect();
      if (box.width === 0) continue;
      for (const el of card.querySelectorAll<HTMLElement>("a, span, p, h1, h2")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > box.right + 1) out.push(`${el.tagName} "${(el.textContent ?? "").slice(0, 40)}" runs past its card`);
      }
    }
    return [...new Set(out)];
  });
}

test.describe("a verdict at 1920 × 1080, on real-sized research", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("is a document with a decision: one tag, the decision in view all the way down, the evidence in two columns", async ({ page }) => {
    expect(await open(page, "verdict-long")).toEqual([]);
    const hero = page.getByRole("region", { name: "The verdict", exact: true });
    await expect(hero.getByText("Verdict · do not build")).toBeVisible();
    // The decision is beside the hero, and still on screen at the foot of the page.
    const decision = page.locator("[data-side-panel]").getByRole("region", { name: "Your decision" });
    await expect(decision.getByRole("button", { name: "Overrule and build anyway" })).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(decision.getByRole("button", { name: "Change the idea" })).toBeInViewport();
    // Said once: the decision is not repeated in the page beside it.
    await expect(page.getByRole("button", { name: "Overrule and build anyway" })).toHaveCount(1);
    // The evidence flows down two columns, each section the height of what it holds.
    const lefts = await page.getByRole("group", { name: "The evidence" }).locator(":scope > section").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts.length).toBe(2);
    // Long lists show the first five and say how many there are.
    const products = page.getByRole("list", { name: "Existing products" }).locator(":scope > li");
    await expect(products).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Show all 21 products" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Signals of demand" }).locator(":scope > li")).toHaveCount(5);
    // No native disclosure triangle, and nothing runs past its card.
    await expect(page.locator("main details, aside details")).toHaveCount(0);
    expect(await overflowing(page)).toEqual([]);
  });

  test("opens the full reasoning in place, without repeating its first lines", async ({ page }) => {
    await open(page, "verdict-long");
    const hero = page.getByRole("region", { name: "The verdict", exact: true });
    const before = await hero.evaluate((el) => el.textContent ?? "");
    await hero.getByRole("button", { name: "Read the full reasoning" }).click();
    const after = await hero.evaluate((el) => el.textContent ?? "");
    const opening = "The strongest case against is that this exact product already exists";
    expect(before.split(opening).length - 1).toBe(1);
    expect(after.split(opening).length - 1).toBe(1);
    await expect(hero.getByRole("button", { name: "Hide the full reasoning" })).toBeVisible();
  });

  test("over a red line says the red line once, and the market once", async ({ page }) => {
    await open(page, "verdict-long-red-line");
    const sentence = "secretly monitors members' reading habits";
    const count = await page.locator("main").evaluate((el, s) => (el.textContent ?? "").split(s).length - 1, sentence);
    expect(count).toBe(1);
    await expect(page.getByRole("alert").filter({ hasText: "crosses a red line" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The market was not researched" })).toBeVisible();
    for (const name of ["Who already does this", "What gap is left", "Who would want it"]) await expect(page.getByRole("heading", { name })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Overrule/ })).toHaveCount(0);
  });

  for (const [scenario, tag] of [
    ["verdict-dropped", "Dropped"],
    ["verdict-overruled", "Overruled"],
    ["verdict-decided", "Built"],
  ] as const) {
    test(`a decided verdict (${scenario}) says what was decided, in the side card`, async ({ page }) => {
      expect(await open(page, scenario)).toEqual([]);
      const card = page.locator("[data-side-panel]").getByRole("region", { name: "Your decision" });
      await expect(card.getByText(tag, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Drop the idea" })).toHaveCount(0);
    });
  }
});

test.describe("a verdict at 1280 × 800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps the decision in view while the evidence scrolls past", async ({ page }) => {
    await open(page, "verdict-do-not-build");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator("[data-side-panel]").getByRole("button", { name: "Overrule and build anyway" })).toBeInViewport();
    expect(await overflowing(page)).toEqual([]);
  });
});

test.describe("a verdict on a phone, 375 × 812", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  for (const scenario of ["verdict-long", "verdict-long-red-line"]) {
    test(`(${scenario}) puts the first decision on the first screen`, async ({ page }) => {
      await open(page, scenario);
      const first = page.getByRole("region", { name: "Your decision" }).getByRole("button").first();
      const box = await first.boundingBox();
      const bar = await page.locator("[data-bottom-nav]").boundingBox();
      expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 812);
      expect(await overflowing(page)).toEqual([]);
    });
  }
});

test.describe("a verdict's layout", () => {
  for (const width of [1280, 1512, 1920, 2560]) {
    test(`at ${width} sets the evidence in two columns with level tops, the hero's figures beside its words, and the record as one card`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      expect(await open(page, "verdict-build")).toEqual([]);
      const sections = await page.getByRole("group", { name: "The evidence" }).locator(":scope > section").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: Math.round(r.left), top: Math.round(r.top) })));
      const lefts = [...new Set(sections.map((s) => s.left))];
      expect(lefts.length).toBe(2);
      // Each column starts at the same top.
      const tops = lefts.map((l) => Math.min(...sections.filter((s) => s.left === l).map((s) => s.top)));
      expect(Math.abs((tops[0] ?? 0) - (tops[1] ?? 9))).toBeLessThanOrEqual(1);
      // The figures sit beside the headline, not under it.
      const hero = page.getByRole("region", { name: "The verdict", exact: true });
      const h1 = await hero.getByRole("heading", { level: 1 }).boundingBox();
      const facts = await hero.getByRole("group", { name: "What research found" }).boundingBox();
      expect(facts?.x ?? 0).toBeGreaterThan((h1?.x ?? 0) + (h1?.width ?? 0));
      expect((facts?.y ?? 9999)).toBeLessThan((h1?.y ?? 0) + (h1?.height ?? 0));
      // Research's record: one card, its two halves level.
      const record = page.getByRole("region", { name: "Research's record" });
      const a = await record.getByRole("region", { name: "How often research says no" }).boundingBox();
      const b = await record.getByRole("region", { name: "When you overruled" }).boundingBox();
      expect(Math.abs((a?.y ?? 0) - (b?.y ?? 9))).toBeLessThanOrEqual(1);
      expect(await overflowing(page)).toEqual([]);
    });
  }

  test("with no web search says so once and counts nothing it did not read", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    expect(await open(page, "verdict-no-search")).toEqual([]);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text.split("No web search was run").length - 1).toBe(1);
    expect(text).not.toMatch(/0 searches|no sources recorded|sources read|products like it/);
    await expect(page.getByRole("group", { name: "What research found" })).toHaveCount(0);
    // The strands are named, with no row of zeros under each.
    await expect(page.getByRole("list", { name: "Strands" }).locator(":scope > li")).toHaveCount(3);
  });

  test("beside the docked conversation below 1600 the decision is under the verdict, not at the foot of the page", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await open(page, "verdict-long");
    const hero = await page.getByRole("region", { name: "The verdict", exact: true }).boundingBox();
    const decision = await page.getByRole("region", { name: "Your decision" }).boundingBox();
    expect(decision?.y ?? 9999).toBeLessThan((hero?.y ?? 0) + (hero?.height ?? 0) + 60);
  });

  test("research that did not finish shows where it got to, on the idea's own page", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await open(page, "s3-research-failed");
    const trace = page.getByRole("region", { name: "Where research got to" });
    await expect(trace).toBeVisible();
    await expect(trace.locator('[data-state="stopped"]')).toHaveCount(1);
  });

  test("over a red line on a phone: the red line is a banner of its own, the folds held together under headings", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, "verdict-long-red-line");
    const banner = page.getByRole("alert").filter({ hasText: "crosses a red line" });
    const hero = page.getByRole("region", { name: "The verdict", exact: true });
    await expect(hero.getByRole("alert")).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(page.getByRole("heading", { name: "The evidence", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Research's record", exact: true })).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
  });
});

test.describe("a new idea", () => {
  test("at 1920 sets the form two across beside what happens next, what research costs and ideas to start from", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    expect(await open(page, "default", "/start")).toEqual([]);
    const idea = await page.getByLabel("The idea").boundingBox();
    const where = await page.getByLabel("Where it goes").boundingBox();
    expect(Math.abs((idea?.y ?? 0) - (where?.y ?? 999))).toBeLessThanOrEqual(2);
    expect((where?.x ?? 0) - (idea?.x ?? 0)).toBeGreaterThan(400);
    const side = page.locator("[data-side-panel]");
    await expect(side.getByRole("list", { name: "Steps" }).locator(":scope > li")).toHaveCount(6);
    await expect(side.getByText("What research costs here")).toBeVisible();
    await expect(side.getByText("Start from what you run")).toBeVisible();
    // The constraint chips are chips: the standard height with a mouse.
    const chip = await page.getByRole("button", { name: "Members sign in" }).boundingBox();
    expect(chip?.height ?? 0).toBeLessThanOrEqual(36);
    // An idea to start from fills the box.
    await side.getByRole("button").first().click();
    await expect(page.getByLabel("The idea")).not.toHaveValue("");
  });

  for (const width of [1280, 1512, 1920, 2560]) {
    test(`at ${width} fills the page column in one order: the idea beside how it starts, no gutter before the side panel`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      expect(await open(page, "default", "/start")).toEqual([]);
      const form = await page.locator("main form").boundingBox();
      const main = await page.locator("main").evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) };
      });
      // The form ends at its column's edge (or at the page cap on an ultrawide), never 400 px short of it.
      expect(main.right - ((form?.x ?? 0) + (form?.width ?? 0))).toBeLessThanOrEqual(Math.max(8, main.right - main.left - 1536));
      const idea = await page.getByLabel("The idea").boundingBox();
      const where = await page.getByLabel("Where it goes").boundingBox();
      const start = await page.getByRole("button", { name: "Research this idea" }).boundingBox();
      // Read left then right, the order is the order a phone shows: the idea first, then where it goes, then the start.
      expect(where?.x ?? 0).toBeGreaterThan((idea?.x ?? 0) + (idea?.width ?? 0));
      expect(start?.y ?? 0).toBeGreaterThan(where?.y ?? 0);
      await expect(page.getByRole("link", { name: "Back to the org chart" })).toHaveCount(0);
    });
  }

  test("on a phone puts the idea first and keeps one order", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "default", "/start");
    const idea = await page.getByLabel("The idea").boundingBox();
    const where = await page.getByLabel("Where it goes").boundingBox();
    expect(where?.y ?? 0).toBeGreaterThan(idea?.y ?? 0);
    expect(await overflowing(page)).toEqual([]);
  });

  test("on a phone keeps “Research this idea” above the bottom bar however long the idea", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "default", "/start");
    await page.getByLabel("The idea").fill("A spoiler-safe discussion space for our book club: every member marks how far they have read, each thread is locked to a chapter, and nobody sees a comment about a page they have not reached yet, with a weekly digest of what opened up.");
    const start = page.getByRole("button", { name: "Research this idea" });
    await expect(start).toBeInViewport();
    const box = await start.boundingBox();
    const bar = await page.locator("[data-bottom-nav]").boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 812);
  });
});

test.describe("ideas from your portfolio", () => {
  for (const width of [1512, 1920, 2560]) {
    test(`at ${width} are full-width cards, one under another with no holes, each reused thing named once`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      expect(await open(page, "suggestions-long")).toEqual([]);
      const list = page.getByRole("list", { name: "Suggested ideas" });
      const listBox = await list.boundingBox();
      const boxes = await list.locator(":scope > li").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom) })));
      expect(boxes.length).toBeGreaterThan(1);
      for (const b of boxes) {
        expect(b.left).toBe(Math.round(listBox?.x ?? 0));
        expect(Math.abs(b.width - (listBox?.width ?? 0))).toBeLessThanOrEqual(1);
      }
      // No holes: each card starts the gap's width under the one before.
      for (let i = 1; i < boxes.length; i++) expect((boxes[i]?.top ?? 0) - (boxes[i - 1]?.bottom ?? 0)).toBeLessThanOrEqual(24);
      // Inside each card from 1280: the idea and its choices beside why it is suggested, their tops level.
      const first = list.locator(":scope > li").first();
      const title = await first.getByRole("heading").boundingBox();
      const gap = await first.getByText("The gap it fills").boundingBox();
      expect((gap?.x ?? 0) - (title?.x ?? 0)).toBeGreaterThan(300);
      expect(Math.abs((gap?.y ?? 0) - (title?.y ?? 0))).toBeLessThanOrEqual(12);
      await expect(first.getByText("Dive Trip Ready", { exact: true })).toHaveCount(1);
      await expect(page.locator("main details")).toHaveCount(0);
      expect(await overflowing(page)).toEqual([]);
    });
  }

  test("a lone suggestion is never half a page", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await open(page, "s3-suggestions");
    const list = page.getByRole("list", { name: "Suggested ideas" });
    const listBox = await list.boundingBox();
    const card = await list.locator(":scope > li").first().boundingBox();
    expect(Math.abs((card?.width ?? 0) - (listBox?.width ?? 0))).toBeLessThanOrEqual(1);
  });

  test("at 320 the division picker is whole", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page, "suggestions-long");
    const select = page.getByLabel("Suggest for");
    const fits = await select.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
    expect(await overflowing(page)).toEqual([]);
  });
});
