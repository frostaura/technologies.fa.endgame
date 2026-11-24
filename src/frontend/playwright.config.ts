import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke runs against REAL health — never mocked.
 *
 * - `PW_BASE_URL` set (e.g. http://localhost:8095, the edge of `make up`): the bundle the stack
 *   serves is tested, through the edge, and no server is started here.
 * - Otherwise a Vite dev server is started on `PW_PORT`, proxying /api to the edge of a running
 *   stack (`VITE_API_TARGET`, default http://127.0.0.1:8095). Choose a free PW_PORT: with
 *   reuseExistingServer on, a busy port silently reuses whatever is listening there.
 */
const isCI = !!process.env.CI;
const externalBaseUrl = process.env.PW_BASE_URL;
const port = Number(process.env.PW_PORT ?? 5465);
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: isCI,
  reporter: [["list"]],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `npm run dev -- --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      }),
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
