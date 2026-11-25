import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";

const SITE_URL = process.env.SITE_URL?.trim() || "https://frostaura.github.io/technologies.fa.endgame/";
const double = readFileSync(path.resolve(import.meta.dirname, "../test-double/demo/index.html"), "utf8");

/** Every test fails on any console error or uncaught exception. */
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function withDemo(page: Page) {
  await page.route("**/demo/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: double }));
}

async function received(page: Page): Promise<string[]> {
  const frame = page.frameLocator("[data-testid=demo-frame]");
  return frame.locator("#log li").allTextContents();
}

test("the cover names the academy and its QR code reads the site's address", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "The Endgame Academy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start learning" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the live demo" })).toBeVisible();
  const pixels = await page.locator("[data-testid=qr] svg").evaluate(async (svg) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const [rect, pathEl] = [svg.querySelector("rect"), svg.querySelector("path")];
    clone.querySelector("rect")?.setAttribute("fill", getComputedStyle(rect as Element).fill);
    clone.querySelector("path")?.setAttribute("fill", getComputedStyle(pathEl as Element).color);
    clone.setAttribute("width", "400");
    clone.setAttribute("height", "400");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0, 400, 400);
    return Array.from(ctx.getImageData(0, 0, 400, 400).data);
  });
  const code = jsQR(Uint8ClampedArray.from(pixels), 400, 400);
  expect(code?.data).toBe(SITE_URL);
  await expect(page.getByText(SITE_URL.replace(/^https:\/\//, ""), { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download the academy (PDF)" })).toHaveAttribute("href", "./academy.pdf");
  const pdf = await page.request.get("./academy.pdf");
  expect(pdf.status()).toBe(200);
});

test("a refusal message someone saw on screen finds the flow that explains it", async ({ page }) => {
  await withDemo(page);
  await page.goto("./");
  await page.keyboard.press("/");
  const box = page.getByRole("combobox", { name: "Search the academy" });
  await expect(box).toBeFocused();
  await box.fill("Endgame is invite-only. Sign in, or register with the invitation code");
  const option = page.getByRole("option").filter({ hasText: "ID-07" });
  await expect(option).toBeVisible();
  const options = await page.getByRole("option").allTextContents();
  const at = options.findIndex((t) => t.includes("ID-07"));
  for (let i = 0; i < at; i++) await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/flow\/ID-07/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Try to register without an invitation, or with one through the console");
});

test("stepping through a scripted flow sends the live console each op in order", async ({ page }) => {
  await withDemo(page);
  await page.goto("./#/flow/IDEA-02");
  await expect.poll(() => received(page)).toEqual([
    'reset {}',
    'goto {"route":"/","persona":"builder","scenario":"established"}',
    expect.stringMatching(/^act \{"actions":\[\{"click":\{"text":"New idea"\}\}\]\}$/),
    expect.stringMatching(/^highlight \{"text":"New idea"/),
  ]);
  const ops = async () => (await received(page)).map((l) => l.split(" ")[0]);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[aria-current=step]")).toContainText("Type the idea");
  await expect.poll(ops).toEqual(["reset", "goto", "act", "highlight", "act", "highlight"]);
  await page.keyboard.press("ArrowRight");
  await expect.poll(ops).toEqual(["reset", "goto", "act", "highlight", "act", "highlight", "act", "highlight"]);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/flow\/IDEA-02\/step\/4$/);
  await expect.poll(ops).toEqual(["reset", "goto", "act", "highlight", "act", "highlight", "act", "highlight", "goto", "highlight"]);
  expect((await received(page))[4]).toContain('"text":"A court-booking app for our squash club, sold in playing minutes."');
  // "Show me again" resets the console and replays up to this step.
  await page.getByRole("button", { name: "Show me again" }).click();
  await expect.poll(async () => (await received(page)).length).toBeGreaterThan(10);
  const replay = (await received(page)).slice(10).map((l) => l.split(" ")[0]);
  expect(replay[0]).toBe("reset");
  expect(replay.at(-1)).toBe("highlight");
});

test("a terminal step types its command and prints its output", async ({ page }) => {
  await page.goto("./#/flow/OPS-12/step/2");
  await expect(page.getByTestId("terminal")).toContainText("BACKUP_ID=", { timeout: 10_000 });
  await expect(page.getByRole("banner")).toContainText("Operator handbook");
});

test("under reduced motion, the terminal shows its whole output at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#/flow/OPS-12/step/2");
  await expect(page.getByTestId("terminal")).toContainText("BACKUP_ID=", { timeout: 1000 });
});

test("without the demo, a live step says once that the console could not be loaded and still teaches", async ({ page }) => {
  await page.route("**/demo/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("./#/flow/ORG-04");
  await expect(page.getByText("The live console could not be loaded here")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("facts")).toBeVisible();
  await expect(page.getByText("The header shows:")).toBeVisible();
  errors = errors.filter((e) => !/404|Failed to load resource/.test(e));
});

test("the academy works from the keyboard alone", async ({ page }) => {
  await withDemo(page);
  await page.goto("./");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the content" })).toBeFocused();
  await page.keyboard.press("/");
  await page.keyboard.type("Sign in with a passkey");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/flow\/ID-02/);
  await expect(page.locator("#main")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[aria-current=step]")).toContainText("asks the server for options");
  await expect(page.locator("[aria-current=step]")).toBeFocused();
  let found = false;
  for (let i = 0; i < 60 && !found; i++) {
    await page.keyboard.press("Tab");
    found = (await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Mark as done");
  }
  expect(found).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Done/ })).toHaveAttribute("aria-pressed", "true");
});

test("progress is remembered, and the cover offers to resume", async ({ page }) => {
  await withDemo(page);
  await page.goto("./#/flow/ID-01/step/3");
  await expect(page.locator("[aria-current=step]")).toContainText("They fill in");
  await page.goto("./#/");
  await expect(page.getByRole("region", { name: "Resume" })).toContainText("ID-01");
});

test("on a phone, the cover and a flow fit the screen and the stage sits above the steps", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errors.push(e.message));
  await withDemo(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("./#/flow/ID-01/step/3");
  const frame = page.getByTestId("demo-frame");
  await expect(frame).toBeVisible();
  const step = page.locator("[aria-current=step]");
  await expect(step).toContainText("They fill in");
  const [f, s] = [await frame.boundingBox(), await step.boundingBox()];
  expect(f && s && f.y + f.height <= s.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});

test("client navigation never mixes in the operator handbook", async ({ page }) => {
  for (const level of ["Foundation", "Core", "Advanced", "Developer"]) {
    await page.goto(`./#/path/${level}`);
    const ids = await page.locator("ol a span.font-mono").allTextContents();
    expect(ids.length).toBeGreaterThan(10);
    for (const operatorFlow of ["OP-02", "OPS-01", "OPS-12"]) expect(ids).not.toContain(operatorFlow);
  }
  await page.goto("./#/search?q=backup");
  await expect(page.getByRole("status")).toBeVisible();
  expect(await page.getByRole("link", { name: /OPS-12/ }).count()).toBe(0);
});
