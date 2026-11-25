import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The first version's acceptance tests (spec, *Acceptance test*; the build plan's Phase 6; TEST-201), against a REAL
 * stack with LIVE models, through the public API, MCP and a real browser exactly as people use them. Nothing is
 * mocked. It spends real money, so it watches the credit ledger of both organisations and cancels at ACC_SPEND_STOP_USD.
 *
 *   1. FrostAura as tenant zero: the organisation and its divisions made through the public API, its workforce and
 *      org chart filled by the factory's own hiring.
 *   2. A larger app through the factory: a club court-booking app, researched (overruled if it says do not build,
 *      unless a red line), planned, built, evaluated, reviewed and published privately; then used by a signed-in
 *      member in a real browser, its hardware endpoint, its confirmation e-mail and its MCP tools.
 *   3. An invited organisation: provisioned by an operator, topped up, its owner signs in with the invitation (a real
 *      passkey ceremony), builds a small app, shares it by e-mail with one person who registers and opens it; the
 *      first organisation sees nothing of the second, through the API and in the database.
 */

const EDGE = need("ACC_EDGE");
const MAIL = need("ACC_MAIL");
const STATE = need("ACC_STATE");
const PROJECT = need("ACC_PROJECT");
const STOP_USD = Number(process.env.ACC_SPEND_STOP_USD ?? "5");
const CREDITS_PER_USD = 100; // CreditOptions.CreditsPerUsd, margin 1.0 in development
const REUSE = process.env.ACC_CLUB_APP ?? "";
/** Replays the sharing and isolation of step 4 against an invited organisation's app already built: <org>/<division>/<project>/<app>. */
const BAKERY = process.env.ACC_BAKERY_APP ?? "";
const BAKERY_OWNER = process.env.ACC_BAKERY_OWNER ?? "";

const CLUB_IDEA =
  "A court booking app for a squash club. Members sign in and book a court for a time slot; a booking costs playing minutes from the member's balance; an admin adds minute packages to a member; a member sees their upcoming bookings and their balance; the court hardware calls an incoming endpoint to ask whether a court is booked right now and by whom; a confirmation e-mail is sent when a booking is made.";
const SMALL_IDEA =
  "A specials board for a small bakery: staff sign in and post today's specials with a name and a price, and everyone who opens the app sees today's specials.";

const run = randomBytes(3).toString("hex");
const frostaura = "frostaura";
const harbour = `harbour-${run}`;
const ownerEmail = "dev@frostaura.net";
const operatorEmail = "operator@endgame.localhost";
const inviteeEmail = `owner-${run}@harbour.example`;
const started = Date.now();

const story = {
  club: { ideaId: "", researchRunId: "", buildRunId: "", appId: "", appPath: "" },
  bakery: { ideaId: "", buildRunId: "", appId: "", appPath: "" },
  harbourId: "",
  frostauraId: "",
  report: {} as Record<string, unknown>,
};

let owner: BrowserContext;
let operator: BrowserContext;
let invitee: BrowserContext;

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run this through \`make e2e-acceptance\`.`);
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

/** One organisation's real cost so far, in US$: billed AI work plus repairs, which are not charged but are paid for. */
async function spentUsd(as: BrowserContext, org: string): Promise<{ usd: number; ai: number; notCharged: number; hosting: number }> {
  const credits = await ok<{ month: { ai: number; hosting: number }; notCharged: { credits: number } }>(await as.request.get(`/api/credits?scope=${org}`));
  return { usd: (credits.month.ai + credits.notCharged.credits) / CREDITS_PER_USD, ai: credits.month.ai, notCharged: credits.notCharged.credits, hosting: credits.month.hosting };
}

async function totalUsd(): Promise<number> {
  let total = (await spentUsd(owner, frostaura)).usd;
  if (invitee && story.harbourId) total += (await spentUsd(invitee, harbour)).usd;
  return total;
}

/** Polls a run to an end, cancelling it (and failing) if the spend of the whole acceptance run reaches the stop. */
async function follow(as: BrowserContext, runId: string, label: string, minutes: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + minutes * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const view = await ok(await as.request.get(`/api/runs/${runId}`));
    const status = String(view.status);
    const usd = await totalUsd();
    if (status !== last) await note(`${label} ${runId}: ${status} (spent so far US$${usd.toFixed(4)})`);
    last = status;
    if (usd >= STOP_USD) {
      await as.request.post(`/api/runs/${runId}/cancel`);
      throw new Error(`Spend reached US$${usd.toFixed(2)}, at or past the stop of US$${STOP_USD}: ${label} cancelled.`);
    }
    if (["finished", "failed", "cancelled"].includes(status)) return view;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`${label} did not finish in ${minutes} minutes.`);
}

