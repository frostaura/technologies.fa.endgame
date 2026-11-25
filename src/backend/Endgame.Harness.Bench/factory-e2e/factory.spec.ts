import { randomBytes } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The factory's proof (TEST-201): an idea taken all the way to a running private app, through the
 * public API exactly as the console drives it, with LIVE models. Nothing is mocked. It spends real
 * money, so it watches the credit ledger and cancels everything at FAC_SPEND_STOP_USD.
 */

const EDGE = need("FAC_EDGE");
const STATE = need("FAC_STATE");
const STOP_USD = Number(process.env.FAC_SPEND_STOP_USD ?? "8.50");
const CREDITS_PER_USD = 100; // CreditOptions.CreditsPerUsd, margin 1.0 in development

const IDEA =
  "A reading-list app for a small book club: members sign in, add books with a title, author and a one-line note, mark a book as reading or finished, and see what everyone is reading now.";

/** Set to an app's path (org/division/project/app) to replay only the browser step against an app already built. */
const REUSE = process.env.FAC_APP_PATH ?? "";
const run = randomBytes(3).toString("hex");
const org = `fac-${run}`;
const ownerEmail = "dev@frostaura.net";
const operatorEmail = "operator@endgame.localhost";
const started = Date.now();

const story = {
  ideaId: "",
  researchRunId: "",
  buildRunId: "",
  appId: "",
  appPath: "",
  verdict: null as Record<string, unknown> | null,
  report: {} as Record<string, unknown>,
};

let owner: BrowserContext;
let operator: BrowserContext;

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run this through \`make e2e-factory\`.`);
  return value;
}

async function note(line: string) {
  console.log(`  ${line}`);
  await appendFile(path.join(STATE, "evidence.txt"), `${new Date().toISOString()} ${line}\n`);
}

async function ok<T = Record<string, unknown>>(response: APIResponse, status = 200): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} answered ${response.status()}: ${text.slice(0, 1500)}`).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

async function signedIn(browser: Browser, email: string, displayName: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: EDGE });
  await ok(await context.request.post("/api/auth/development", { data: { email, displayName } }));
  return context;
}

/** What the run has really cost, in US$: billed AI work plus repairs, which are not charged but are paid for. */
async function spentUsd(): Promise<{ usd: number; ai: number; notCharged: number; hosting: number }> {
  const credits = await ok<{ month: { ai: number; hosting: number }; notCharged: { credits: number } }>(await owner.request.get(`/api/credits?scope=${org}`));
  const ai = credits.month.ai;
  const notCharged = credits.notCharged.credits;
  return { usd: (ai + notCharged) / CREDITS_PER_USD, ai, notCharged, hosting: credits.month.hosting };
}

/** Polls a run to an end, cancelling it (and failing) if the spend reaches the stop. */
async function follow(runId: string, label: string, minutes: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + minutes * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const view = await ok(await owner.request.get(`/api/runs/${runId}`));
    const status = String(view.status);
    const spend = await spentUsd();
    if (`${status}` !== last) await note(`${label} ${runId}: ${status} (spent so far US$${spend.usd.toFixed(4)})`);
    last = status;
    if (spend.usd >= STOP_USD) {
      await owner.request.post(`/api/runs/${runId}/cancel`);
      throw new Error(`Spend reached US$${spend.usd.toFixed(2)}, at or past the stop of US$${STOP_USD}: ${label} cancelled.`);
    }
    if (["finished", "failed", "cancelled"].includes(status)) return view;
    if (status === "paused" || status === "waiting") await note(`${label} is ${status}: ${JSON.stringify(view).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`${label} did not finish in ${minutes} minutes.`);
}

