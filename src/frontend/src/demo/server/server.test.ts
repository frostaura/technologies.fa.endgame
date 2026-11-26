import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { match } from "./http";
import { consoleCalls } from "./consoleEndpoints";
import { clock, seek, tick } from "./engine";
import { answerApproval } from "./routes/work";
import { MODELS_UNREACHABLE } from "./scripts";
import { buildWorld } from "../world/scenarios";
import "../world/scenarios.s4";
import { IDS, ORG, PEOPLE } from "../world/default";
import type { World } from "./world";

/**
 * The fake control plane's contract: every endpoint the console calls has a handler, and the
 * rules and refusals are the control plane's own, word for word.
 */

const src = path.join(import.meta.dirname, "..", "..", "store");

/** Every METHOD path the console calls, read from api.ts and sensitive.ts. */
function consoleEndpoints() {
  return consoleCalls(readFileSync(path.join(src, "api.ts"), "utf8"), readFileSync(path.join(src, "sensitive.ts"), "utf8"));
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
    expect(detail(await call(op, "GET", `audit/operator-access?organisation=${ORG}`))).toBe(`This needs the owner role at '${ORG}'; you are an admin there (set at ${ORG}).`);
  });

  it("records God-mode entries where the Owner reads them", async () => {
    const w = as("operator");
    const r = await call(w, "POST", `operator/organisations/${ORG}/enter`);
    expect((r.body as { logged: string }).logged).toBe("This entry is in the organisation's operator log, which its Owner reads.");
    w.sessionUserId = PEOPLE.owner.id;
    const log = await call(w, "GET", `audit/operator-access?organisation=${ORG}`);
    expect((log.body as { action: string }[])[0]?.action).toBe("organisation.entered");
  });

  it("lists the operator log newest first, as the control plane does, whatever order the world holds it in", async () => {
    const w = as("owner");
    const at = (log: { at: string }[]) => log.map((x) => Date.parse(x.at));
    const log = (await call(w, "GET", `audit/operator-access?organisation=${ORG}`)).body as { at: string }[];
    expect(log.length).toBeGreaterThan(1);
    expect(at(log)).toEqual([...at(log)].sort((a, b) => b - a));
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

  it("lets the first person name the first organisation, and nobody self-serve after", async () => {
    const w = buildWorld("default", "first-run").world;
    const r = await call(w, "POST", "organisations", { name: "Harbour Club", slug: "harbour-club" });
    expect(r.status).toBe(201);
    expect(w.memberships.some((m) => m.path === "harbour-club" && m.role === "owner" && m.userId === w.sessionUserId)).toBe(true);
    expect(detail(await call(w, "POST", "organisations", { name: "Another", slug: "another" }))).toBe("Organisations are provisioned by FrostAura; there is no self-serve sign-up.");
  });

  it("refuses a release of the standing security reviewer", async () => {
    const w = as("owner");
    const reviewer = w.employees.find((e) => e.standing === "security-reviewer" && e.scope === ORG);
    const r = await call(w, "POST", `employees/${reviewer?.id ?? ""}/release`);
    expect((r.body as { title: string }).title).toBe("A standing hire is never released");
  });
});

