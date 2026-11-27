import { expect, test, type Page } from "@playwright/test";

/**
 * The people pages' layout, in the built demo (ARCH-011): an employee's record, a hire proposal and
 * its edit form, hiring, People and your account, held to what the visual reviews asked of them.
 * Long real data never breaks a page (sixty memories and forty pieces of work stay a few screens),
 * siblings sit side by side with their tops aligned, columns read down, and on a phone nothing
 * scrolls sideways and every choice is a thumb's height.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";

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

const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function top(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox())?.y ?? -1;
}

test.describe("the people pages on a wide desktop", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("a long record stays a few screens: ten memories and ten pieces of work, the work and the memory side by side", async ({ page }) => {
    const problems = await open(page, "s4-employee-long-record");
    await expect(page.getByRole("heading", { level: 1, name: "Kasper" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Memory entries" }).getByRole("listitem")).toHaveCount(10);
    await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Show all 40 pieces of work" })).toBeVisible();
    // Was 16,162 px on the real stack with ~60 memory cards (real-stack 50).
    expect(await height(page)).toBeLessThan(3200);
    expect(Math.abs((await top(page, "section[aria-labelledby='work-title']")) - (await top(page, "section[aria-label='Memory']")))).toBeLessThanOrEqual(2);
    // The side panel's cards end with their content.
    const job = await page.locator("section[aria-labelledby='job-title']").boundingBox();
    expect(job?.height ?? 0).toBeLessThan(700);
    // The actions are one row, and opening one never moves it.
    const group = page.getByRole("group", { name: "Actions" });
    const place = () => group.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const before = await place();
    await group.getByRole("button", { name: "Edit the job" }).click();
    await expect(page.getByRole("form", { name: "Edit Kasper's job" })).toBeVisible();
    // Within a pixel: the row sits on a half-pixel at some widths, and rounding may fall either way.
    const after = await place();
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(after[k] - before[k]), k).toBeLessThanOrEqual(1);
    expect(before.h).toBeLessThanOrEqual(48);
    expect(problems).toEqual([]);
  });

  test("hiring: every proposal a row with its state at the same place, no orphan card, no repeated pill", async ({ page }) => {
    await open(page, "s4-hiring");
    // The one table: every proposal's state in the same column.
    const tags = page.locator("[data-table] .tbl-row > [data-kind='status']");
    await expect(tags).toHaveCount(3);
    const rights = await tags.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(rights).size).toBe(1);
    // A waiting proposal says whether it fits the budget, not "Waiting for you" again under that heading (real-stack 47).
    const waiting = page.getByRole("region", { name: "Waiting for you" });
    await expect(waiting.getByText("Waiting for you", { exact: true })).toHaveCount(0);
    await expect(waiting.getByText("More than the budget has room for")).toBeVisible();
    // The recurring role is a row of its card, never a card inside a card.
    const recurring = page.getByRole("list", { name: "Recurring roles" }).locator("li").first();
    expect(await recurring.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("0px");
  });

  test("a hire proposal: the decision beside the proposal, in the side card under its cost, never floating under the job", async ({ page }) => {
    const problems = await open(page, "hire-pending");
    const card = page.getByTestId("hire-decision");
    const hire = card.getByRole("button", { name: "Hire Lark" });
    await expect(hire).toBeVisible();
    const jd = await page.locator("section[aria-labelledby='jd-title']").boundingBox();
    const box = await hire.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThan((jd?.x ?? 0) + (jd?.width ?? 0));
    // Every side card is named.
    await expect(page.getByRole("heading", { name: "If it has nothing to do" })).toBeVisible();
    await hire.click();
    await expect(card.getByText("Hire Lark at about 300 credits a month?")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("an employee: the work beside the memory, the memory's upkeep under the work, no column ending on empty space", async ({ page }) => {
    await open(page, "s4-employee-record");
    const work = await page.locator("section[aria-labelledby='work-title']").boundingBox();
    const upkeep = await page.locator("section[aria-labelledby='upkeep-title']").boundingBox();
    const memory = await page.locator("section[aria-label='Memory']").boundingBox();
    expect(Math.abs((upkeep?.x ?? 0) - (work?.x ?? 99))).toBeLessThanOrEqual(1);
    const left = (upkeep?.y ?? 0) + (upkeep?.height ?? 0);
    const right = (memory?.y ?? 0) + (memory?.height ?? 0);
    expect(Math.abs(left - right)).toBeLessThan(400);
    // The last piece of work is linked from who it is, not floating over the table.
    await expect(page.locator("header").getByRole("link", { name: "Its last piece of work" })).toBeVisible();
    await expect(page.locator("section[aria-labelledby='work-title']").getByRole("link", { name: "Its last piece of work" })).toHaveCount(0);
    // "Let go" is a live red-edged control, not a greyed one.
    const letGo = page.getByRole("group", { name: "Actions" }).getByRole("button", { name: "Let go" });
    await expect(letGo).toBeEnabled();
    // No caption cut short on the track record.
    for (const caption of await page.locator("section[aria-label='Track record'] span.truncate").all()) expect(await caption.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test("People: a table whose headings sit over their columns, dates on one line", async ({ page }) => {
    await open(page, "default", "/people?scope=northwind");
    const list = page.getByRole("list", { name: "People" });
    await expect(list.locator("li[data-member]")).toHaveCount(6);
    const heading = await page.getByText("Where it was set", { exact: true }).first().boundingBox();
    const cell = await list.locator("li[data-member='ada@northwind.example']").getByText("Set here", { exact: true }).boundingBox();
    expect(Math.abs((heading?.x ?? 0) - (cell?.x ?? 99))).toBeLessThanOrEqual(1);
    for (const since of await list.getByText(/^Since /).all()) expect((await since.boundingBox())?.height ?? 99).toBeLessThan(26);
    const roles = await list.locator("li[data-member] select, li[data-member] span.min-h-touch").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(roles).size).toBe(1);
    // A role that is not changed here starts its word where a field's word starts (console-desktop 44).
    const words = await list.locator("li[data-member] select, li[data-member] span.min-h-touch").evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().left + parseFloat(getComputedStyle(e).paddingLeft) + parseFloat(getComputedStyle(e).borderLeftWidth))),
    );
    expect(new Set(words).size).toBe(1);
  });

  test("your account uses the width: each part a row, its words beside it, nothing stranded", async ({ page }) => {
    await open(page, "account");
    const main = await page.locator("main").boundingBox();
    for (const id of ["passkeys-title", "roles-title"]) {
      const section = await page.locator(`section[aria-labelledby='${id}']`).boundingBox();
      // Each part runs the page's width (console-desktop 45): no two unequal cards side by side.
      expect(section?.width ?? 0).toBeGreaterThan((main?.width ?? 0) * 0.85);
    }
    // Its words and the part itself share a row: the card's top within a line of the heading's.
    const heading = await page.locator("#passkeys-title").boundingBox();
    const button = await page.getByRole("button", { name: "Add another passkey" }).boundingBox();
    expect(button?.x ?? 0).toBeGreaterThan((heading?.x ?? 0) + 400);
  });
});

test.describe("the people pages on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test("an employee: the first action and More side by side, the rest a menu of thumb-sized rows, nothing sideways", async ({ page }) => {
    await open(page, "s4-employee-long-record");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const group = page.getByRole("group", { name: "Actions" });
    const edit = await group.getByRole("button", { name: "Edit the job" }).boundingBox();
    const more = await group.getByRole("button", { name: "More" }).boundingBox();
    expect(Math.abs((edit?.y ?? 0) - (more?.y ?? 99))).toBeLessThanOrEqual(1);
    await expect(group.getByRole("button", { name: "Let go" })).toBeHidden();
    await group.getByRole("button", { name: "More" }).click();
    for (const name of ["Reassign", "Change budget", "Pause", "Let go"]) {
      const box = await group.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThan(300);
    }
    await group.getByRole("button", { name: "Let go" }).click();
    await expect(page.getByRole("group", { name: "Confirm letting go" })).toBeVisible();
    expect(await height(page)).toBeLessThan(3200);
  });

  test("editing a proposal: every choice a thumb's height, the mandate shows whole lines", async ({ page }) => {
    await open(page, "hire-pending");
    await page.getByRole("button", { name: "Edit the proposal" }).click();
    const form = page.getByRole("form", { name: "Edit the proposal" });
    for (const row of await form.locator("label:has(input[type=checkbox])").all()) expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const mandate = form.getByLabel("Mandate");
    const fits = await mandate.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits, "the mandate cuts a line").toBe(true);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test("People and hiring fit a phone", async ({ page }) => {
    await open(page, "default", "/people?scope=northwind");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await open(page, "s4-hiring");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("the people pages on a portrait tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test("on a portrait tablet, what each role may do is the page's width, two across", async ({ page }) => {
    await open(page, "default", "/people?scope=northwind");
    const terms = await page.locator("section[aria-labelledby='roles-title'] dt").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(terms).size).toBe(2);
  });
});