/** The run's whole log, read from its event stream (the console's own feed) until it goes quiet. */
async function events(runId: string): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const controller = new AbortController();
  const cookies = (await owner.cookies(EDGE)).map((c) => `${c.name}=${c.value}`).join("; ");
  const response = await fetch(`${EDGE}/api/runs/${runId}/events`, { headers: { cookie: cookies, accept: "text/event-stream" }, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // aborted: the stream stays open for a live run, and this one has finished.
  } finally {
    clearTimeout(timer);
  }

  const out: { type: string; payload: Record<string, unknown> }[] = [];
  for (const block of text.split("\n\n")) {
    const type = /^event: (.+)$/m.exec(block)?.[1] ?? "message";
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as { type?: string; payload?: Record<string, unknown> };
      out.push({ type: parsed.type ?? type, payload: parsed.payload ?? (parsed as Record<string, unknown>) });
    } catch {
      // a comment or keep-alive
    }
  }
  return out;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await mkdir(STATE, { recursive: true });
  owner = await signedIn(browser, ownerEmail, "Development owner");
  operator = await signedIn(browser, operatorEmail, "FrostAura operator");
});

test.afterAll(async () => {
  story.report.wallMinutes = Math.round((Date.now() - started) / 600) / 100;
  try {
    story.report.spend = await spentUsd();
  } catch {
    // the report keeps what it has
  }
  await writeFile(path.join(STATE, "report.json"), JSON.stringify(story.report, null, 2));
  await owner?.close();
  await operator?.close();
});

test("1. the organisation, topped up by an operator", async () => {
  test.skip(!!REUSE, "replaying the browser step against an app already built");
  const named = { name: `Factory ${run}`, slug: org };
  let created = await owner.request.post("/api/organisations", { data: named });
  if (created.status() === 403) created = await operator.request.post("/api/organisations", { data: { ...named, ownerEmail } });
  await ok(created, 201);
  await ok(await operator.request.post("/api/credits/top-ups", { data: { organisation: org, credits: 3000, note: "factory proof top-up" } }));
  await note(`organisation ${org}, topped up with 3000 credits`);
});

test("2. the idea, researched with live web search, ends in the agreed verdict", async () => {
  test.skip(!!REUSE, "replaying the browser step against an app already built");
  const estimate = await ok<{ credits: number; basis: string }>(await owner.request.post("/api/ideas/estimate", { data: { text: IDEA, constraints: [] } }));
  await note(`research estimate shown first: ${estimate.credits} credits`);
  const idea = await ok<{ id: string; runId: string }>(await owner.request.post("/api/ideas", { data: { text: IDEA, constraints: [], scope: org } }), 201);
  story.ideaId = idea.id;
  story.researchRunId = idea.runId;
  const research = await follow(idea.runId, "research", 20);
  expect(research.status, JSON.stringify(research)).toBe("finished");
  const read = await ok<{ status: string; verdict: Record<string, unknown>; redLine: string | null; decision: { runId: string | null; via: string } | null }>(await owner.request.get(`/api/ideas/${idea.id}`));
  story.verdict = read.verdict;
  const keys = ["outcome", "headline", "summary", "against", "suggestedChange", "existing", "gap", "demand", "wouldChange", "redLines", "placement", "method", "rulesApplied"];
  expect(Object.keys(read.verdict).sort()).toEqual([...keys].sort());
  expect(Array.isArray((read.verdict.existing as { products: unknown[] }).products)).toBe(true);
  const method = read.verdict.method as { searches: number; strands: { id: string; searches: number; sources: number; confidence: string }[]; confidence: string };
  story.report.research = {
    estimateCredits: estimate.credits,
    spentCredits: research.spentCredits,
    outcome: read.verdict.outcome,
    headline: read.verdict.headline,
    products: (read.verdict.existing as { products: { name: string }[] }).products.map((p) => p.name),
    sources: (read.verdict.existing as { sources: string[] }).sources.length,
    method,
    redLine: read.redLine,
  };
  await note(`verdict ${read.verdict.outcome}: ${read.verdict.headline} — ${method.searches} searches, confidence ${method.confidence}`);

  const log = await events(idea.runId);
  const messages = log.filter((e) => e.type === "message" && !e.payload.kind && e.payload.from !== "owner");
  for (const m of messages) {
    expect(String(m.payload.text)).not.toContain("{");
    expect(String(m.payload.title ?? "").length).toBeGreaterThan(0);
  }
  expect(messages.filter((m) => m.payload.milestone === "verdict")).toHaveLength(1);
  story.report.researchMessages = messages.map((m) => `${m.payload.title}: ${m.payload.text}`);
  story.report.researchActions = log.filter((e) => e.type === "subagent.started" || e.type === "tool.requested").length;

  // Whatever the verdict, it proceeds to build: auto-mode on build or change; an explicit overrule on a do-not-build.
  if (read.verdict.outcome === "do-not-build") {
    if (read.redLine) {
      const refused = await owner.request.post(`/api/ideas/${idea.id}/decision`, { data: { choice: "overrule" } });
      expect(refused.status()).toBe(403);
      throw new Error(`The verdict records a red line (${read.redLine}); nobody may build it, so the proof stops here.`);
    }
    const decided = await ok<{ decision: { runId: string } }>(await owner.request.post(`/api/ideas/${idea.id}/decision`, { data: { choice: "overrule", note: "The factory proof builds it regardless." } }));
    story.buildRunId = decided.decision.runId;
    story.report.decision = "overruled by the owner";
  } else {
    expect(read.decision?.via).toBe("auto-mode");
    story.buildRunId = read.decision!.runId!;
    story.report.decision = "auto-mode";
  }
  await note(`build run ${story.buildRunId} (${story.report.decision})`);
});

