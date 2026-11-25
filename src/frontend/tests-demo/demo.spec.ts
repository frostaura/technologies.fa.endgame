import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * The static demo, end to end: served from a sub-path and opened from the file, the whole story is
 * walked — sign in, start an idea, watch research reach its verdict, build it to "Running
 * privately", open and question the app, and on through credits, hiring, memory, secrets, people,
 * autonomy, notifications and God mode — with no request leaving the page and no console error.
 */

const SUB = "/technologies.fa.endgame/demo/index.html";
const FILE = pathToFileURL(path.join(import.meta.dirname, "..", "dist-demo", "index.html")).href;

function watch(page: Page, allowedOrigin: string | null) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    if (allowedOrigin === null ? !u.startsWith("file:") : !u.startsWith(allowedOrigin)) problems.push(`request left the page: ${u}`);
  });
  page.on("popup", (p) => problems.push(`a page opened: ${p.url()}`));
  return problems;
}

const demo = (page: Page, op: string, ...args: unknown[]) =>
  page.evaluate(([o, a]) => (window as unknown as { endgameDemo: Record<string, (...x: unknown[]) => unknown> }).endgameDemo[o as string]?.(...(a as unknown[])), [op, args] as const);

async function walk(page: Page, start: string) {
  // Signed out: the device sheet stands in for the passkey prompt.
  await page.goto(`${start}?persona=signed-out&scenario=default`);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Mara Ellison/ }).click();
  await expect(page.getByText("Talking to Northwind")).toBeVisible();

  // Home → a new idea → its research, played to the verdict.
  await page.getByRole("link", { name: "New idea" }).first().click();
  await page.locator("textarea").first().fill("A members' locker booking app for the club: book a locker for a session and get its code on your phone.");
  await expect(page.getByText(/credits/).first()).toBeVisible();
  await page.getByRole("button", { name: /Research this idea/ }).click();
  await expect(page.getByText("Research started").first()).toBeVisible({ timeout: 20_000 });
  await demo(page, "clock", { seek: 120_000 });
  await expect(page.getByText(/Verdict: build/).first()).toBeVisible({ timeout: 20_000 });

  // The verdict → build it → the build plays to "Running privately".
  await page.getByRole("link", { name: /verdict/i }).first().click();
  await expect(page.getByText(/Verdict ·/).first()).toBeVisible();
  await page.getByRole("button", { name: "Build it" }).first().click();
  await expect(page.getByText(/Build:/).first()).toBeVisible({ timeout: 20_000 });
  await demo(page, "clock", { seek: 600_000 });
  await expect(page.getByText("Running privately").first()).toBeVisible({ timeout: 30_000 });

  // The app's page, and the hosted app behind "Open the app".
  await page.getByRole("link", { name: "Northwind" }).first().click();
  await page.locator('a[href^="/apps/"]', { hasText: /Locker/ }).first().click();
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();
  await page.getByRole("link", { name: "Open the app" }).click();
  await expect(page.getByRole("button", { name: "Back to Endgame" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Back to Endgame" }).click();

  // Asking about a busy app, in plain words.
  await demo(page, "goto", { route: "/apps/{app}", scenario: "app-busy" });
  await page.getByLabel("Ask about this app").fill("Which hour was busiest today?");
  await page.getByRole("button", { name: "See what it costs" }).click();
  await expect(page.getByText(/^At most/).first()).toBeVisible();
  await page.getByRole("button", { name: "Ask it" }).click();
  await expect(page.getByText(/busiest hour today/).first()).toBeVisible({ timeout: 10_000 });

  // Credits, then a hire accepted, then an employee's memory.
  await demo(page, "goto", { route: "/credits", scenario: "default" });
  await expect(page.getByText("Spent this month").first()).toBeVisible();
  await demo(page, "goto", { route: "/hires/{hire}" });
  await page.getByRole("button", { name: "Hire Lark" }).click();
  await page.getByRole("button", { name: "Yes, hire" }).click();
  await expect(page.getByText("Lark was hired").first()).toBeVisible();
  await demo(page, "goto", { route: "/employees/{employee}" });
  await expect(page.getByText("Courts are booked in 40-minute slots").first()).toBeVisible();

  // Secrets: one set at the organisation, by name only.
  await demo(page, "goto", { route: "/secrets?scope=northwind" });
  await page.getByPlaceholder("STRIPE_API_KEY").fill("WEATHER_API_KEY");
  await page.locator("input[type=password], textarea").last().fill("not-a-real-value");
  await page.getByRole("button", { name: /^(Set|Save|Add)/ }).last().click();
  await expect(page.getByText("WEATHER_API_KEY").first()).toBeVisible();

  // People: invite someone, and see their one-time code.
  await demo(page, "goto", { route: "/people?scope=northwind" });
  await page.getByLabel("E-mail address").fill("jo@northwind.example");
  await page.getByLabel("Their name").fill("Jo Park");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText("It will not be shown again.").first()).toBeVisible();

  // Autonomy: stop for sign-off before the plan is carried out.
  await demo(page, "goto", { route: "/autonomy?scope=northwind" });
  await page.getByRole("radio", { name: /^Checkpoints/ }).click();
  await expect(page.getByRole("radio", { name: /^Checkpoints/ })).toBeChecked();

  // Notifications: mark them all read.
  await demo(page, "goto", { route: "/notifications" });
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);

  // God mode: every organisation, and entering one is logged.
  await demo(page, "goto", { route: "/operator", persona: "operator" });
  await expect(page.locator("main").getByText("Every organisation").first()).toBeVisible();
  await page.getByRole("button", { name: "Enter Northfield Tutors" }).click();
  await expect(page.getByText("Logged: This entry is in the organisation's operator log, which its Owner reads.")).toBeVisible();
  await page.getByRole("link", { name: "Open its org chart" }).or(page.getByRole("button", { name: "Open its org chart" })).click();
  await expect(page.getByText("Homework Planner").first()).toBeVisible();
}

