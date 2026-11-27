import { describe, expect, it } from "vitest";
import { buildWorld, resolveRoute } from "./scenarios";
import "./scenarios.talk";
import { IDS, ORG } from "./default";
import { dispatch, outage } from "../server/index";
import { advance, seek } from "../server/engine";
import { answerApproval } from "../server/routes/work";
import { runView } from "../server/tryAgain";
import { LONG_RUN_ID } from "./longRun";
import "./scenarios.s3";
import type { DemoRun, World } from "../server/world";

/** Each conversation state the review could not reach (ARCH-009 "talk-" scenarios), reached from the world's own logs. */

const built = (name: string) => buildWorld(name, "owner");
const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
type History = { messages: { runId: string; from: string; text: string; by: string | null; code: string | null }[]; turns: { runId: string; status: string; started: { runId: string; kind: string; title: string }[]; replied: boolean; endedWithoutReply: boolean; interruption: string | null }[] };
const history = async (w: World, scope = ORG, employeeId?: string) => (await call(w, "GET", `conversations?scope=${scope}${employeeId ? `&employeeId=${employeeId}` : ""}`)).body as History;
const replies = (h: History) => h.messages.filter((m) => m.from === "assistant").map((m) => m.text);
/** The runs the conversation at a scope started, in order. */
const cards = (w: World, h: History) => h.turns.flatMap((t) => t.started).map((s) => w.runs.find((r) => r.run.id === s.runId) as DemoRun);
const events = (r: DemoRun, type: string) => r.events.filter((e) => e.type === type);

