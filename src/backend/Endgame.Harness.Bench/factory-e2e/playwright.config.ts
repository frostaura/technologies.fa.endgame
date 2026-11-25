import { defineConfig, devices } from "@playwright/test";

/**
 * The factory's proof (`make e2e-factory`, TEST-201): one serial story against a REAL running stack
 * with LIVE models. It spends real money; the Makefile passes FAC_EDGE (the stack's edge),
 * FAC_STATE (a scratch directory for the run's report and screenshots) and FAC_SPEND_STOP_USD.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "factory.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Research, then a multi-feature build with evaluation, review and publishing, on live models.
  timeout: 150 * 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.FAC_EDGE,
    headless: true,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // A control that is not there fails in seconds, never at the test's own two-and-a-half hours.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  outputDir: (process.env.FAC_STATE ?? "../../../../.tmp/e2e-factory") + "/test-results",
});
