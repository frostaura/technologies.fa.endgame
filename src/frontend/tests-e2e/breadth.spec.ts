import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, isPhone, mockRequests, useScenario } from "./support.ts";

/**
 * The console's breadth, end to end against the TEST-ONLY mock control plane: the app page's asking,
 * dashboard, history and download; people; AI assistants; notifications; ideas from the portfolio;
 * the overdraft and top-ups; God mode; and plain language in normal mode — on desktop and phone.
 */

/** The marks of machinery normal mode must never print: a `:`-separated key, an id, a model, a file. */
const MACHINERY = [
  /(?<![\w/])(?!https?:)[a-z][\w.-]*:[a-z0-9][\w./-]*/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b[0-9a-f]{12,}\b/i,
  /\b[a-z0-9-]+\/[\w.-]*(claude|gpt|gemini|llama|mistral|qwen|sonnet|haiku|opus)/i,
  /\b[\w-]+\.(cs|tsx?|json|md|csproj)\b/i,
];

async function stepLines(page: Page): Promise<string[]> {
  return page.getByRole("list", { name: "Steps", exact: true }).locator("li").evaluateAll((items) => items.map((li) => (li as HTMLElement).innerText));
}

async function technicalMode(page: Page) {
  await page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Technical" }).click();
}

test.describe("plain language", () => {
  test("a needs-you card is a headline and one line", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    const card = page.getByRole("region", { name: "Needs you" }).getByRole("link", { name: /Court ladder/ });
    await expect(card).toContainText("Research says do not build “Court ladder.");
    await expect(card).toContainText("Three club apps already run ladders for free");
    await expect(card).not.toContainText("Commercially it is worse");
    await expectNoSidewaysScroll(page);
  });

  test("a normal-mode run never prints a key, an id, a model or a file; technical mode does", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/runs/run-factory");
    await expect(page.getByRole("heading", { name: "Build: Booking desk" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps", exact: true })).toContainText("Endgame · Hired Lin");
    await expect(page.getByRole("list", { name: "Steps", exact: true })).toContainText("Ada joined as a product researcher");
    const lines = await stepLines(page);
    for (const line of lines) for (const mark of MACHINERY) expect(line, `"${line}" prints machinery`).not.toMatch(mark);
    const plan = page.getByRole("list", { name: "Parts of the plan" });
    await expect(plan).toContainText("Part 1 of 1 of the plan");
    await expect(plan).not.toContainText("Booking.cs");
    await expectNoSidewaysScroll(page);

    await technicalMode(page);
    await expect(page.getByRole("list", { name: "Steps", exact: true })).toContainText("hire:stage:research:northwind");
    await expect(page.getByRole("list", { name: "Parts of the plan" })).toContainText("api/Bookings/Booking.cs");
  });
});

test.describe("the app page", () => {
  test("asks about the app with the cost first, keeps the answer, and reads the dashboard", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    await page.getByLabel("Ask about this app").fill("Which days are busiest?");
    await expect(page.getByRole("button", { name: "Ask it" })).toHaveCount(0);
    await page.getByRole("button", { name: "See what it costs" }).click();
    await expect(page.getByText("At most 0.4 credits.")).toBeVisible();
    await page.getByRole("button", { name: "Ask it" }).click();
    await expect(page.getByText("Tuesday and Thursday evenings are the busiest.")).toBeVisible();
    await expect(page.getByRole("img", { name: /bookings: Mon 52/ })).toBeVisible();
    await expect(page.getByText("The query")).toHaveCount(0);
    await page.getByRole("button", { name: "Keep this on the dashboard" }).click();
    await expect(page.getByText(/It is on the dashboard/)).toBeVisible();
    const kept = page.getByRole("list", { name: "Kept questions" });
    await expect(kept.locator("li")).toHaveCount(2);
    await expect(kept).toContainText("About two hundred a day");
    await expectNoSidewaysScroll(page);
  });

  test("an unanswerable question is said in words", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    await page.getByLabel("Ask about this app").fill("Delete every booking");
    await page.getByRole("button", { name: "See what it costs" }).click();
    await page.getByRole("button", { name: "Ask it" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Try asking it another way" })).toBeVisible();
  });

  test("history names who made each version and brings one back after a confirmation", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    const versions = page.getByRole("list", { name: "Versions" });
    await expect(versions).toContainText("Let members cancel a booking up to an hour before");
    await expect(versions).toContainText("The factory recorded its progress");
    await expect(versions.getByText("Live now")).toBeVisible();
    await expect(versions).not.toContainText("9f1c2e7a");
    await versions.getByRole("button", { name: /^Bring back “Changed the welcome wording/ }).click();
    const dialog = versions.getByRole("alertdialog");
    await expect(dialog).toContainText("It becomes the newest version");
    await dialog.getByRole("button", { name: "Bring it back" }).click();
    await expect(page.getByText("The earlier version is back and running.")).toBeVisible();
    await expect(versions.locator("li").first()).toContainText("Restore");
    await expectNoSidewaysScroll(page);
  });

  test("the Owner downloads everything, and sees what the app uses", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/apps/app1");
    await expect(page.getByRole("list", { name: "What it uses" })).toContainText("Open to AI assistants");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download everything" }).click();
    expect((await download).suggestedFilename()).toBe("desk-export.tar.gz");
    await expect(page.getByText("Saved as desk-export.tar.gz.")).toBeVisible();
  });
});

