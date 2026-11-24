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
    return send(res, 200, { user: state.user, organisation: state.org ? { id: state.org.id, slug: state.org.slug, name: state.org.name } : null });
  }
  if (path === "/api/auth/development" && method === "POST") {
    if (!state.developmentSignIn) return problem(res, 404, "Not found");
    state.signedIn = true;
    return send(res, 200, { user: state.user, organisation: state.org ? { id: state.org.id, slug: state.org.slug, name: state.org.name } : null });
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
    return send(res, 200, { user: state.user, organisation: state.org ? { id: state.org.id, slug: state.org.slug, name: state.org.name } : null });
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
    return send(res, 201, { id: state.org.id, slug: b.slug, name: b.name });
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