describe("lane A's control plane: roles per node, invitations, screening, pauses, God mode on record", () => {
  it("gives every node the viewer's role, and says when nobody may name the first organisation", async () => {
    const tree = (await call(as("division-admin"), "GET", "tree")).body as { organisation: { role: string | null }; divisions: { slug: string; role: string | null; archived: boolean }[]; firstRun: boolean };
    expect(tree.organisation.role).toBeNull();
    expect(tree.divisions.find((d) => d.slug === "technologies")).toMatchObject({ role: "admin", archived: false });
    const fresh = (await call(as("first-run"), "GET", "tree")).body as { firstRun: boolean };
    expect(fresh.firstRun).toBe(true);
  });

  it("lists grants from above, with a pending person's code expiry, and sends a new code", async () => {
    const w = as("owner");
    const people = (await call(w, "GET", `members?scope=${ORG}/learning`)).body as { email: string; invitationExpiresAt: string | null; membershipId: string; hasPasskey: boolean }[];
    expect(people.some((p) => p.email === PEOPLE.owner.email)).toBe(true);
    const tobi = people.find((p) => p.email === PEOPLE.invited.email);
    expect(tobi?.invitationExpiresAt).not.toBeNull();
    const again = await call(w, "POST", `members/${tobi?.membershipId ?? ""}/invitation`);
    expect((again.body as { invitationCode: string }).invitationCode).not.toBe("LARK-7Q4M-2PXD");
    const ada = people.find((p) => p.email === PEOPLE.admin.email);
    expect(detail(await call(w, "POST", `members/${ada?.membershipId ?? ""}/invitation`))).toBe("Ada Lovelace already has a passkey, so they sign in with it and need no code.");
  });

  it("screens a provisioned organisation, and records it in its operator log", async () => {
    const w = as("operator");
    const base = { name: "Harbour Watch", slug: "harbour-watch", ownerEmail: "owner@harbour.example" };
    expect(detail(await call(w, "POST", "organisations", base))).toBe("Say what the organisation does, in 10 to 1000 characters: it is screened against FrostAura's red lines before it is set up.");
    const breach = await call(w, "POST", "organisations", { ...base, description: "We track where employees go after work using their phones." });
    expect(breach.status).toBe(422);
    expect(detail(breach)).toMatch(/^What it does crosses a red line — surveillance and authoritarian tooling: /);
    const made = await call(w, "POST", "organisations", { ...base, description: "Tide tables and a booking desk for a small harbour." });
    expect((made.body as { screening: { method: string } }).screening.method).toBe("model");
    expect(w.operatorLog.filter((x) => x.organisation === "harbour-watch").map((x) => x.action)).toEqual(expect.arrayContaining(["organisation.screened", "organisation.provisioned"]));
    const offline = buildWorld("screening-offline", "operator").world;
    const unscreened = await call(offline, "POST", "organisations", { ...base, description: "Tide tables and a booking desk for a small harbour." });
    expect((unscreened.body as { code: string }).code).toBe("screening_unavailable");
    const manual = await call(offline, "POST", "organisations", { ...base, description: "Tide tables and a booking desk for a small harbour.", screening: { decision: "clear", reason: "Read it myself: tide tables and bookings." } });
    expect((manual.body as { screening: { method: string } }).screening.method).toBe("manual");
  });

  it("pauses an employee's work with them, and refuses them new work", async () => {
    const w = as("owner");
    seek(w, "build:part-1", () => undefined);
    const engineer = w.employees.find((e) => e.status === "working" && e.role === "Software engineer");
    expect(engineer).toBeDefined();
    await call(w, "PATCH", `employees/${engineer?.id ?? ""}`, { status: "paused" });
    const run = w.runs.find((r) => r.run.id === IDS.runBuildReadingList);
    expect(run?.run.status).toBe("paused");
    const refused = await call(w, "POST", "conversations", { scope: engineer?.scope ?? ORG, message: "Hello", employeeId: engineer?.id });
    expect(detail(refused)).toBe(`${engineer?.name ?? ""} is paused, so they are given no new work. Resume them first.`);
    await call(w, "PATCH", `employees/${engineer?.id ?? ""}`, { status: "idle" });
    expect(run?.run.status).toBe("running");
  });

  it("tells a signed-out visitor only whether the whole is healthy", async () => {
    expect(Object.keys((await call(as("signed-out"), "GET", "system/status")).body as object).sort()).toEqual(["checkedAt", "overall"]);
  });

  it("writes each change an operator makes inside an entered organisation to its log, and tells operators of top-up requests", async () => {
    const w = as("operator");
    await call(w, "PUT", "secrets", { scope: ORG, name: "OPERATOR_SET", value: "x" });
    expect(w.operatorLog[0]).toMatchObject({ organisation: ORG, action: "admin.PUT-secrets", detail: { title: "Set a secret" } });
    expect(JSON.stringify(w.operatorLog[0])).not.toContain('"x"');
    w.sessionUserId = PEOPLE.owner.id;
    await call(w, "POST", "credits/top-up-requests", { organisation: ORG, credits: 300, note: "Tournament weekend." });
    expect(w.notifications.find((n) => n.kind === "topup.requested" && n.organisation === "frostaura")?.title).toBe("Northwind asks for 300 credits");
  });
});

