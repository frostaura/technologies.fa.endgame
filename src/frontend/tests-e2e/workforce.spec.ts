import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, isPhone, mockRequests, useScenario } from "./support.ts";

/**
 * The verdict, the workforce, hiring and autonomy, end to end in a real browser against the
 * TEST-ONLY mock control plane (tests-e2e/mock-api), on desktop and phone.
 */

test.describe("the verdict page", () => {
  test("reads the agreed verdict document: the case against, products and sources, the method; normal mode names no repository", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/ideas/idea-ladder");
    await expect(page.getByRole("heading", { name: "Do not build this as its own app." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The case against, argued first" })).toBeVisible();
    const products = page.getByRole("list", { name: "Existing products" });
    await expect(products.getByText("Fixture Ladders")).toBeVisible();
    await expect(products.getByRole("link", { name: "example.test" }).first()).toHaveAttribute("href", "https://example.test/ladders");
    await expect(page.getByText("No evidence of demand was found. That counts against building.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No red line is crossed" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Strands" }).getByText("3 searches · 1 source · low confidence")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("a crash or an unreadable answer never blanks the page", async ({ page }) => {
    await useScenario("populated");
    // An idea the mock does not have: the page records the failure and offers a way back.
    await page.goto("/ideas/no-such-idea");
    await expect(page.getByRole("alert")).toContainText("This idea could not be found");
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("change is sent with what should change; drop is confirmed", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/ideas/idea-ladder");
    await page.getByRole("button", { name: "Change the idea" }).click();
    const form = page.getByRole("form", { name: "Change the idea" });
    await expect(form.getByLabel("What should change?")).toHaveValue("Build it as a feature of Booking desk instead.");
    await form.getByLabel("What should change?").fill("Make it part of Booking desk.");
    await form.getByRole("button", { name: "Research it again with this change" }).click();
    await expect(page).toHaveURL(/\/runs\//);
    expect((await mockRequests()).find((r) => r.path.endsWith("/decision"))?.body).toEqual({ choice: "change", note: "Make it part of Booking desk." });
  });
});

test.describe("the run view in normal mode", () => {
  test("speaks plainly: sub-agents by title with their outcome, tool work summarised, actions counted", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/runs/run-done");
    const steps = page.getByRole("list", { name: "Steps" });
    await expect(steps.getByText("Looked for existing products")).toBeVisible();
    await expect(steps.getByText("Found three, each with pricing.")).toBeVisible();
    await expect(steps).toContainText("Searched the web");
    await expect(steps).not.toContainText("web_search");
    await expect(steps).not.toContainText("fixture/model-small");
    await expect(page.getByTestId("action-count")).toHaveText("4 actions taken, 1 refused by your rules");
    // The sub-agent's own steps fold beneath it.
    await page.getByText("Show its 1 step").click();
    await expect(page.getByRole("list", { name: "Steps: Looked for existing products" })).toContainText("Searched the web");
  });
});

test.describe("home — the workforce on the chart", () => {
  test("employees and contractors on their nodes, hires and idle employees in needs you, and the graph views", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    const chart = page.getByRole("region", { name: "Organisation chart" });
    await expect(chart.getByText("Lin: Building Field notes").first()).toBeVisible();
    await expect(chart.getByText("2 contractors · competitor sweep")).toBeVisible();
    const needs = page.getByRole("region", { name: "Needs you" });
    await expect(needs.getByText("Hire proposed")).toBeVisible();
    await expect(needs.getByText("About 300 credits a month.", { exact: false })).toBeVisible();
    await expect(needs.getByText("Ruth has had nothing to do for 14 days")).toBeVisible();

    await page.getByRole("tab", { name: "Who works on what" }).click();
    const list = page.getByRole("list", { name: "Who works on what" });
    if (isPhone(page)) {
      await expect(list.getByRole("link", { name: "Lin · Engineer" })).toBeVisible();
      await expect(list).toContainText("works on Field notes (now on Building Field notes)");
    } else {
      await expect(page.getByRole("region", { name: "Who works on what, drawn" })).toBeVisible();
    }
    await page.getByRole("tab", { name: "How data flows" }).click();
    await expect(page.getByRole("list", { name: "How data flows" })).toContainText("sends data to AI inside apps");
    await expect(page.getByRole("list", { name: "How data flows" })).not.toContainText("models");
    await expectNoSidewaysScroll(page);
  });

  test("the conversation is scoped to an employee from the chart, and leads to their screen", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("region", { name: "Organisation chart" }).getByRole("button", { name: /Ada · Product researcher/ }).click();
    await expect(page.getByRole("heading", { name: "Talking to Ada" })).toBeVisible();
    await page.getByLabel("Message Ada").fill("What did you learn this week?");
    await page.getByRole("button", { name: "Send" }).click();
    expect((await mockRequests()).find((r) => r.path === "/api/conversations" && r.method === "POST")?.body).toEqual({ scope: "northwind/research/recipes", message: "What did you learn this week?", employeeId: "e1" });
    await page.getByRole("link", { name: "See Ada’s job, record and memory" }).click();
    await expect(page.getByRole("heading", { name: "Ada", exact: true })).toBeVisible();
  });
});

test.describe("the employee screen", () => {
  test("track record, job in plain words, recent work, contractors and memory", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/employees/e1");
    await expect(page.getByRole("region", { name: "Track record" })).toContainText("19 of 22");
    await expect(page.getByText("Standard, for reading and judging")).toBeVisible();
    await expect(page.getByText("Read files, Search the web, Brief contractors")).toBeVisible();
    await expect(page.getByRole("link", { name: "Research: Court ladder" })).toHaveAttribute("href", "/runs/run-done");
    await expect(page.getByText("Sweep the competitors of Recipe box.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Memory entries" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText(/1 note merged, 1 removed as out of date, 1 habit corrected/)).toBeVisible();
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" }).click();
    await expect(page.getByText("Standard, for reading and judging (research)")).toBeVisible();
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Normal" }).click();
    await expectNoSidewaysScroll(page);
  });

  test("memory is added, corrected and removed; a review is started", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/employees/e1");
    const memory = page.getByRole("list", { name: "Memory entries" });
    await page.getByRole("button", { name: "Add something Ada should know" }).click();
    const add = page.getByRole("form", { name: "Add to the memory" });
    await add.getByLabel("In a few words").fill("Quiet weekends");
    await add.getByLabel("What Ada should remember").fill("Nothing ships on a weekend.");
    await add.getByRole("button", { name: "Add it" }).click();
    await expect(memory.getByText("Quiet weekends")).toBeVisible();

    const entry = memory.getByRole("listitem").filter({ hasText: "Three contractors, not six" });
    await entry.getByRole("button", { name: "Correct" }).click();
    await page.getByRole("form", { name: "Correct this memory" }).getByLabel("What Ada should remember").fill("Use three contractors for a sweep.");
    await page.getByRole("button", { name: "Save the correction" }).click();
    await expect(memory.getByText("Use three contractors for a sweep.")).toBeVisible();

    const old = memory.getByRole("listitem").filter({ hasText: "Check Booking desk first" });
    await old.getByRole("button", { name: "Remove" }).click();
    await old.getByLabel(/Why should Ada forget this/).fill("Booking desk is retired");
    await old.getByRole("button", { name: "Remove it" }).click();
    await expect(memory.getByText("Check Booking desk first")).toHaveCount(0);
    expect((await mockRequests()).some((r) => r.method === "DELETE" && r.path === "/api/employees/e1/memory/mem2?why=Booking%20desk%20is%20retired")).toBe(true);

    await page.getByRole("button", { name: "Review now" }).click();
    await expect(page.getByRole("link", { name: "Review started — watch it" })).toBeVisible();
  });

  test("pause, budget and letting go; a refused change rolls back with the reason", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/employees/e1");
    await page.getByRole("button", { name: "Change budget" }).click();
    await page.getByLabel("Credits a month").fill("250");
    await page.getByRole("button", { name: "Save budget" }).click();
    await expect(page.getByText("Budget 250 a month, 140 used")).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.getByRole("button", { name: "Let go" }).click();
    await page.getByRole("button", { name: "Yes, let Ada go" }).click();
    await expect(page.getByRole("button", { name: "Rehire Ada" })).toBeVisible();

    await useScenario("workforce-refused");
    await page.goto("/employees/e1");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText(/Could not pause: .*admin role/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("a standing hire cannot be let go, and a failed read is a failure", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/employees/e3");
    await expect(page.getByRole("button", { name: "Let go" })).toBeDisabled();
    await expect(page.getByText(/A standing hire is never let go/)).toBeVisible();
    await useScenario("workforce-fails");
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "The employee could not be loaded" })).toBeVisible();
  });
});

