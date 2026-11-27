import { expect, test, type Page } from "@playwright/test";

/**
 * How the template looks and behaves in a real browser, on the path-form address (proof/run.sh starts it):
 *   - a field marked wrong on a failed submit stops being marked wrong as soon as the person corrects it;
 *   - on a phone the header is two rows — the app's name and the person's avatar, then the places — that never wrap, with
 *     every target at least 44 px and nothing wider than the screen.
 * With PW_SCREENSHOTS set, it also saves the list, the form after a failed submit and a note's page at 375, 768, 1512 and
 * 1920 px wide, for a person to look at.
 */
const edge = process.env.PW_EDGE === "1";
const base = (() => {
  const value = process.env.PW_PATH_URL;
  if (!value) throw new Error("PW_PATH_URL is not set; run the proof through proof/run.sh or proof/edge.sh.");
  return value.endsWith("/") ? value : `${value}/`;
})();
const at = (path = "") => `${base}${path}`;

/** Signs in through the dev platform's own page, from the form (which offers it to someone signed out). */
async function signIn(page: Page, who: string) {
  await page.goto(at("notes/new"));
  await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(`${who}@example.test`);
  await page.getByLabel("Name").fill("Proof Runner");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(at("notes/new"));
}

test.describe("the kit's look", () => {
  test.skip(edge, "Signs in through the dev platform's page; the real edge's sign-in is covered by addresses.spec.ts.");

  test("a field's error clears as soon as the person corrects it, and focus goes to the first wrong field", async ({ page }, info) => {
    await signIn(page, `look-form-${info.project.name}-${Date.now()}`);
    const title = page.getByTestId("note-title");
    const when = page.getByTestId("note-happens-at");

    // Two fields wrong at once: a blank title and a date past the field's limit.
    await when.fill("2120-01-01T08:00");
    await page.getByTestId("save-note").click();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(when).toHaveAttribute("aria-invalid", "true");
    await expect(title).toBeFocused();
    await expect(page.locator("#title-error")).toHaveText("Give the note a title.");
    await expect(title).toHaveAttribute("aria-describedby", /title-error/);

    // Correcting the title clears its mark and its message straight away; the date, untouched, is still marked.
    await title.fill("Reef dive");
    await expect(title).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#title-error")).toHaveCount(0);
    await expect(when).toHaveAttribute("aria-invalid", "true");
    // Its edge is the field's own again (measured away from the focus, which draws the accent).
    await title.blur();
    const edgeColour = await title.evaluate((el) => getComputedStyle(el).borderTopColor);
    const fieldEdge = await page.getByTestId("note-body").evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(edgeColour).toBe(fieldEdge);

    // The date corrected too: the next submit saves.
    await when.fill("2027-01-01T08:00");
    await expect(when).not.toHaveAttribute("aria-invalid", "true");
    await page.getByTestId("save-note").click();
    await expect(page.getByRole("heading", { name: "Reef dive" })).toBeVisible();
  });

  test("on a phone the header is two compact rows that never wrap, with 44 px targets", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "The phone header.");
    await signIn(page, `look-header-${Date.now()}`);
    await page.goto(at());
    await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible();

    const header = page.locator('[data-slot="app-header"]');
    const box = await header.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(112);

    // Row one: the app's name and the avatar, side by side.
    const home = header.getByRole("link").first();
    const account = header.getByRole("button", { name: /^Your account/ });
    const homeBox = await home.boundingBox();
    const accountBox = await account.boundingBox();
    expect(homeBox && accountBox && Math.abs(homeBox.y + homeBox.height / 2 - (accountBox.y + accountBox.height / 2))).toBeLessThan(2);
    // Sign out is not spread across the header; it waits in the avatar's menu.
    await expect(header.getByRole("link", { name: "Sign out" })).toHaveCount(0);

    // Row two: the places, on one line.
    const nav = header.getByRole("navigation", { name: "Main" });
    const navBox = await nav.boundingBox();
    expect(navBox && accountBox && navBox.y).toBeGreaterThanOrEqual((accountBox?.y ?? 0) + (accountBox?.height ?? 0) - 1);
    const tabs = nav.getByRole("link");
    const tops = await tabs.evaluateAll((links) => links.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    for (const height of await tabs.evaluateAll((links) => links.map((l) => l.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);

    // The avatar opens a menu with who is signed in and the way out, every target 44 px.
    expect(accountBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(accountBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    await account.click();
    await expect(account).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByTestId("user-menu");
    await expect(menu).toContainText("Proof Runner");
    const signOut = menu.getByRole("link", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    expect((await signOut.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(account).toBeFocused();

    // Nothing is wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("screens at four widths, for a person to look at", async ({ page }, info) => {
    const dir = process.env.PW_SCREENSHOTS;
    test.skip(!dir || info.project.name !== "desktop", "Only with PW_SCREENSHOTS, once.");
    await signIn(page, `look-shots-${Date.now()}`);
    await page.getByTestId("note-title").fill("Lost: a blue mask strap");
    await page.getByTestId("note-body").fill("Left by the rinse tank after the Sunday dive.");
    await page.getByTestId("save-note").click();
    await expect(page.getByRole("heading", { name: "Lost: a blue mask strap" })).toBeVisible();
    const note = page.url();

    for (const width of [375, 768, 1512, 1920]) {
      await page.setViewportSize({ width, height: width < 700 ? 812 : 1000 });
      await page.goto(at());
      await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
      await page.screenshot({ path: `${dir}/${width}-list.png`, fullPage: true });

      await page.goto(at("notes/new"));
      await page.getByTestId("note-happens-at").fill("2120-01-01T08:00");
      await page.getByTestId("save-note").click();
      await page.getByTestId("note-title").fill("Lost: fins");
      await page.screenshot({ path: `${dir}/${width}-form-corrected.png`, fullPage: true });

      await page.goto(note);
      await expect(page.getByRole("heading", { name: "Lost: a blue mask strap" })).toBeVisible();
      await page.screenshot({ path: `${dir}/${width}-note.png`, fullPage: true });
      if (width === 375) {
        const account = page.getByRole("button", { name: /^Your account/ });
        if (await account.count()) {
          await account.click();
          await page.screenshot({ path: `${dir}/${width}-account-menu.png` });
          await page.keyboard.press("Escape");
        }
      }
    }
  });
});
