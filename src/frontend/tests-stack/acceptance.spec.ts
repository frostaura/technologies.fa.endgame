import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, request as apiRequest, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The merged stack's acceptance test: one story, in order, against the REAL stack (see
 * playwright.stack.config.ts). Nothing is mocked. Where the Runner will one day drive Dock, this test
 * drives Dock's internal API itself — exactly the calls the Runner makes.
 */

const EDGE = need("STACK_EDGE");
const DOCK = need("STACK_DOCK");
const TOKEN = need("STACK_SERVICE_TOKEN");
const MAIL = need("STACK_MAIL");
const STATE = need("STACK_STATE");

const run = randomBytes(3).toString("hex");
const org = `e2e-${run}`;
const division = "labs";
const project = "probe";
const ownerEmail = "dev@frostaura.net"; // the console's development sign-in, unnamed
const operatorEmail = "operator@endgame.localhost";
const strangerEmail = `stranger-${run}@endgame.localhost`;
const edge = new URL(EDGE);
const subdomainOrigin = `${edge.protocol}//${org}.localhost:${edge.port}`;
const PROBE = path.join(import.meta.dirname, "probe");

const at = {
  path: (app: string, rest = "") => `${EDGE}/${org}/${division}/${project}/${app}/${rest}`,
  subdomain: (app: string, rest = "") => `${subdomainOrigin}/${division}/${project}/${app}/${rest}`,
};

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run this suite through \`make e2e-stack\`.`);
  return value;
}

/** Shared across the story's steps; each step builds on the last. */
const story = {
  organisationId: "",
  probeApp: "",
  kitApp: "",
  secret: randomBytes(18).toString("base64url"),
  hookToken: randomBytes(18).toString("base64url"),
  wakes: [] as { wakeMs: number; firstByteMs: number }[],
};

let owner: BrowserContext;
let operator: BrowserContext;
let dock: APIRequestContext;
const evidence: string[] = [];

function note(line: string) {
  evidence.push(line);
  console.log(`  evidence: ${line}`);
}

async function ok(response: APIResponse, status = 200): Promise<unknown> {
  const text = await response.text();
  expect(response.status(), `${response.url()} → ${response.status()}: ${text.slice(0, 400)}`).toBe(status);
  return text.length > 0 ? JSON.parse(text) : null;
}

async function dockCall<T>(method: "GET" | "POST" | "PUT" | "DELETE", route: string, data?: unknown, status = 200): Promise<T> {
  const response = await dock.fetch(`${DOCK}${route}`, { method, data });
  return (await ok(response, status)) as T;
}

async function signedIn(browser: Browser, email: string, displayName: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: EDGE });
  await ok(await context.request.post("/api/auth/development", { data: { email, displayName } }));
  return context;
}

/** Builds an app from what its repository holds now, starts it, and waits until the edge serves it. */
async function buildAndStart(appId: string) {
  const started = Date.now();
  const build = await dockCall<{ commit: string; image: string; durationMs: number }>("POST", `/internal/apps/${appId}/build`, { ref: null });
  note(`app ${appId} built from ${build.commit.slice(0, 12)} in ${(build.durationMs / 1000).toFixed(0)} s (image ${build.image})`);
  const status = await dockCall<{ state: string }>("POST", `/internal/apps/${appId}/start`, {
    organisationId: story.organisationId, image: null, appToken: null, limits: null, allowedHosts: null,
  });
  expect(status.state).toBe("running");
  note(`app ${appId} started by Dock ${((Date.now() - started) / 1000).toFixed(0)} s after the build was asked for`);
}

async function createApp(slug: string, name: string): Promise<string> {
  const created = (await ok(await owner.request.post("/api/apps", { data: { parent: `${org}/${division}/${project}`, name, slug } }), 201)) as { id: string };
  await mkdir(STATE, { recursive: true });
  await appendFile(path.join(STATE, "apps"), `${created.id}\n`);
  await dockCall("POST", "/internal/repos", { appId: created.id }, 201);
  return created.id;
}

async function appDetail(appId: string) {
  return (await ok(await owner.request.get(`/api/apps/${appId}`))) as {
    telemetry: { requestsToday: number; visitsToday: number; latencyP50Ms: number | null } | null;
    health: { state: string };
    settings: { access: string };
    addresses: { path: string; subdomain: string };
  };
}

