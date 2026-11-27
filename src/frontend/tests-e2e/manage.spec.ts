import { expect } from "@playwright/test";
import { expectNoSidewaysScroll, isPhone, isPhoneLayout, mockRequests, useScenario, test } from "./support.ts";

/**
 * Managing the organisation, caps and limits, the app page by role, starting an idea where it
 * belongs, the whole job of an employee, and your account — end to end in a real browser against the
 * TEST-ONLY mock control plane (tests-e2e/mock-api), on desktop and phone.
 */

const mock = `http://127.0.0.1:${Number(process.env.PW_PORT ?? 5465) + 1}`;
async function manage(body: Record<string, unknown>) {
  expect((await fetch(`${mock}/__mock/manage`, { method: "POST", body: JSON.stringify(body) })).status).toBe(204);
}

test.describe("managing the tree", () => {
  test("an Admin adds a division from the chart, names it, says what it is, and archives it", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("link", { name: "Add a division" }).click();
    await expect(page).toHaveURL(/\/tree\?scope=northwind&add=1/);
    const form = page.getByRole("form", { name: "Add a division to Northwind" });
    await form.getByLabel("Name").fill("Field Operations");
    await expect(form.getByLabel("Its address")).toHaveValue("field-operations");
    await form.getByLabel("Its address").fill("field-ops");
    await form.getByRole("button", { name: "Add the division" }).click();
    await expect(page).toHaveURL(/scope=northwind%2Ffield-ops/);
    const outline = page.getByRole("navigation", { name: "Every part of the organisation" });
    // A phone takes Manage in two steps (SHL-07): the part chosen, and the outline one step back.
    if (isPhoneLayout(page)) await page.getByRole("link", { name: "Every part of the organisation" }).click();
    await expect(outline.getByRole("button", { name: "Field Operations" })).toBeVisible();
    if (isPhoneLayout(page)) await outline.getByRole("button", { name: "Field Operations" }).click();

    // What it is: inherited from the organisation, then said here.
    const what = page.getByRole("list", { name: "What Field Operations is" });
    await expect(what.getByText("From Northwind")).toBeVisible();
    await page.getByRole("button", { name: "Say something about Field Operations" }).click();
    await page.getByLabel("What it is about").fill("Purpose");
    await page.getByLabel("What it says").fill("Runs the courts day to day.");
    await page.getByRole("button", { name: "Add it" }).click();
    await expect(what.getByText("Runs the courts day to day.")).toBeVisible();
    await expect(what.getByText("Said here")).toBeVisible();
    expect((await mockRequests()).find((r) => r.method === "PUT" && r.path === "/api/cascade")?.body).toEqual({ scope: "northwind/field-ops", kind: "context", key: "purpose", value: "Runs the courts day to day." });

    await page.getByRole("button", { name: "Archive Field Operations" }).click();
    await page.getByRole("button", { name: "Yes, archive Field Operations" }).click();
    await expect(page.getByText("Field Operations is archived. Nothing in it was deleted.")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Manage Field Operations" })).toBeVisible();
    await expect(page.locator("[data-archived]").getByText("Archived")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("renames a project, and a division with history is archived instead of deleted", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/tree?scope=northwind/software/booking");
    await expect(page.getByText("Its address stays booking: an address never changes once it is made.")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill("Court booking");
    await page.getByRole("button", { name: "Save the name" }).click();
    await expect(page.getByText("It is called Court booking now.")).toBeVisible();
    if (isPhoneLayout(page)) await page.getByRole("link", { name: "Every part of the organisation" }).click();
    await expect(page.getByRole("navigation", { name: "Every part of the organisation" }).getByRole("button", { name: "Court booking" })).toBeVisible();

    await page.goto("/tree?scope=northwind/research");
    await page.getByRole("button", { name: "Delete Research" }).click();
    await page.getByRole("button", { name: "Yes, delete Research" }).click();
    await expect(page.getByRole("alert")).toContainText("It still has things beneath it, work or credit history");
    await page.getByRole("button", { name: "Archive it instead" }).click();
    await expect(page.getByText("Research is archived instead. Nothing in it was deleted.")).toBeVisible();
  });

  test("a Viewer reads the tree and is told who may change it", async ({ page }) => {
    await useScenario("viewer");
    await page.goto("/tree?scope=northwind");
    await expect(page.getByText("The Owner renames the organisation.")).toBeVisible();
    await expect(page.getByText("An Admin or above adds a division here.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save the name" })).toHaveCount(0);
    await expect(page.getByText("A Builder or above changes what is said here.")).toBeVisible();
    if (isPhone(page)) await expectNoSidewaysScroll(page);
  });
});

test.describe("caps and limits on Credits", () => {
  test("an Owner sets and removes a cap, and removes their own overdraft limit", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/credits");
    const budgets = page.getByRole("list", { name: "Budgets" });
    await expect(budgets.getByText("No cap here; the cap on Northwind, 2,000 credits, holds")).toBeVisible();
    await budgets.getByRole("button", { name: "Set a cap on Research" }).click();
    await budgets.getByLabel("Credits a month").fill("400");
    await budgets.getByRole("button", { name: "Save the cap" }).click();
    await expect(budgets.getByText("Research may spend 400 credits a month.")).toBeVisible();
    await expect(budgets.getByText("142 of 400")).toBeVisible();
    await budgets.getByRole("button", { name: "Remove the cap on Software" }).click();
    await expect(budgets.getByText("Software has no cap of its own now; the cap on Northwind, 2,000 credits a month, holds it.")).toBeVisible();

    await page.getByRole("button", { name: "Remove your own limit" }).click();
    await expect(page.getByText("Your own limit is removed. The most FrostAura allows, 3,000 below zero, applies now.")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test.describe("the app page", () => {
  test("an Owner sets the app's own AI allowance and its idle minutes", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    const spend = page.getByRole("region", { name: "What it may spend" });
    await expect(spend.getByText("500 credits a month, set on Booking desk")).toBeVisible();
    await expect(page.getByText("Own cap: 500")).toBeVisible();
    await spend.getByRole("button", { name: "Set its own" }).click();
    await spend.getByLabel("Credits a month").fill("80");
    await spend.getByRole("button", { name: "Save" }).click();
    await expect(spend.getByText("80 credits a month, set on Booking desk")).toBeVisible();

    await page.getByRole("radio", { name: /Sleeps when unused/ }).check();
    await page.getByLabel("Sleeps after this many idle minutes").fill("30");
    await page.getByRole("form", { name: "Idle minutes before it sleeps" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("It sleeps after 30 idle minutes now.")).toBeVisible();
    expect((await mockRequests()).filter((r) => r.path === "/api/apps/app1/settings").map((r) => r.body)).toContainEqual({ idleMinutes: 30 });
  });

  test("a stopped app is rebuilt and restarted", async ({ page }) => {
    await useScenario("populated");
    await manage({ appStatus: { app1: "failed" } });
    await page.goto("/apps/app1");
    await expect(page.getByText("Booking desk stopped working.")).toBeVisible();
    await page.getByRole("button", { name: "Rebuild and restart" }).click();
    await expect(page.getByText("Booking desk is rebuilt and running again.")).toBeVisible();
  });

  test("a Viewer sees how it runs and who may open it, with who changes them, and no refusals", async ({ page }) => {
    await useScenario("viewer");
    await page.goto("/apps/app2");
    await expect(page.getByText("A Builder or above changes how it runs.")).toBeVisible();
    await expect(page.getByText("An Admin or the Owner chooses who can open it.")).toBeVisible();
    await expect(page.getByText("An Admin or the Owner sees which secrets it is given, and adds or changes them.")).toBeVisible();
    await expect(page.getByText("An Admin or the Owner sees who, invites people and stops sharing.")).toBeVisible();
    await expect(page.getByRole("radio").first()).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await mockRequests()).some((r) => r.path.startsWith("/api/secrets") || r.path.endsWith("/shares"))).toBe(false);
  });
});

test.describe("starting an idea where it belongs", () => {
  test("the estimate and the idea name the division chosen", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/start");
    await page.getByLabel("Where it goes").selectOption({ label: "Research" });
    await expect(page.getByText("It is researched for Research, and built there if it is built.")).toBeVisible();
    await page.getByLabel("The idea").fill("A tide board for the club's sea swimmers.");
    await expect(page.getByText(/^Estimated \d+ credits$/)).toBeVisible();
    await page.getByRole("button", { name: "Research this idea" }).click();
    await expect(page).toHaveURL(/\/runs\//);
    const requests = await mockRequests();
    expect(requests.filter((r) => r.path === "/api/ideas/estimate").at(-1)?.body).toMatchObject({ scope: "northwind/research" });
    expect(requests.find((r) => r.path === "/api/ideas" && r.method === "POST")?.body).toMatchObject({ scope: "northwind/research" });
  });

  test("a Viewer is told why they cannot start one", async ({ page }) => {
    await useScenario("viewer");
    await page.goto("/start");
    await expect(page.getByRole("heading", { name: "Only a Builder or above starts an idea" })).toBeVisible();
    await expect(page.getByLabel("The idea")).toHaveCount(0);
  });
});

test.describe("the whole job of an employee", () => {
  test("an Admin edits the job, and asks for a hire by hand", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/employees/e1");
    await page.getByRole("button", { name: "Edit the job" }).click();
    const form = page.getByRole("form", { name: "Edit Ada's job" });
    await form.getByLabel("Role").fill("Lead researcher");
    await form.getByRole("checkbox", { name: "Change files" }).check();
    await form.getByLabel("Reports to").selectOption({ label: "Lin · Engineer" });
    await form.getByRole("button", { name: "Save the job" }).click();
    await expect(page.getByText(/Lead researcher · Employee/)).toBeVisible();
    await expect(page.getByText(/Reports to Lin/)).toBeVisible();
    expect((await mockRequests()).find((r) => r.method === "PATCH" && r.path === "/api/employees/e1")?.body).toMatchObject({ role: "Lead researcher", reportsTo: "e2" });
    await expect(page.getByRole("list", { name: "Changes to the memory" })).toBeVisible();

    await page.goto("/hires?scope=northwind/software");
    await page.getByRole("button", { name: "Ask for a hire" }).click();
    const ask = page.getByRole("form", { name: "Ask for a hire for Software" });
    await ask.getByLabel("Name").fill("Kit");
    await ask.getByLabel("Role").fill("Designer");
    await ask.getByLabel("What it should cost a month").fill("120");
    await ask.getByLabel("Why this hire").fill("Nobody designs here.");
    await ask.getByRole("button", { name: "Ask for this hire" }).click();
    await expect(page).toHaveURL(/\/hires\/h-/);
    await expect(page.getByRole("heading", { name: "Kit, Designer" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("a proposal's budget is cleared by emptying it", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/hires?scope=northwind");
    await page.getByRole("link", { name: /for/ }).first().click();
    await page.getByRole("button", { name: "Edit the proposal" }).click();
    await page.getByLabel("Its own monthly budget (optional)").fill("");
    await page.getByRole("button", { name: "Save the proposal" }).click();
    await expect(page.getByText("No cap of its own; the one above holds")).toBeVisible();
    expect((await mockRequests()).find((r) => r.method === "PATCH" && r.path.startsWith("/api/hires/"))?.body).toMatchObject({ clearMonthlyCreditLimit: true });
  });
});

test.describe("your account", () => {
  test("shows your passkeys and every role you hold", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/account");
    await expect(page.getByRole("button", { name: "Add another passkey" })).toBeVisible();
    await expect(page.getByText(/1 passkey can sign you in/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Your roles in each organisation" })).toContainText("Owner of the whole organisation");
    await expectNoSidewaysScroll(page);
  });

  test("after signing in, you land on the address you first asked for", async ({ page }) => {
    await useScenario("signed-out-dev");
    await page.goto("/credits");
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByRole("button", { name: "Development sign-in" }).click();
    await expect(page).toHaveURL(/\/credits$/);
    await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();
  });
});
