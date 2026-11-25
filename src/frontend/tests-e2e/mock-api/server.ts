/**
 * TEST ONLY. A stand-in for the control plane's public API, implementing the shapes the console
 * reads (src/store/types.ts, from ARCH-004) so the Playwright specs can drive every flow without
 * the real stack. It is never built into, served by or imported from the running console.
 *
 * Run: node tests-e2e/mock-api/server.ts <port>   (Node's own type stripping; no build step)
 * Control: POST /__mock/scenario {"name": "..."} resets state; GET /__mock/requests lists calls.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

const now = () => new Date().toISOString();
import { scenario, type MockState, type ScenarioName, type MockEvent } from "./fixtures.ts";

const port = Number(process.argv[2] ?? 5591);
let state: MockState = scenario("populated");
const requests: { method: string; path: string; body: unknown }[] = [];
const waiters = new Map<string, Set<() => void>>();

function notify(runId: string) {
  for (const w of waiters.get(runId) ?? []) w();
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": status >= 400 ? "application/problem+json" : "application/json" }).end(json);
}

function problem(res: ServerResponse, status: number, title: string, detail?: string) {
  send(res, status, { type: "about:blank", title, status, ...(detail ? { detail } : {}) });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** `GET /api/me` as the control plane writes it. */
function me() {
  const org = state.org;
  return {
    user: state.user,
    organisation: org ? { id: org.id, slug: org.slug, name: org.name } : null,
    isOperator: false,
    passkeys: 1,
    memberships: org
      ? [{ id: "m1", scope: org.slug, level: "organisation", role: state.viewerRole === "none" ? "owner" : state.viewerRole, organisationId: org.id, organisationSlug: org.slug, organisationName: org.name }]
      : [],
  };
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;
const LEVELS = ["organisation", "division", "project", "app"];

/** The control plane's secret listing: the nearest level wins; names only, never a value. */
function secretList(scope: string) {
  const parts = scope.split("/");
  const chain = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  const effective = new Map<string, { name: string; setAtLevel: string; setAtPath: string; setAt: string; inherited: boolean; overrides: string[] }>();
  for (const path of chain) {
    for (const e of state.secrets.filter((x) => x.scope === path)) {
      const above = effective.get(e.name);
      effective.set(e.name, {
        name: e.name,
        setAtLevel: LEVELS[path.split("/").length - 1] ?? "app",
        setAtPath: path,
        setAt: e.setAt,
        inherited: path !== scope,
        overrides: above ? [above.setAtPath, ...above.overrides] : [],
      });
    }
  }
  const setBelow = state.secrets
    .filter((x) => x.scope.startsWith(`${scope}/`))
    .map((x) => ({ name: x.name, setAtPath: x.scope }))
    .sort((a, b) => a.setAtPath.localeCompare(b.setAtPath) || a.name.localeCompare(b.name));
  return { scope, effective: [...effective.values()].sort((a, b) => a.name.localeCompare(b.name)), setBelow };
}

/** The conversation docked at a scope, read from the released `message` events of its runs. */
function conversation(scope: string, employeeId: string | null) {
  const runs = Object.values(state.runs).filter((r) => r.summary.kind === "conversation" && r.summary.scope === scope && (r.summary.employeeId ?? null) === employeeId);
  if (runs.length === 0) return { scope, conversationId: null, employeeId, messages: [] };
  const messages = runs
    .sort((a, b) => a.summary.createdAt.localeCompare(b.summary.createdAt))
    .flatMap((r) =>
      r.events
        .slice(0, r.released)
        .filter((e) => e.type === "message")
        .map((e) => ({ runId: r.summary.id, seq: e.seq, at: e.at, from: String(e.payload.from ?? "employee"), text: String(e.payload.text ?? "") })),
    );
  return { scope, conversationId: runs[0]?.summary.conversationId ?? null, employeeId, messages: messages.slice(-200) };
}

function b64url(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function append(runId: string, type: string, payload: Record<string, unknown> = {}) {
  const run = state.runs[runId];
  if (!run) return;
  const seq = run.events.length + 1;
  run.events.push({ seq, type, at: new Date().toISOString(), payload, delayMs: 0 });
  run.released = Math.max(run.released, seq);
  notify(runId);
}

/** Release scripted events one by one, honouring their delays and any gate (an approval). */
function pump(runId: string) {
  const run = state.runs[runId];
  if (!run || run.pumping) return;
  run.pumping = true;
  const step = () => {
    const current = state.runs[runId];
    if (!current || current !== run) return;
    if (run.paused) {
      run.pumping = false;
      return;
    }
    const next = run.events[run.released];
    if (!next) {
      run.pumping = false;
      return;
    }
    if (next.gate && !run.answered.has(next.gate)) {
      run.pumping = false;
      return;
    }
    setTimeout(() => {
      if (state.runs[runId] !== run || run.paused) {
        run.pumping = false;
        return;
      }
      run.released += 1;
      next.at = new Date().toISOString();
      if (next.type === "run.finished") run.summary.status = next.payload.outcome === "failed" ? "failed" : "finished";
      if (next.type === "approval.requested") run.summary.status = "waiting";
      notify(runId);
      step();
    }, next.delayMs);
  };
  step();
}

function stream(req: IncomingMessage, res: ServerResponse, runId: string, after: number) {
  const run = state.runs[runId];
  if (!run) return problem(res, 404, "Run not found");
  if (state.failStream) return problem(res, 503, "Stream unavailable");
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(": open\n\n");
  let sent = after;
  const flush = () => {
    while (sent < run.released) {
      const e = run.events[sent] as MockEvent;
      sent += 1;
      const body = JSON.stringify({ seq: e.seq, type: e.type, at: e.at, payload: e.payload });
      res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${body}\n\n`);
      if (e.type === "run.finished") {
        cleanup();
        res.end();
        return;
      }
    }
  };
  const set = waiters.get(runId) ?? new Set();
  waiters.set(runId, set);
  const cleanup = () => set.delete(flush);
  set.add(flush);
  req.on("close", cleanup);
  flush();
  pump(runId);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const body = method === "GET" ? null : await readBody(req);
  if (!path.startsWith("/__mock")) requests.push({ method, path: path + url.search, body });

  // Test control -------------------------------------------------------------------------
  if (path === "/__mock/scenario" && method === "POST") {
    state = scenario(((body as { name?: string } | null)?.name ?? "populated") as ScenarioName);
    requests.length = 0;
    return send(res, 204);
  }
  if (path === "/__mock/requests") return send(res, 200, requests);

  if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));

  // Session ------------------------------------------------------------------------------
  if (path === "/api/auth/options") return send(res, 200, { passkey: true, developmentSignIn: state.developmentSignIn });
  if (path === "/api/me") {
    if (!state.signedIn) return problem(res, 401, "Not signed in");
    return send(res, 200, me());
  }
  if (path === "/api/auth/development" && method === "POST") {
    if (!state.developmentSignIn) return problem(res, 404, "Not found");
    state.signedIn = true;
    return send(res, 200, me());
  }
  if (path === "/api/auth/logout" && method === "POST") {
    state.signedIn = false;
    return send(res, 204);
  }
  if (path === "/api/auth/passkey/register/options" && method === "POST") {
    const b = body as { displayName?: string; email?: string };
    return send(res, 200, {
      publicKey: {
        challenge: b64url(randomBytes(32)),
        rp: { name: "Endgame" },
        user: { id: b64url(randomBytes(16)), name: b.email ?? "owner", displayName: b.displayName ?? "Owner" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        excludeCredentials: [],
      },
    });
  }
  if (path === "/api/auth/passkey/login/options" && method === "POST") {
    return send(res, 200, { publicKey: { challenge: b64url(randomBytes(32)), timeout: 60000, userVerification: "preferred", allowCredentials: [] } });
  }
  if ((path === "/api/auth/passkey/register/complete" || path === "/api/auth/passkey/login/complete") && method === "POST") {
    const credential = (body as { credential?: { id?: string; response?: Record<string, unknown> } } | null)?.credential;
    if (!credential?.id || !credential.response?.clientDataJSON) return problem(res, 400, "That passkey response could not be read");
    state.signedIn = true;
    return send(res, 200, me());
  }

  if (!state.signedIn) return problem(res, 401, "Not signed in");

  // Tree ---------------------------------------------------------------------------------
  if (path === "/api/tree") {
    if (state.failTree) return problem(res, 500, "The tree could not be read", "The database did not answer.");
    return send(res, 200, state.tree());
  }
  if (path === "/api/organisations" && method === "POST") {
    const b = body as { name: string; slug: string };
    state.org = { id: "org-new", slug: b.slug, name: b.name, summary: null };
    state.viewerRole = "owner";
    return send(res, 201, { id: state.org.id, slug: b.slug, name: b.name, ownerEmail: state.user.email, ownerInvitationCode: null, invitationExpiresAt: null });
  }

  // Ideas --------------------------------------------------------------------------------
  if (path === "/api/ideas/estimate" && method === "POST") {
    if (state.failEstimate) return problem(res, 503, "Estimates are unavailable");
    const text = String((body as { text?: string }).text ?? "");
    return send(res, 200, { credits: 40 + Math.min(60, Math.round(text.length / 10)), basis: "Covers three parallel research sweeps and the verdict." });
  }
  if (path === "/api/ideas" && method === "POST") {
    const idea = state.addIdea(body as { text: string; constraints: string[] });
    pump(idea.runId);
    return send(res, 201, idea);
  }
  let m = path.match(/^\/api\/ideas\/([^/]+)$/);
  if (m) {
    const idea = state.ideas[m[1] as string];
    if (!idea) return problem(res, 404, "Idea not found");
    // A researching idea gets its verdict once its run has released its last event.
    const run = state.runs[idea.runId];
    if (idea.status === "researching" && run && run.released >= run.events.length) {
      const template = state.ideas["idea-ladder"];
      Object.assign(idea, { status: "verdict", verdict: template?.verdict ?? null, scope: "northwind/software" });
    }
    return send(res, 200, idea);
  }
  m = path.match(/^\/api\/ideas\/([^/]+)\/decision$/);
  if (m && method === "POST") {
    const idea = state.ideas[m[1] as string];
    if (!idea) return problem(res, 404, "Idea not found");
    if (state.failDecision) return problem(res, 409, "The decision could not be recorded", "Someone else decided first.");
    const choice = (body as { choice: string }).choice;
    const overruled = choice === "overrule";
    const runId = choice === "drop" ? null : state.addRun("Building " + idea.title, "build");
    idea.status = "decided";
    idea.decision = { choice, at: new Date().toISOString(), by: state.user.displayName, overruled, runId };
    if (runId) pump(runId);
    return send(res, 200, idea);
  }

  // Runs ---------------------------------------------------------------------------------
  m = path.match(/^\/api\/runs\/([^/]+)$/);
  if (m) {
    const run = state.runs[m[1] as string];
    if (!run) return problem(res, 404, "Run not found");
    return send(res, 200, { ...run.summary, lastSeq: run.released });
  }
  m = path.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (m) {
    const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0) || 0;
    return stream(req, res, m[1] as string, after);
  }
  m = path.match(/^\/api\/runs\/([^/]+)\/(pause|resume|cancel)$/);
  if (m && method === "POST") {
    const run = state.runs[m[1] as string];
    if (!run) return problem(res, 404, "Run not found");
    const action = m[2];
    if (state.failControl) return problem(res, 409, "The run cannot change state now");
    if (action === "pause") {
      run.paused = true;
      run.summary.status = "paused";
      run.events.splice(run.released, 0, { seq: 0, type: "run.paused", at: "", payload: { reason: "Paused by the owner." }, delayMs: 0 });
      run.events.forEach((e, i) => (e.seq = i + 1));
      run.released += 1;
      notify(run.summary.id);
    } else if (action === "resume") {
      run.paused = false;
      run.summary.status = "running";
      run.events.splice(run.released, 0, { seq: 0, type: "run.resumed", at: "", payload: {}, delayMs: 0 });
      run.events.forEach((e, i) => (e.seq = i + 1));
      run.released += 1;
      notify(run.summary.id);
      pump(run.summary.id);
    } else {
      run.paused = true;
      run.summary.status = "cancelled";
      run.events.splice(run.released);
      append(run.summary.id, "run.finished", { outcome: "cancelled", summary: "Cancelled by the owner.", totals: { credits: 3 } });
    }
    return send(res, 200, { ...run.summary, lastSeq: run.released });
  }
  m = path.match(/^\/api\/runs\/([^/]+)\/approvals\/([^/]+)$/);
  if (m && method === "POST") {
    const run = state.runs[m[1] as string];
    if (!run) return problem(res, 404, "Run not found");
    const decision = (body as { decision: string }).decision;
    run.answered.add(m[2] as string);
    const gateIndex = run.events.findIndex((e) => e.gate === m?.[2]);
    if (gateIndex >= 0) {
      const gated = run.events[gateIndex] as MockEvent;
      gated.payload = { ...gated.payload, answer: decision === "approve" ? "Approved" : "Declined" };
    }
    run.summary.status = "running";
    pump(run.summary.id);
    return send(res, 204);
  }

  // Conversation -------------------------------------------------------------------------
  if (path === "/api/conversations" && method === "GET") {
    const scope = url.searchParams.get("scope") ?? "";
    return send(res, 200, conversation(scope, url.searchParams.get("employeeId")));
  }
  if (path === "/api/conversations" && method === "POST") {
    if (state.failConversation) return problem(res, 503, "The conversation could not start");
    const b = body as { scope: string; message: string; employeeId?: string };
    const runId = state.addConversation(b.scope, b.message, b.employeeId);
    pump(runId);
    return send(res, 201, state.runs[runId]?.summary);
  }

  // Apps ---------------------------------------------------------------------------------
  m = path.match(/^\/api\/apps\/([^/]+)$/);
  if (m) {
    const app = state.apps[m[1] as string];
    return app ? send(res, 200, app) : problem(res, 404, "App not found");
  }
  m = path.match(/^\/api\/apps\/([^/]+)\/settings$/);
  if (m && method === "POST") {
    const app = state.apps[m[1] as string];
    if (!app) return problem(res, 404, "App not found");
    if (state.failSettings) {
      await new Promise((r) => setTimeout(r, 300));
      return problem(res, 403, "Only an Admin can change this");
    }
    Object.assign(app.settings, body);
    return send(res, 200, app);
  }

  // Sharing ------------------------------------------------------------------------------
  m = path.match(/^\/api\/apps\/([^/]+)\/shares$/);
  if (m) {
    const appId = m[1] as string;
    const app = state.apps[appId];
    if (!app) return problem(res, 404, "App not found");
    const list = (state.shares[appId] ??= []);
    if (method === "GET") return send(res, 200, list);
    if (method === "POST") {
      const email = String((body as { email?: string } | null)?.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return problem(res, 400, "That is not an e-mail address");
      const existing = list.find((x) => x.email === email);
      if (existing?.registered) return problem(res, 409, "Conflict", "That address is already registered with this app; sign in instead.");
      if (!existing) list.push({ email, invitedAt: now(), registered: false });
      list.sort((a, b) => a.email.localeCompare(b.email));
      app.sharedWith = list.length;
      return send(res, 201, { email, invitationCode: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() });
    }
    if (method === "DELETE") {
      const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
      const i = list.findIndex((x) => x.email === email);
      if (i < 0) return problem(res, 404, "Not found", `A share with '${email}' was not found.`);
      list.splice(i, 1);
      app.sharedWith = list.length;
      return send(res, 204);
    }
  }

  // Secrets ------------------------------------------------------------------------------
  if (path === "/api/secrets") {
    if (method === "GET") return send(res, 200, secretList(url.searchParams.get("scope") ?? ""));
    if (method === "PUT") {
      const b = (body ?? {}) as { scope?: string; name?: string; value?: string };
      if (state.failSecretWrite) return problem(res, 403, "Forbidden", `This needs the admin role at '${b.scope}'; you are a builder there (set at ${b.scope}).`);
      if (!SECRET_NAME.test(b.name ?? "")) return problem(res, 400, "Invalid", `'${b.name}' is not a secret name: use UPPER_SNAKE_CASE.`);
      if (typeof b.value !== "string" || b.value.length === 0) return problem(res, 400, "Invalid", "A secret needs a value.");
      const scope = b.scope ?? "";
      const existing = state.secrets.find((x) => x.scope === scope && x.name === b.name);
      const setAt = now();
      if (existing) existing.setAt = setAt;
      else state.secrets.push({ scope, name: b.name as string, setAt });
      return send(res, 200, { name: b.name, setAtLevel: LEVELS[scope.split("/").length - 1], setAtPath: scope, setAt, inherited: false, overrides: [] });
    }
    if (method === "DELETE") {
      const scope = url.searchParams.get("scope") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const i = state.secrets.findIndex((x) => x.scope === scope && x.name === name);
      if (i < 0) return problem(res, 404, "Not found", `A secret '${name}' set at '${scope}' was not found.`);
      state.secrets.splice(i, 1);
      return send(res, 204);
    }
  }

  // Operator access ----------------------------------------------------------------------
  if (path === "/api/audit/operator-access") {
    const org = url.searchParams.get("organisation") ?? "";
    if (state.viewerRole !== "owner") return problem(res, 403, "Forbidden", `This needs the owner role at '${org}'; you are a ${state.viewerRole} there (set at ${org}).`);
    return send(res, 200, state.operatorLog);
  }

  // The workforce ------------------------------------------------------------------------
  const workforceRead = path.startsWith("/api/employees") || path.startsWith("/api/hires") || path.startsWith("/api/autonomy") || path === "/api/ontology" || path === "/api/tasks";
  if (workforceRead && method === "GET" && state.failWorkforceRead) return problem(res, 503, "Unavailable", "The workforce could not be read.");
  if (workforceRead && method !== "GET" && state.failWorkforceWrite) {
    await new Promise((r) => setTimeout(r, 300));
    return problem(res, 403, "Forbidden", "This needs the admin role here; you are a builder.");
  }
  if (path === "/api/employees/recurring-roles") return send(res, 200, state.recurringRoles);
  if (path === "/api/employees" && method === "GET") return send(res, 200, Object.values(state.employees).map((d) => d.employee));
  m = path.match(/^\/api\/employees\/([^/]+)$/);
  if (m) {
    const d = state.employees[m[1] as string];
    if (!d) return problem(res, 404, "Not found", "No such employee.");
    if (method === "GET") return send(res, 200, d);
    if (method === "PATCH") {
      const b = (body ?? {}) as { status?: string; clearMonthlyCreditLimit?: boolean; jobDescription?: { monthlyCreditLimit?: number } };
      if (b.status) d.employee.status = b.status;
      const jd = d.employee.jobDescription as Record<string, unknown>;
      if (b.clearMonthlyCreditLimit) jd.monthlyCreditLimit = null;
      if (b.jobDescription?.monthlyCreditLimit !== undefined) jd.monthlyCreditLimit = b.jobDescription.monthlyCreditLimit;
      return send(res, 200, d.employee);
    }
  }
  m = path.match(/^\/api\/employees\/([^/]+)\/(release|rehire|reassign)$/);
  if (m && method === "POST") {
    const d = state.employees[m[1] as string];
    if (!d) return problem(res, 404, "Not found");
    if (m[2] === "release") {
      if (d.employee.standing) return problem(res, 409, "Conflict", "A standing hire is never released.");
      d.employee.status = "released";
      d.employee.releasedAt = now();
    } else if (m[2] === "rehire") {
      d.employee.status = "idle";
      d.employee.releasedAt = null;
    } else {
      d.employee.scope = String((body as { scope?: string }).scope ?? d.employee.scope);
    }
    return send(res, 200, d.employee);
  }
  m = path.match(/^\/api\/employees\/([^/]+)\/memory(?:\/(changes|[^/]+))?$/);
  if (m) {
    const id = m[1] as string;
    const list = (state.memory[id] ??= []);
    const changes = (state.memoryChanges[id] ??= []);
    if (m[2] === "changes") return send(res, 200, changes);
    if (!m[2] && method === "GET") return send(res, 200, list);
    if (!m[2] && method === "POST") {
      const b = body as { title: string; body: string; kind: string };
      const entry = { id: `mem-${randomBytes(4).toString("hex")}`, employeeId: id, scope: String(state.employees[id]?.employee.scope ?? ""), title: b.title, body: b.body, kind: b.kind, sourceRunId: null, createdAt: now(), updatedAt: now(), lastReviewedAt: null, archived: false };
      list.unshift(entry);
      changes.unshift({ id: `ch-${entry.id}`, memoryId: entry.id, action: "added", by: "person", userId: "u1", runId: null, detail: null, at: now() });
      return send(res, 201, entry);
    }
    const entry = list.find((e) => e.id === m?.[2]);
    if (!entry) return problem(res, 404, "Not found");
    if (method === "PATCH") {
      Object.assign(entry, body as object, { updatedAt: now() });
      changes.unshift({ id: `ch-${randomBytes(4).toString("hex")}`, memoryId: entry.id, action: "corrected", by: "person", userId: "u1", runId: null, detail: null, at: now() });
      return send(res, 200, entry);
    }
    if (method === "DELETE") {
      list.splice(list.indexOf(entry), 1);
      changes.unshift({ id: `ch-${randomBytes(4).toString("hex")}`, memoryId: entry.id, action: "removed", by: "person", userId: "u1", runId: null, detail: { why: url.searchParams.get("why") }, at: now() });
      return send(res, 204);
    }
  }
  m = path.match(/^\/api\/employees\/([^/]+)\/reviews$/);
  if (m && method === "POST") {
    const runId = state.addRun(`Memory review: ${String(state.employees[m[1] as string]?.employee.name ?? "")}`, "review");
    return send(res, 201, state.runs[runId]?.summary);
  }

  // Hires --------------------------------------------------------------------------------
  if (path === "/api/hires" && method === "GET") return send(res, 200, Object.values(state.hires).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  if (path === "/api/hires" && method === "POST") {
    const b = body as Record<string, unknown> & { scope: string; role: string; reason: string; expectedMonthlyCredits: number; jobDescription: Record<string, unknown> };
    const id = `h-${randomBytes(4).toString("hex")}`;
    state.hires[id] = { id, status: "proposed", trigger: String(b.trigger ?? "owner"), needKey: b.needKey ?? null, scope: b.scope, reason: b.reason, name: String(b.name), role: b.role, jobDescription: { mandate: "", scope: b.scope, tools: [], services: [], monthlyCreditLimit: null, modelTier: null, ...b.jobDescription }, reportsTo: null, expectedMonthlyCredits: b.expectedMonthlyCredits, withinBudget: true, headroomCredits: 690, contractorRole: b.role, raisedBy: "person", raisedByRunId: null, decision: null, employeeId: null, createdAt: now() };
    return send(res, 201, state.hires[id]);
  }
  m = path.match(/^\/api\/hires\/([^/]+)(?:\/(accept|decline))?$/);
  if (m) {
    const hire = state.hires[m[1] as string];
    if (!hire) return problem(res, 404, "Not found", "No such hire proposal.");
    if (method === "GET") return send(res, 200, hire);
    if (method === "PATCH") {
      const b = body as Record<string, unknown> & { jobDescription?: Record<string, unknown> };
      Object.assign(hire, { ...b, jobDescription: { ...(hire.jobDescription as object), ...(b.jobDescription ?? {}) } });
      return send(res, 200, hire);
    }
    if (method === "POST") {
      if (hire.status !== "proposed") return problem(res, 409, "Conflict", "This proposal was already decided.");
      const note = (body as { note?: string } | null)?.note ?? null;
      hire.decision = { via: "person", by: state.user.displayName, at: now(), note };
      if (m[2] === "accept") {
        hire.status = "accepted";
        hire.employeeId = "e2";
      } else hire.status = "declined";
      return send(res, 200, hire);
    }
  }

  // Autonomy -----------------------------------------------------------------------------
  if (path === "/api/autonomy" || path === "/api/autonomy/rule-sets") {
    const scope = method === "GET" || method === "DELETE" ? (url.searchParams.get("scope") ?? "") : String((body as { scope?: string }).scope ?? "");
    const here = (state.autonomy[scope] ??= { checkpoints: {}, ruleSets: {} });
    if (path === "/api/autonomy" && method === "PUT") {
      const b = body as { autonomy?: string; checkpoints?: Record<string, boolean> };
      if (b.autonomy) here.autonomy = b.autonomy;
      Object.assign(here.checkpoints, b.checkpoints ?? {});
    }
    if (path === "/api/autonomy" && method === "DELETE") {
      const key = url.searchParams.get("key") ?? "";
      if (key === "autonomy") delete here.autonomy;
      else here.checkpoints = Object.fromEntries(Object.entries(here.checkpoints).filter(([k]) => k !== key.replace("checkpoint.", "")));
    }
    if (path === "/api/autonomy/rule-sets" && method === "PUT") {
      const b = body as { stage: string; deny: string[]; ask: string[]; allow: string[]; checkpoints: string[] };
      here.ruleSets[b.stage] = { deny: b.deny, ask: b.ask, allow: b.allow, checkpoints: b.checkpoints };
    }
    if (path === "/api/autonomy/rule-sets" && method === "DELETE") here.ruleSets = Object.fromEntries(Object.entries(here.ruleSets).filter(([k]) => k !== url.searchParams.get("stage")));
    const parts = scope.split("/");
    const chain = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    let autonomy: { value: string; at: string | null } = { value: "auto", at: null };
    const checkpoints: Record<string, { on: boolean; setAtPath: string | null }> = { start: { on: false, setAtPath: null }, plan: { on: false, setAtPath: null }, hire: { on: false, setAtPath: null } };
    const rules: Record<string, Record<string, unknown> & { setAtPath: string; overrides: string[] }> = {};
    for (const at of chain) {
      const level = state.autonomy[at];
      if (!level) continue;
      if (level.autonomy) autonomy = { value: level.autonomy, at };
      for (const [k, on] of Object.entries(level.checkpoints)) checkpoints[k] = { on, setAtPath: at };
      for (const [stage, r] of Object.entries(level.ruleSets)) rules[stage] = { stage, ...r, setAtPath: at, overrides: rules[stage] ? [rules[stage].setAtPath, ...rules[stage].overrides] : [] };
    }
    return send(res, 200, { scope, autonomy: autonomy.value, autonomySetAtPath: autonomy.at, checkpoints, ruleSets: Object.values(rules), stages: ["all", "research", "plan", "build", "evaluate", "review", "conversation"] });
  }

  // The ontology and tasks ---------------------------------------------------------------
  if (path === "/api/ontology") return send(res, 200, state.ontology());
  if (path === "/api/tasks") return send(res, 200, state.tasks);

  // Credits ------------------------------------------------------------------------------
  if (path === "/api/credits") {
    if (state.failCredits) return problem(res, 500, "Credits could not be read");
    return send(res, 200, state.credits());
  }

  // System -------------------------------------------------------------------------------
  if (path === "/api/system/status") {
    return send(res, 200, {
      overall: "healthy",
      checkedAt: new Date().toISOString(),
      services: ["Control plane", "Edge", "Runner", "Dock", "Database", "Console"].map((name) => ({ key: name.toLowerCase().replace(/ /g, "-"), name, state: "healthy", latencyMs: 4, detail: null })),
    });
  }

  return problem(res, 404, "No such endpoint in the mock");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock control plane listening on http://127.0.0.1:${port}`);
});
