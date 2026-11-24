/** TEST ONLY. Controls for the mock control plane the console specs run against. */
import { expect, type Page } from "@playwright/test";
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