test("3. placement, hires, plan, builders, evaluator, security review and a private publish", async () => {
  test.skip(!!REUSE, "replaying the browser step against an app already built");
  const build = await follow(story.buildRunId, "build", 110);
  const log = await events(story.buildRunId);
  const count = (type: string) => log.filter((e) => e.type === type).length;
  const evaluations = log.filter((e) => e.type.startsWith("evaluation."));
  story.report.build = {
    status: build.status,
    summary: build.summary ?? build.finishedSummary,
    spentCredits: build.spentCredits,
    estimateCredits: build.estimateCredits,
    plan: log.filter((e) => e.type === "plan.accepted").map((e) => e.payload.items)[0],
    requirements: log.filter((e) => e.type === "plan.accepted").map((e) => e.payload.requirements)[0],
    leftOut: log.filter((e) => e.type === "plan.accepted").map((e) => e.payload.leftOut)[0],
    appCalls: log.filter((e) => e.type === "tool.requested" && e.payload.name === "call_app").length,
    builderSessions: new Set(log.filter((e) => String(e.payload.agent ?? "").startsWith("builder-")).map((e) => e.payload.agent)).size,
    evaluations: evaluations.map((e) => ({ item: e.payload.item, passed: e.type === "evaluation.passed", round: e.payload.round, tier: e.payload.tier, summary: e.payload.summary, requirements: e.payload.requirements, faults: e.payload.faults })),
    repairs: evaluations.filter((e) => e.type === "evaluation.failed").length,
    tiers: [...new Set(evaluations.map((e) => e.payload.tier))],
    probes: log.filter((e) => e.type === "tool.requested" && e.payload.name === "check_preview").length,
    scored: log.filter((e) => e.type === "estimate.scored").map((e) => e.payload),
    messages: log.filter((e) => e.type === "message" && !e.payload.kind && e.payload.from !== "owner").map((e) => `${e.payload.title}: ${e.payload.text}`),
    toolCalls: count("tool.requested"),
    modelCalls: count("model.replied"),
  };
  await note(`build ${build.status}: ${JSON.stringify(story.report.build).slice(0, 1500)}`);
  expect(build.status, String(build.summary ?? JSON.stringify(build))).toBe("finished");

  // The plan is a faithful contract: "see what everyone is reading now" is a requirement of its own, delivered by an
  // item, never silently dropped, and the evaluator showed it working in the running app, signed in.
  const accepted = log.find((e) => e.type === "plan.accepted")!.payload as {
    requirements: { id: string; text: string }[];
    items: { id: string; text: string; covers: string[] }[];
    leftOut: { requirement: string; reason: string }[];
  };
  const readingNow = accepted.requirements.find((r) => /reading now/i.test(r.text));
  expect(readingNow, `requirements: ${JSON.stringify(accepted.requirements)}`).toBeTruthy();
  expect(accepted.leftOut.map((l) => l.requirement)).not.toContain(readingNow!.id);
  const delivering = accepted.items.filter((i) => i.covers.includes(readingNow!.id)).map((i) => i.id);
  expect(delivering.length).toBeGreaterThan(0);
  const shown = evaluations.filter((e) => e.type === "evaluation.passed" && delivering.includes(String(e.payload.item)))
    .flatMap((e) => (e.payload.requirements as { id: string; met: boolean; calls: string[] }[]) ?? [])
    .filter((r) => r.id === readingNow!.id && r.met && r.calls.length > 0);
  expect(shown.length, "the evaluator evidenced 'reading now' with a signed-in call").toBeGreaterThan(0);
  story.report.readingNow = { requirement: readingNow, items: delivering, evidence: shown };
  await note(`"reading now" is ${readingNow!.id}, delivered by ${delivering.join(", ")}, evidenced by ${JSON.stringify(shown.map((r) => r.calls))}`);

  const hires = await ok<{ name: string; role: string; status: string; trigger: string }[]>(await owner.request.get(`/api/hires?scope=${org}`));
  story.report.hires = hires.map((h) => `${h.name}, ${h.role}: ${h.status} (${h.trigger})`);
  expect(hires.filter((h) => h.status === "accepted").length).toBeGreaterThanOrEqual(2);

  const tree = await ok<{ divisions: { slug: string; projects: { slug: string; apps: { id: string; slug: string }[] }[] }[] }>(await owner.request.get(`/api/tree?organisation=${org}`));
  const apps = tree.divisions.flatMap((d) => d.projects.flatMap((p) => p.apps.map((a) => ({ ...a, path: `${org}/${d.slug}/${p.slug}/${a.slug}` }))));
  expect(apps.length).toBeGreaterThan(0);
  story.appId = apps[0].id;
  story.appPath = apps[0].path;
  await appendFile(path.join(STATE, "apps"), `${story.appId}\n`);
  const detail = await ok<{ access: string; settings: { access: string } }>(await owner.request.get(`/api/apps/${story.appId}`));
  story.report.app = { id: story.appId, path: story.appPath, access: detail.settings?.access ?? detail.access };
  await note(`app ${story.appPath} (${story.appId}), access ${JSON.stringify(story.report.app)}`);
});

