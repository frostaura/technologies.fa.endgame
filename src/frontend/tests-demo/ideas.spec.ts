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
  test("at 1920 are a grid of same-shaped cards, each reused thing named once", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    expect(await open(page, "suggestions-long")).toEqual([]);
    const cards = page.getByRole("list", { name: "Suggested ideas" }).locator(":scope > li");
    const tops = await cards.evaluateAll((els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const reuse = cards.first().getByText("Dive Trip Ready", { exact: true });
    await expect(reuse).toHaveCount(1);
    await expect(page.locator("main details")).toHaveCount(0);
    expect(await overflowing(page)).toEqual([]);
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