test.describe("hiring", () => {
  test("a proposal is read from needs you and accepted, with a note", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    await page.getByRole("region", { name: "Needs you" }).getByRole("link", { name: /A support writer for Software/ }).click();
    await expect(page.getByRole("heading", { name: "Noor, support writer" })).toBeVisible();
    await expect(page.getByText("Light, for quick answers")).toBeVisible();
    await expect(page.getByText("Fits the budget")).toBeVisible();
    await page.getByRole("button", { name: "Hire Noor" }).click();
    await page.getByLabel(/A note for the record/).fill("Welcome");
    await page.getByRole("button", { name: "Yes, hire" }).click();
    await expect(page.getByText(/Noor was hired by Fixture Owner/)).toBeVisible();
    expect((await mockRequests()).find((r) => r.path === "/api/hires/h1/accept")?.body).toEqual({ note: "Welcome" });
  });

  test("a proposal is edited and declined", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/hires/h1");
    await page.getByRole("button", { name: "Edit the proposal" }).click();
    await page.getByLabel("Expected credits a month").fill("240");
    await page.getByRole("button", { name: "Save the proposal" }).click();
    await expect(page.getByRole("complementary").getByText("240")).toBeVisible();
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("button", { name: "Yes, decline" }).click();
    await expect(page.getByText(/This hire was declined/)).toBeVisible();
  });

  test("a refused decision rolls back with the reason; a recurring contractor role is proposed as a hire", async ({ page }) => {
    await useScenario("workforce-refused");
    await page.goto("/hires/h1");
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("button", { name: "Yes, decline" }).click();
    await expect(page.getByText(/Your decision was not recorded: .*admin role/)).toBeVisible();
    await expect(page.getByText("Hire proposed")).toBeVisible();

    await useScenario("populated");
    await page.goto("/hires?scope=northwind");
    await page.getByRole("button", { name: "Propose as a permanent hire" }).click();
    await page.getByLabel("Name the new employee").fill("Sam");
    await page.getByRole("button", { name: "Propose the hire" }).click();
    await expect(page.getByRole("heading", { name: "Sam, competitor sweep" })).toBeVisible();
  });
});