/**
 * The app kit's test ids (template AGENTS.md, the write-a-screen skill): every built app names its controls the same way,
 * so the driver needs no knowledge of how a particular build laid them out. `<entity>` is "book" for this idea.
 */
function bookItem(page: Page, title: string) {
  return page.getByTestId("book-item").filter({ hasText: title }).first();
}

/** Sets a book's status with its `set-<field>-<value>` button: on its item when the list offers it, otherwise on its own page. */
async function setStatus(page: Page, title: string, status: "reading" | "finished") {
  const setter = (scope: Page | ReturnType<Page["getByTestId"]>) => scope.locator(`[data-testid^="set-"][data-testid$="-${status}"]`).first();
  const anySetter = (scope: Page | ReturnType<Page["getByTestId"]>) => scope.locator('[data-testid^="set-"]').first();
  const item = bookItem(page, title);
  await expect(item).toBeVisible({ timeout: 20_000 });
  let scope: Page | ReturnType<Page["getByTestId"]> = item;
  if (!(await anySetter(item).count())) {
    await item.getByTestId("open-book").first().click();
    await expect(anySetter(page)).toBeVisible({ timeout: 20_000 });
    scope = page;
  }
  // A book already in that status offers no button for it, or a disabled one (a new book starts as "reading" in some
  // builds): nothing to do.
  if (!(await setter(scope).count()) || (await setter(scope).isDisabled())) {
    await expect(scope === page ? page.getByRole("main") : item).toContainText(new RegExp(status, "i"));
    return;
  }
  const saved = page.waitForResponse((r) => ["PATCH", "PUT", "POST"].includes(r.request().method()) && /books/.test(r.url()));
  await setter(scope).click();
  expect((await saved).status()).toBeLessThan(300);
}

