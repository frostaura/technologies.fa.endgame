/** TEST ONLY. Controls for the mock control plane the console specs run against. */
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import type { ScenarioName } from "./mock-api/fixtures.ts";

const mock = `http://127.0.0.1:${Number(process.env.PW_PORT ?? 5465) + 1}`;

export async function useScenario(name: ScenarioName) {
  const res = await fetch(`${mock}/__mock/scenario`, { method: "POST", body: JSON.stringify({ name }) });
  expect(res.status).toBe(204);
}

export async function mockRequests(): Promise<{ method: string; path: string; body: unknown }[]> {
  return (await (await fetch(`${mock}/__mock/requests`)).json()) as { method: string; path: string; body: unknown }[];
}

export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/**
 * The console specs, with one difference on a phone: the page is read as a person reading it all
 * would — every section a phone folds away (`[data-fold]`, a division on the chart) is opened as it
 * appears, so a spec written for the whole page reads the same words at 412 px. What folds, and
 * that it opens, is the phone's own suite (`tests-demo/phone.spec.ts`, `components/phone.test.tsx`).
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    if ((page.viewportSize()?.width ?? 1440) < 640) {
      await page.addInitScript(() => {
        const open = () => {
          for (const b of document.querySelectorAll<HTMLButtonElement>('[data-fold] > button[aria-expanded="false"], button[aria-expanded="false"][aria-label^="Show what is in"]')) {
            if (b.dataset.opened) continue;
            b.dataset.opened = "1";
            b.click();
          }
        };
        new MutationObserver(open).observe(document, { childList: true, subtree: true });
      });
    }
    await provide(page);
  },
});

/** The console's phone layout (SHL-07): under 640 px wide. */
export function isPhoneLayout(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 640;
}

/** "Needs you": on a phone one row that opens the list as a sheet; the list it opens, or the strip. */
export async function needsYou(page: Page): Promise<Locator> {
  if (!isPhoneLayout(page)) return page.getByRole("region", { name: "Needs you" });
  const sheet = page.getByRole("dialog", { name: "Needs you" });
  if (!(await sheet.isVisible())) await page.locator("[data-needs-summary]").click();
  return sheet;
}

/** The mode toggle: in the header, or on a phone under More. */
export async function setMode(page: Page, mode: "Normal" | "Technical") {
  if (!isPhoneLayout(page)) {
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode }).click();
    return;
  }
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^More/ }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("group", { name: "Mode" }).getByRole("button", { name: mode }).click();
  await page.keyboard.press("Escape");
}

/** The balance, which opens Credits: the header's pill, or on a phone the bottom bar's figure. */
export function balanceLink(page: Page): Locator {
  return isPhoneLayout(page) ? page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Credits: / }) : page.getByRole("link", { name: /credits left/ });
}

/** The conversation: beside the page, or on a phone in the sheet the bottom bar's Talk opens. */
export async function conversation(page: Page): Promise<Locator> {
  if (!isPhoneLayout(page)) return page.locator("body");
  const sheet = page.locator('[data-testid="talk-sheet"]').getByRole("dialog");
  if (!(await sheet.isVisible())) await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Talk/ }).click();
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Closes whatever sheet is open on a phone. */
export async function closeSheet(page: Page) {
  if (isPhoneLayout(page)) await page.keyboard.press("Escape");
}