/** The run's whole log, read from its event stream (the console's own feed) until it goes quiet. */
async function events(as: BrowserContext, runId: string): Promise<{ type: string; payload: Record<string, unknown> }[]> {
  const controller = new AbortController();
  const cookies = (await as.cookies(EDGE)).map((c) => `${c.name}=${c.value}`).join("; ");
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
    // aborted: the run has finished and the stream would stay open
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

/** An idea through the whole factory, as its owner: research, the owner's overrule when it says do not build, the build. */
async function factory(as: BrowserContext, org: string, scope: string, idea: string, label: string) {
  const estimate = await ok<{ credits: number; basis: string }>(await as.request.post("/api/ideas/estimate", { data: { text: idea, constraints: [], scope: org } }));
  await note(`${label}: research estimate shown first: ${estimate.credits} credits — ${estimate.basis}`);
  const created = await ok<{ id: string; runId: string }>(await as.request.post("/api/ideas", { data: { text: idea, constraints: [], scope } }), 201);
  const research = await follow(as, created.runId, `${label} research`, 25);
  expect(research.status, JSON.stringify(research)).toBe("finished");
  const read = await ok<{ verdict: Record<string, unknown>; redLine: string | null; decision: { runId: string | null; via: string } | null }>(await as.request.get(`/api/ideas/${created.id}`));
  const method = read.verdict.method as { searches: number; confidence: string };
  const researchReport = {
    estimateCredits: estimate.credits,
    estimateBasis: estimate.basis,
    spentCredits: research.spentCredits,
    outcome: read.verdict.outcome,
    headline: read.verdict.headline,
    products: (read.verdict.existing as { products: { name: string }[] }).products.map((p) => p.name),
    searches: method.searches,
    confidence: method.confidence,
    redLine: read.redLine,
  };
  await note(`${label}: verdict ${read.verdict.outcome} — ${read.verdict.headline} (${method.searches} searches, confidence ${method.confidence})`);
  let buildRunId: string;
  let decision: string;
  if (read.verdict.outcome === "do-not-build") {
    if (read.redLine) throw new Error(`${label}: the verdict records a red line (${read.redLine}); nobody may build it.`);
    const decided = await ok<{ decision: { runId: string } }>(await as.request.post(`/api/ideas/${created.id}/decision`, { data: { choice: "overrule", note: "Acceptance test: the owner builds it regardless." } }));
    buildRunId = decided.decision.runId;
    decision = "overruled by the owner";
  } else {
    expect(read.decision?.via).toBe("auto-mode");
    buildRunId = read.decision!.runId!;
    decision = "auto-mode";
  }
  await note(`${label}: build run ${buildRunId} (${decision})`);
  const buildStarted = Date.now();
  const build = await follow(as, buildRunId, `${label} build`, 150);
  const log = await events(as, buildRunId);
  const evaluations = log.filter((e) => e.type.startsWith("evaluation."));
  const accepted = log.find((e) => e.type === "plan.accepted")?.payload as
    | { requirements: { id: string; text: string }[]; items: { id: string; text: string; covers: string[] }[]; leftOut: { requirement: string; text: string; reason: string }[] }
    | undefined;
  const buildReport = {
    status: build.status,
    summary: build.summary,
    minutes: Math.round((Date.now() - buildStarted) / 6000) / 10,
    estimateCredits: build.estimateCredits,
    spentCredits: build.spentCredits,
    requirements: accepted?.requirements,
    plan: accepted?.items.map((i) => ({ id: i.id, text: i.text, covers: i.covers })),
    leftOut: accepted?.leftOut,
    builderSessions: new Set(log.filter((e) => String(e.payload.agent ?? "").startsWith("builder-")).map((e) => e.payload.agent)).size,
    evaluations: evaluations.map((e) => ({ item: e.payload.item, passed: e.type === "evaluation.passed", round: e.payload.round, tier: e.payload.tier, summary: e.payload.summary, faults: e.payload.faults })),
    repairs: evaluations.filter((e) => e.type === "evaluation.failed").length,
    tiers: [...new Set(evaluations.map((e) => e.payload.tier))],
    appCalls: log.filter((e) => e.type === "tool.requested" && e.payload.name === "call_app").length,
    modelCalls: log.filter((e) => e.type === "model.replied").length,
    messages: log.filter((e) => e.type === "message" && !e.payload.kind && e.payload.from !== "owner").map((e) => `${e.payload.title}: ${e.payload.text}`),
  };
  await note(`${label}: build ${build.status}: ${JSON.stringify(buildReport).slice(0, 2500)}`);
  return { ideaId: created.id, researchRunId: created.runId, buildRunId, decision, research: researchReport, build: buildReport };
}

async function appOf(as: BrowserContext, org: string): Promise<{ id: string; path: string }> {
  const tree = await ok<{ divisions: { slug: string; projects: { slug: string; apps: { id: string; slug: string }[] }[] }[] }>(await as.request.get(`/api/tree?organisation=${org}`));
  const apps = tree.divisions.flatMap((d) => d.projects.flatMap((p) => p.apps.map((a) => ({ id: a.id, path: `${org}/${d.slug}/${p.slug}/${a.slug}` }))));
  expect(apps.length).toBeGreaterThan(0);
  await appendFile(path.join(STATE, "apps"), `${apps[apps.length - 1].id}\n`);
  return apps[apps.length - 1];
}

/** A virtual authenticator on the page's browser, so passkey ceremonies run for real without a person. */
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** The browser's own WebAuthn: options from the server, a credential from the authenticator, the credential back. */
async function passkey(page: Page, optionsUrl: string, optionsBody: Record<string, unknown>, completeUrl: string, completeExtra: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ optionsUrl, optionsBody, completeUrl, completeExtra }) => {
      const answer = await fetch(optionsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(optionsBody), credentials: "include" });
      if (!answer.ok) throw new Error(`${optionsUrl} answered ${answer.status}: ${await answer.text()}`);
      const raw = await answer.json();
      const options = PublicKeyCredential.parseCreationOptionsFromJSON(raw.publicKey ?? raw);
      const credential = (await navigator.credentials.create({ publicKey: options })) as PublicKeyCredential;
      const done = await fetch(completeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: credential.toJSON(), ...completeExtra }), credentials: "include" });
      return { status: done.status, body: await done.text() };
    },
    { optionsUrl, optionsBody, completeUrl, completeExtra },
  );
}

