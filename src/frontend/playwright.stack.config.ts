import { defineConfig, devices } from "@playwright/test";

/**
 * The merged stack's acceptance test (`make e2e-stack`): one serial story against a REAL running
 * stack — its real Edge, control plane, Dock, database, egress proxy and mail catcher — with no mocks.
 * It starts nothing itself; the Makefile brings the stack up (docker-compose.e2e.yml) and passes:
 *   STACK_EDGE           the edge, e.g. http://localhost:18095 (organisation subdomains: <org>.localhost)
 *   STACK_DOCK           Dock's internal API on loopback (docker-compose.e2e.yml), behind the service token
 *   STACK_SERVICE_TOKEN  that token — the test stack's own, never a real one
 *   STACK_MAIL           the mail catcher's API
 *   STACK_STATE          a scratch directory: the app ids it made (for teardown) and the proof's addresses
 */
export default defineConfig({
  testDir: "./tests-stack",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  // Building the app from the template on a cold cache is the long pole (ARCH-005: minutes).
  timeout: 25 * 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.STACK_EDGE,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  outputDir: "test-results/stack",
});
