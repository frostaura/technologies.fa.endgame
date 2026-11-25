import { defineConfig } from "@playwright/test";

/**
 * The academy's browser test: the ASSEMBLED site (`make site`), served from a static server under
 * /technologies.fa.endgame/ exactly as GitHub Pages serves it. Run as
 * `CI=1 PW_PORT=<free port above 5600> npm run test:e2e`. The demo frame is answered by the
 * bridge's test double (`test-double/demo/`), routed in by the spec, so op order is deterministic.
 */
const port = Number(process.env.PW_PORT ?? 5647);
export const BASE_PATH = "/technologies.fa.endgame/";
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: isCI,
  reporter: [["list"]],
  webServer: {
    command: `node tools/serve.ts ../../site ${port} --base ${BASE_PATH}`,
    url: `http://127.0.0.1:${port}${BASE_PATH}`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}${BASE_PATH}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
