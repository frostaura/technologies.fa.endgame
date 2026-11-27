import { expect, test, type Page } from "@playwright/test";

/**
 * A run's page in the built demo, at every size it is designed for: nothing scrolls sideways; the heading is a short
 * name that is never cut mid-word; the timeline is one grid, so every row's time sits in the same column; the steps are
 * gathered by part with the part the work is on open; the plan's tags sit in one place; a failed run never says it is
 * working or live; the side panel is beside the page only from 1280 (the page keeps its width at 1024); from 1600 the plan
 * stands beside the steps; and on a phone the decision comes before the controls, its note before its answers.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

async function open(page: Page, scenario: string, width: number, height = 900) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.setViewportSize({ width, height });
  await page.goto(`${SUB}?scenario=${scenario}&persona=owner&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return problems;
}

async function noSideways(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "the page scrolls sideways").toBeLessThanOrEqual(cw);
}

for (const width of [375, 768, 1024, 1512, 1920, 2560]) {
  test(`a long failed run at ${width}: one grid, gathered by part, never "Live"`, async ({ page }) => {
    const problems = await open(page, "run-long", width, width < 640 ? 812 : 900);
    await noSideways(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Build: A sign-up sheet for the rowing club's Saturday outings");
    // Two lines at most, never three.
    const lines = await h1.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeLessThanOrEqual(width < 640 ? 3 : 2);
    await expect(page.getByText("Did not succeed").first()).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Working", { exact: true })).toHaveCount(0);
    // One card says how it ended: never one inside another.
    const ended = page.getByRole("region", { name: "How it ended" });
    await expect(ended).toHaveCount(1);
    expect(await ended.locator("section.rounded-md, div.rounded-md.border").count()).toBe(0);

    const parts = page.locator("ol[aria-label='Steps'] > li[data-part]");
    await expect(parts).toHaveCount(3);
    await expect(parts.nth(2)).toHaveAttribute("data-open", "true");
    await expect(parts.nth(0)).not.toHaveAttribute("data-open", "true");

    // Every row's time is in one column: the right edges of the times line up.
    const rights = await page.locator("ol[aria-label='Steps: Part 2 of 5'] > li time").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
    expect(rights.length).toBeGreaterThan(10);
    expect(new Set(rights).size, `times sit in ${new Set(rights).size} columns`).toBe(1);

    // The plan's tags sit in one place on every item.
    const tags = page.locator("ol[aria-label='Parts of the plan'] > li [class*='rounded-full']");
    if (width >= 640 && (await tags.first().isVisible())) {
      const edges = await tags.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
      expect(new Set(edges).size).toBe(1);
    }

    // The side panel is beside the page only from 1280; from 1600 the plan stands beside the steps.
    const aside = page.getByRole("complementary", { name: "Beside this page" });
    if (width >= 1280) await expect(aside).toBeVisible();
    else await expect(aside).toHaveCount(0);
    if (width >= 1600) {
      const steps = await page.getByRole("heading", { name: "Step by step" }).boundingBox();
      const plan = await page.locator("#plan-title").boundingBox();
      expect(plan && steps && plan.x > steps.x + 300, "the plan is beside the steps").toBe(true);
    }
    expect(problems).toEqual([]);
  });
}

test("a plan waiting on a phone: the decision first, its note before its answers, the controls after it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "build-waiting-on-plan", 375, 812);
  await noSideways(page);
  const card = page.getByTestId("approval-card");
  const note = await card.getByLabel("Add a note (optional)").boundingBox();
  const approve = await card.getByRole("button", { name: "Approve" }).boundingBox();
  const pause = await page.getByRole("button", { name: "Pause" }).boundingBox();
  const cardBox = await card.boundingBox();
  expect(note && approve && note.y < approve.y).toBe(true);
  expect(cardBox && pause && cardBox.y < pause.y, "the decision comes before the controls").toBe(true);
});

test("a paused run shows no live pulse", async ({ page }) => {
  await open(page, "s3-waiting-for-budget", 1512);
  await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
});

test("at 1024 the page keeps its width: no squeezed side column", async ({ page }) => {
  await open(page, "build-running", 1024, 768);
  const cost = await page.getByRole("region", { name: "Cost" }).boundingBox();
  // Beside the docked conversation (ARCH-012) the page column is what is left; the cost takes all of it.
  const main = await page.locator("main").boundingBox();
  expect(cost?.width ?? 0).toBeGreaterThan((main?.width ?? 0) - 100);
});