async function openApp(page: Page) {
  await expect(async () => {
    const response = await page.goto(`${EDGE}/${story.appPath}/`);
    expect(response?.status()).toBe(200);
  }).toPass({ timeout: 90_000, intervals: [3_000] });
}

test("4. private: a signed-out visitor is refused; the owner opens it, adds two books, finishes one, and they stay", async ({ browser }) => {
  if (REUSE) story.appPath = REUSE;
  const anonymous = await browser.newContext();
  const outside = await anonymous.newPage();
  await outside.goto(`${EDGE}/${story.appPath}/`);
  await expect(outside).toHaveURL(/_endgame\/auth\/sign-in/);
  await outside.screenshot({ path: path.join(STATE, "signed-out.png"), fullPage: true });
  await anonymous.close();
  await note("signed out: sent to the edge's sign-in page");

  const page = await owner.newPage();
  await openApp(page);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(STATE, "1-home.png"), fullPage: true });

  const books = [
    { title: `The Left Hand of Darkness (${run})`, author: "Ursula K. Le Guin", note: "Our pick for December." },
    { title: `Piranesi (${run})`, author: "Susanna Clarke", note: "Short and strange; everyone loved it." },
  ];
  await expect(page.getByTestId("page-home")).toBeVisible({ timeout: 30_000 });
  for (const book of books) {
    await page.getByTestId("new-book").first().click();
    await page.getByTestId("book-title").fill(book.title);
    await page.getByTestId("book-author").fill(book.author);
    if (await page.getByTestId("book-note").count()) await page.getByTestId("book-note").fill(book.note);
    await page.getByTestId("save-book").click();
    await expect(bookItem(page, book.title).or(page.getByText(book.title).first())).toBeVisible({ timeout: 20_000 });
    await openApp(page);
  }
  for (const book of books) await expect(bookItem(page, book.title)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(STATE, "2-two-books.png"), fullPage: true });

  // Mark the second one finished, wherever the app puts the control: a button on its card, or the book's own page.
  await setStatus(page, books[1].title, "finished");
  await page.screenshot({ path: path.join(STATE, "3-finished.png"), fullPage: true });

  // A reload, and both are still there, the second one finished.
  await openApp(page);
  await page.reload();
  await page.waitForLoadState("networkidle");
  for (const book of books) await expect(bookItem(page, book.title)).toBeVisible({ timeout: 20_000 });
  await expect(bookItem(page, books[1].title)).toContainText(/finished/i);
  await page.screenshot({ path: path.join(STATE, "4-after-reload.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(STATE, "5-phone.png"), fullPage: true });
  await note("owner: two books added, one finished, both still there after a reload");

  // What everyone is reading now: mark the first book "reading", then find the view that shows it as such.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await setStatus(page, books[0].title, "reading");
  await openApp(page);
  await page.waitForLoadState("networkidle");
  // The app's own way to it: a `nav-<view>` link to a view of its own (`page-<view>` naming reading), or the home page
  // when that is where the app shows what is being read.
  const nav = page.locator('[data-testid^="nav-"]').filter({ hasText: /reading|everyone/i });
  if (await nav.count()) await nav.first().click();
  await page.waitForLoadState("networkidle");
  const own = page.locator('[data-testid^="page-"][data-testid*="reading"]');
  const dedicated = (await own.count()) > 0;
  const region = dedicated ? own.first() : page.getByTestId("page-home");
  await expect(region).toBeVisible({ timeout: 20_000 });
  await expect(region.getByTestId("book-item").filter({ hasText: books[0].title }).first()).toContainText(/reading/i, { timeout: 20_000 });
  const finished = region.getByTestId("book-item").filter({ hasText: books[1].title });
  // A view of what is being read leaves the finished book out; a list of every book shows it as finished, never as reading.
  if (dedicated) await expect(finished).toHaveCount(0);
  else await expect(finished.first()).toContainText(/finished/i);
  await note(`what everyone is reading now: ${dedicated ? "its own view" : "the home page"} shows the book being read${dedicated ? " and leaves the finished one out" : " and the finished one as finished"}`);
  await page.screenshot({ path: path.join(STATE, "6-reading-now.png"), fullPage: true });
});
