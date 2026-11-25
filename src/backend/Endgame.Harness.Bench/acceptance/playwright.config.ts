import { defineConfig, devices } from "@playwright/test";

/**
 * The acceptance tests (`make e2e-acceptance`, TEST-201, the build plan's Phase 6): one serial story against a REAL stack
 * with LIVE models. It spends real money; the Makefile passes ACC_EDGE (the stack's edge),
 * ACC_STATE (a scratch directory for the run's report and screenshots) and ACC_SPEND_STOP_USD.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "acceptance.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Two factory runs (a larger app, then a small one) with research, evaluation, review and publishing, on live models.
  timeout: 240 * 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.ACC_EDGE,
    headless: true,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // A control that is not there fails in seconds, never at the test's own two-and-a-half hours.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  outputDir: (process.env.ACC_STATE ?? "../../../../.tmp/e2e-acceptance") + "/test-results",
});
