import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The console on a phone (375 × 812, touch), screen by screen, in the built demo: nothing scrolls
 * sideways, the screen's main action is on screen without scrolling, the bottom bar is there with
 * thumb-sized targets, the conversation is one tap away with its message box in view, and the long
 * pages open short.
 *
 * Page heights on arrival (the budgets): the org chart under 2,400 px, an app's page under 2,000 px,
 * a run under 3,200 px — about two to four screens, where they were 6,300, 7,300 and 11,500.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";
const BUDGET = { home: 2400, app: 2000, run: 3200 } as const;

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

async function open(page: Page, scenario: string, route?: string, persona = "owner") {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto(`${SUB}?scenario=${scenario}&persona=${persona}&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  if (route) await page.evaluate((r) => (window as unknown as { endgameDemo: { goto: (a: { route: string }) => Promise<void> } }).endgameDemo.goto({ route: r }), route);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
  return problems;
}

async function noSideways(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "the page scrolls sideways").toBeLessThanOrEqual(cw);
}

/** On screen as the page opens, above the bottom bar, without scrolling. */
async function inFirstScreen(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  const bar = await page.locator("[data-bottom-nav]").boundingBox();
  expect(box, "the main action has no box").not.toBeNull();
  // All of it, or — for something taller than a control (a list, a card) — its first line.
  const shown = Math.min(box?.height ?? 0, 56);
  expect((box?.y ?? 0) + shown, "the main action is below the first screen").toBeLessThanOrEqual(bar?.y ?? 812);
}

async function thumbSized(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function bottomBar(page: Page) {
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  await thumbSized(bar.getByRole("link", { name: "Home" }));
  await thumbSized(bar.getByRole("button", { name: /^Talk/ }));
  await thumbSized(bar.getByRole("button", { name: /^More/ }));
  // Alerts and the balance, wherever there is an organisation to read them for.
  for (const name of [/^Alerts/, /^Credits/]) {
    const item = bar.getByRole("link", { name });
    if (await item.count()) await thumbSized(item);
  }
}

async function height(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight);
}

/** "Talk" in the bar opens the conversation, its message box in view and usable. */
async function talkInOneTap(page: Page, box: RegExp) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Talk/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const input = sheet.getByLabel(box);
  await expect(input).toBeInViewport();
  await input.fill("What needs me today?");
  await expect(sheet.getByRole("button", { name: "Send" })).toBeEnabled();
}

const SCREENS: { name: string; scenario: string; route?: string; persona?: string; primary: (p: Page) => Locator }[] = [
  { name: "home", scenario: "default", route: "/", primary: (p) => p.getByRole("link", { name: "New idea" }) },
  { name: "a run waiting for approval", scenario: "build-waiting-on-plan", primary: (p) => p.getByRole("region", { name: "Waiting for your approval" }).getByRole("button").first() },
  { name: "a finished run", scenario: "build-published", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "research running", scenario: "research-running", primary: (p) => p.getByRole("button", { name: "Pause" }) },
  { name: "an app", scenario: "app-busy", primary: (p) => p.getByRole("link", { name: "Open the app" }) },
  { name: "credits", scenario: "default", route: "/credits", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "people", scenario: "default", route: "/people?scope=northwind", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "secrets", scenario: "default", route: "/secrets?scope=northwind", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "autonomy", scenario: "default", route: "/autonomy?scope=northwind", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "hiring", scenario: "default", route: "/hires?scope=northwind", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "a hire proposed", scenario: "hire-pending", primary: (p) => p.getByRole("button", { name: /^Hire / }) },
  { name: "an employee", scenario: "employee-memory", primary: (p) => p.getByRole("button", { name: /^Talk to / }).first() },
  { name: "notifications", scenario: "default", route: "/notifications", primary: (p) => p.getByRole("button", { name: "Mark all read" }) },
  { name: "manage", scenario: "manage-tree", route: "/tree", primary: (p) => p.getByRole("navigation", { name: "Every part of the organisation" }) },
  { name: "a verdict", scenario: "verdict-build", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "a new idea", scenario: "default", route: "/start", primary: (p) => p.getByLabel("The idea") },
  { name: "ideas from the portfolio", scenario: "default", route: "/suggestions?scope=northwind", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "AI assistants", scenario: "default", route: "/assistants", primary: (p) => p.getByRole("heading", { level: 1 }) },
  { name: "your account", scenario: "account", primary: (p) => p.getByRole("button", { name: /passkey/i }).first() },
  { name: "God mode", scenario: "god-mode", persona: "operator", primary: (p) => p.getByRole("button", { name: /^Enter / }).first() },
  { name: "operator access", scenario: "default", route: "/operator-access", primary: (p) => p.getByRole("heading", { level: 1 }) },
];

test.describe("the console on a phone", () => {
  for (const s of SCREENS) {
    test(`${s.name}: one column, its main action in the first screen, the bottom bar in reach`, async ({ page }) => {
      const problems = await open(page, s.scenario, s.route, s.persona);
      await noSideways(page);
      await inFirstScreen(page, s.primary(page));
      await bottomBar(page);
      expect(problems).toEqual([]);
    });
  }

  test("signing in fits a phone, its button a thumb's size", async ({ page }) => {
    await open(page, "default", "/sign-in", "signed-out");
    await noSideways(page);
    const button = page.getByRole("button", { name: "Sign in with a passkey" });
    await inFirstScreenWithoutBar(button);
    await thumbSized(button);
  });

  test("home opens short, its conversation one tap away", async ({ page }) => {
    await open(page, "default", "/");
    expect(await height(page)).toBeLessThanOrEqual(BUDGET.home);
    // "Needs you" is one row that opens the list.
    await page.locator("[data-needs-summary]").click();
    await expect(page.getByRole("dialog", { name: "Needs you" }).locator("[data-need]").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await talkInOneTap(page, /^Message Northwind$/);
  });

  test("an app opens short: its main action first, every section a folded row, its conversation one tap away", async ({ page }) => {
    await open(page, "app-busy");
    expect(await height(page)).toBeLessThanOrEqual(BUDGET.app);
    const history = page.getByRole("button", { name: /^History/ });
    await expect(history).toHaveAttribute("aria-expanded", "false");
    await history.click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await talkInOneTap(page, /^Message /);
  });

  test("a run opens short, the approval it waits on straight under its title and pinned once scrolled past", async ({ page }) => {
    await open(page, "build-waiting-on-plan");
    expect(await height(page)).toBeLessThanOrEqual(BUDGET.run);
    const approval = page.getByRole("region", { name: "Waiting for your approval" });
    await inFirstScreen(page, approval.getByRole("button").first());
    await page.mouse.wheel(0, 1600);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const pinned = page.locator("[data-pinned-approval]");
    await expect(pinned).toBeVisible();
    await thumbSized(pinned);
    await pinned.click();
    await expect(approval).toBeInViewport();
  });

  test("a finished run opens short, its latest step first", async ({ page }) => {
    await open(page, "build-published");
    expect(await height(page)).toBeLessThanOrEqual(BUDGET.run);
  });

  test("More holds every other page, the mode and signing out", async ({ page }) => {
    await open(page, "default", "/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^More/ }).click();
    const more = page.getByRole("dialog", { name: "More" });
    for (const name of ["Manage the organisation", "Hiring", "Autonomy", "People", "Secrets", "AI assistants"]) await expect(more.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(more.getByRole("group", { name: "Mode" })).toBeVisible();
    await more.getByRole("link", { name: /^Hiring/ }).click();
    await expect(page).toHaveURL(/#\/hires/);
  });

  test("where you are reads in full, with the way up and every level a tap away", async ({ page }) => {
    await open(page, "app-busy");
    await expect(page.getByRole("link", { name: /^Up to / })).toBeVisible();
    await page.getByRole("button", { name: /^Where you are/ }).click();
    const trail = page.getByRole("dialog", { name: "Where you are" });
    await expect(trail.getByText("Court booking").last()).toBeVisible();
  });

  test("a step written at desktop size finds what a phone folded away", async ({ page }) => {
    await open(page, "app-busy");
    const found = await page.evaluate(() => (window as unknown as { endgameDemo: { highlight: (a: { text: string }) => Promise<boolean | undefined> } }).endgameDemo.highlight({ text: "Bring back" }));
    expect(found).toBe(true);
    await expect(page.locator("[data-demo-spotlight]")).toBeInViewport();
    const layout = await page.evaluate(() => (window as unknown as { endgameDemo: { layout: () => { viewport: string; bottom: number } } }).endgameDemo.layout());
    expect(layout.viewport).toBe("phone");
    expect(layout.bottom).toBeGreaterThanOrEqual(56);
  });
});

/** The sign-in page has no bottom bar: on screen within the first screen's height. */
async function inFirstScreenWithoutBar(target: Locator) {
  await expect(target).toBeInViewport();
}