test("served from a sub-path: the whole story, with nothing leaving the page", async ({ page, baseURL }) => {
  const problems = watch(page, baseURL ?? null);
  await walk(page, SUB);
  expect(problems).toEqual([]);
});

test("opened from the file", async ({ page }) => {
  const problems = watch(page, null);
  await page.goto(`${FILE}?persona=owner&scenario=build-running`);
  await expect(page.getByText("The plan").first()).toBeVisible({ timeout: 20_000 });
  expect(problems).toEqual([]);
});

test("the academy bridge: ready, goto, highlight, act to step-done, clock, reset, and errors", async ({ page, baseURL }) => {
  const problems = watch(page, baseURL ?? null);
  await page.setContent(
    `<!doctype html><html><body><script>window.msgs = []; addEventListener("message", (e) => window.msgs.push(e.data));</script><iframe id="f" style="width:1400px;height:860px" src="${baseURL}${SUB}?embed=1&persona=owner&scenario=established"></iframe></body></html>`,
  );
  const send = (id: string, op: string, args: Record<string, unknown> = {}) =>
    page.evaluate(([i, o, a]) => (document.getElementById("f") as HTMLIFrameElement).contentWindow?.postMessage({ source: "endgame-academy", id: i, op: o, args: a }, "*"), [id, op, args] as const);
  const reply = (pred: string) =>
    expect.poll(() => page.evaluate((p) => (window as unknown as { msgs: { op: string; id: string; args?: { id?: string } }[] }).msgs.some((m) => `${m.op}:${m.op === "step-done" ? m.args?.id : m.id}` === p), pred), { timeout: 20_000 }).toBe(true);

  await reply("ready:ready");
  const frame = page.frameLocator("#f");
  await expect(frame.getByText("Demo — mock data")).toHaveCount(0);

  await send("g1", "goto", { route: "/", persona: "owner", scenario: "established" });
  await reply("goto:g1");
  await send("h1", "highlight", { text: "Whole organisation", note: "On load the selection is the whole organisation." });
  await reply("highlight:h1");
  await expect(frame.locator("[data-demo-spotlight]")).toHaveCount(1);

  await send("a1", "act", { actions: [{ click: { text: "Technologies" } }, { click: { text: "Court booking" } }] });
  await reply("step-done:a1");
  await expect(frame.getByText("Talking to Court booking").first()).toBeVisible();

  await send("c1", "clock", { seek: 15_000 });
  await reply("clock:c1");
  await send("x1", "highlight", { text: "Nothing on this page says this" });
  await reply("highlight:x1");
  await send("x2", "act", { actions: [{ click: { text: "Nothing on this page says this" } }] });
  await reply("error:x2");
  await send("u1", "frobnicate", {});
  await reply("error:u1");

  await send("r1", "reset", {});
  await reply("reset:r1");
  await send("a2", "act", { actions: [{ click: { text: "New idea" } }, { type: { into: { selector: "textarea" }, text: "A court-booking app for our squash club, sold in playing minutes." } }], instant: true });
  await reply("step-done:a2");
  await expect(frame.locator("textarea").first()).toHaveValue("A court-booking app for our squash club, sold in playing minutes.");
  expect(problems).toEqual([]);
});

test("managing the tree, your account, choosing where an idea goes, and switching organisations", async ({ page, baseURL }) => {
  const problems = watch(page, baseURL ?? null);
  // Manage: what has history is archived, not deleted; a new project joins the tree.
  await page.goto(`${SUB}?persona=owner&scenario=manage-tree`);
  await page.getByRole("button", { name: /^Events/ }).first().click();
  await page.getByRole("button", { name: /^Delete Events/ }).click();
  const confirm = page.getByRole("button", { name: /^(Yes, delete|Delete it)/ });
  if (await confirm.count()) await confirm.first().click();
  await expect(page.getByText(/still has children, work or credit history attached/).first()).toBeVisible();
  await page.getByRole("button", { name: /^Operations/ }).first().click();
  await page.getByRole("button", { name: "Add a project" }).click();
  await page.getByLabel(/^Name/).last().fill("Lost Property");
  await page.getByRole("button", { name: /^(Add|Create)/ }).last().click();
  await expect(page.getByRole("button", { name: "Lost Property" }).first()).toBeVisible();

  // Your account: another passkey on this device.
  await demo(page, "goto", { route: "/account" });
  await page.getByRole("button", { name: "Add another passkey" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save the passkey" }).click();
  await expect(page.getByText(/3 passkeys|passkey added|Added/i).first()).toBeVisible();

  // Start: the idea goes to a division, named on the estimate and the idea.
  await demo(page, "goto", { route: "/start" });
  await page.getByLabel("Where it goes").selectOption({ label: "Learning" });
  await page.getByLabel("The idea").fill("A holiday-camp sign-up for the kids' cookery club, with a waiting list when it is full.");
  await page.getByRole("button", { name: /Research this idea/ }).click();
  await expect(page.getByText("Research started").first()).toBeVisible({ timeout: 20_000 });

  // A person in two organisations switches between them.
  await demo(page, "goto", { route: "/", persona: "two-organisations", scenario: "two-organisations" });
  await page.locator("header select").selectOption({ label: "Quayside Bakery" });
  await expect(page.locator("main").getByRole("heading", { name: "Quayside Bakery" }).first()).toBeVisible();
  expect(problems).toEqual([]);
});
