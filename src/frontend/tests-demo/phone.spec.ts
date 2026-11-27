import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The console on a phone (375 × 812, touch), screen by screen, in the built demo: nothing scrolls
 * sideways, the screen's main action is on screen without scrolling, the bottom bar is there with
 * thumb-sized targets, the conversation is one tap away with its message box in view, and the long
 * pages open short.
 *
 * Page heights on arrival (the budgets): the org chart under 2,400 px, an app's page under 2,000 px,
 * a run under 3,200 px, a verdict under 2,400 px with its first decision in the first 1,400 px, and
 * notifications under 2,600 px — about two to four screens, where they were 6,300, 7,300, 11,500,
 * up to 7,300 and 5,200. Every control on every main screen, folds opened, is a thumb's height.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";
const BUDGET = { home: 2400, app: 2000, run: 3200, verdict: 2400, decision: 1400, notifications: 2600 } as const;

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

  test("a finished build leads to its app: Open and Manage full width, under the title (R7-2)", async ({ page }) => {
    await open(page, "build-published");
    await page.evaluate(() => (window as unknown as { endgameDemo: { clock: (a: { seek: string }) => void } }).endgameDemo.clock({ seek: "build:finished" }));
    const actions = page.getByRole("group", { name: "The app it built" });
    const title = page.getByRole("heading", { level: 1 });
    for (const name of [/^Open /, /^Manage /]) {
      const link = actions.getByRole("link", { name });
      await inFirstScreen(page, link);
      await thumbSized(link);
      const [box, heading] = [await link.boundingBox(), await title.boundingBox()];
      expect(box?.y ?? 0, "the app's actions sit under the title").toBeGreaterThan(heading?.y ?? 0);
      expect(box?.width ?? 0, "full width on a phone").toBeGreaterThanOrEqual(375 - 2 * 24);
    }
    await noSideways(page);
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

  test("every control on every main screen is a thumb's height, folded sections opened", async ({ page }) => {
    const found: string[] = [];
    for (const s of SCREENS) {
      await open(page, s.scenario, s.route, s.persona);
      await openFolds(page);
      for (const t of await shortTargets(page)) found.push(`${s.name}: ${t}`);
    }
    // The sheets: More, and the conversation with a reply in it.
    await open(page, "default", "/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^More/ }).click();
    for (const t of await shortTargets(page)) found.push(`More: ${t}`);
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Talk/ }).click();
    for (const t of await shortTargets(page)) found.push(`the conversation: ${t}`);
    expect(found).toEqual([]);
  });

  test("the conversation opens at its latest message, follows the reply, and says it is working on it", async ({ page }) => {
    await open(page, "default", "/");
    const bar = page.getByRole("navigation", { name: "Main" });
    const sheet = page.getByRole("dialog");
    const log = sheet.getByRole("log");
    const atFoot = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 48);
    await bar.getByRole("button", { name: /^Talk/ }).click();
    for (const q of ["What needs me today?", "What did we spend last month?"]) {
      await sheet.getByLabel(/^Message /).fill(q);
      await sheet.getByRole("button", { name: "Send" }).click();
      // From the moment it is sent, something says the answer is on its way, in view.
      await expect(sheet.locator("[data-working]").last()).toBeInViewport();
      // The reply arrives and stays in view: the log follows it to its foot.
      await expect(sheet.locator("[data-working]")).toHaveCount(0, { timeout: 30_000 });
      await expect.poll(atFoot).toBe(true);
    }
    // Closed and opened again, it opens at the latest, not the oldest.
    await page.keyboard.press("Escape");
    await bar.getByRole("button", { name: /^Talk/ }).click();
    expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect.poll(atFoot).toBe(true);
    // Reading what was said before while a reply arrives: left there, with a way down to it.
    await sheet.getByLabel(/^Message /).fill("What is Rosa building?");
    await sheet.getByRole("button", { name: "Send" }).click();
    await log.evaluate((el) => el.scrollTo({ top: 0 }));
    const jump = sheet.getByRole("button", { name: "New reply" });
    await expect(jump).toBeVisible({ timeout: 20_000 });
    expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(48);
    await jump.click();
    await expect.poll(atFoot).toBe(true);
    await expect(jump).toHaveCount(0);
  });

  test("the composer: files, what it can use and the actions, each a thumb's size, nothing sideways", async ({ page }) => {
    await open(page, "default", "/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Talk/ }).click();
    const sheet = page.getByRole("dialog");
    for (const name of ["Attach files", "What it can use here", "Actions", "Send"]) await thumbSized(sheet.getByRole("button", { name }));
    await sheet.locator("input[type=file]").setInputFiles({ name: "court-rules.md", mimeType: "text/markdown", buffer: Buffer.from("# Court rules\n- Book at most 7 days ahead\n") });
    await expect(sheet.locator("[data-attachment-chip=ready]")).toHaveCount(1);
    await thumbSized(sheet.getByRole("button", { name: "Take off court-rules.md" }));
    await sheet.getByRole("button", { name: "What it can use here" }).click();
    await expect(sheet.locator("[data-can-use]")).toBeVisible();
    await noSideways(page);
    expect(await shortTargets(page)).toEqual([]);
    await sheet.getByRole("button", { name: "What it can use here" }).click();
    await sheet.getByLabel(/^Message /).fill("Here are the rules.");
    await sheet.getByRole("button", { name: "Send" }).click();
    await expect(sheet.locator("[data-sent-attachments]")).toBeVisible();
    await expect(sheet.locator("[data-working]")).toHaveCount(0, { timeout: 30_000 });
    await expect(sheet.getByText(/^I read/)).toBeVisible();
  });

  test("work the conversation starts is a card in the sheet: the plan, its parts, whole on a phone", async ({ page }) => {
    await open(page, "app-busy");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Talk/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel(/^Message /).fill("Let members join a waitlist when a court is full.");
    await sheet.getByRole("button", { name: "Send" }).click();
    await sheet.getByRole("button", { name: /^Approve/ }).click({ timeout: 30_000 });
    const card = sheet.locator("[data-work-card]");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { endgameDemo: { clock: (a: { speed: number }) => void } }).endgameDemo.clock({ speed: 30 }));
    await expect(card.getByRole("region", { name: "The plan" })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { endgameDemo: { clock: (a: { speed: number }) => void } }).endgameDemo.clock({ speed: 1 }));
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);
    await noSideways(page);
    expect(await shortTargets(page)).toEqual([]);
  });

  test("an opened fold says its title once", async ({ page }) => {
    await open(page, "app-busy");
    await page.getByRole("button", { name: /^Dashboard/ }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(1);
    await expect(page.getByText("Dashboard", { exact: true }).locator("visible=true")).toHaveCount(1);
  });

  for (const [scenario, firstDecision] of [
    ["verdict-build", /^Build/],
    ["verdict-do-not-build", /^Change the idea/],
    ["verdict-red-line", /^Change the idea/],
  ] as const) {
    test(`a verdict (${scenario}) opens short: the verdict, then the decision, then the evidence folded with the case against open`, async ({ page }) => {
      await open(page, scenario);
      expect(await height(page)).toBeLessThanOrEqual(BUDGET.verdict);
      const decision = page.getByRole("region", { name: "Your decision" }).getByRole("button", { name: firstDecision }).first();
      const top = await decision.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      expect(top, "the first decision is too far down").toBeLessThanOrEqual(BUDGET.decision);
      const box = await decision.boundingBox();
      expect(box?.width ?? 0, "the decision is not full width").toBeGreaterThanOrEqual(320);
      await thumbSized(decision);
      await expect(page.getByRole("button", { name: /^The case against/ })).toHaveAttribute("aria-expanded", "true");
      // Over a red line research looks at no market, and the page says so once rather than three times.
      const market = scenario === "verdict-red-line" ? [/^The market was not researched/] : [/^Who already does this/, /^What gap is left/, /^Who would want it/];
      for (const name of [...market, /^How often research says no/]) await expect(page.getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
      if (scenario === "verdict-red-line") {
        const card = page.getByRole("alert").filter({ hasText: "crosses a red line" });
        await expect(card).toBeVisible();
        const cardTop = await card.evaluate((el) => el.getBoundingClientRect().top);
        const firstFold = await page.locator("[data-fold]").first().evaluate((el) => el.getBoundingClientRect().top);
        expect(cardTop).toBeLessThan(firstFold);
      }
    });
  }

  test("dropping an idea is confirmed in place, full width", async ({ page }) => {
    await open(page, "verdict-do-not-build");
    await page.getByRole("button", { name: "Drop the idea" }).click();
    const confirm = page.getByRole("group", { name: "Confirm" });
    await expect(confirm).toBeInViewport();
    await thumbSized(confirm.getByRole("button", { name: "Yes" }));
  });

  test("notifications open short: the unread and the newest ten, then older ones ten at a time", async ({ page }) => {
    await open(page, "default", "/notifications");
    expect(await height(page)).toBeLessThanOrEqual(BUDGET.notifications);
    const rows = page.getByRole("list", { name: "Notifications" }).locator("[data-notification]");
    const first = await rows.count();
    const older = page.getByRole("button", { name: /^Show older/ });
    if (await older.count()) {
      await older.click();
      expect(await rows.count()).toBeGreaterThan(first);
      expect((await rows.count()) - first).toBeLessThanOrEqual(10);
    }
    // Every unread notice is among those shown from the start.
    const unread = Number((await page.getByText(/^\d+ unread$/).textContent())?.match(/\d+/)?.[0] ?? 0);
    expect(await page.locator("[data-notification][data-read=false]").count()).toBe(unread);
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

/** Opens every folded section on the page, so what they hold is measured too. */
async function openFolds(page: Page) {
  const rows = page.locator("[data-fold] > button[aria-expanded=false]");
  for (let n = await rows.count(); n > 0; n = await rows.count()) await rows.first().click();
}

/**
 * Every control on screen shorter than a thumb's 44 px, described. Not counted: a link that is a word
 * in a sentence (drawn inline, among other words), a visually hidden "skip" link, and a control whose
 * tap area is stretched over its card by an absolutely placed `::after` (the whole card takes the tap).
 */
async function shortTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const sel = "a[href], button, [role=button], [role=link], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=switch], [role=radio], [role=checkbox]";
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest("[data-demo-chrome], [hidden]")) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width <= 1 || r.height <= 1 || style.visibility === "hidden" || style.display === "none") continue;
      if (r.height >= 43.5) continue;
      if (getComputedStyle(el, "::after").position === "absolute" && (el.offsetParent?.getBoundingClientRect().height ?? 0) >= 44) continue;
      const own = (el.textContent ?? "").trim();
      const around = (el.parentElement?.textContent ?? "").trim();
      if (el.tagName === "A" && style.display === "inline" && around.length > own.length + 3) continue;
      if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio") {
        if ((el.closest("label")?.getBoundingClientRect().height ?? 0) >= 43.5) continue;
      }
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? own).slice(0, 60)}" is ${Math.round(r.height)} px tall`);
    }
    return out;
  });
}