describe("lane B's control plane: managing the tree, the cascade, republishing, moving people", () => {
  it("creates, renames, archives and deletes levels, refusing a delete with history attached", async () => {
    const w = as("owner");
    const made = await call(w, "POST", "projects", { parent: `${ORG}/operations`, name: "Lost Property", slug: "lost-property" });
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    expect(detail(await call(w, "POST", "projects", { parent: `${ORG}/operations`, name: "Again", slug: "lost-property" }))).toBe("A sibling already uses that slug.");
    expect(detail(await call(w, "POST", "apps", { parent: `${ORG}/operations`, name: "X", slug: "xx" }))).toBe(`An app is created under a project; '${ORG}/operations' is a division.`);
    expect(((await call(w, "PATCH", `projects/${id}`, { name: "Lost and Found" })).body as { name: string }).name).toBe("Lost and Found");
    expect(((await call(w, "PATCH", `projects/${id}`, { status: "archived" })).body as { status: string }).status).toBe("archived");
    expect(detail(await call(w, "PATCH", `projects/${id}`, { status: "gone" }))).toBe("'gone' is not a status a project can have: use active, archived.");
    expect((await call(w, "DELETE", `projects/${id}`)).status).toBe(204);
    const events = w.nodes.find((n) => n.path === `${ORG}/events`);
    expect(detail(await call(w, "DELETE", `divisions/${events?.id ?? ""}`))).toBe(`'${ORG}/events' still has children, work or credit history attached. Archive it instead (status: archived).`);
    const org = w.organisations.find((o) => o.slug === ORG);
    expect(((await call(w, "PATCH", `organisations/${org?.id ?? ""}`, { name: "Northwind Club" })).body as { name: string }).name).toBe("Northwind Club");
    expect(detail(await call(w, "PATCH", `organisations/${org?.id ?? ""}`, { status: "suspended" }))).toBe("An organisation is suspended or reinstated by FrostAura.");
  });

  it("reads, sets and removes the cascade's values where they apply", async () => {
    const w = as("owner");
    await call(w, "PUT", "cascade", { scope: `${ORG}/learning/course-notes`, kind: "budget", key: "monthly_credits", value: 75 });
    const caps = (await call(w, "GET", `cascade?scope=${ORG}/learning/course-notes/web&kind=budget`)).body as { value: number; setAtPath: string; overrides: string[] }[];
    expect(caps[0]).toMatchObject({ value: 75, setAtPath: `${ORG}/learning/course-notes`, overrides: [`${ORG}/learning`] });
    expect(detail(await call(w, "PUT", "cascade", { scope: ORG, kind: "budget", key: "monthly_credits", value: -1 }))).toBe("'monthly_credits' cannot be negative.");
    expect(detail(await call(w, "PUT", "cascade", { scope: ORG, kind: "setting", key: "overdraft_limit", value: 5 }))).toBe("An organisation's deepest overdraft is set by a FrostAura operator. Set a tighter one of your own (overdraft_own_limit), or on a division, project or app.");
    expect((await call(w, "DELETE", `cascade?scope=${ORG}&kind=setting&key=overdraft_own_limit`)).status).toBe(204);
    expect(w.organisations.find((o) => o.slug === ORG)?.ownLimit).toBeNull();
    const below = (await call(w, "GET", `cascade/below?scope=${ORG}&kind=context`)).body as { setAtPath: string }[];
    expect(below.some((v) => v.setAtPath === `${ORG}/technologies`)).toBe(true);
    await call(w, "PUT", "cascade", { scope: `${ORG}/learning`, kind: "context", key: "opening-hours", value: "Weekdays 15:00–19:00." });
    expect(((await call(w, "GET", `cascade?scope=${ORG}/learning&kind=context`)).body as { key: string }[]).map((v) => v.key)).toContain("opening-hours");
    expect(detail(await call(w, "DELETE", `cascade?scope=${ORG}&kind=context&key=nothing-here`))).toBe(`A context 'nothing-here' set at '${ORG}' was not found, or you cannot see it.`);
    expect(detail(await call(as("viewer"), "PUT", "cascade", { scope: ORG, kind: "context", key: "x", value: "y" }))).toBe(`This needs the builder role at '${ORG}'; you are a viewer there (set at ${ORG}).`);
  });

  it("republishes a crashed app on its newest version", async () => {
    const w = as("owner");
    const r = await call(w, "POST", `apps/${IDS.shiftRota}/republish`);
    expect((r.body as { published: boolean }).published).toBe(true);
    expect(w.apps.find((a) => a.id === IDS.shiftRota)?.health).toBe("healthy");
  });

  it("moves an employee under a manager, and refuses a reporting loop", async () => {
    const w = as("owner");
    const ruth = w.employees.find((e) => e.name === "Ruth");
    const pell = w.employees.find((e) => e.name === "Pell");
    const moved = await call(w, "POST", `employees/${ruth?.id ?? ""}/reassign`, { scope: `${ORG}/learning/tutor-match`, reportsTo: pell?.id });
    expect((moved.body as { reportsTo: { name: string } }).reportsTo.name).toBe("Pell");
    expect(detail(await call(w, "POST", `employees/${pell?.id ?? ""}/reassign`, { scope: `${ORG}/learning`, reportsTo: ruth?.id }))).toBe("That would make a reporting loop: the manager already reports, directly or not, to this employee.");
  });

  it("lets a person in two organisations read each", async () => {
    const w = buildWorld("two-organisations", "two-organisations").world;
    const quayside = (await call(w, "GET", "tree?organisation=quayside")).body as { organisation: { name: string; role: string } };
    expect(quayside.organisation).toMatchObject({ name: "Quayside Bakery", role: "admin" });
    expect(((await call(w, "GET", "me")).body as { memberships: unknown[] }).memberships).toHaveLength(2);
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

  it("with no AI model reachable, research stops at once, plainly, with nothing charged and the detail kept technical (D64)", () => {
    const w = as("owner");
    w.modelsOffline = true;
    expect(seek(w, "research:models-unreachable", () => undefined)).toBe(true);
    const r = w.runs.find((x) => x.run.ideaId === IDS.ideaTides);
    expect(r?.run.status).toBe("failed");
    expect(r?.run.summary).toBe(MODELS_UNREACHABLE);
    const finished = r?.events.find((e) => e.type === "run.finished");
    expect(finished?.payload).toMatchObject({ outcome: "failed", summary: MODELS_UNREACHABLE });
    expect(String(finished?.payload.detail)).toContain("503");
    expect(r?.events.some((e) => e.type === "subagent.started")).toBe(false);
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

describe("the workforce, credits and God mode as the academy shows them (S4)", () => {
  it("works out a hire's room from the tightest cap on its chain, on every read", async () => {
    const w = as("owner", "hire-pending");
    const lark = (await call(w, "GET", `hires/${w.hires.find((h) => h.name === "Lark")?.id}`)).body as { headroomCredits: number; withinBudget: boolean };
    // Technologies: a cap of 450 with 360.9 spent beneath it, tighter than the balance and overdraft.
    expect(lark.headroomCredits).toBe(89.1);
    expect(lark.withinBudget).toBe(false);
  });

  it("refuses to hire under a manager who has been let go", async () => {
    const w = as("owner", "s4-hire-manager-gone");
    const r = await call(w, "POST", `hires/${w.hires.find((h) => h.name === "Lark")?.id}/accept`, {});
    expect(r.status).toBe(400);
    expect(detail(r)).toBe("reportsTo names an employee of this organisation who is on the payroll.");
  });

  it("finishes a contractor: its lesson goes to its briefer, and the recurring role is hired in auto-mode", () => {
    const w = as("owner", "s4-contractor-finishes");
    seek(w, "s4:contractor-finished", () => undefined);
    expect(w.employees.find((e) => e.kind === "contractor" && e.role === "Data contractor")?.status).toBe("released");
    expect(w.memory.some((m) => m.title === "Empty courts cluster on Tuesday and Wednesday" && m.sourceRunId)).toBe(true);
    const promotion = w.hires.find((h) => h.trigger === "promotion");
    expect(promotion?.reason).toMatch(/^7 Data contractor contractors were briefed here in the last 30 days, costing 56.7 credits\./);
    expect(promotion?.status).toBe("accepted");
  });

  it("keeps a removed memory entry in its employee's change log, newest first", async () => {
    const w = as("owner", "s4-memory-to-tidy");
    const kasper = w.employees.find((e) => e.name === "Kasper");
    const changes = (await call(w, "GET", `employees/${kasper?.id}/memory/changes`)).body as { action: string; at: string }[];
    expect(changes.some((c) => c.action === "removed")).toBe(true);
    expect([...changes].sort((a, b) => b.at.localeCompare(a.at))).toEqual(changes);
  });

  it("logs a new entry when an operator comes back after the visit window, and none within it", async () => {
    const w = as("operator", "god-mode");
    const entries = () => w.operatorLog.filter((x) => x.organisation === ORG && x.action === "organisation.entered").length;
    const before = entries();
    await call(w, "GET", `hires?scope=${ORG}`);
    expect(entries()).toBe(before + 1);
    await call(w, "GET", `hires?scope=${ORG}`);
    expect(entries()).toBe(before + 1);
    w.operatorSeen = { [`${PEOPLE.operator.id}:${ORG}`]: new Date(Date.now() - 11 * 60_000).toISOString() };
    for (const x of w.operatorLog) if (x.action === "organisation.entered") x.at = new Date(Date.now() - 11 * 60_000).toISOString();
    await call(w, "GET", `hires?scope=${ORG}`);
    expect(entries()).toBe(before + 2);
  });

  it("writes a price change to every organisation's log and reprices every app", async () => {
    const w = as("operator", "god-mode");
    const app = async () => ((await call(w, "GET", `apps/${IDS.tableBookings}`)).body as { runningCost: { prices: string; alwaysOn: { credits: number } } }).runningCost;
    const before = await app();
    expect(before.prices).toMatch(/^Today's prices: 0\.2 credits an awake hour/);
    const pricing = { ...w.pricing.pricing, hosting: { ...w.pricing.pricing.hosting, usdPerAwakeHour: 0.004 } };
    expect((await call(w, "PUT", "operator/pricing", pricing as unknown as Record<string, unknown>)).status).toBe(200);
    expect(w.organisations.every((o) => w.operatorLog.some((x) => x.organisation === o.slug && x.action === "pricing.changed"))).toBe(true);
    const after = await app();
    expect(after.prices).toMatch(/^Today's prices: 0\.4 credits an awake hour/);
    expect(after.alwaysOn.credits).toBeGreaterThan(before.alwaysOn.credits);
  });

  it("closes a request answered by a top-up with its note, on the record", async () => {
    const w = as("operator", "god-mode");
    const request = w.topUpRequests.find((r) => r.status === "open");
    await call(w, "POST", "credits/top-ups", { organisation: request?.organisation, credits: 1500, note: "Answering the request", idempotencyKey: "k-s4", requestId: request?.id });
    expect(request?.closeNote).toBe("Answering the request");
    expect(w.operatorLog.some((x) => x.action === "topup_request.fulfilled" && x.organisation === request?.organisation)).toBe(true);
  });

  it("refuses one of Endgame's own names as the control plane does", async () => {
    const r = await call(as("operator", "god-mode"), "POST", "organisations", { name: "Endgame", slug: "endgame", ownerEmail: "ana@harbour.example", description: "Tide tables for a harbour." });
    expect(r.status).toBe(409);
    expect(detail(r)).toBe("'endgame' cannot name an organisation: it is one of Endgame's own names.");
  });
});

describe("answered notices (D40, NotificationService.AnsweredAsync)", () => {
  type Feed = { unread: number; notifications: { id: string; kind: string; title: string; read: boolean; resolved: boolean; subject: { id: string } | null }[] };
  const feed = async (w: World) => (await call(w, "GET", `notifications?organisation=${ORG}`)).body as Feed;

  it("a decided verdict and an accepted hire come back resolved, read, in the past tense, and not counted", async () => {
    const w = as("owner");
    const before = await feed(w);
    const verdict = before.notifications.find((n) => n.subject?.id === IDS.ideaAllergen);
    expect(verdict?.resolved).toBe(false);
    expect(verdict?.title.startsWith("A verdict is waiting")).toBe(true);
    await call(w, "POST", `ideas/${IDS.ideaAllergen}/decision`, { choice: "build" });
    await call(w, "POST", `hires/${w.hires.find((h) => h.name === "Lark")?.id}/accept`, {});
    const after = await feed(w);
    const decided = after.notifications.find((n) => n.subject?.id === IDS.ideaAllergen);
    expect(decided).toMatchObject({ resolved: true, read: true });
    expect(decided?.title).toMatch(/^You chose to build: Allergen labels/);
    const hired = after.notifications.find((n) => n.kind === "hire");
    expect(hired).toMatchObject({ resolved: true, read: true, title: "Lark was hired as Data analyst" });
    expect(after.unread).toBe(before.unread - 2);
  });

  it("an approval answered long ago reads as answered", async () => {
    const old = (await feed(as("owner"))).notifications.find((n) => n.kind === "approval");
    expect(old).toMatchObject({ resolved: true, read: true, title: "You approved “Agree the plan for Shift Rota?”" });
  });
});

describe("removing a grant (D8, AccountService.RevokeAsync)", () => {
  it("answers { revoked, invitationCancelled }, and a last grant of someone who never signed in cancels their code", async () => {
    const w = as("owner");
    const invited = w.users.find((u) => u.id === PEOPLE.invited.id);
    const grant = w.memberships.find((m) => m.userId === PEOPLE.invited.id);
    expect(invited?.invitation).not.toBeNull();
    const r = await call(w, "DELETE", `members/${grant?.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ revoked: grant?.id, invitationCancelled: !w.memberships.some((m) => m.userId === PEOPLE.invited.id) });
    expect((r.body as { invitationCancelled: boolean }).invitationCancelled).toBe(true);
    expect(invited?.invitation).toBeNull();
  });

  it("does not cancel anything for someone who has signed in", async () => {
    const w = as("owner");
    const grant = w.memberships.find((m) => m.role !== "owner" && (w.users.find((u) => u.id === m.userId)?.passkeys ?? 0) > 0);
    const r = await call(w, "DELETE", `members/${grant?.id}`);
    expect(r.body).toMatchObject({ revoked: grant?.id, invitationCancelled: false });
  });
});