async function waitForApp(page: Page, url: string) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  dock = await apiRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` }, timeout: 20 * 60_000 });
  owner = await browser.newContext({ baseURL: EDGE });
});

test.afterAll(async () => {
  await mkdir(STATE, { recursive: true });
  await writeFile(path.join(STATE, "evidence.txt"), `${evidence.join("\n")}\n`);
  await dock?.dispose();
  await owner?.close();
  await operator?.close();
});

test("1. the development sign-in, through the console", async ({ browser }) => {
  const page = await owner.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Development sign-in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  const me = (await ok(await owner.request.get("/api/me"))) as { user: { email: string } };
  expect(me.user.email).toBe(ownerEmail);
  operator = await signedIn(browser, operatorEmail, "FrostAura operator");
  await page.close();
});

test("2. the organisation, a division, a project and two apps, through the API", async () => {
  const named = { name: `E2E ${run}`, slug: org };
  let created = await owner.request.post("/api/organisations", { data: named });
  if (created.status() === 403) {
    // Not the stack's first run: organisations after the first are provisioned by an operator.
    created = await operator.request.post("/api/organisations", { data: { ...named, ownerEmail } });
  }

  story.organisationId = ((await ok(created, 201)) as { id: string }).id;
  await ok(await owner.request.post("/api/divisions", { data: { parent: org, name: "Labs", slug: division } }), 201);
  await ok(await owner.request.post("/api/projects", { data: { parent: `${org}/${division}`, name: "Probe", slug: project } }), 201);
  story.probeApp = await createApp("notes", "Notes");
  story.kitApp = await createApp("kit", "Kit");
  // FrostAura's overdraft for the organisation: it may run 100 credits below zero.
  await ok(await operator.request.put("/api/cascade", { data: { scope: org, kind: "setting", key: "overdraft_limit", value: 100 } }));
  note(`organisation ${org} (${story.organisationId}); apps notes ${story.probeApp}, kit ${story.kitApp}`);
});

test("3. Dock builds the app from the template, with the probe committed through a workspace, and starts it", async () => {
  await expect(async () => {
    const health = (await ok(await dock.get(`${DOCK}/health`))) as { workspaceImage: string; template: string };
    expect(health.template).toBe("present");
    expect(health.workspaceImage).toBe("ready");
  }).toPass({ timeout: 20 * 60_000, intervals: [5_000] });

  // An agent's way in: a workspace on the app's repository, two files written, committed.
  const runId = randomUUID();
  await dockCall("POST", "/internal/workspaces", {
    runId, appId: story.probeApp, ref: null, leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), limits: null, allowedHosts: null,
  }, 201);
  try {
    for (const [file, target] of [["ProbeEndpoints.cs", "api/Probe/ProbeEndpoints.cs"], ["Program.cs", "api/Program.cs"]] as const) {
      await dockCall("PUT", `/internal/workspaces/${runId}/files`, { path: target, content: await readFile(path.join(PROBE, file), "utf8"), encoding: null });
    }
    const commit = await dockCall<{ commitId: string; changed: boolean }>("POST", `/internal/workspaces/${runId}/commit`, {
      message: "Add the acceptance probe", authorName: "Acceptance test", authorEmail: "acceptance@endgame.localhost",
    });
    expect(commit.changed).toBe(true);
  } finally {
    await dock.delete(`${DOCK}/internal/workspaces/${runId}`);
  }

  await buildAndStart(story.probeApp);
  await buildAndStart(story.kitApp);
});

test("4. both address shapes through the real Edge; private: signed out to sign-in, a member in, the session handed off to the subdomain", async ({ browser }) => {
  const page = await owner.newPage();
  await waitForApp(page, at.path("notes"));
  await expect(page.getByTestId("signed-in-as")).not.toBeEmpty();
  expect(await page.evaluate(() => document.baseURI)).toBe(at.path("notes"));

  // The subdomain: no cookie there yet, so sign-in moves to the platform's host, finds the member's
  // session and hands it back as the subdomain's own cookie.
  await page.goto(at.subdomain("notes", "notes/new"));
  await expect(page).toHaveURL(at.subdomain("notes", "notes/new"), { timeout: 20_000 });
  await expect(page.getByTestId("signed-in-as")).not.toBeEmpty();
  expect(await page.evaluate(() => document.baseURI)).toBe(at.subdomain("notes"));
  const subdomainCookies = await owner.cookies(subdomainOrigin);
  expect(subdomainCookies.map((c) => c.name)).toContain(`endgame.app.${story.probeApp.replaceAll("-", "")}`);
  note("subdomain session handed off: endgame.app.<id> set host-only on the organisation subdomain");

  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto(at.path("notes"));
  await expect(visitor).toHaveURL(/\/_endgame\/auth\/sign-in\?returnTo=/);
  await expect(visitor.getByRole("heading", { name: "Sign in to Notes" })).toBeVisible();
  const api = await anonymous.request.get(at.path("notes", "api/notes"), { maxRedirects: 0 });
  expect(api.status()).toBe(302);
  await visitor.goto(at.subdomain("notes"));
  await expect(visitor).toHaveURL(new RegExp(`^${EDGE}/${org}/${division}/${project}/notes/_endgame/auth/sign-in\\?returnTo=`));
  await anonymous.close();

  const stranger = await signedIn(browser, strangerEmail, "A stranger");
  const outsider = await stranger.newPage();
  const refused = await outsider.goto(at.path("notes"));
  expect(refused?.status()).toBe(403);
  await expect(outsider.getByRole("heading", { name: "You don't have access to this app" })).toBeVisible();
  await stranger.close();
  await page.close();
});

test("5. a secret set at the organisation is read from inside the app through the platform API", async () => {
  await ok(await owner.request.put("/api/secrets", { data: { scope: org, name: "PROBE_SECRET", value: story.secret } }));
  const listed = await owner.request.get(`/api/secrets?scope=${encodeURIComponent(`${org}/${division}/${project}/notes`)}`);
  const text = await listed.text();
  expect(text).not.toContain(story.secret);
  const effective = (JSON.parse(text) as { effective: { name: string; setAtLevel: string; inherited: boolean }[] }).effective;
  expect(effective).toContainEqual(expect.objectContaining({ name: "PROBE_SECRET", setAtLevel: "organisation", inherited: true }));

  const read = (await ok(await owner.request.get(at.path("notes", "api/probe/secrets/PROBE_SECRET")))) as { name: string; sha256: string };
  expect(read.sha256).toBe(createHash("sha256").update(story.secret).digest("hex"));
  note("secret PROBE_SECRET set at the organisation, read inside the app: hashes match");
});

test("6. the app sleeps when idle and a request wakes it", async () => {
  await ok(await owner.request.post(`/api/apps/${story.probeApp}/settings`, { data: { idleMinutes: 1 } }));
  for (let i = 0; i < 3; i++) {
    await expect(async () => {
      const status = (await ok(await dock.get(`${DOCK}/internal/apps/${story.probeApp}`))) as { state: string };
      expect(status.state).toBe("sleeping");
    }).toPass({ timeout: 90_000, intervals: [1_000] });
    const started = performance.now();
    const response = await owner.request.get(at.path("notes", "api/notes"));
    const firstByteMs = Math.round(performance.now() - started);
    expect(response.status()).toBe(200);
    const wakeMs = Number(response.headers()["x-endgame-wake-ms"]);
    expect(wakeMs, "the edge reports the wake").toBeGreaterThan(0);
    story.wakes.push({ wakeMs, firstByteMs });
  }

  await ok(await owner.request.post(`/api/apps/${story.probeApp}/settings`, { data: { idleMinutes: 15 } }));
  note(`wakes (edge wake ms / first byte ms): ${story.wakes.map((w) => `${w.wakeMs}/${w.firstByteMs}`).join(", ")}`);
});

test("7. an e-mail sent from the app arrives in the mail catcher", async () => {
  const to = `e2e-${run}@endgame.localhost`;
  const subject = `Endgame acceptance ${run}`;
  const queued = (await ok(await owner.request.post(at.path("notes", "api/probe/email"), { data: { to, subject } }))) as { id: string };
  expect(queued.id).toMatch(/^eml_/);
  const mail = await apiRequest.newContext();
  try {
    await expect(async () => {
      const found = (await ok(await mail.get(`${MAIL}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`))) as {
        messages_count: number; messages: { To: { Address: string }[] }[];
      };
      expect(found.messages_count).toBe(1);
      expect(found.messages[0]?.To.map((t) => t.Address)).toEqual([to]);
    }).toPass({ timeout: 60_000, intervals: [1_000] });
  } finally {
    await mail.dispose();
  }
  note(`e-mail ${queued.id} delivered to the mail catcher`);
});

test("8. a declared schedule is called back, signed, through the edge's control listener", async () => {
  let runs: string[] = [];
  await expect(async () => {
    runs = (await ok(await owner.request.get(at.path("notes", "api/probe/schedule-runs")))) as string[];
    expect(runs.length).toBeGreaterThan(0);
  }).toPass({ timeout: 150_000, intervals: [2_000] });
  note(`schedule probe-minute called back: first run scheduled for ${runs[0]}`);
});

test("9. a declared webhook reaches the private app with no session; an undeclared one does not", async () => {
  await ok(await owner.request.put("/api/secrets", { data: { scope: `${org}/${division}/${project}/notes`, name: "PROBE_HOOK_TOKEN", value: story.hookToken } }));
  const outside = await apiRequest.newContext();
  try {
    await expect(async () => {
      const hook = await outside.post(at.path("notes", "hooks/probe-hook"), { headers: { "X-Probe-Token": story.hookToken }, data: "ping", maxRedirects: 0 });
      expect(hook.status()).toBe(200);
      expect(await hook.json()).toEqual({ received: "ping" });
    }).toPass({ timeout: 30_000 });
    const forged = await outside.post(at.path("notes", "hooks/probe-hook"), { headers: { "X-Probe-Token": "wrong" }, data: "ping", maxRedirects: 0 });
    expect(forged.status()).toBe(401); // the app's own verification
    const undeclared = await outside.post(at.path("notes", "hooks/other"), { data: "ping", maxRedirects: 0 });
    expect(undeclared.status()).toBe(401); // the edge: sign in first
    expect(undeclared.headers().location).toContain("/_endgame/auth/sign-in?returnTo=");
  } finally {
    await outside.dispose();
  }
});

test("10. telemetry appears in GET /api/apps/{id}", async () => {
  let telemetry: NonNullable<Awaited<ReturnType<typeof appDetail>>["telemetry"]> | null = null;
  await expect(async () => {
    telemetry = (await appDetail(story.probeApp)).telemetry;
    expect(telemetry?.requestsToday ?? 0).toBeGreaterThan(0);
  }).toPass({ timeout: 120_000, intervals: [3_000] });
  note(`telemetry: ${JSON.stringify(telemetry)}`);
});

test("11. hosting usage appears as credit entries", async () => {
  let month: { spent: number; hosting: number } = { spent: 0, hosting: 0 };
  let balance = 0;
  await expect(async () => {
    const credits = (await ok(await owner.request.get(`/api/credits?scope=${org}`))) as { balance: number; month: { spent: number; hosting: number } };
    month = credits.month;
    balance = credits.balance;
    expect(month.hosting).toBeGreaterThan(0);
    expect(balance).toBeLessThan(0);
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  note(`hosting this month ${month.hosting} credits; balance ${balance}`);

  // The console's app page, with measured telemetry and cost, at desktop and phone width.
  const page = await owner.newPage();
  await page.goto(`/apps/${story.probeApp}`);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByText("Visits today")).toBeVisible();
  const still = { fullPage: true, animations: "disabled" } as const;
  await page.screenshot({ ...still, path: path.join(STATE, "console-app-desktop.png") });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ ...still, path: path.join(STATE, "console-app-phone.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/credits`);
  await expect(page.getByText("On hosting")).toBeVisible();
  await page.screenshot({ ...still, path: path.join(STATE, "console-credits-desktop.png") });
  await page.close();
});