describe("talk-rich-replies", () => {
  it("answers in rich Markdown: a table, a heading and lists, fenced code with its language, bold and chips with real ids", async () => {
    const w = built("talk-rich-replies").world;
    const all = replies(await history(w)).join("\n\n");
    expect(all).toMatch(/\| App \| Work \| Keeping it running \| This month \|\n\| --- \|/);
    expect(all).toContain(`[Court booking](/apps/${IDS.tableBookings})`);
    expect(all).toMatch(/^## Northwind at a glance$/m);
    expect(all).toMatch(/^### Apps\n- \[/m);
    expect(all).toMatch(/```yaml\nname: Court booking\n/);
    expect(all).toMatch(/\*\*[^*]+\*\*/);
    const kasper = w.employees.find((e) => e.name === "Kasper");
    expect(all).toContain(`[Kasper](/employees/${kasper?.id})`);
    expect(all).toMatch(/\[the idea\]\(\/ideas\/[0-9a-f-]{36}\)/);
    expect(all).toMatch(/\[the build\]\(\/runs\/[0-9a-f-]{36}\)/);
    // A long path in inline code, so the bubble is shown to wrap it.
    expect(all).toMatch(/`[^`\s]{120,}`/);
  });

  it("are given in the free-play demo too, not only in the scenario", async () => {
    const w = built("default").world;
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Compare what each app cost this month." });
    seek(w, "conversation:replied", () => undefined);
    const reply = replies(await history(w)).filter((t) => w.runs.find((r) => r.run.id === (sent.body as { id: string }).id)?.events.some((e) => e.payload.text === t));
    expect(reply.join("\n")).toMatch(/\| --- \| ---: \|/);
  });

  it("has an app and an employee variant, opening where each is seen", async () => {
    const app = built("talk-rich-replies-app");
    expect(resolveRoute("/apps/{app}", app.scenarios)).toBe(`/apps/${IDS.tableBookings}`);
    expect(replies(await history(app.world, `${ORG}/technologies/court-booking/web`)).join("\n")).toMatch(/```yaml/);
    const emp = built("talk-rich-replies-employee");
    const kasper = emp.world.employees.find((e) => e.name === "Kasper");
    expect(resolveRoute("/employees/{employee}", emp.scenarios)).toBe(`/employees/${kasper?.id}`);
    const h = await history(emp.world, kasper?.scope, kasper?.id);
    expect(h.messages.filter((m) => m.from === "assistant").every((m) => m.by === "Kasper")).toBe(true);
    expect(replies(h).join("\n")).toMatch(/\[the (build|change)\]\(\/runs\//);
  });
});

describe("the conversation's approvals, in the owner's words (C-1)", () => {
  it("quote the owner's words, name the app by its name, say what approving does, and are answered by name", async () => {
    const w = built("talk-plan-approval").world;
    const turn = w.runs.find((r) => r.run.kind === "conversation" && r.run.title.startsWith("Please change"));
    const asked = events(turn as DemoRun, "approval.requested")[0]?.payload;
    expect(asked?.title).toBe("Change Court booking: “Please change the Court booking app: let members join a waitlist when a court is full.”");
    expect(asked?.detail).toBe("Approving starts this change to Court booking: its estimate is shown first, then a plan, the change built and checked in the running app, and a new version. If you decline, nothing changes.");
    expect(String(asked?.technical)).toMatch(/^change_app: northwind\/technologies\/court-booking\/web: change the Court booking app/);
    expect(events(turn as DemoRun, "approval.answered")[0]?.payload).toMatchObject({ answer: "approved", byName: "Mara Ellison", comment: null });
  });

  it("cut the owner's long words at a word, with “…” and no question mark", async () => {
    const w = built("quiet").world;
    const long = `Start researching ${"a booking app for the dive centres along the coast that run trips every weekend ".repeat(3)}`;
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: long });
    seek(w, "conversation:approval", () => undefined);
    const a = w.approvals.find((x) => x.runId === (sent.body as { id: string }).id);
    expect(a?.title).toMatch(/^Start researching an idea: “Start researching a booking .* the…”$|^Start researching an idea: “.*[a-z]…”$/);
    expect((a?.title.length ?? 0) - "Start researching an idea: ".length).toBeLessThanOrEqual(142);
    expect(a?.title.endsWith("?")).toBe(false);
  });

  it("keep a declined approval in the turn's log, with who answered and their note, and say plainly it was not done", async () => {
    const w = built("talk-long-history").world;
    const turn = w.runs.find((r) => r.run.kind === "conversation" && r.run.title === "Keep apps always on.") as DemoRun;
    expect(events(turn, "approval.requested")).toHaveLength(1);
    expect(events(turn, "approval.answered")[0]?.payload).toMatchObject({ answer: "rejected", comment: "Not while Learning is over budget.", byName: "Mara Ellison" });
    // The sentence after the answer is in the same turn, after the approval: the console splits the bubble there.
    const after = turn.events.findIndex((e) => e.type === "approval.answered");
    expect(turn.events.slice(after).some((e) => e.type === "message" && e.payload.text === "Left as it was.")).toBe(true);
  });
});

describe("#40: trying the long failed build again from the conversation", () => {
  it("starts the build again and names it in the conversation, so its card appears", async () => {
    const w = built("run-long").world;
    expect(runView(w, w.runs.find((r) => r.run.id === LONG_RUN_ID) as DemoRun).canTryAgain).toBe(true);
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Try the failed build again." });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    const a = w.approvals.find((x) => x.runId === runId && x.answer === null);
    expect(a?.title).toBe("Try the build again: “A sign-up sheet for the rowing club's Saturday outings: members sign in, see…”");
    expect((await call(w, "POST", `runs/${runId}/approvals/${a?.id}`, { decision: "approve" })).status).toBe(204);
    seek(w, "conversation:replied", () => undefined);
    const turn = (await history(w)).turns.find((t) => t.runId === runId);
    expect(turn?.started).toEqual([{ runId: expect.any(String), kind: "retry", title: expect.stringMatching(/^Build: A sign-up sheet/) }]);
    const again = w.runs.find((r) => r.run.id === turn?.started[0]?.runId) as DemoRun;
    expect(again.run.kind).toBe("build");
    // It carries on from the earlier attempt: its plan as agreed, the part that passed kept.
    advance(w, again, 5000);
    expect(again.events.find((e) => e.type === "message" && e.payload.kind === "plan.carried")?.payload.items).toEqual(["outings-list"]);
    expect(replies(await history(w)).some((t) => t.startsWith("It has started again"))).toBe(true);
  });

  it("says it could not start work the control plane refuses, instead of saying it started", async () => {
    const w = built("run-long").world;
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Try the failed build again." });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    // Meanwhile someone else started it again from the run page.
    await call(w, "POST", `runs/${LONG_RUN_ID}/retry`, {});
    const a = w.approvals.find((x) => x.runId === runId && x.answer === null);
    expect((await call(w, "POST", `runs/${runId}/approvals/${a?.id}`, { decision: "approve" })).status).toBe(204);
    seek(w, "conversation:replied", () => undefined);
    const said = replies(await history(w));
    expect(said.some((t) => t.startsWith("It has started again"))).toBe(false);
    expect(said.some((t) => t.startsWith("I could not start it again:"))).toBe(true);
    expect((await history(w)).turns.find((t) => t.runId === runId)?.started).toEqual([]);
  });
});

describe("work cards in every state", () => {
  it("talk-web-search-approval: the research it started waits on a web search, asked inside its card", async () => {
    const w = built("talk-web-search-approval").world;
    const [research] = cards(w, await history(w));
    expect(research?.run.kind).toBe("research");
    expect(research?.run.status).toBe("waiting");
    const open = w.approvals.find((a) => a.runId === research?.run.id && a.answer === null);
    expect(open?.title).toBe("Let the agent take this step?");
    expect(open?.technical).toMatch(/^web_search: /);
  });

  it("talk-plan-approval: the change stops at its plan, the plan's approval in its card; the app and employee variants too", async () => {
    for (const name of ["talk-plan-approval", "talk-plan-approval-app", "talk-plan-approval-employee"]) {
      const b = built(name);
      const w = b.world;
      const kasper = w.employees.find((e) => e.name === "Kasper");
      const at = name.endsWith("-app") ? history(w, `${ORG}/technologies/court-booking/web`) : name.endsWith("-employee") ? history(w, kasper?.scope, kasper?.id) : history(w);
      const [change] = cards(w, await at);
      expect(change?.run.status, name).toBe("waiting");
      expect(w.approvals.find((a) => a.runId === change?.run.id && a.answer === null)?.title, name).toBe("Accept this plan for the change?");
      expect(events(change as DemoRun, "plan.proposed"), name).toHaveLength(1);
    }
  });

  it("talk-card-failed and talk-card-cancelled: a change that failed can be tried again; one that was cancelled says so", async () => {
    const failed = built("talk-card-failed").world;
    const [f] = cards(failed, await history(failed));
    expect(f?.run.status).toBe("failed");
    expect(runView(failed, f as DemoRun).canTryAgain).toBe(true);
    expect(events(f as DemoRun, "evaluation.failed").at(-1)?.payload).toMatchObject({ final: true });
    const cancelled = built("talk-card-cancelled").world;
    const [c] = cards(cancelled, await history(cancelled));
    expect(c?.run.status).toBe("cancelled");
    expect(events(c as DemoRun, "evaluation.passed").length).toBeGreaterThan(0);
    expect(events(c as DemoRun, "run.finished").at(-1)?.payload).toMatchObject({ outcome: "cancelled", by: "Mara Ellison" });
  });

  it("talk-part-states: a part that did not pass, and a part whose check needs a look", async () => {
    const w = built("talk-part-states").world;
    const [didNotPass, needsLook] = cards(w, await history(w));
    expect(events(didNotPass as DemoRun, "evaluation.failed").at(-1)?.payload).toMatchObject({ final: true });
    expect(events(didNotPass as DemoRun, "evaluation.failed").at(-1)?.payload.needsLook).toBeUndefined();
    expect(events(needsLook as DemoRun, "evaluation.failed").at(-1)?.payload).toMatchObject({ item: "c1", final: true, needsLook: true, summary: expect.stringMatching(/^Not sent back for repair: the check needs a look\./) });
    expect(needsLook?.run.status).toBe("failed");
  });

  it("talk-over-estimate: re-estimated after planning from about 10 to about 15, with why, then over it", async () => {
    const w = built("talk-over-estimate").world;
    const [change] = cards(w, await history(w));
    const made = events(change as DemoRun, "estimate.made");
    expect(made[0]?.payload.credits).toBe(10);
    expect(made.find((e) => e.payload.stage === "plan")?.payload).toMatchObject({ credits: 15, previousCredits: 10, reason: "Re-estimated after planning: 2 parts." });
    expect(change?.run.status).toBe("finished");
    expect(change?.run.spentCredits).toBeGreaterThan(15);
  });

  it("talk-many-parts: a change planned in six parts, under way", async () => {
    const w = built("talk-many-parts").world;
    const [change] = cards(w, await history(w));
    expect((events(change as DemoRun, "plan.proposed")[0]?.payload.items as unknown[]).length).toBe(6);
    expect(change?.playback).not.toBeNull();
  });

  it("talk-retry-carried: the build tried again keeps the parts built before, and finishes", async () => {
    const w = built("talk-retry-carried").world;
    const [again] = cards(w, await history(w));
    expect(again?.run.kind).toBe("build");
    const carried = again?.events.find((e) => e.type === "message" && e.payload.kind === "plan.carried")?.payload.items as string[];
    expect(carried.length).toBeGreaterThan(0);
    expect(again?.run.status).toBe("finished");
  });

  it("every task a part's work is claimed by names a holder and says what kind (C-3)", async () => {
    const w = built("talk-over-estimate").world;
    const [change] = cards(w, await history(w));
    const claims = events(change as DemoRun, "task.claimed");
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(c.payload).toMatchObject({ holder: expect.any(String), holderKind: "employee" });
    const long = built("run-long").world.runs.find((r) => r.run.id === LONG_RUN_ID) as DemoRun;
    expect(events(long, "task.claimed")[0]?.payload).toMatchObject({ holder: "Software engineer", holderKind: "role" });
  });
});

describe("the thread", () => {
  it("talk-not-sent: the first send fails, the next goes", () => {
    const w = built("talk-not-sent").world;
    expect(outage(w, "POST", "conversations")).toMatchObject({ status: 503 });
    expect(outage(w, "POST", "conversations")).toBeNull();
  });

  it("talk-budget-stopped: the conversation's own notice, kept in its history", async () => {
    const h = await history(built("talk-budget-stopped").world);
    const notice = h.messages.find((m) => m.code === "budget_exhausted");
    expect(notice?.from).toBe("runner");
    expect(h.turns.at(-1)).toMatchObject({ replied: false, endedWithoutReply: false, interruption: null });
  });

  it("talk-long-history: 30-odd turns over several days, two finished cards, a no and a yes, a table", async () => {
    const w = built("talk-long-history").world;
    const h = await history(w);
    expect(h.turns.length).toBeGreaterThanOrEqual(30);
    const done = cards(w, h);
    expect(done.map((r) => r.run.status)).toEqual(["finished", "finished"]);
    const answers = w.approvals.filter((a) => h.turns.some((t) => t.runId === a.runId)).map((a) => a.answer);
    expect(answers).toEqual(expect.arrayContaining(["approved", "rejected"]));
    expect(replies(h).some((t) => t.includes("| --- |"))).toBe(true);
    const days = new Set(h.messages.map((m) => m.text && w.runs.find((r) => r.run.id === m.runId)?.run.createdAt.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(4);
    const times = h.turns.map((t) => Date.parse(w.runs.find((r) => r.run.id === t.runId)?.run.createdAt ?? ""));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("talk-reply-interrupted: the last turn ended with no reply, and the history says so", async () => {
    const h = await history(built("talk-reply-interrupted").world);
    expect(h.turns.at(-1)).toMatchObject({ status: "failed", replied: false, endedWithoutReply: true, interruption: "The reply could not be written. Nothing more was charged; ask again." });
    expect(h.turns.at(0)).toMatchObject({ replied: true, endedWithoutReply: false, interruption: null });
  });

  it("talk-midreply: a long reply still being written, picked up from where it is after a reload", async () => {
    const w = built("talk-midreply").world;
    const h = await history(w);
    const last = h.turns.at(-1);
    expect(last).toMatchObject({ status: "running", replied: false, endedWithoutReply: false, interruption: null });
    const r = w.runs.find((x) => x.run.id === last?.runId) as DemoRun;
    // A reload keeps the world with its playback position; the clock plays the rest of the reply.
    const saved = JSON.parse(JSON.stringify(w)) as World;
    const again = saved.runs.find((x) => x.run.id === r.run.id) as DemoRun;
    for (let i = 0; i < 200 && again.playback; i += 1) advance(saved, again, 250);
    const said = again.events.filter((e) => e.type === "message" && e.payload.from === "assistant");
    expect(said.length).toBeGreaterThanOrEqual(5);
    expect(again.run.status).toBe("finished");
  });
});

describe("the approval and its answer stay in the conversation's own run (#33)", () => {
  it("approval.requested, then approval.answered with byName, answer and comment, then the next sentence", async () => {
    const w = built("quiet").world;
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: WAITLIST_TEXT });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    const a = w.approvals.find((x) => x.runId === runId && x.answer === null);
    answerApproval(w, a?.id ?? "", "approve", "Mara Ellison", "  Leagues keep their own rule. ");
    seek(w, "conversation:replied", () => undefined);
    const r = w.runs.find((x) => x.run.id === runId) as DemoRun;
    const types = r.events.map((e) => (e.type === "message" ? `message:${e.payload.kind ?? e.payload.from}` : e.type));
    const asked = types.indexOf("approval.requested");
    const answered = types.indexOf("approval.answered");
    expect(asked).toBeGreaterThan(-1);
    expect(answered).toBeGreaterThan(asked);
    expect(types.slice(answered)).toEqual(expect.arrayContaining(["message:work.started", "message:assistant", "run.finished"]));
    expect(r.events[answered]?.payload).toMatchObject({ answer: "approved", comment: "Leagues keep their own rule.", byName: "Mara Ellison", by: w.users.find((u) => u.displayName === "Mara Ellison")?.id });
  });
});

const WAITLIST_TEXT = "Please change the Court booking app: let members join a waitlist when a court is full.";
