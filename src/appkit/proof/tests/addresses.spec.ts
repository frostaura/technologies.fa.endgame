import { expect, test, type Page } from "@playwright/test";

/**
 * ONE image of the template, ONE running container, reached through an edge at the two address
 * shapes Endgame serves every app at — four segments on the path form, three on the subdomain
 * (ARCH-004, ARCH-005):
 *   path form            PW_PATH_URL  e.g. http://127.0.0.1:<port>/acme/labs/demo/notes/
 *   organisation domain  PW_HOST_URL  e.g. http://acme.localhost:<port>/labs/demo/notes/
 * Edge strips the prefix and sends X-Forwarded-Prefix in both.
 *
 * Two edges: the dev platform's (proof/run.sh, the default), or the REAL Edge of a running stack
 * (proof/edge.sh, PW_EDGE=1), where sign-in is the edge's own page with the development sign-in
 * for PW_MEMBER_EMAIL, and on the subdomain it returns through the hand-off.
 */
const edge = process.env.PW_EDGE === "1";
const memberEmail = edge ? required("PW_MEMBER_EMAIL") : "";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run the proof through proof/run.sh or proof/edge.sh.`);
  return value;
}

const shapes = [
  { name: "path form", url: new URL(required("PW_PATH_URL")) },
  { name: "organisation subdomain", url: new URL(required("PW_HOST_URL")) },
].map((s) => ({ name: s.name, origin: s.url.origin, base: s.url.pathname.endsWith("/") ? s.url.pathname : `${s.url.pathname}/` }));

/** Every response the page gets that is not a success, and every script error: the test ends with none. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  return problems;
}

for (const shape of shapes) {
  const at = (path = "") => `${shape.origin}${shape.base}${path}`;

  test.describe(shape.name, () => {
    test("reads, signs in through the platform, writes, deep-links and reloads", async ({ page }, info) => {
      const problems = watch(page);
      const chunks: string[] = [];
      page.on("response", (r) => {
        if (/\/assets\/(NoteDetailPage|NewNotePage)-[\w-]+\.js$/.test(r.url())) chunks.push(`${r.status()} ${r.url()}`);
      });

      // The app's address without its trailing slash is redirected to the app.
      if (shape.base !== "/") {
        await page.goto(`${shape.origin}${shape.base.replace(/\/$/, "")}`);
        await expect(page).toHaveURL(at());
      } else {
        await page.goto(at());
      }

      // The server set the page's base to this address; the router and every fetch follow it.
      expect(await page.evaluate(() => document.baseURI)).toBe(at());
      await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0); // loading finished: a list or the empty state
      await expect(page.getByRole("alert")).toHaveCount(0); // and not a failure

      // Client-side route to a lazily loaded page; signed out, it offers the platform's sign-in.
      await page.getByRole("link", { name: "New note" }).click();
      await expect(page).toHaveURL(at("notes/new"));
      await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();

      if (edge) {
        // The edge's own sign-in page, under the app's path-form address on the platform's host —
        // the subdomain's sign-in moves there, where a member's session lives.
        await expect(page).toHaveURL(/\/_endgame\/auth\/sign-in\?returnTo=/);
        await page.getByLabel("E-mail address").fill(memberEmail);
        await page.getByRole("button", { name: "As a member" }).click();
      } else {
        // The platform's sign-in page lives under the app's own address.
        await expect(page).toHaveURL(new RegExp(`^${escape(at("_endgame/auth/sign-in"))}\\?returnTo=`));
        const email = `${info.project.name}.${shape.name.replace(" ", "-")}@example.test`;
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Name").fill("Proof Runner");
        await page.getByRole("button", { name: "Sign in" }).click();
      }

      // Back where they started, signed in.
      await expect(page).toHaveURL(at("notes/new"));
      if (edge) await expect(page.getByTestId("signed-in-as")).not.toBeEmpty();
      else await expect(page.getByTestId("signed-in-as")).toHaveText("Proof Runner");

      // Write through the API; the app routes to the new note (another lazy chunk).
      const title = `Proof ${shape.name} ${info.project.name} ${Date.now()}`;
      await page.getByLabel("Title").fill(title);
      await page.getByLabel("Body").fill("Written by the both-addresses proof.");
      await page.getByRole("button", { name: "Save note" }).click();
      await expect(page).toHaveURL(new RegExp(`^${escape(at("notes/"))}[0-9a-f-]{36}$`));
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

      // A deep link survives a full reload: the server answers with the app, base rewritten.
      await page.reload();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      expect(await page.evaluate(() => document.baseURI)).toBe(at());

      // Client-side back to the list, which now carries the note. React Router writes the home of a
      // path-form app without its trailing slash; a reload there goes through Edge's redirect.
      await page.getByRole("link", { name: "← All notes" }).click();
      await expect(page).toHaveURL(new RegExp(`^${escape(at().replace(/\/$/, ""))}/?$`));
      await expect(page.getByRole("link", { name: new RegExp(escape(title)) })).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(at());
      await expect(page.getByRole("link", { name: new RegExp(escape(title)) })).toBeVisible();
      if (process.env.PW_SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.PW_SCREENSHOTS}/${info.project.name}-${shape.name.replace(" ", "-")}-list.png`, fullPage: true });
      }

      // A deep link typed straight in, to a route that needs a lazy chunk.
      await page.goto(at("notes/new"));
      await expect(page.getByLabel("Title")).toBeVisible();

      // Both lazy chunks came from under this address, and loaded.
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of chunks) expect(chunk).toMatch(new RegExp(`^200 ${escape(at("assets/"))}`));
      expect(problems).toEqual([]);
    });

    test("the API answers under this address, and only signed-in people write", async ({ request }) => {
      const list = await request.get(at("api/notes"));
      expect(list.status()).toBe(200);
      expect(Array.isArray(await list.json())).toBe(true);

      const refused = await request.post(at("api/notes"), { data: { title: "anonymous" } });
      expect(refused.status()).toBe(401);
      const problem = await refused.json();
      expect(problem.signInUrl).toBe(`${shape.base}_endgame/auth/sign-in?returnTo=${encodeURIComponent(shape.base)}`);

      const health = await request.get(at("health"));
      expect(await health.json()).toMatchObject({ status: "healthy", database: "reachable" });

      const doc = await request.get(at("openapi/v1.json"));
      const ids = Object.values((await doc.json()).paths as Record<string, Record<string, { operationId: string }>>)
        .flatMap((ops) => Object.values(ops).map((o) => o.operationId))
        .sort();
      expect(ids).toEqual(["createNote", "getCurrentUser", "getNote", "listNotes"]);

      // Platform callbacks are never reachable from the public side.
      expect((await request.post(at("_platform/schedules/anything"))).status()).toBe(404);
    });
  });
}

test("the app reported to the platform, and every platform call went out through the egress proxy", async ({ request }) => {
  test.skip(edge, "The dev platform's state view exists only in the test double; against the real stack, `make e2e-stack` checks telemetry in the control plane.");
  const platformPort = required("PW_PLATFORM_PORT");
  let state: { otlpRequests: Record<string, number>; events: { name: string }[]; egress: string[] } | undefined;
  await expect
    .poll(
      async () => {
        state = await (await request.get(`http://127.0.0.1:${platformPort}/dev/state`)).json();
        return (state?.otlpRequests.traces ?? 0) > 0 && (state?.otlpRequests.logs ?? 0) > 0;
      },
      { timeout: 20_000, message: "traces and logs reached the platform collector" },
    )
    .toBe(true);

  expect(state?.events.some((e) => e.name === "note.created")).toBe(true);
  const egress = state?.egress ?? [];
  expect(egress).toContain("POST http://test-appkit-platform:8080/platform/v1/identity/resolve");
  expect(egress.some((line) => line.startsWith("PUT http://test-appkit-platform:8080/platform/v1/schedules"))).toBe(true);
  expect(egress.some((line) => line.includes("/platform/v1/otlp/v1/traces"))).toBe(true);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