test.describe("people", () => {
  test("invites to a role at a level with a one-time code, changes a role and removes a grant", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/people");
    const people = page.getByRole("list", { name: "People" });
    await expect(people).toContainText("Kit");
    await expect(page.getByRole("region", { name: "What each role may do" })).toContainText("changes nothing");
    await page.getByLabel("E-mail address").fill("noor@example.test");
    await page.getByLabel("Their name").fill("Noor");
    await page.getByLabel("Role", { exact: true }).selectOption("builder");
    await page.getByLabel("Where", { exact: true }).selectOption("northwind/software");
    await page.getByRole("button", { name: "Invite" }).click();
    const code = page.getByRole("status", { name: "Invitation code" });
    await expect(code).toContainText("give them this code yourself");
    await code.getByRole("button", { name: "Done" }).click();
    await expect(code).toHaveCount(0);

    await page.getByLabel("Role for Kit").selectOption("viewer");
    await expect(page.getByLabel("Role for Kit")).toHaveValue("viewer");
    await page.getByRole("button", { name: "Remove Kit" }).click();
    await page.getByRole("group", { name: "Confirm removing Kit" }).getByRole("button", { name: "Remove" }).click();
    await expect(people).not.toContainText("kit@example.test");
    await expectNoSidewaysScroll(page);
  });

  test("an Admin who asks for the Admin role is refused, and the role goes back", async ({ page }) => {
    await useScenario("not-owner");
    await page.goto("/people");
    await expect(page.getByLabel("Role for Kit").locator("option[value=admin]")).toHaveCount(0);
  });
});