/** The sign-in page has no bottom bar: on screen within the first screen's height. */
async function inFirstScreenWithoutBar(target: Locator) {
  await expect(target).toBeInViewport();
}

/**
 * A tablet worked by touch — portrait 768 and 834, landscape 1024 — the full header on one row that never wraps
 * (the organisation switcher in it; the mode switch and Sign out in the account menu below 1,100 px), and every
 * control a thumb's height: the same rule as a phone, since a finger is the same size on both.
 */
for (const [width, height] of [
  [768, 1024],
  [834, 1194],
  [1024, 768],
] as const) {
  test.describe(`the console on a tablet worked by touch (${width} × ${height})`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: false, deviceScaleFactor: 2 });

    test("the header's controls sit on one row, with two organisations, in both modes", async ({ page }) => {
      await open(page, "two-organisations", "/", "two-organisations");
      await expect(page.getByRole("combobox", { name: "Working in" })).toBeVisible();
      for (const mode of ["Normal", "Technical"]) {
        await page.getByRole("button", { name: "Your account, the mode and signing out" }).click();
        await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode }).click();
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
        await page.keyboard.press("Escape");
        const tops = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("header a, header button, header select")]
            .filter((el) => el.offsetParent !== null && !el.closest("nav[aria-label='Where you are']") && !el.closest("[hidden]"))
            .map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)),
        );
        expect(Math.max(...tops) - Math.min(...tops), `the ${mode} header wraps`).toBeLessThanOrEqual(4);
      }
    });

    test("every control on every main screen is a thumb's height", async ({ page }) => {
      const found: string[] = [];
      for (const s of SCREENS) {
        await open(page, s.scenario, s.route, s.persona);
        await noSideways(page);
        for (const t of await shortTargets(page)) found.push(`${s.name}: ${t}`);
      }
      expect(found).toEqual([]);
    });
  });
}

