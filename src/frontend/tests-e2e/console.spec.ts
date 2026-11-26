import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, isPhone, mockRequests, useScenario } from "./support.ts";

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
    await expect(page.getByRole("region", { name: "Needs you" }).getByRole("link")).toHaveCount(4);
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

  test("the conversation survives a reload: earlier turns are read back, new ones appended once", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    const log = page.getByRole("log", { name: "Conversation with Northwind" });
    await expect(log.getByText("Is anything over budget?")).toBeVisible();
    await expect(log.getByText("Nothing is over budget. Booking desk is at 310 of its 500 credit cap.")).toBeVisible();

    await page.getByLabel("Message Northwind").fill("Anything to approve?");
    await page.getByRole("button", { name: "Send" }).click();
    const reply = "About “Anything to approve?”: one verdict is waiting and one approval.";
    await expect(log.getByText(reply)).toBeVisible();
    // The owner's own message is in the run's log too; it is drawn once, as theirs.
    await expect(log.getByText("Anything to approve?", { exact: true })).toHaveCount(1);

    await page.reload();
    await expect(log.getByText(reply)).toBeVisible();
    await expect(log.getByText("Anything to approve?", { exact: true })).toHaveCount(1);
    const texts = await log.locator("p").allTextContents();
    expect(texts.indexOf("Is anything over budget?")).toBeLessThan(texts.indexOf("Anything to approve?"));
    expect((await mockRequests()).some((r) => r.method === "GET" && r.path === "/api/conversations?scope=northwind")).toBe(true);
  });

  test("the header is at most two rows, and keeps the mode, the balance and sign-out", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    await expect(page.getByRole("heading", { name: "Booking desk", exact: true })).toBeVisible();
    const phone = isPhone(page);
    // The narrowest phone in common use as well as the project's own.
    for (const [mode, width] of phone ? ([["Normal", 0], ["Technical", 0], ["Normal", 375], ["Technical", 375]] as const) : ([["Normal", 0], ["Technical", 0]] as const)) {
      if (width) await page.setViewportSize({ width, height: 812 });
      await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: mode }).click();
      const banner = page.getByRole("banner");
      await expect(banner.getByRole("group", { name: "Mode" })).toBeVisible();
      await expect(banner.getByRole("link", { name: /credits left/ })).toBeVisible();
      await expect(banner.getByRole("button", { name: "Sign out" })).toBeVisible();
      // Rows of the header's flex line: a child starts a new row when it sits wholly below the last one.
      const rows = await banner.evaluate((el) => {
        const boxes = [...(el.firstElementChild as HTMLElement).children].map((c) => c.getBoundingClientRect()).filter((b) => b.height > 0).sort((a, b) => a.top - b.top);
        let count = 0;
        let bottom = -Infinity;
        for (const b of boxes) {
          if (b.top >= bottom - 1) count += 1;
          bottom = Math.max(b.top >= bottom - 1 ? b.bottom : bottom, b.bottom);
        }
        return count;
      });
      expect(rows, `${mode} mode${width ? ` at ${width}px` : ""}`).toBeLessThanOrEqual(phone ? 2 : 1);
      await expectNoSidewaysScroll(page);
    }
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Normal" }).click();
  });

  test("from phone to wide desktop the header keeps the mark clear, where you are on one line, and nothing crowded", async ({ page }) => {
    test.skip(isPhone(page), "widths are set here, from a phone up");
    await useScenario("populated");
    await page.goto("/apps/app1");
    await expect(page.getByRole("heading", { name: "Booking desk", exact: true })).toBeVisible();
    for (const width of [390, 600, 680, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const banner = page.getByRole("banner");
      await expect(banner.getByRole("navigation", { name: "Where you are" })).toBeVisible();
      const layout = await banner.evaluate((el) => {
        const box = (e: Element | null) => e?.getBoundingClientRect() ?? null;
        const shown = (r: DOMRect | null): r is DOMRect => !!r && r.width > 0 && r.height > 0;
        const meets = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const mark = box(el.querySelector('a[aria-label="Endgame home"]'));
        const nav = el.querySelector('nav[aria-label="Where you are"]');
        const crumbs = [...(nav?.querySelectorAll("li") ?? [])].filter((li) => shown(li.getBoundingClientRect()));
        const controls = [...el.querySelectorAll<HTMLElement>('[role="group"][aria-label="Mode"], a[href="/credits"], a[aria-label="Your account"], button')].filter((c) => !nav?.contains(c) && !c.closest('[role="group"]')?.isSameNode(c.parentElement) && shown(c.getBoundingClientRect()));
        const words = [...(nav?.querySelectorAll("a, button, span[aria-current]") ?? [])].filter((w) => shown(w.getBoundingClientRect()));
        return {
          oneLine: new Set(crumbs.map((li) => Math.round(li.getBoundingClientRect().top))).size === 1,
          markClear: !!mark && [nav?.getBoundingClientRect(), ...controls.map((c) => c.getBoundingClientRect())].every((r) => !r || !shown(r) || !meets(mark, r)),
          crowded: controls.flatMap((a, i) => controls.slice(i + 1).filter((b) => meets(a.getBoundingClientRect(), b.getBoundingClientRect())).map((b) => `${a.textContent} / ${b.textContent}`)),
          cut: words.filter((w) => w.scrollWidth > w.clientWidth + 1).map((w) => w.textContent),
        };
      });
      expect(layout.oneLine, `where you are is one line at ${width}px`).toBe(true);
      expect(layout.markClear, `the mark stands clear at ${width}px`).toBe(true);
      expect(layout.crowded, `no control overlaps another at ${width}px`).toEqual([]);
      // Off a phone there is room for every step of a short trail: none is cut short.
      if (width >= 640) expect(layout.cut, `no step is cut short at ${width}px`).toEqual([]);
      await expectNoSidewaysScroll(page);
    }
  });

  test("a failed read is shown as a failure, with a way to try again", async ({ page }) => {
    await useScenario("tree-fails");
    await page.goto("/");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The organisation could not be loaded");
    await expect(alert).toContainText("The database did not answer.");
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
    await expect(steps).not.toContainText("curl");
    await expect(steps).toContainText("Looked for existing products");
    await approval.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("link", { name: /The verdict is ready/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" }).click();
    await expect(steps).toContainText("Denied: run");
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
    await expect(page.getByRole("heading", { name: "Booking desk", exact: true })).toBeVisible();
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

  test("an app that has measured nothing yet says so, never zero", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("link", { name: "Tide board" }).click();
    await expect(page.getByRole("heading", { name: "Tide board", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Today" }).getByText("Not measured yet")).toHaveCount(2);
    await expect(page.getByText(/Not enough history yet to say what it costs a month/)).toHaveCount(2);
    await page.goto("/");
    await expect(page.getByRole("article", { name: "Recipes" }).getByText("Not measured yet")).toBeVisible();
  });

  test("making an app public waits for a person to confirm it", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    await page.getByRole("radio", { name: /Public/ }).click();
    const dialog = page.getByRole("alertdialog", { name: "Make Booking desk public?" });
    await expect(dialog).toBeVisible();
    expect((await mockRequests()).some((r) => r.path === "/api/apps/app1/settings")).toBe(false);
    await dialog.getByRole("button", { name: "Make it public" }).click();
    await expect(page.getByRole("radio", { name: /Public/ })).toBeChecked();
    expect((await mockRequests()).find((r) => r.path === "/api/apps/app1/settings")?.body).toEqual({ access: "public" });
  });

  test("a shared app lists its people, invites by e-mail with a code shown once, and stops sharing", async ({ page, context }) => {
    await useScenario("populated");
    await page.goto("/apps/app2");
    const sharing = page.getByRole("region", { name: "Sharing" });
    const people = sharing.getByRole("list", { name: "People it is shared with" });
    await expect(people.getByRole("listitem")).toHaveCount(2);
    await expect(people.getByText("Registered")).toBeVisible();

    await sharing.getByLabel("Invite by e-mail").fill("guest@example.test");
    await sharing.getByRole("button", { name: "Invite" }).click();
    const code = sharing.getByRole("status", { name: "Invitation code" });
    await expect(code.getByText("It will not be shown again.")).toBeVisible();
    const shown = (await code.locator("code").textContent()) ?? "";
    expect(shown).toMatch(/^[0-9a-f]{32}$/);
    await expect(people.getByRole("listitem")).toHaveCount(3);
    if (!isPhone(page)) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await code.getByRole("button", { name: "Copy the code" }).click();
      await expect(code.getByRole("button", { name: "Copied" })).toBeVisible();
    }

    // Once gone, it is gone: a reload does not bring the code back.
    await page.reload();
    await expect(people.getByText("guest@example.test")).toBeVisible();
    await expect(page.getByText(shown)).toHaveCount(0);

    await people.getByRole("button", { name: "Stop sharing with taster@example.test" }).click();
    await sharing.getByRole("group", { name: "Confirm stopping sharing with taster@example.test" }).getByRole("button", { name: "Stop sharing" }).click();
    await expect(people.getByRole("listitem")).toHaveCount(2);
    expect((await mockRequests()).some((r) => r.method === "DELETE" && r.path === "/api/apps/app2/shares?email=taster%40example.test")).toBe(true);
  });

  test("credits show the balance, the cascade of budgets, and a failed read as a failure", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("link", { name: /credits left/ }).click();
    await expect(page.getByRole("heading", { name: "9,548" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Budgets" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("Usually 12% under the estimate")).toBeVisible();

    await useScenario("credits-fail");
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Credits could not be loaded" })).toBeVisible();
    await expect(page.getByText("Balance unavailable")).toBeVisible();
  });
});

test.describe("secrets and operator access", () => {
  test("secrets are set, inherited, replaced and removed by name, and a value is never shown", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("region", { name: "Organisation chart" }).getByRole("button", { name: /Software/ }).first().click();
    await page.getByRole("navigation", { name: "Manage" }).getByRole("link", { name: "Secrets for Software" }).click();
    await expect(page.getByRole("heading", { name: "Secrets for Software" })).toBeVisible();
    const list = page.getByRole("list", { name: "Secrets" });
    const maps = list.getByRole("listitem").filter({ hasText: "MAPS_KEY" });
    await expect(maps.getByText("Set here")).toBeVisible();
    await expect(maps.getByText("Replaces the one set at Northwind.")).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "MAIL_API_KEY" }).getByText(/Inherited from/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Set beneath" }).getByText("PAYMENTS_KEY")).toBeVisible();

    const add = page.getByRole("region", { name: "Add a secret" });
    await add.getByLabel("Name").fill("weather api key");
    await expect(add.getByLabel("Name")).toHaveValue("WEATHER_API_KEY");
    await add.getByLabel("Value").fill("fixture-value-never-shown");
    await add.getByRole("button", { name: "Save the secret" }).click();
    await expect(add.getByText("WEATHER_API_KEY is saved. Its value is sealed and will not be shown.")).toBeVisible();
    await expect(add.getByLabel("Value")).toHaveValue("");
    await expect(list.getByText("WEATHER_API_KEY")).toBeVisible();
    await expect(page.getByText("fixture-value-never-shown")).toHaveCount(0);
    expect((await mockRequests()).find((r) => r.method === "PUT")?.body).toEqual({ scope: "northwind/software", name: "WEATHER_API_KEY", value: "fixture-value-never-shown" });

    await maps.getByRole("button", { name: "Remove" }).click();
    await maps.getByRole("group", { name: "Confirm removing MAPS_KEY" }).getByRole("button", { name: "Remove it" }).click();
    // The organisation's own MAPS_KEY applies again, inherited.
    await expect(list.getByRole("listitem").filter({ hasText: "MAPS_KEY" }).getByText(/Inherited from/)).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("a refused secret is taken back off the list, with the reason on the page", async ({ page }) => {
    await useScenario("secret-refused");
    await page.goto("/secrets?scope=northwind");
    const add = page.getByRole("region", { name: "Add a secret" });
    await add.getByLabel("Name").fill("NEW_KEY");
    await add.getByLabel("Value").fill("x");
    await add.getByRole("button", { name: "Save the secret" }).click();
    await expect(add.getByRole("alert")).toContainText("NEW_KEY was not saved: This needs the admin role");
    await expect(page.getByRole("list", { name: "Secrets" }).getByText("NEW_KEY")).toHaveCount(0);
  });

  test("the Owner reads every operator entry; anyone else is refused, shown as a failure", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("navigation", { name: "Manage" }).getByRole("link", { name: "Operator access" }).click();
    const log = page.getByRole("list", { name: "Operator log" });
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await expect(log.getByText("Added 10,000 credits")).toBeVisible();
    await expect(log.getByText("Entered the organisation")).toBeVisible();
    await expect(page.getByText("credits.top_up")).toHaveCount(0);

    await useScenario("not-owner");
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Manage" }).getByRole("link", { name: /Secrets for/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Operator access" })).toHaveCount(0);
    await page.goto("/operator-access");
    await expect(page.getByRole("alert").filter({ hasText: "Only the Owner can read the operator log" })).toBeVisible();
    await expect(page.getByText(/No one from FrostAura has entered/)).toHaveCount(0);
  });
});

test.describe("every screen, every width", () => {
  const screens: [string, Parameters<typeof useScenario>[0], string, string][] = [
    ["home", "populated", "/", "Talking to Northwind"],
    ["start", "populated", "/start", "What do you want to build?"],
    ["run", "populated", "/runs/run-done", "Research: Court ladder"],
    ["verdict", "populated", "/ideas/idea-ladder", "Do not build this as its own app."],
    ["app", "populated", "/apps/app1", "Booking desk"],
    ["shared app", "populated", "/apps/app2", "Recipe box"],
    ["unmeasured app", "populated", "/apps/app3", "Tide board"],
    ["secrets", "populated", "/secrets?scope=northwind%2Fsoftware%2Fbooking%2Fdesk", "Secrets for Booking desk"],
    ["operator access", "populated", "/operator-access", "Operator access"],
    ["credits", "populated", "/credits", "Budgets"],
    ["employee", "populated", "/employees/e1", "Talk to Ada"],
    ["hire proposal", "populated", "/hires/h1", "Noor, support writer"],
    ["hiring", "populated", "/hires?scope=northwind", "Hiring for Northwind"],
    ["autonomy", "populated", "/autonomy?scope=northwind%2Fsoftware", "How much Software does on its own"],
    ["sign-in", "signed-out", "/sign-in", "Sign in"],
  ];
  for (const [name, scenario, path, heading] of screens) {
    test(`${name} never scrolls sideways and every control is reachable`, async ({ page }) => {
      await useScenario(scenario);
      await page.goto(path);
      // Exact: an app page also heads its "Change {app}" panel and its conversation with the app's name.
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
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
