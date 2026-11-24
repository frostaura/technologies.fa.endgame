import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, mockRequests, useScenario } from "./support.ts";

/**
 * The console's main flows, end to end in a real browser, against the TEST-ONLY mock control
 * plane (tests-e2e/mock-api). Every figure on screen comes from that mock's fixtures.
 */

test.describe("signing in", () => {
  test("development sign-in is offered only when advertised, and lands on the org chart", async ({ page }) => {
    await useScenario("signed-out");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Development sign-in" })).toHaveCount(0);

    await useScenario("signed-out-dev");
    await page.reload();
    await page.getByRole("button", { name: "Development sign-in" }).click();
    await expect(page.getByRole("region", { name: "Organisation", exact: true }).getByRole("heading", { name: "Northwind" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a passkey is created and signs the owner in", async ({ page, context, baseURL }) => {
    await useScenario("signed-out");
    // WebAuthn will not run on an IP address; localhost is a secure context it accepts.
    const local = (baseURL ?? "").replace("127.0.0.1", "localhost");
    await page.goto(`${local}/sign-in`);
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.getByRole("button", { name: "First time here? Create your passkey" }).click();
    await page.getByLabel("Your name").fill("Fixture Owner");
    await page.getByLabel("Email address").fill("owner@example.test");
    await page.getByRole("button", { name: "Create passkey" }).click();
    await expect(page.getByRole("region", { name: "Organisation", exact: true })).toBeVisible();
    const complete = (await mockRequests()).find((r) => r.path === "/api/auth/passkey/register/complete");
    const credential = (complete?.body as { credential: { response: { attestationObject: string } } }).credential;
    expect(credential.response.attestationObject).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

test.describe("home — the living org chart", () => {
  test("shows the tree from the API, and selection scopes the breadcrumb and the conversation", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    const chart = page.getByRole("region", { name: "Organisation chart" });
    await expect(chart.getByRole("article", { name: "Booking" }).getByText("Always on")).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs you" }).getByRole("link")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Talking to Northwind" })).toBeVisible();

    await chart.getByRole("button", { name: /Research/ }).first().click();
    await expect(page.getByRole("navigation", { name: "Where you are" })).toHaveText("Northwind/Research");
    await expect(page.getByRole("heading", { name: "Talking to Research" })).toBeVisible();

    await page.getByLabel("Message Research").fill("What needs me today?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("About “What needs me today?”: one verdict is waiting and one approval.")).toBeVisible();
    const sent = (await mockRequests()).find((r) => r.path === "/api/conversations");
    expect(sent?.body).toEqual({ scope: "northwind/research", message: "What needs me today?" });

    await chart.getByRole("button", { name: /Ada · Product researcher/ }).click();
    await expect(page.getByRole("heading", { name: "Talking to Ada" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("a failed read is shown as a failure, with a way to try again", async ({ page }) => {
    await useScenario("tree-fails");
    await page.goto("/");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The organisation could not be loaded");
    await expect(alert).toContainText("The database did not answer. (500)");
    await expect(page.getByRole("region", { name: "Organisation chart" })).toHaveCount(0);
    await useScenario("populated");
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("region", { name: "Organisation chart" })).toBeVisible();
  });

  test("an empty organisation says so and leads to a first idea", async ({ page }) => {
    await useScenario("empty-org");
    await page.goto("/");
    await expect(page.getByText("Northwind has nothing in it yet")).toBeVisible();
    await page.getByRole("link", { name: "Describe your first idea" }).click();
    await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible();
  });
});

test.describe("from idea to verdict", () => {
  test("first run: name the organisation, see the estimate, research, watch it live, read the verdict, overrule", async ({ page }) => {
    await useScenario("first-run");
    await page.goto("/");
    await page.getByRole("link", { name: "Start" }).click();
    await page.getByLabel("Your organisation").fill("Harbour Lights");
    await expect(page.getByText(/Its apps appear at .*\/harbour-lights\./)).toBeVisible();
    const research = page.getByRole("button", { name: "Research this idea" });
    await expect(research).toBeDisabled();
    await page.getByLabel("The idea").fill("A tide table for our harbour that warns members before the slipway floods.");
    await page.getByRole("button", { name: "Works on a phone" }).click();
    await expect(page.getByRole("region", { name: "Research estimate" })).toContainText(/Estimated \d+ credits/);
    await research.click();

    await expect(page).toHaveURL(/\/runs\//);
    await expect(page.getByRole("list", { name: "Steps" })).toContainText("Estimated the cost");
    await expect(page.getByRole("link", { name: /The verdict is ready/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("list", { name: "Tasks" }).getByText("Done")).toHaveCount(2);
    await page.getByRole("link", { name: /The verdict is ready/ }).click();

    await expect(page.getByText("Verdict · do not build")).toBeVisible();
    await page.getByRole("button", { name: "Overrule and build anyway" }).click();
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Yes" }).click();
    await expect(page).toHaveURL(/\/runs\/run-build-/);
    const decision = (await mockRequests()).find((r) => r.path.endsWith("/decision"));
    expect(decision?.body).toEqual({ choice: "overrule" });
    const created = (await mockRequests()).find((r) => r.path === "/api/ideas" && r.method === "POST");
    expect(created?.body).toEqual({ text: "A tide table for our harbour that warns members before the slipway floods.", constraints: ["Works on a phone"] });
  });

  test("an approval is answered inline and the run carries on; technical mode shows the raw trace", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/runs/run-research");
    const approval = page.getByRole("region", { name: "Waiting for your approval" });
    await expect(approval).toContainText("Spend 20 more credits on a wider demand sweep?", { timeout: 15_000 });
    const steps = page.getByRole("list", { name: "Steps" });
    await expect(steps).toContainText("An action was refused by your rules");
    await expect(steps).not.toContainText("shell.exec");
    await approval.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("link", { name: /The verdict is ready/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" }).click();
    await expect(steps).toContainText("Denied: shell.exec");
    await expect(steps).toContainText("Rule: protected floor: no shell in research");
    await expect(steps).toContainText("Model replied: fixture/model-small");
    await page.reload();
    await expect(page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: "System" })).toBeVisible();
  });

  test("a run is paused and resumed from the trace", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/runs/run-build");
    await expect(page.getByRole("list", { name: "Steps" })).toContainText("The notes list works; sign-in next.");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    const calls = (await mockRequests()).map((r) => r.path);
    expect(calls).toContain("/api/runs/run-build/pause");
    expect(calls).toContain("/api/runs/run-build/resume");
  });
});

test.describe("app and credits", () => {
  test("the app shows both addresses and telemetry, and its running setting changes", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("link", { name: "Booking desk" }).click();
    await expect(page.getByRole("heading", { name: "Booking desk" })).toBeVisible();
    await expect(page.getByText("https://northwind.example.test/booking · also at https://endgame.example.test/northwind/software/booking")).toBeVisible();
    await expect(page.getByText("Slowest 1 in 20: 540 ms")).toBeVisible();
    await page.getByRole("radio", { name: /Sleeps when unused/ }).check();
    await expect(page.getByRole("radio", { name: /Sleeps when unused/ })).toBeChecked();
    const saved = (await mockRequests()).find((r) => r.path === "/api/apps/app1/settings");
    expect(saved?.body).toEqual({ running: "sleep" });
  });

  test("a refused setting is rolled back and the reason stays on the page", async ({ page }) => {
    await useScenario("settings-fail");
    await page.goto("/apps/app1");
    await page.getByRole("radio", { name: /Shared/ }).click();
    await expect(page.getByText(/The change was not saved: Only an Admin can change this/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Private/ })).toBeChecked();
  });

  test("credits show the balance, the cascade of budgets, and a failed read as a failure", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("link", { name: /credits left/ }).click();
    await expect(page.getByRole("heading", { name: "9,548" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Budgets" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("Within 8%")).toBeVisible();

    await useScenario("credits-fail");
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Credits could not be loaded" })).toBeVisible();
    await expect(page.getByText("Balance unavailable")).toBeVisible();
  });
});

test.describe("every screen, every width", () => {
  const screens: [string, Parameters<typeof useScenario>[0], string, string][] = [
    ["home", "populated", "/", "Talking to Northwind"],
    ["start", "populated", "/start", "What do you want to build?"],
    ["run", "populated", "/runs/run-done", "Research: Court ladder"],
    ["verdict", "populated", "/ideas/idea-ladder", "Do not build this as its own app."],
    ["app", "populated", "/apps/app1", "Booking desk"],
    ["credits", "populated", "/credits", "Budgets"],
    ["sign-in", "signed-out", "/sign-in", "Sign in"],
  ];
  for (const [name, scenario, path, heading] of screens) {
    test(`${name} never scrolls sideways and every control is reachable`, async ({ page }) => {
      await useScenario(scenario);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoSidewaysScroll(page);
      // Every button and link has a name a screen reader can read out.
      const unnamed = await page.locator("button, a[href]").evaluateAll((els) => els.filter((el) => !(el.textContent ?? "").trim() && !el.getAttribute("aria-label")).length);
      expect(unnamed).toBe(0);
    });
  }

  test("under reduced motion nothing animates", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await useScenario("populated");
    await page.goto(test.info().project.use.baseURL ?? "/");
    await expect(page.getByRole("region", { name: "Organisation chart" })).toBeVisible();
    const animated = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    expect(animated).toBe(0);
    await context.close();
  });
});
