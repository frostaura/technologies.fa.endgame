import { expect, test, type Page } from "@playwright/test";

/**
 * `make e2e`: the console against the REAL stack of `make up`, through the edge. The stack's control
 * plane offers the development sign-in (docker-compose.yml's default); system status is technical
 * detail, so it is opened in technical mode.
 */
const SERVICES = ["Control plane", "Edge", "Runner", "Dock", "Database", "Console"];

async function signInAndOpenSystemStatus(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Development sign-in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto("/system");
  await page.getByRole("button", { name: "Switch to technical mode" }).click();
}

test("the console shows every service healthy, live from the control plane", async ({ page }) => {
  const statusResponse = page.waitForResponse((r) => r.url().endsWith("/api/system/status"));
  await signInAndOpenSystemStatus(page);
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
  await signInAndOpenSystemStatus(page);
  await expect(page.getByText("All services healthy")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
