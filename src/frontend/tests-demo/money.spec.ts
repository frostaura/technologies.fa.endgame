import { expect, test, type Page } from "@playwright/test";

/**
 * Credits, autonomy, notifications, AI assistants, the operator log, God mode, secrets and system
 * status at desktop widths, in the built demo: nothing scrolls sideways, siblings sit on one grid,
 * long lists stay short, and the shapes the visual reviews found broken stay fixed — the budget tree
 * as a dense table (console-desktop 50, real-stack 37), one stage-by-rule table with no rule said
 * twice (console-desktop 51–52), a feed grouped by day that opens short (real-stack 21), addresses
 * that break only at "/" (real-stack 40), a single-column operator log (real-stack 41), and God mode's
 * organisations on one grid with their figures aligned (console-desktop 58).
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

test.use({ viewport: { width: 1920, height: 1080 } });

async function open(page: Page, scenario: string, route?: string, persona = "owner", technical = false) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${SUB}?scenario=${scenario}&persona=${persona}&embed=1`);
  await page.waitForFunction(() => !!(window as unknown as { endgameDemo?: unknown }).endgameDemo);
  if (route) await page.evaluate((r) => (window as unknown as { endgameDemo: { goto: (a: { route: string }) => Promise<void> } }).endgameDemo.goto({ route: r }), route);
  await page.evaluate(() => (window as unknown as { endgameDemo: { settled: (ms: number) => Promise<void> } }).endgameDemo.settled(6000));
  if (technical) await page.getByRole("button", { name: "Technical" }).first().click();
  return problems;
}

async function noSideways(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "the page scrolls sideways").toBeLessThanOrEqual(cw);
}

const PAGES: { name: string; scenario: string; route?: string; persona?: string; technical?: boolean }[] = [
  { name: "credits", scenario: "default", route: "/credits" },
  { name: "autonomy", scenario: "default", route: "/autonomy?scope=northwind" },
  { name: "notifications", scenario: "default", route: "/notifications" },
  { name: "AI assistants", scenario: "default", route: "/assistants" },
  { name: "secrets", scenario: "default", route: "/secrets?scope=northwind/technologies/court-booking" },
  { name: "operator log", scenario: "s4-operator-log" },
  { name: "God mode", scenario: "god-mode", persona: "operator" },
  { name: "system status", scenario: "status-unhealthy", technical: true },
];

test.describe("the money and settings pages at desktop and tablet widths", () => {
  for (const width of [768, 1280, 1920, 2560]) {
    test(`nothing scrolls sideways at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      for (const p of PAGES) {
        const problems = await open(page, p.scenario, p.route, p.persona, p.technical);
        await expect(page.getByRole("heading", { level: 1 }).first(), p.name).toBeVisible();
        await noSideways(page);
        expect(problems, `${p.name}: page errors`).toEqual([]);
      }
    });
  }
});

test.describe("credits", () => {
  test("the budget tree is a dense table: one line a row, the action at its end, the cap note said once", async ({ page }) => {
    await open(page, "default", "/credits");
    const tree = page.getByRole("list", { name: "Budgets" });
    const rows = tree.locator(":scope > li");
    const n = await rows.count();
    expect(n).toBeGreaterThan(20);
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const box = await row.boundingBox();
      expect(box?.height ?? 0, `row ${i} is too tall`).toBeLessThanOrEqual(64);
      // The action is on the row's own line, at its end.
      const action = row.getByRole("button", { name: /^(Set a cap on|Change the cap on) / });
      const a = await action.boundingBox();
      expect((a?.x ?? 0) + (a?.width ?? 0), `row ${i}'s action is not at its end`).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0) - 40);
    }
    // "No cap here …" is a cell's name and a legend, never a sentence repeated on every row.
    await expect(tree.getByText(/No cap here/)).toHaveCount(0);
    await expect(page.getByText("no cap here or above it", { exact: false })).toHaveCount(1);
    // A division folds away what is in it.
    const before = n;
    await page.getByRole("button", { name: "Hide what is in Learning" }).click();
    expect(await rows.count()).toBeLessThan(before);
    await page.getByRole("button", { name: "Show what is in Learning" }).click();
    expect(await rows.count()).toBe(before);
  });

  test("at 1600 and wider the month's figures and the top-ups sit beside the tree, and no amount wraps", async ({ page }) => {
    await open(page, "default", "/credits");
    const tree = await page.getByRole("list", { name: "Budgets" }).boundingBox();
    const figures = await page.getByRole("region", { name: "How the month went" }).boundingBox();
    expect(figures?.x ?? 0).toBeGreaterThan((tree?.x ?? 0) + (tree?.width ?? 0));
    expect(Math.abs((figures?.y ?? 0) - (tree?.y ?? 0))).toBeLessThan(120);
    for (const amount of await page.getByRole("list", { name: "Top-ups made" }).getByText(/^\+/).all()) {
      expect((await amount.boundingBox())?.height ?? 99, "a top-up amount wraps").toBeLessThanOrEqual(26);
    }
  });
});

test.describe("autonomy", () => {
  test("one stage-by-rule table, each stage one row, no rule said twice", async ({ page }) => {
    await open(page, "default", "/autonomy?scope=northwind");
    const table = page.getByRole("list", { name: "Rules for each stage" });
    const stages = table.locator(":scope > li[data-stage]");
    await expect(stages).toHaveCount(7);
    const lefts = new Set<number>();
    for (const stage of await stages.all()) lefts.add(Math.round((await stage.locator("h3").boundingBox())?.x ?? 0));
    expect(lefts.size, "the stages' names are not in one column").toBe(1);
    // Northwind's "every stage" rules refuse two different commands: one line says so, once.
    await expect(table.locator('[data-stage="all"]').getByText("Run commands and tests, limited")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(1500);
  });

  test("each checkpoint's switch sits beside its title", async ({ page }) => {
    await open(page, "default", "/autonomy?scope=northwind");
    for (const name of ["Before work starts", "Before the plan is carried out", "Before anyone is hired"]) {
      const sw = await page.getByRole("switch", { name }).boundingBox();
      const title = await page.getByText(name, { exact: true }).boundingBox();
      expect((title?.x ?? 0) - ((sw?.x ?? 0) + (sw?.width ?? 0)), `${name}: switch far from its title`).toBeLessThan(40);
    }
  });

  test("the technical rule editor's examples show whole", async ({ page }) => {
    await open(page, "default", "/autonomy?scope=northwind", "owner", true);
    await page.locator('[data-stage="build"]').getByRole("button", { name: "Change" }).click();
    for (const input of await page.locator('[data-stage="build"] fieldset input').all()) {
      const fits = await input.evaluate((el) => {
        const field = el as HTMLInputElement;
        const probe = document.createElement("span");
        probe.style.font = getComputedStyle(field).font;
        probe.textContent = field.placeholder;
        document.body.appendChild(probe);
        const wide = probe.getBoundingClientRect().width;
        probe.remove();
        return wide <= field.clientWidth;
      });
      expect(fits, "a placeholder is cut").toBe(true);
    }
  });
});

test.describe("notifications", () => {
  test("grouped by day, unread marked one way, and the side card ends with its content", async ({ page }) => {
    await open(page, "default", "/notifications");
    const feed = page.getByRole("main").getByRole("list", { name: "Notifications" });
    await expect(feed.getByRole("heading", { name: "Today" })).toBeVisible();
    // Unread is a dot read as "Unread", never a "New" word, never a tinted card.
    await expect(feed.getByText("New", { exact: true })).toHaveCount(0);
    const fills = await feed.locator("li[data-notification]").evaluateAll((items) => new Set(items.map((li) => getComputedStyle(li).backgroundColor)).size);
    expect(fills).toBe(1);
    const card = await page.locator("[data-side-panel] > *").first().boundingBox();
    expect(card?.height ?? 0).toBeLessThan(500);
    // "Mark read" sits on its row's tag line, never alone between the time and the tags (real-stack 17).
    const row = feed.locator('li[data-notification][data-read="false"]').first();
    const button = await row.getByRole("button", { name: "Mark read" }).boundingBox();
    const tag = await row.locator("span.rounded-full.h-6").first().boundingBox();
    expect(Math.abs((button?.y ?? 0) + (button?.height ?? 0) / 2 - ((tag?.y ?? 99) + (tag?.height ?? 0) / 2))).toBeLessThanOrEqual(6);
  });
});

test.describe("AI assistants", () => {
  test("the key form has room, and an address breaks only after a slash", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "default", "/assistants");
    const form = await page.getByRole("region", { name: "Make a key" }).boundingBox();
    expect(form?.width ?? 0).toBeGreaterThan(600);
    const lines = await page.getByRole("list", { name: "App addresses" }).locator("code").evaluateAll((codes) =>
      codes.map((code) => {
        // Every line the address is laid out on starts just after a "/" (or is its first).
        const range = document.createRange();
        range.selectNodeContents(code);
        const rects = [...range.getClientRects()];
        const tops = new Set(rects.map((r) => Math.round(r.top)));
        return { text: code.textContent ?? "", lines: tops.size, slashes: (code.textContent ?? "").split("/").length - 1 };
      }),
    );
    for (const l of lines) expect(l.lines, `${l.text} broke more often than it has slashes`).toBeLessThanOrEqual(l.slashes + 1);
  });
});

test.describe("the operator log", () => {
  test("one list, newest first, every time in the same place", async ({ page }) => {
    await open(page, "s4-operator-log");
    const log = page.getByRole("list", { name: "Operator log" });
    const times = await log.locator("time").evaluateAll((els) => els.map((t) => ({ x: Math.round(t.getBoundingClientRect().x), at: Date.parse(t.getAttribute("datetime") ?? "") })));
    expect(times.length).toBeGreaterThan(5);
    expect(new Set(times.map((t) => t.x)).size, "the times are not in one column").toBe(1);
    for (let i = 1; i < times.length; i++) expect(times[i]?.at ?? 0).toBeLessThanOrEqual(times[i - 1]?.at ?? 0);
  });
});

test.describe("God mode", () => {
  test("organisations on one grid, figures aligned, and a top-up opening breaks no other card", async ({ page }) => {
    await open(page, "god-mode", undefined, "operator");
    const cards = page.getByRole("list", { name: "Organisations" }).locator(":scope > li");
    const n = await cards.count();
    expect(n).toBeGreaterThan(2);
    const offsets = new Set<string>();
    const heights: number[] = [];
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const box = await card.boundingBox();
      heights.push(box?.height ?? 0);
      const balance = await card.getByText("Balance", { exact: true }).boundingBox();
      offsets.add(`${Math.round(box?.x ?? 0)}:${Math.round((balance?.x ?? 0) - (box?.x ?? 0))}`);
      for (const value of await card.locator("dd.font-semibold").all()) expect((await value.boundingBox())?.height ?? 99, "a figure wraps").toBeLessThanOrEqual(26);
    }
    expect(offsets.size, "the cards' figures are not on one grid").toBe(1);
    await cards.nth(1).getByRole("button", { name: "Top up" }).click();
    for (let i = 0; i < n; i++) if (i !== 1) expect((await cards.nth(i).boundingBox())?.height).toBeCloseTo(heights[i] ?? 0, 0);
  });

  test("red is the band alone: the page beneath it is calm", async ({ page }) => {
    await open(page, "operator-no-organisation", undefined, "operator");
    const panel = page.getByRole("region", { name: "God mode" });
    await expect(panel).toBeVisible();
    const border = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
    const band = await page.locator("[data-god-mode]").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(border).not.toBe(band);
    await expect(panel.getByRole("region", { name: "Every organisation at a glance" })).toBeVisible();
  });
});