/** Every message the mail catcher holds for an address, newest first, with its text. */
async function mailTo(address: string): Promise<{ subject: string; text: string }[]> {
  const list = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
  const out: { subject: string; text: string }[] = [];
  for (const m of list.messages ?? []) {
    const full = (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
    out.push({ subject: m.Subject, text: full.Text || full.HTML });
  }
  return out;
}

/** A query in the platform database as the tenant role, with one organisation's row-level security pinned. */
function asTenant(organisationId: string, sql: string): string {
  return execFileSync("docker", ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "endgame", "-d", "endgame", "-tA", "-v", "ON_ERROR_STOP=1", "-c",
    `BEGIN; SET LOCAL ROLE endgame_app; SELECT set_config('endgame.organisation_id', '${organisationId}', true); ${sql}; COMMIT;`], { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter((l) => l && l !== "BEGIN" && l !== "SET" && l !== "COMMIT" && l !== organisationId).join("\n");
}

/** An MCP client of the SDK, signed with a personal access token. */
async function mcp(url: string, token: string): Promise<Client> {
  const client = new Client({ name: "endgame-acceptance", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

function text(result: unknown): string {
  return ((result as { content?: { type: string; text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("\n");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await mkdir(STATE, { recursive: true });
  owner = await signedIn(browser, ownerEmail, "Dean (FrostAura)");
  operator = await signedIn(browser, operatorEmail, "FrostAura operator");
});

test.afterAll(async () => {
  story.report.wallMinutes = Math.round((Date.now() - started) / 600) / 100;
  try {
    story.report.spend = { frostaura: await spentUsd(owner, frostaura), harbour: story.harbourId ? await spentUsd(invitee, harbour) : null, totalUsd: await totalUsd() };
  } catch {
    // the report keeps what it has
  }
  await writeFile(path.join(STATE, "report.json"), JSON.stringify(story.report, null, 2));
  await owner?.close();
  await operator?.close();
  await invitee?.close();
});

test("1. tenant zero: FrostAura, with Technologies and Labs, made through the public API", async () => {
  test.skip(!!REUSE, "replaying against a club app already built");
  const made = await owner.request.post("/api/organisations", { data: { name: "FrostAura", slug: frostaura } });
  const created = made.status() === 403 ? await operator.request.post("/api/organisations", { data: { name: "FrostAura", slug: frostaura, ownerEmail } }) : made;
  // On a stack that already holds tenant zero (a second pass), it is found rather than made again.
  if (created.status() === 409) {
    story.frostauraId = (await ok<{ organisation: { id: string } }>(await owner.request.get(`/api/tree?organisation=${frostaura}`))).organisation.id;
  } else {
    story.frostauraId = (await ok<{ id: string }>(created, 201)).id;
  }
  for (const [slug, name] of [["technologies", "Technologies"], ["labs", "Labs"]]) {
    const division = await owner.request.post("/api/divisions", { data: { parent: frostaura, slug, name } });
    expect([201, 409], await division.text()).toContain(division.status());
  }
  await ok(await operator.request.post("/api/credits/top-ups", { data: { organisation: frostaura, credits: 2000, note: "acceptance: tenant zero" } }));
  const tree = await ok<{ divisions: { slug: string; name: string }[] }>(await owner.request.get(`/api/tree?organisation=${frostaura}`));
  expect(tree.divisions.map((d) => d.name).sort()).toEqual(["Labs", "Technologies"]);
  story.report.tenantZero = { organisation: "FrostAura", divisions: tree.divisions.map((d) => d.name) };
  await note("FrostAura made, with Technologies and Labs, topped up with 2000 credits");
});

test("2. the club court-booking app through the whole factory", async () => {
  test.skip(!!REUSE, "replaying against a club app already built");
  const result = await factory(owner, frostaura, `${frostaura}/technologies`, CLUB_IDEA, "club");
  story.club.ideaId = result.ideaId;
  story.club.buildRunId = result.buildRunId;
  story.report.club = result;
  expect(result.build.status, String(result.build.summary)).toBe("finished");
  const app = await appOf(owner, frostaura);
  story.club.appId = app.id;
  story.club.appPath = app.path;
  await note(`club app ${app.path} (${app.id})`);
});

test("1b. tenant zero's workforce and org chart, filled by the factory's own hiring", async () => {
  test.skip(!!REUSE, "replaying against a club app already built");
  const employees = await ok<{ name: string; role: string; kind: string; scope: string; standing: string | null }[]>(await owner.request.get(`/api/employees?scope=${frostaura}`));
  const chart = await ok<{ nodes: { type: string; name: string }[]; edges: { type: string }[] }>(await owner.request.get(`/api/ontology?scope=${frostaura}&view=org-chart`));
  const hires = await ok<{ name: string; role: string; status: string; trigger: string }[]>(await owner.request.get(`/api/hires?scope=${frostaura}`));
  story.report.workforce = {
    employees: employees.filter((e) => e.kind === "employee").map((e) => `${e.name}, ${e.role} (${e.scope})${e.standing ? ` [${e.standing}]` : ""}`),
    hires: hires.map((h) => `${h.name}, ${h.role}: ${h.status} (${h.trigger})`),
    chartNodes: chart.nodes.length,
    chartEdges: chart.edges.length,
  };
  // The standing security reviewer, the researcher research hired, and the engineer and QA engineer the build hired.
  const roles = employees.filter((e) => e.kind === "employee").map((e) => e.role.toLowerCase());
  for (const role of [/security/, /research/, /engineer/, /qa/]) expect(roles.some((r) => role.test(r)), `${role} in ${roles}`).toBe(true);
  expect(hires.filter((h) => h.status === "accepted").length).toBeGreaterThanOrEqual(3);
  expect(chart.nodes.filter((n) => n.type === "employee").length).toBeGreaterThanOrEqual(4);
  await note(`tenant zero's workforce: ${JSON.stringify(story.report.workforce)}`);
});

test("3. the club app, used: a member books a court and sees it, the hardware asks, the e-mail arrives, MCP calls it", async () => {
  if (REUSE) {
    story.club.appPath = REUSE;
    story.club.appId = (await appOf(owner, REUSE.split("/")[0])).id;
  }
  const detail = await ok<{ settings: { access: string }; addresses: Record<string, string> }>(await owner.request.get(`/api/apps/${story.club.appId}`));
  story.report.clubApp = { id: story.club.appId, path: story.club.appPath, access: detail.settings.access, addresses: detail.addresses };
  expect(detail.settings.access).toBe("private");

  // The app's own operations, as its MCP tools: the SDK's client, with a personal access token.
  const token = await ok<{ token: string }>(await owner.request.post("/api/tokens", { data: { name: `acceptance-${run}`, organisation: frostaura } }), 201);
  const appTools = await mcp(`${EDGE}/mcp/apps/${story.club.appId}`, token.token);
  const tools = (await appTools.listTools()).tools;
  story.report.mcpTools = tools.map((t) => t.name);
  await note(`the club app's MCP tools: ${tools.map((t) => t.name).join(", ")}`);
  expect(tools.length).toBeGreaterThan(2);
  const read = tools.find((t) => /^(list|get)/i.test(t.name) && !(t.inputSchema?.required ?? []).length);
  expect(read, "a tool that reads without arguments").toBeTruthy();
  const called = await appTools.callTool({ name: read!.name, arguments: {} });
  story.report.mcpCall = { tool: read!.name, isError: called.isError ?? false, text: text(called).slice(0, 800) };
  expect(called.isError ?? false, text(called)).toBe(false);
  await note(`MCP: ${read!.name} answered ${text(called).slice(0, 300)}`);

  // The member, in a real browser: the owner is a member of the club's organisation and opens the private app.
  const page = await owner.newPage();
  await expect(async () => {
    const response = await page.goto(`${EDGE}/${story.club.appPath}/`);
    expect(response?.status()).toBe(200);
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(STATE, "club-1-home.png"), fullPage: true });
  story.report.clubHomeText = (await page.locator("body").innerText()).slice(0, 1500);
  await note(`club app home: ${String(story.report.clubHomeText).slice(0, 400)}`);
  // The rest is the club's own flow, through the app's own screens, its MCP tools and its incoming endpoint.
  await clubFlow(page, appTools);
  await appTools.close();

  // The Owner takes the whole app away: code with its history, its data, and the platform's records of it.
  const exported = await owner.request.get(`/api/apps/${story.club.appId}/export`);
  expect(exported.status()).toBe(200);
  const archive = path.join(STATE, "club-export.tar.gz");
  await writeFile(archive, await exported.body());
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
  story.report.clubExport = entries;
  for (const part of ["manifest.json", "code.bundle", "database.dump", "platform.json"]) expect(entries.some((e) => e.endsWith(`/${part}`)), `${part} in ${entries}`).toBe(true);
  const dump = execFileSync("tar", ["-xzOf", archive, entries.find((e) => e.endsWith("/database.dump"))!]);
  expect(dump.subarray(0, 5).toString()).toBe("PGDMP");
  await note(`the Owner's export: ${entries.join(", ")} (the database dump ${dump.length} bytes, pg_dump custom format)`);
});

/** The arguments a derived tool needs: its path and query parameters, and a body with every required field filled. */
function argumentsFor(tool: { inputSchema: { properties?: Record<string, unknown>; required?: string[] } }, given: Record<string, unknown>, body: Record<string, unknown>) {
  const args: Record<string, unknown> = { ...given };
  const schema = tool.inputSchema.properties?.body as { properties?: Record<string, { type?: string }> } | undefined;
  if (schema) {
    const filled: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
      const match = Object.entries(body).find(([k]) => new RegExp(k, "i").test(name));
      if (match) filled[name] = match[1];
      else if (field.type === "string") filled[name] = "Acceptance test";
    }
    args.body = filled;
  }
  return args;
}

/** A defect of the built app, found by using it: reported, and the flow goes on. */
function defect(what: string) {
  story.report.clubDefects = [...((story.report.clubDefects as string[]) ?? []), what];
  console.log(`  DEFECT in the built app: ${what}`);
}

/** Book, balance, bookings, the confirmation e-mail, the hardware's question: against the app the factory built. */
async function clubFlow(page: Page, appTools: Client) {
  const app = `${EDGE}/${story.club.appPath}/`;
  const minutesLeft = async () => {
    await page.goto(app);
    await page.waitForLoadState("networkidle");
    const match = /(\d+)\s*minutes?\s*left/i.exec(await page.getByRole("main").innerText());
    expect(match, "the balance is shown on the member's home").toBeTruthy();
    return Number(match![1]);
  };
  const me = (await ok<{ user: { id: string; displayName: string; email: string } }>(await page.request.get(`${app}api/me`))).user;
  const tools = (await appTools.listTools()).tools;
  const find = (pattern: RegExp) => tools.find((t) => pattern.test(t.name)) ?? (() => { throw new Error(`no tool matching ${pattern} in ${tools.map((t) => t.name)}`); })();

  // An admin adds a package of minutes to the member (the owner holds the admin role), through the app's MCP tool.
  const before = await minutesLeft();
  const add = find(/add.*minute|minute.*package|topup|top_up/i);
  const added = await appTools.callTool({ name: add.name, arguments: argumentsFor(add as never, { memberId: me.id }, { minutes: 60 }) });
  expect(added.isError ?? false, text(added)).toBe(false);
  const afterPackage = await minutesLeft();
  expect(afterPackage, "the package shows in the member's balance").toBeGreaterThanOrEqual(60);
  if (afterPackage !== before + 60) {
    // Recorded, not hidden: the built app's own defect, which its evaluator did not catch.
    defect(`a member's first package replaced the balance shown before it (${before} minutes shown, ${afterPackage} after adding 60)`);
  }
  await note(`an admin added a 60-minute package through MCP (${add.name}): ${before} → ${afterPackage} minutes`);

  // The member books a court for tomorrow evening, in the app's own form.
  await page.getByRole("link", { name: /book a court/i }).or(page.getByRole("button", { name: /book a court/i })).first().click();
  const form = page.getByRole("button", { name: /^book/i });
  if (!(await form.last().isVisible({ timeout: 8_000 }).catch(() => false))) {
    defect("the 'Book a court' link changes the address but does not show the booking form; opening the address directly does");
    await page.goto(`${app}bookings/new`);
  }
  await page.getByLabel(/court/i).first().selectOption({ index: 1 });
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  // A slot of this run's own (a replay must not collide with an earlier run's booking): tomorrow, between 07:00 and 20:30.
  const slot = parseInt(run, 16) % 28;
  const hhmm = `${String(7 + Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
  const local = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}T${hhmm}`;
  await page.getByLabel(/start|when|time/i).first().fill(local);
  await page.getByLabel(/minutes|duration|length/i).first().fill("30");
  const mailsBefore = (await mailTo(me.email)).length;
  const booked = page.waitForResponse((r) => r.request().method() === "POST" && /bookings/.test(r.url()));
  await page.getByRole("button", { name: /^book/i }).last().click();
  expect((await booked).status()).toBeLessThan(300);
  await page.screenshot({ path: path.join(STATE, "club-2-booked.png"), fullPage: true });
  const afterBooking = await minutesLeft();
  expect(afterBooking).toBe(afterPackage - 30);
  await expect(page.getByRole("main")).toContainText(new RegExp(`${hhmm}|${Number(hhmm.slice(0, 2)) % 12 || 12}:${hhmm.slice(3)}`));
  await page.screenshot({ path: path.join(STATE, "club-3-home-after.png"), fullPage: true });
  await note(`the member booked a court for tomorrow ${hhmm} for 30 minutes: balance ${afterPackage} → ${afterBooking}, the booking listed on the home page`);

  // The confirmation e-mail, in the mail catcher.
  let mails: { subject: string; text: string }[] = [];
  for (let i = 0; i < 30 && mails.length <= mailsBefore; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    mails = await mailTo(me.email);
  }
  expect(mails.length, "a confirmation e-mail reached the mail catcher").toBeGreaterThan(mailsBefore);
  story.report.clubMail = { subject: mails[0].subject, text: mails[0].text.slice(0, 500) };
  await note(`confirmation e-mail: "${mails[0].subject}"`);

  // The court hardware asks whether a court is booked right now, and by whom: a booking that has just begun, made
  // through the app's MCP tool, then the incoming endpoint signed as the device signs it.
  const courts = await ok<{ id: string; name: string }[]>(await page.request.get(`${app}api/courts`));
  const create = find(/^(create|make|add)\w*booking/i);
  // The first court free for the next half hour (a replay finds the last one's booking still running).
  const start = new Date(Date.now() + 75_000).toISOString();
  let busyCourt: { id: string; name: string } | undefined;
  for (const court of courts) {
    const made = await appTools.callTool({ name: create.name, arguments: argumentsFor(create as never, {}, { courtId: court.id, startAt: start, durationMinutes: 30, minutes: 30 }) });
    if (!made.isError) {
      busyCourt = court;
      break;
    }
    expect(text(made)).toMatch(/already booked|409/i);
  }
  expect(busyCourt, "a court free for the next half hour").toBeTruthy();
  await note(`MCP: ${create.name} booked ${busyCourt!.name} from ${start}`);
  const secret = randomBytes(24).toString("hex");
  await ok(await owner.request.put("/api/secrets", { data: { scope: story.club.appPath, name: "COURT_STATUS", value: secret } }));
  await new Promise((r) => setTimeout(r, 80_000));
  const ask = async (courtId: string) => {
    const body = JSON.stringify({ courtId });
    const signature = "sha256=" + (await import("node:crypto")).createHmac("sha256", secret).update(body).digest("hex");
    const response = await fetch(`${app}hooks/court-status`, { method: "POST", headers: { "content-type": "application/json", "X-Court-Signature": signature }, body });
    return { status: response.status, body: await response.json().catch(() => null) as { booked?: boolean; memberName?: string } | null };
  };
  const busy = await ask(busyCourt!.id);
  const others = await Promise.all(courts.filter((c) => c.id !== busyCourt!.id).map(async (c) => ({ court: c.name, ...(await ask(c.id)) })));
  const free = others.find((o) => o.body?.booked === false) ?? others[0];
  const unsigned = await fetch(`${app}hooks/court-status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courtId: busyCourt!.id }) });
  story.report.clubHardware = { busy, free, unsignedStatus: unsigned.status };
  expect(busy.status).toBe(200);
  expect(busy.body?.booked).toBe(true);
  expect(busy.body?.memberName).toBe(me.displayName);
  expect(free.body?.booked).toBe(false);
  expect(unsigned.status).toBeGreaterThanOrEqual(400);
  await note(`hardware: ${busyCourt!.name} → ${JSON.stringify(busy.body)}; ${free.court} → ${JSON.stringify(free.body)}; unsigned → ${unsigned.status}`);

  // Both bookings, as the member's own list over MCP.
  const upcoming = await appTools.callTool({ name: find(/upcoming|list.*booking/i).name, arguments: {} });
  expect(text(upcoming)).toContain(busyCourt!.name);
  await note(`MCP: upcoming bookings ${text(upcoming).slice(0, 300)}`);
}

test("4. an invited organisation builds an app of its own, shares it, and is kept apart from the first", async ({ browser }) => {
  test.skip(!!REUSE, "replaying against a club app already built");
  if (BAKERY) {
    // Replay: the organisation and its app exist; its owner signs in for development, and the sharing and the isolation run again.
    const [slug] = BAKERY.split("/");
    invitee = await signedIn(browser, BAKERY_OWNER, "Harbour owner");
    const tree = await ok<{ organisation: { id: string } }>(await invitee.request.get(`/api/tree?organisation=${slug}`));
    story.harbourId = tree.organisation.id;
    const app = await appOf(invitee, slug);
    const runs = await ok<{ id: string; kind: string; ideaId: string | null }[]>(await invitee.request.get(`/api/runs?scope=${slug}&limit=20`));
    await shareAndIsolate(browser, slug, app, runs.find((r) => r.kind === "research")?.ideaId ?? "", runs.find((r) => r.kind === "build")?.id ?? "");
    return;
  }

  // God mode provisions it for an invited owner and tops it up by hand.
  const provisioned = await ok<{ id: string; ownerInvitationCode: string; invitationEmailed: boolean }>(
    await operator.request.post("/api/organisations", { data: { name: "Harbour Bakery", slug: harbour, ownerEmail: inviteeEmail, ownerDisplayName: "Harbour owner" } }), 201);
  story.harbourId = provisioned.id;
  await ok(await operator.request.post("/api/credits/top-ups", { data: { organisation: harbour, credits: 600, note: "acceptance: invited organisation" } }));
  let invitation: { subject: string; text: string }[] = [];
  for (let i = 0; i < 30 && invitation.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    invitation = await mailTo(inviteeEmail);
  }
  expect(/Invitation code:\s*([0-9a-f]+)/i.exec(invitation[0]?.text ?? "")?.[1], "the invitation e-mail carries the owner's code").toBe(provisioned.ownerInvitationCode);
  await note(`Harbour Bakery provisioned for ${inviteeEmail}; invitation e-mailed: ${provisioned.invitationEmailed} (${invitation.length} message(s))`);

  // The owner signs in with the invitation: a real passkey ceremony in a real browser.
  invitee = await browser.newContext({ baseURL: EDGE });
  const welcome = await invitee.newPage();
  await welcome.goto(`${EDGE}/`);
  await authenticator(welcome);
  const registered = await passkey(welcome, "/api/auth/passkey/register/options", { email: inviteeEmail, displayName: "Harbour owner", invitationCode: provisioned.ownerInvitationCode }, "/api/auth/passkey/register/complete");
  expect(registered.status, registered.body).toBe(200);
  const me = await ok<{ user: { email: string }; passkeys: number; memberships: { role: string; scope?: string }[] }>(await invitee.request.get("/api/me"));
  expect(me.user.email).toBe(inviteeEmail);
  expect(me.passkeys).toBe(1);
  await note(`the invited owner signed in with a passkey: ${JSON.stringify(me.memberships)}`);

  // A small idea, through the factory, as that owner.
  const result = await factory(invitee, harbour, harbour, SMALL_IDEA, "bakery");
  story.report.bakery = result;
  expect(result.build.status, String(result.build.summary)).toBe("finished");
  const app = await appOf(invitee, harbour);
  story.bakery.appId = app.id;
  story.bakery.appPath = app.path;
  await note(`bakery app ${app.path} (${app.id})`);

  await shareAndIsolate(browser, harbour, app, result.ideaId, result.buildRunId);
});

async function shareAndIsolate(browser: Browser, harbour: string, app: { id: string; path: string }, ideaId: string, buildRunId: string) {
  const friendEmail = `friend-${run}@harbour.example`;
  // Shared by e-mail with one person, who registers at the app and opens it.
  await ok(await invitee.request.post(`/api/apps/${app.id}/settings`, { data: { access: "shared" } }));
  const share = await ok<{ invitationCode: string }>(await invitee.request.post(`/api/apps/${app.id}/shares`, { data: { email: friendEmail } }), 201);
  // The person learns of it by e-mail, and registers with the code the e-mail carries.
  let mails: { subject: string; text: string }[] = [];
  for (let i = 0; i < 30 && mails.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    mails = await mailTo(friendEmail);
  }
  expect(mails.length, "the share reached the person by e-mail").toBeGreaterThan(0);
  const mailedCode = /Invitation code:\s*([0-9a-f]+)/i.exec(mails[0].text)?.[1];
  expect(mailedCode).toBe(share.invitationCode);
  story.report.shareMail = mails.map((m) => m.subject);
  await note(`shared with ${friendEmail}: "${mails[0].subject}", carrying the code`);
  const friend = await browser.newContext();
  const door = await friend.newPage();
  await door.goto(`${EDGE}/${app.path}/`);
  await expect(door).toHaveURL(/_endgame\/auth\/sign-in/);
  await authenticator(door);
  const signedUp = await passkey(door, `${EDGE}/api/app-auth/${app.id}/sign-up/options`, { email: friendEmail, displayName: "Friend of the bakery", invitationCode: mailedCode, returnTo: `/${app.path}/` },
    `${EDGE}/api/app-auth/${app.id}/sign-up/complete`, { invitationCode: mailedCode });
  expect(signedUp.status, signedUp.body).toBe(200);
  const opened = await door.goto(`${EDGE}/${app.path}/`);
  expect(opened?.status()).toBe(200);
  await door.waitForLoadState("networkidle");
  await door.screenshot({ path: path.join(STATE, "bakery-friend.png"), fullPage: true });
  story.report.bakeryFriendText = (await door.locator("body").innerText()).slice(0, 800);
  await note(`the friend registered and opened the bakery app: ${String(story.report.bakeryFriendText).slice(0, 300)}`);
  await friend.close();

  // The first organisation sees nothing of the second: through the API ...
  const theirs = [`/api/tree?organisation=${harbour}`, `/api/apps/${app.id}`, `/api/ideas/${ideaId}`, `/api/runs/${buildRunId}`, `/api/credits?scope=${harbour}`, `/api/employees?scope=${harbour}`];
  const answers: Record<string, number> = {};
  for (const url of theirs) answers[url] = (await owner.request.get(url)).status();
  story.report.isolationApi = answers;
  for (const [url, status] of Object.entries(answers)) expect([403, 404], `${url} answered ${status} to FrostAura's owner`).toContain(status);
  expect([403, 404]).toContain((await invitee.request.get(`/api/tree?organisation=${frostaura}`)).status());
  // ... and in the database, where row-level security pins every query to one organisation.
  const frostauraId = story.frostauraId || (await ok<{ organisation: { id: string } }>(await owner.request.get(`/api/tree?organisation=${frostaura}`))).organisation.id;
  const harbourId = story.harbourId;
  const seenByFrostaura = asTenant(frostauraId, `SELECT count(*) FROM apps WHERE organisation_id = '${harbourId}'`);
  const ideasSeen = asTenant(frostauraId, `SELECT count(*) FROM ideas WHERE organisation_id = '${harbourId}'`);
  const runsSeen = asTenant(frostauraId, `SELECT count(*) FROM runs WHERE organisation_id = '${harbourId}'`);
  const ownApps = asTenant(harbourId, `SELECT count(*) FROM apps WHERE organisation_id = '${harbourId}'`);
  story.report.isolationDb = { appsSeenByFrostaura: seenByFrostaura, ideasSeenByFrostaura: ideasSeen, runsSeenByFrostaura: runsSeen, harbourSeesItsOwnApps: ownApps };
  expect([seenByFrostaura, ideasSeen, runsSeen]).toEqual(["0", "0", "0"]);
  expect(Number(ownApps)).toBeGreaterThan(0);
  await note(`isolation: API ${JSON.stringify(answers)}; database ${JSON.stringify(story.report.isolationDb)}`);
}
