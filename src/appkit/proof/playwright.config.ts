import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the template's real container image in a real browser, through the dev edge, at both
 * address shapes. run.sh starts everything and passes the ports; this config starts nothing.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
