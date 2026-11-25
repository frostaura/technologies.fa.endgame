import { defineConfig, devices } from "@playwright/test";

/**
 * The static demo (ARCH-009), built first with `npm run build:demo`, served from a plain static
 * server under the sub-path GitHub Pages uses, and also opened straight from the file. Run as
 * `CI=1 PW_PORT=<free port in 5500–5599> npx playwright test -c playwright.demo.config.ts`.
 */
const port = Number(process.env.PW_PORT ?? 5571);

export default defineConfig({
  testDir: "./tests-demo",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 240_000,
  webServer: {
    command: `node tests-demo/static-server.ts ${port} /technologies.fa.endgame/demo/`,
    url: `http://127.0.0.1:${port}/technologies.fa.endgame/demo/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: { actionTimeout: 15_000, baseURL: `http://127.0.0.1:${port}`, headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
