import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { match } from "./http";
import { clock, seek, tick } from "./engine";
import { answerApproval } from "./routes/work";
import { buildWorld } from "../world/scenarios";
import { IDS, ORG, PEOPLE } from "../world/default";
import type { World } from "./world";

/**
 * The fake control plane's contract: every endpoint the console calls has a handler, and the
 * rules and refusals are the control plane's own, word for word.
 */

const src = path.join(import.meta.dirname, "..", "..", "store");

/** Every METHOD path the console calls, read from api.ts and sensitive.ts. */
function consoleEndpoints(): { method: string; path: string; from: string }[] {
  const out: { method: string; path: string; from: string }[] = [];
  const sample = (t: string) => t.replace(/\$\{[^}]*["'`][?&][^}]*\}/g, "").replace(/\$\{[^}]+\}/g, "x1").replace(/\?.*$/, "").replace(/^\/+/, "");
  const api = readFileSync(path.join(src, "api.ts"), "utf8");
  const blocks = api.split(/\n {4}(?=\w+: build\.(?:query|mutation)<)/).slice(1);
  for (const block of blocks) {
    const name = block.match(/^(\w+):/)?.[1] ?? "?";
    const query = block.slice(block.indexOf("query:"));
    const literals = [...query.matchAll(/(["`])((?:(?!\1)[^\\]|\\.)*?)\1/g)].map((m) => m[2] ?? "").filter((t) => /^[a-z][a-z-]*(\/|$|\?|\$)/.test(t) && !/^(GET|POST|PUT|PATCH|DELETE|same-origin)$/i.test(t));
    const method = query.match(/method: "(\w+)"/)?.[1] ?? "GET";
    const pathText = literals.find((l) => !l.startsWith("?")) ?? "";
    if (!pathText) throw new Error(`could not read the address of ${name}`);
    out.push({ method, path: sample(pathText), from: `api.ts ${name}` });
  }
  const sensitive = readFileSync(path.join(src, "sensitive.ts"), "utf8");
  for (const m of sensitive.matchAll(/send(?:<\w+>)?\("(\w+)", (["`])(.*?)\2/g)) out.push({ method: m[1] ?? "GET", path: sample(m[3] ?? ""), from: "sensitive.ts send" });
  for (const m of sensitive.matchAll(/apiFetch\(`\$\{API_BASE\}\/(.*?)`/g)) if (!m[1]?.startsWith("${path}")) out.push({ method: "GET", path: sample(m[1] ?? ""), from: "sensitive.ts apiFetch" });
  return out;
}

describe("endpoint coverage", () => {
  const endpoints = consoleEndpoints();

  it("reads the console's endpoints", () => {
    expect(endpoints.length).toBeGreaterThan(80);
  });

  it.each(endpoints.map((e) => [`${e.method} ${e.path}`, e] as const))("%s has a handler", (_name, e) => {
    expect(match(e.method, e.path), `${e.from}: no handler for ${e.method} ${e.path} — add one in src/demo/server/routes/`).not.toBeNull();
  });
});

function as(persona: string, scenario = "default"): World {
  return buildWorld(scenario, persona).world;
}

const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};

const detail = (r: { body?: unknown }) => (r.body as { detail?: string }).detail;

describe("the control plane's rules", () => {
  it("answers a signed-out caller with 401", async () => {
    const r = await call(as("signed-out"), "GET", "me");
    expect(r.status).toBe(401);
    expect(detail(r)).toBe("This needs a signed-out member.".replace("signed-out", "signed-in"));
  });

  it("refuses a Viewer an idea, in the control plane's words", async () => {
    const r = await call(as("viewer"), "POST", "ideas", { text: "Something", constraints: [] });
    expect(r.status).toBe(403);
    expect(detail(r)).toBe(`This needs the builder role at '${ORG}'; you are a viewer there (set at ${ORG}).`);
  });

  it("hides what a person has no role over", async () => {
    const r = await call(as("division-admin"), "GET", `secrets?scope=${ORG}/learning`);
    expect(r.status).toBe(404);
    expect(detail(r)).toBe(`The scope '${ORG}/learning' was not found, or you cannot see it.`);
  });

  it("never builds over a red line", async () => {
    const r = await call(as("owner"), "POST", `ideas/${IDS.ideaLocator}/decision`, { choice: "overrule" });
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe("red_line");
    expect(detail(r)).toBe("The research found it crosses a red line (surveillance). FrostAura never builds it, and no one can overrule that. Change the idea, or drop it.");
  });

  it("keeps overrule for a do-not-build verdict", async () => {
    const w = as("owner");
    expect(detail(await call(w, "POST", `ideas/${IDS.ideaAllergen}/decision`, { choice: "overrule" }))).toBe("There is nothing to overrule: the verdict was 'build'.");
    expect(detail(await call(w, "POST", `ideas/${IDS.ideaVans}/decision`, { choice: "build" }))).toBe("The verdict was 'do not build'. Building over it takes an explicit overrule, which the project keeps on record.");
  });

  it("lets only FrostAura top up, and only the Owner read the operator log", async () => {
    expect(detail(await call(as("owner"), "POST", "credits/top-ups", { organisation: ORG, credits: 10, note: "", idempotencyKey: "a" }))).toBe("Credits are topped up by FrostAura (manual top-ups; there is no payment gateway).");
    const op = as("operator");
    expect((await call(op, "POST", "credits/top-ups", { organisation: ORG, credits: 10, note: "x", idempotencyKey: "a" })).status).toBe(200);
    expect(detail(await call(op, "GET", `audit/operator-access?organisation=${ORG}`))).toBe(`This needs the owner role at '${ORG}'; you are a admin there (set at ${ORG}).`);
  });

  it("records God-mode entries where the Owner reads them", async () => {
    const w = as("operator");
    const r = await call(w, "POST", `operator/organisations/${ORG}/enter`);
    expect((r.body as { logged: string }).logged).toBe("This entry is in the organisation's operator log, which its Owner reads.");
    w.sessionUserId = PEOPLE.owner.id;
    const log = await call(w, "GET", `audit/operator-access?organisation=${ORG}`);
    expect((log.body as { action: string }[])[0]?.action).toBe("organisation.entered");
  });

  it("keeps one Owner", async () => {
    const r = await call(as("owner"), "POST", "members", { scope: ORG, email: "a@b.example", displayName: "A", role: "owner" });
    expect(detail(r)).toBe("An organisation has one Owner, the person it was provisioned for.");
    const admin = await call(as("admin"), "POST", "members", { scope: ORG, email: "a@b.example", displayName: "A", role: "admin" });
    expect(detail(admin)).toBe("Only the Owner manages Admins.");
  });

  it("checks a secret's name and never returns its value", async () => {
    const w = as("owner");
    expect(detail(await call(w, "PUT", "secrets", { scope: ORG, name: "lower", value: "v" }))).toBe("'lower' is not a secret name: use UPPER_SNAKE_CASE, 2-128 characters, starting with a letter (for example STRIPE_API_KEY).");
    const ok = await call(w, "PUT", "secrets", { scope: ORG, name: "NEW_KEY", value: "the-value" });
    expect(JSON.stringify(ok.body)).not.toContain("the-value");
    expect(JSON.stringify(w)).not.toContain("the-value");
  });

  it("is invite-only", async () => {
    const r = await call(as("signed-out"), "POST", "auth/passkey/register/options", { email: "x@y.example", displayName: "X" });
    expect(detail(r)).toBe("Endgame is invite-only. Sign in, or register with the invitation code you were sent.");
    const bad = await call(as("invited"), "POST", "auth/passkey/register/options", { email: PEOPLE.invited.email, displayName: "T", invitationCode: "WRONG" });
    expect(detail(bad)).toBe("That invitation code is not valid for this e-mail address, or it has expired.");
  });

  it("refuses a release of the standing security reviewer", async () => {
    const w = as("owner");
    const reviewer = w.employees.find((e) => e.standing === "security-reviewer" && e.scope === ORG);
    const r = await call(w, "POST", `employees/${reviewer?.id ?? ""}/release`);
    expect((r.body as { title: string }).title).toBe("A standing hire is never released");
  });
});

describe("live work", () => {
  it("plays research to its verdict, raising the verdict notice", () => {
    const w = as("owner");
    expect(seek(w, "research:verdict", () => undefined)).toBe(true);
    const idea = w.ideas.find((i) => i.id === IDS.ideaTides);
    expect(idea?.status).toBe("verdict");
    expect(idea?.verdict).not.toBeNull();
    expect(w.notifications.some((n) => n.kind === "verdict" && n.subject?.id === IDS.ideaTides)).toBe(true);
  });

  it("builds to a private app, repairs a sent-back part at no charge, and fixes the security finding", () => {
    const w = as("owner");
    const before = w.notCharged[ORG]?.repairs ?? 0;
    seek(w, "build:finished", () => undefined);
    const run = w.runs.find((r) => r.run.id === IDS.runBuildReadingList);
    expect(run?.run.status).toBe("finished");
    const types = run?.events.map((e) => e.type) ?? [];
    expect(types).toContain("evaluation.failed");
    expect(types).toContain("plan.accepted");
    expect(run?.events.some((e) => e.payload.milestone === "security:0")).toBe(true);
    expect(run?.events.some((e) => e.payload.milestone === "published")).toBe(true);
    expect(run?.events.some((e) => e.type === "model.replied" && e.payload.billable === false)).toBe(true);
    const app = w.apps.find((a) => a.id === IDS.readingList);
    expect(app).toMatchObject({ status: "running", access: "private" });
    expect(w.notCharged[ORG]?.repairs).toBe(before + 1);
  });

  it("stops at an approval until it is answered", () => {
    const w = buildWorld("build-waiting-on-plan", "owner").world;
    seek(w, "build:waiting-on-plan", () => undefined);
    const run = w.runs.find((r) => r.run.id === IDS.runBuildReadingList);
    expect(run?.run.status).toBe("waiting");
    const cursor = run?.playback?.cursor;
    clock.playing = true;
    tick(w, 60_000);
    expect(run?.playback?.cursor).toBe(cursor);
    const approval = w.approvals.find((a) => a.runId === IDS.runBuildReadingList && !a.answer);
    answerApproval(w, approval?.id ?? "", "approve", "test");
    tick(w, 5_000);
    expect(run?.events.some((e) => e.type === "plan.accepted")).toBe(true);
  });

  it("raises an approval when a conversation proposes an idea, and starts research on a yes", async () => {
    const w = as("owner");
    const r = await call(w, "POST", "conversations", { scope: ORG, message: "Could we build a coaching calendar for the junior squad?" });
    const runId = (r.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    const approval = w.approvals.find((a) => a.runId === runId);
    expect(approval?.title).toMatch(/^Start researching an idea: /);
    const ideas = w.ideas.length;
    await call(w, "POST", `runs/${runId}/approvals/${approval?.id ?? ""}`, { decision: "approve" });
    expect(w.ideas.length).toBe(ideas + 1);
  });
});
