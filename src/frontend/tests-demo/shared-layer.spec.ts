import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The console's shared layer (ARCH-011), held in the built demo:
 *
 * - every confirmation in the console opens as the one ConfirmCard, right under (or beside) the control that
 *   asked for it — never at the far side of the page or over the next row;
 * - a short window that is upright (a phone with its keyboard open) keeps the phone layout: the page keeps its
 *   width, its fields, and its primary action reachable above the bar.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

async function open(page: Page, scenario: string, route?: string, persona = "owner") {
  await page.goto(`${SUB}?scenario=${scenario}&persona=${persona}&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  if (route) await page.evaluate((r) => (window as unknown as { endgameDemo: { goto: (a: { route: string }) => Promise<void> } }).endgameDemo.goto({ route: r }), route);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
}

/** Every trigger of a confirmation the demo can show, and where to find it. */
const CONFIRMS: { name: string; scenario: string; route?: string; trigger: (p: Page) => Locator }[] = [
  { name: "People: Remove", scenario: "quiet", route: "/people?scope=northwind", trigger: (p) => p.getByRole("button", { name: /^Remove Ada/ }) },
  { name: "Secrets: Remove", scenario: "quiet", route: "/secrets?scope=northwind", trigger: (p) => p.getByRole("main").getByRole("button", { name: /^Remove/ }) },
  { name: "AI assistants: Revoke", scenario: "quiet", route: "/assistants", trigger: (p) => p.getByRole("button", { name: /^Revoke/ }) },
  { name: "App: Stop sharing", scenario: "app-busy", trigger: (p) => p.getByRole("button", { name: /^Stop sharing with/ }) },
  { name: "App history: Bring back", scenario: "app-long-history", trigger: (p) => p.getByRole("button", { name: /^Bring back/ }) },
  { name: "Employee: Let go", scenario: "employee-memory", trigger: (p) => p.getByRole("main").getByRole("button", { name: "Let go", exact: true }) },
  { name: "Hire: Decline", scenario: "hire-pending", trigger: (p) => p.getByRole("button", { name: /^Decline/ }) },
  { name: "Verdict: Drop the idea", scenario: "verdict-build", trigger: (p) => p.getByRole("button", { name: "Drop the idea" }) },
  { name: "Run: Cancel", scenario: "build-running", trigger: (p) => p.getByRole("main").getByRole("button", { name: "Cancel", exact: true }) },
];

/** The gap between two boxes along one axis: 0 when they overlap. */
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1);

test.describe("one confirmation, anchored to its trigger", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const c of CONFIRMS) {
    test(`${c.name} opens the ConfirmCard right under the control that asked`, async ({ page }) => {
      await open(page, c.scenario, c.route);
      const trigger = c.trigger(page).first();
      await trigger.scrollIntoViewIfNeeded();
      const t = await trigger.boundingBox();
      expect(t, "the trigger is on the page").not.toBeNull();
      await trigger.click();
      const card = page.locator("[data-confirm]").first();
      await expect(card).toBeVisible();
      await expect(card).toBeInViewport();
      // Where it was when it was pressed: the page may have scrolled the card into view since.
      const scrolled = await page.evaluate(() => window.scrollY);
      const k = await card.boundingBox();
      const after = await page.evaluate(() => window.scrollY);
      if (!t || !k) return;
      const dy = after - scrolled;
      const top = k.y + dy;
      expect(top, "the card opens below the top of its trigger, never above it").toBeGreaterThanOrEqual(t.y - 4);
      expect(gap(t.y, t.y + t.height, top, top + k.height), "the card opens right under its trigger").toBeLessThanOrEqual(72);
      expect(gap(t.x, t.x + t.width, k.x, k.x + k.width), "the card sits beside its trigger, not across the page").toBeLessThanOrEqual(48);
    });
  }
});

/** The pages a person types into, for the short-window check. */
const FORMS: { name: string; scenario: string; route: string; field: (p: Page) => Locator; action: (p: Page) => Locator }[] = [
  { name: "New idea", scenario: "quiet", route: "/start", field: (p) => p.getByLabel("The idea"), action: (p) => p.getByRole("button", { name: "Research this idea" }) },
  { name: "Invite someone", scenario: "quiet", route: "/people?scope=northwind", field: (p) => p.getByLabel("E-mail address"), action: (p) => p.getByRole("button", { name: "Invite" }) },
  { name: "AI assistants", scenario: "quiet", route: "/assistants", field: (p) => p.getByRole("main").getByRole("textbox").first(), action: (p) => p.getByRole("main").getByRole("button").last() },
];

for (const [width, height] of [
  [375, 450],
  [390, 480],
] as const) {
  test.describe(`a short upright window (${width} × ${height}, a phone with its keyboard open)`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    for (const f of FORMS) {
      test(`${f.name} keeps the phone layout, its field and its primary action usable`, async ({ page }) => {
        await open(page, f.scenario, f.route);
        const bar = await page.locator("[data-bottom-nav]").boundingBox();
        expect(bar?.y ?? 0, "the bar is at the foot, not a rail at the side").toBeGreaterThan(height / 2);
        const main = await page.locator("main").boundingBox();
        expect(main?.width ?? 0, "the page keeps the window's width").toBeGreaterThanOrEqual(width - 1);
        const title = await page.getByRole("heading", { level: 1 }).first().boundingBox();
        expect(title?.width ?? 0, "the title is not crushed").toBeGreaterThan(200);
        const field = f.field(page);
        await field.scrollIntoViewIfNeeded();
        await expect(field).toBeInViewport();
        expect((await field.boundingBox())?.width ?? 0, "the field is usable").toBeGreaterThan(200);
        const action = f.action(page).first();
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport();
        const a = await action.boundingBox();
        const nav = await page.locator("[data-bottom-nav]").boundingBox();
        expect((a?.y ?? 0) + (a?.height ?? 0), "the primary action is above the bar").toBeLessThanOrEqual((nav?.y ?? height) + 1);
        const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw).toBeLessThanOrEqual(cw);
      });
    }
  });
}