/**
 * A phone on its side (812 × 375) is not the upright layout stretched: the bar becomes a slim rail at
 * the left, so the page keeps its height, and the header is one line.
 */
test.describe("a phone on its side", () => {
  test.use({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test("the bar is a rail at the left edge, the page beside it, nothing sideways", async ({ page }) => {
    await open(page, "app-busy");
    const rail = await page.locator("[data-bottom-nav]").boundingBox();
    expect(rail?.x ?? -1).toBe(0);
    expect(rail?.width ?? 999, "the rail is slim").toBeLessThanOrEqual(96);
    expect(rail?.height ?? 0, "the rail runs the screen's height").toBeGreaterThanOrEqual(370);
    const main = await page.locator("main").boundingBox();
    expect(main?.x ?? 0, "the page starts beside the rail").toBeGreaterThanOrEqual((rail?.width ?? 0) - 1);
    const header = await page.locator("header").first().boundingBox();
    expect(header?.height ?? 999, "the header is one line").toBeLessThanOrEqual(56);
    await noSideways(page);
    await thumbSized(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }));
  });

  test("a sheet comes in from the side", async ({ page }) => {
    await open(page, "default", "/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^More/ }).click();
    const sheet = await page.getByRole("dialog", { name: "More" }).boundingBox();
    expect(sheet?.x ?? 0, "the sheet sits at the right").toBeGreaterThan(300);
    // Sized to what it holds, at most 85% of the screen's height (ARCH-011).
    expect(sheet?.height ?? 999).toBeLessThanOrEqual(Math.ceil(375 * 0.85) + 1);
  });
});
