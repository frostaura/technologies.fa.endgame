import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { seek } from "./engine";
import { buildWorld } from "../world/scenarios";
import "../world/scenarios.s3";
import { IDS, ORG } from "../world/default";
import { appAt, node, type World } from "./world";

/**
 * Round three as the fake control plane mirrors it: approvals expire with their run (R3-2), auto-mode is named as the
 * decider, refused budgets and checkpoints name the level, and a check is the QA engineer's own task with its own line.
 */

const as = (scenario = "default"): World => buildWorld(scenario, "owner").world;
const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
type Feed = { unread: number; notifications: { kind: string; title: string; read: boolean; resolved: boolean }[] };
const feed = async (w: World) => (await call(w, "GET", `notifications?organisation=${ORG}`)).body as Feed;
const needs = async (w: World) => ((await call(w, "GET", "tree")).body as { needsYou: { kind: string; approvalId?: string }[] }).needsYou;

describe("an approval its run ended before anyone answered (R3-2)", () => {
  it("waits as a notice and on home, then closes with the run: expired, off the strip, and a late answer is refused plainly", async () => {
    const w = as("build-waiting-on-plan");
    seek(w, "build:waiting-on-plan", () => undefined);
    const approval = w.approvals.find((a) => a.runId === IDS.runBuildReadingList && a.answer === null);
    expect(approval).toBeTruthy();
    const asked = `Approval needed: ${approval?.title}`;
    expect((await feed(w)).notifications.find((n) => n.title === asked)).toMatchObject({ kind: "approval", resolved: false, read: false });
    expect((await needs(w)).some((n) => n.approvalId === approval?.id)).toBe(true);

    expect((await call(w, "POST", `runs/${IDS.runBuildReadingList}/cancel`)).status).toBe(200);

    expect(approval?.answer).toBe("expired");
    expect((await needs(w)).some((n) => n.approvalId === approval?.id)).toBe(false);
    const closed = (await feed(w)).notifications.find((n) => n.kind === "approval" && n.title.startsWith("No longer waiting:"));
    expect(closed).toMatchObject({ title: `No longer waiting: “${approval?.title}” — the work ended before it was answered`, resolved: true, read: true });
    const late = await call(w, "POST", `runs/${IDS.runBuildReadingList}/approvals/${approval?.id}`, { decision: "approve" });
    expect(late.status).toBe(409);
    expect((late.body as { detail: string }).detail).toBe("The work ended before this was answered, so there is nothing left to approve.");
  });

  it("an answered one says who answered it", async () => {
    const w = as("build-waiting-on-plan");
    seek(w, "build:waiting-on-plan", () => undefined);
    const approval = w.approvals.find((a) => a.runId === IDS.runBuildReadingList && a.answer === null);
    await call(w, "POST", `runs/${IDS.runBuildReadingList}/approvals/${approval?.id}`, { decision: "approve" });
    expect((await feed(w)).notifications.find((n) => n.kind === "approval" && n.title.includes(approval?.title ?? "—"))).toMatchObject({ title: `You approved “${approval?.title}”`, resolved: true });
  });
});

describe("plain sentences name levels, and auto-mode is named (cad6b82)", () => {
  it("a verdict auto-mode built on reads “Auto-mode chose to build”", async () => {
    const w = as();
    seek(w, "research:decided", () => undefined);
    const idea = w.ideas.find((i) => i.decision?.via === "auto-mode" && i.runId === IDS.runResearchTides);
    expect(idea).toBeTruthy();
    expect((await feed(w)).notifications.some((n) => n.title === `Auto-mode chose to build: ${idea?.title}`)).toBe(true);
  });

  it("checkpoints are said by the level's name, never its path", () => {
    const w = as("s3-checkpoints");
    seek(w, "research:decided", () => undefined);
    const r = w.runs.find((x) => x.run.id === IDS.runResearchTides);
    const said = r?.events.find((e) => e.payload.title === "Waiting for your decision")?.payload.text;
    expect(said).toMatch(/^The verdict waits for you: build it, change it or drop it\. Checkpoints are on for [A-Z][\w ]+, so the owner decides on the verdict\.$/);
    expect(said).not.toContain("/");
  });

  it("a spent budget is said by the level's name; what a client is told to do is kept apart in forAgent", async () => {
    const w = as();
    const app = w.apps.find((a) => a.id === IDS.tableBookings);
    const project = app?.path.split("/").slice(0, -1).join("/") ?? "";
    w.budgets.push({ path: project, cap: 0 } as never);
    const r = await call(w, "POST", `apps/${IDS.tableBookings}/ask`, { question: "How many bookings were made today?" });
    expect(r.status).toBe(402);
    const body = r.body as { detail: string; forAgent: string };
    expect(body.detail).toBe(`The monthly budget for ${node(w, project)?.name} has 0 credits left; this call needs up to 0.42. Work stops until the budget is raised or a new month begins.`);
    expect(body.forAgent).toBe("This is terminal for the run: do not retry it.");
    expect(appAt(w, app?.path ?? "")).toBeTruthy();
  });
});

describe("a check is the QA engineer's own task (a561732)", () => {
  it("each round's check finishes with its own line; the part's task says what was built", () => {
    const w = as("build-running");
    seek(w, "build:finished", () => undefined);
    const r = w.runs.find((x) => x.run.id === IDS.runBuildReadingList);
    const done = r?.events.filter((e) => e.type === "task.done").map((e) => String(e.payload.summary)) ?? [];
    expect(done).toContain("The check of “Keep the club's books: add one, read the list newest first, and change a book's status — signed-in members only” is finished: it works.");
    expect(done.some((d) => /^The check of “The screens: .*” is finished: it goes back for repair, at no charge\.$/.test(d))).toBe(true);
    expect(done.some((d) => /^The check of “The screens: .*” after repair 1 is finished: it works\.$/.test(d))).toBe(true);
    expect(done.filter((d) => d.startsWith("Built and handed over: "))).toHaveLength(3);
    expect(done.some((d) => d.startsWith("Checked and working"))).toBe(false);
    const sentBack = r?.events.find((e) => e.type === "evaluation.failed")?.payload as { failing: string[]; requirements: { id: string; met: boolean; evidence: string }[] };
    expect(sentBack.failing).toEqual(["R5:not-met"]);
    expect(sentBack.requirements.find((q) => q.id === "R5")).toMatchObject({ met: false, evidence: expect.stringContaining("covered by the fixed footer") });
    const repaired = r?.events.filter((e) => e.type === "evaluation.passed").at(1)?.payload as { requirements: { id: string; tests?: string[] }[] };
    expect(repaired.requirements.find((q) => q.id === "R5")?.tests?.[0]).toMatch(/ > it works on a phone$/);
  });
});