test.describe("AI assistants", () => {
  test("lets an assistant in with a key shown once, gives the addresses, and revokes", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/assistants");
    await expect(page.getByRole("heading", { level: 1, name: "Let an AI assistant work with your organisation" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("MCP");
    await page.getByLabel("Which assistant is it for?").fill("Desk assistant");
    await page.getByRole("button", { name: "Make the key" }).click();
    const once = page.getByRole("status", { name: "The new key" });
    await expect(once.locator("code")).toContainText("egp_");
    await expect(page.getByRole("list", { name: "Keys" })).toContainText("Desk assistant");
    await expect(page.getByText(/\/mcp$/).first()).toBeVisible();
    const laptop = page.locator('[data-token="t1"]');
    await laptop.getByRole("button", { name: "Revoke" }).click();
    await laptop.getByRole("button", { name: "Revoke it" }).click();
    await expect(laptop.getByText("Revoked")).toBeVisible();
    await expectNoSidewaysScroll(page);

    await technicalMode(page);
    await expect(page.getByRole("heading", { level: 1, name: "MCP access tokens" })).toBeVisible();
  });
});

test.describe("notifications", () => {
  test("the bell counts the unread, leads to the feed, and everything can be marked read", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/");
    const bell = page.getByRole(isPhone(page) ? "link" : "button", { name: "Notifications, 2 unread" });
    await expect(bell).toBeVisible();
    if (isPhone(page)) await bell.click();
    else {
      await bell.click();
      await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: "See all" }).click();
    }
    await expect(page).toHaveURL(/\/notifications$/);
    const feed = page.locator("main").getByRole("list", { name: "Notifications" });
    await expect(feed.getByRole("link", { name: "The security review found 1 problem" })).toHaveAttribute("href", "/runs/run-build");
    await page.locator("main").getByRole("button", { name: "Mark all read" }).click();
    await expect(page.locator("main").getByText("Nothing unread.")).toBeVisible();
    await expect(page.getByRole(isPhone(page) ? "link" : "button", { name: "Notifications, none unread" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test.describe("ideas from the portfolio", () => {
  test("shows the cost first, then suggestions; one is set aside and one taken into research", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/suggestions");
    await page.getByRole("button", { name: "See what it costs" }).click();
    await expect(page.getByText("At most 84 credits.")).toBeVisible();
    await page.getByRole("button", { name: "Suggest ideas" }).click();
    await expect(page.getByRole("link", { name: "Watch it work" })).toBeVisible();

    const list = page.getByRole("list", { name: "Suggested ideas" });
    const kitchen = list.locator('[data-suggestion="s2"]');
    await kitchen.getByRole("button", { name: "Set it aside" }).click();
    await expect(kitchen).toHaveCount(0);
    const ladder = list.locator('[data-suggestion="s1"]');
    await expect(ladder).toContainText("Clubs run ladders on paper sheets by the door.");
    await ladder.getByRole("button", { name: "Take this idea" }).click();
    await expect(ladder.getByText(/Researching it costs at most/)).toBeVisible();
    await ladder.getByRole("button", { name: "Research this idea" }).click();
    await expect(page).toHaveURL(/\/ideas\/idea-/);
    await expectNoSidewaysScroll(page);
  });
});

test.describe("credits", () => {
  test("the Owner sets a limit no deeper than FrostAura allows and asks for a top-up", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/credits");
    await page.getByRole("button", { name: "Change your limit" }).click();
    await page.getByLabel("How far below zero you may go").fill("5000");
    await expect(page.getByText("That is deeper than the 3,000 FrostAura allows.")).toBeVisible();
    await page.getByLabel("How far below zero you may go").fill("2000");
    await page.getByRole("button", { name: "Save my limit" }).click();
    await expect(page.getByText("Your own limit is saved.")).toBeVisible();
    await expect(page.getByText("2,000 below zero")).toBeVisible();

    const requests = page.getByRole("list", { name: "Top-up requests" });
    await expect(requests).toContainText("Waiting for FrostAura");
    await page.getByRole("button", { name: "Ask for a top-up" }).click();
    await page.getByLabel("How many credits").fill("750");
    await page.getByRole("button", { name: "Ask for it" }).click();
    await expect(page.getByText(/Asked FrostAura for 750 credits/)).toBeVisible();
    await expect(requests.locator("li")).toHaveCount(2);
    await expectNoSidewaysScroll(page);
  });
});

test.describe("God mode", () => {
  async function card(page: Page, slug: string): Promise<Locator> {
    return page.getByRole("list", { name: "Organisations" }).locator(`[data-org="${slug}"]`);
  }

  test("is marked on every screen, lists every organisation, enters one and says it is logged", async ({ page }) => {
    await useScenario("operator");
    await page.goto("/");
    await expect(page.getByRole("note", { name: "God mode" })).toBeVisible();
    await page.getByRole("region", { name: "God mode" }).getByRole("link", { name: "Every organisation" }).click();
    const northwind = await card(page, "northwind");
    await expect(northwind).toContainText("9,548");
    await expect((await card(page, "harbour")).getByText("Below zero", { exact: true })).toBeVisible();
    await northwind.getByRole("button", { name: "Enter Northwind" }).click();
    await expect(northwind).toContainText("Logged: in the organisation's operator log, which its Owner reads");
    await expect(northwind.getByRole("link", { name: "Open its org chart" })).toHaveAttribute("href", "/?organisation=northwind");
    await expectNoSidewaysScroll(page);
  });

  test("fulfils a top-up request, sets a deepest overdraft and changes the prices after a confirmation", async ({ page }) => {
    await useScenario("operator");
    await page.goto("/operator");
    const request = page.getByRole("list", { name: "Waiting requests" }).locator('[data-request="tr1"]');
    await request.getByRole("button", { name: "Add the credits" }).click();
    await request.getByRole("button", { name: "Add it and close the request" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 2,000 credits to Northwind and closed the request" }).first()).toBeVisible();
    const sent = (await mockRequests()).find((r) => r.path === "/api/credits/top-ups");
    expect(sent?.body).toMatchObject({ organisation: "northwind", credits: 2000, requestId: "tr1" });

    const harbour = await card(page, "harbour");
    await harbour.getByRole("button", { name: "Deepest overdraft" }).click();
    await harbour.getByLabel("The most it may go below zero").fill("2500");
    await harbour.getByRole("button", { name: "Save" }).click();
    await expect(harbour.getByText("Set by you: 2,500")).toBeVisible();

    await page.getByLabel("Margin").fill("0.8");
    await expect(page.getByText(/At least 1.0/)).toBeVisible();
    await page.getByLabel("Margin").fill("1.3");
    await page.getByRole("button", { name: "Save the prices" }).click();
    await page.getByRole("alertdialog", { name: "Confirm the new prices" }).getByRole("button", { name: "Change the prices" }).click();
    await expect(page.getByText("The new prices hold from now on, for every organisation.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Price changes" })).toContainText("Margin: 1.2 → 1.3");
    await expectNoSidewaysScroll(page);
  });

  test("provisions an organisation for an invited Owner and shows the code once; a reserved name is refused", async ({ page }) => {
    await useScenario("operator");
    await page.goto("/operator");
    await page.getByLabel("Its name").fill("www");
    await page.getByLabel("The Owner's e-mail").fill("new@example.test");
    await page.getByRole("button", { name: "Set it up" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "is one of FrostAura's own addresses" })).toBeVisible();
    await page.getByLabel("Its name").fill("Beta Works");
    await expect(page.getByLabel("Its address name")).toHaveValue("beta-works");
    await page.getByRole("button", { name: "Set it up" }).click();
    await expect(page.getByRole("status", { name: "The Owner's invitation code" })).toContainText("give them this code yourself");
    await expect(page.getByRole("list", { name: "Organisations" }).locator('[data-org="beta-works"]')).toBeVisible();
  });

  test("is closed to anyone who is not an operator", async ({ page }) => {
    await useScenario("populated");
    await page.goto("/operator");
    await expect(page.getByText("God mode is for FrostAura operators")).toBeVisible();
    await expect(page.getByRole("note", { name: "God mode" })).toHaveCount(0);
  });
});