test("12. made public by a person, the app opens signed out", async ({ browser }) => {
  await ok(await owner.request.post(`/api/apps/${story.probeApp}/settings`, { data: { access: "public" } }));
  await ok(await owner.request.post(`/api/apps/${story.kitApp}/settings`, { data: { access: "public" } }));
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await waitForApp(page, at.path("notes"));
  await expect(page.getByTestId("signed-in-as")).toHaveCount(0); // anonymous, and let in
  await anonymous.close();
});

test("13. at the overdraft limit the app is paused; an operator's top-up brings it back", async ({ browser }) => {
  // The Owner narrows the organisation's own overdraft to zero; hosting has already spent below it.
  await ok(await owner.request.put("/api/cascade", { data: { scope: org, kind: "setting", key: "overdraft_own_limit", value: 0 } }));
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await expect(async () => {
    const response = await page.goto(at.path("notes"));
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { name: "This app is paused" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText("used up its credits")).toBeVisible();
  await page.screenshot({ path: path.join(STATE, "paused-page.png") });
  note("paused page served at the overdraft limit");

  await ok(await operator.request.post("/api/credits/top-ups", { data: { organisation: org, credits: 25, note: "acceptance top-up" } }));
  await waitForApp(page, at.path("notes"));
  note("top-up by an operator: app served again");

  const audit = (await ok(await owner.request.get(`/api/audit/operator-access?organisation=${org}`))) as { action: string }[];
  expect(audit.length).toBeGreaterThan(0);
  note(`operator actions the Owner can read: ${audit.map((a) => a.action).join(", ")}`);
  await anonymous.close();

  // For the app kit's proof, next (proof/edge.sh): the untouched template, public, at both addresses.
  await writeFile(path.join(STATE, "proof.env"), [
    `PW_PATH_URL=${at.path("kit")}`,
    `PW_HOST_URL=${at.subdomain("kit")}`,
    `PW_MEMBER_EMAIL=${ownerEmail}`,
  ].join("\n") + "\n");
});
