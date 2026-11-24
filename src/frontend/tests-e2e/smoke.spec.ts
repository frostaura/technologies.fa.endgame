import { expect, test } from "@playwright/test";

const SERVICES = ["Control plane", "Edge", "Runner", "Dock", "Database", "Console"];

test("the console shows every service healthy, live from the control plane", async ({ page }) => {
  const statusResponse = page.waitForResponse((r) => r.url().endsWith("/api/system/status"));
  await page.goto("/");

  await expect(page.getByRole("banner").getByText("Endgame", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();

  const response = await statusResponse;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { overall: string; services: { name: string; state: string }[] };
  expect(body.services.map((s) => s.name)).toEqual(SERVICES);

  await expect(page.getByText("All services healthy")).toBeVisible();
  const list = page.getByRole("list", { name: "Services" });
  for (const name of SERVICES) {
    const card = list.getByRole("listitem").filter({ hasText: name });
    await expect(card.getByText("Healthy", { exact: true })).toBeVisible();
  }
});

test("the page never scrolls sideways", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("All services healthy")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