test.describe("autonomy and rule sets", () => {
  test("each value says where it was set; a checkpoint and a stage's rules are set here and removed", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/autonomy?scope=northwind%2Fsoftware");
    await expect(page.getByRole("radio", { name: /Auto-mode/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Inherited from Northwind").first()).toBeVisible();
    const build = page.locator('[data-stage="build"]');
    await expect(build.getByText("Set here")).toBeVisible();
    await expect(build.getByText("Replaces the rules set at Northwind.")).toHaveCount(0);
    await expect(build.getByText("Change files")).toBeVisible();
    await expect(page.locator('[data-stage="all"]').getByText("Inherited from Northwind")).toBeVisible();
    await expect(page.getByText("rm -rf")).toHaveCount(0);

    await page.getByRole("switch", { name: "Before the plan is carried out" }).click();
    await expect(page.getByRole("switch", { name: "Before the plan is carried out" })).toHaveAttribute("aria-checked", "true");
    expect((await mockRequests()).find((r) => r.method === "PUT")?.body).toEqual({ scope: "northwind/software", checkpoints: { plan: true } });

    const research = page.locator('[data-stage="research"]');
    await research.getByRole("button", { name: "Set rules here" }).click();
    await research.getByLabel("Add to May not").selectOption("edit_file");
    await research.getByRole("button", { name: "Add" }).first().click();
    await research.getByRole("button", { name: "Save for Software" }).click();
    await expect(research.getByText("Set here")).toBeVisible();
    await expect(research.getByText("Change files")).toBeVisible();
    await research.getByRole("button", { name: "Remove here" }).click();
    await expect(research.getByText("No rules set for this stage")).toBeVisible();

    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" }).click();
    await expect(page.locator('[data-stage="all"]').getByText("run(rm -rf *)")).toBeVisible();
    await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Normal" }).click();
    await expectNoSidewaysScroll(page);
  });

  test("a refused setting rolls back with the reason; a Viewer reads only", async ({ page }) => {
    await useScenario("workforce-refused");
    await page.goto("/autonomy?scope=northwind");
    await page.getByRole("radio", { name: /Checkpoints/ }).click();
    await expect(page.getByText(/Not changed: .*admin role/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Auto-mode/ })).toHaveAttribute("aria-checked", "true");

    await useScenario("viewer");
    await page.goto("/autonomy?scope=northwind");
    await expect(page.getByText("You can read these. An Admin or the Owner sets them.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Before anyone is hired" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Set rules here" })).toHaveCount(0);
  });
});
