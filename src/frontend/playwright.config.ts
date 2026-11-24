import { defineConfig, devices } from "@playwright/test";

/**
 * Two ways to run, never mixed:
 *
 * - `PW_BASE_URL` set (e.g. http://localhost:8095, the edge of `make up`): only `smoke.spec.ts`
 *   runs, against REAL health through the edge. No server is started here.
 * - Otherwise the console flows run against `tests-e2e/mock-api/` — a TEST-ONLY stand-in for the
 *   control plane on `PW_PORT + 1` — with a Vite dev server on `PW_PORT` proxying /api to it.
 *   Run as `CI=1 PW_PORT=<free port> npm run test:e2e`. Choose a free PW_PORT: with
 *   reuseExistingServer on outside CI, a busy port silently reuses whatever is listening there.
 */
const isCI = !!process.env.CI;
const externalBaseUrl = process.env.PW_BASE_URL;
const port = Number(process.env.PW_PORT ?? 5465);
const mockPort = port + 1;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests-e2e",
  ...(externalBaseUrl ? { testMatch: "smoke.spec.ts" } : { testIgnore: "smoke.spec.ts" }),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: isCI,
  reporter: [["list"]],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: [
          {
            command: `node tests-e2e/mock-api/server.ts ${mockPort}`,
            url: `http://127.0.0.1:${mockPort}/__mock/requests`,
            reuseExistingServer: !isCI,
            timeout: 30_000,
          },
          {
            command: `npm run dev -- --port ${port} --strictPort`,
            url: baseURL,
            env: { VITE_API_TARGET: `http://127.0.0.1:${mockPort}` },
            reuseExistingServer: !isCI,
            timeout: 120_000,
          },
        ],
      }),
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  metadata: { mockApi: externalBaseUrl ? null : `http://127.0.0.1:${mockPort}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
