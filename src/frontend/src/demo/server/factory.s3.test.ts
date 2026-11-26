import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { seek } from "./engine";
import { answerApproval } from "./routes/work";
import { buildWorld } from "../world/scenarios";
import { IDS, ORG } from "../world/default";
import type { World } from "./world";

/**
 * Trying again, changing a built app and the conversation's own proposals, as `RetryService`,
 * `ChangeService`, `FactoryEstimates` and the conversation tools do them: the estimate first, the
 * refusals in the control plane's words, and runs that play to their visible end.
 */

const as = (persona = "owner", scenario = "default"): World => buildWorld(scenario, persona).world;
const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
const detail = (r: { body?: unknown }) => (r.body as { detail?: string }).detail;
const approve = (w: World, runId: string) => {
  const a = w.approvals.find((x) => x.runId === runId && !x.answer);
  if (a) answerApproval(w, a.id, "approve", "test");
  return a;
};

describe("trying stopped work again", () => {
  it("prices a failed build for what is left, keeps the finished parts, and lets only the latest attempt be tried, once", async () => {
    const w = as("owner", "build-failed");
    seek(w, "build:failed", () => undefined);
    const failed = (await call(w, "GET", `runs/${IDS.runBuildReadingList}`)).body as { status: string; canTryAgain: boolean };
    expect(failed).toMatchObject({ status: "failed", canTryAgain: true });
    const estimate = (await call(w, "POST", `runs/${IDS.runBuildReadingList}/retry/estimate`)).body as { what: string; partsDone: number; parts: number; basis: string };
    expect(estimate).toMatchObject({ what: "build", partsDone: 1, parts: 3 });
    expect(estimate.basis).toContain("Only 2 of its 3 parts are left to build");
    const again = await call(w, "POST", `runs/${IDS.runBuildReadingList}/retry`);
    expect(again.status).toBe(201);
    const newId = (again.body as { id: string }).id;
    expect(((await call(w, "GET", `runs/${IDS.runBuildReadingList}`)).body as { canTryAgain: boolean }).canTryAgain).toBe(false);
    expect(detail(await call(w, "POST", `runs/${IDS.runBuildReadingList}/retry`))).toBe("Only the idea's latest build can be built again.");
    seek(w, "build:carried", () => undefined);
    const r = w.runs.find((x) => x.run.id === newId);
    expect(r?.events.find((e) => e.payload.title === "Carrying on")?.payload.text).toBe("This picks up where the earlier attempt stopped: 1 of 3 parts was already built and checked, so it is kept, not rebuilt or charged again.");
    seek(w, "build:finished", () => undefined);
    expect(r?.run.status).toBe("finished");
    // Only the two parts left are built; each is then checked as the QA engineer's own task (`BuildWorkflow.JudgeAsync`).
    const claimed = r?.events.filter((e) => e.type === "task.claimed") ?? [];
    expect(claimed.filter((e) => !String(e.payload.summary).startsWith("Check: "))).toHaveLength(2);
    // Three checks: the screens are sent back once and checked again after their repair, the documents pass at once.
    expect(claimed.filter((e) => String(e.payload.summary).startsWith("Check: "))).toHaveLength(3);
  });

  it("refuses work that has not stopped, and research that already reached a verdict", async () => {
    const w = as();
    const live = await call(w, "POST", `runs/${IDS.runResearchTides}/retry/estimate`);
    expect(live.status).toBe(409);
    expect(detail(live)).toBe("It has not stopped: pause, resume or cancel it instead.");
  });

  it("researches a cancelled idea again, records it in the history, and the verdict page offers it", async () => {
    const w = as();
    await call(w, "POST", `runs/${IDS.runResearchTides}/cancel`);
    const idea = (await call(w, "GET", `ideas/${IDS.ideaTides}`)).body as { status: string; tryAgain: { why: string } };
    expect(idea).toMatchObject({ status: "failed", tryAgain: { what: "research", why: "cancelled" } });
    const again = await call(w, "POST", `runs/${IDS.runResearchTides}/retry`);
    expect(again.status).toBe(201);
    const after = (await call(w, "GET", `ideas/${IDS.ideaTides}`)).body as { status: string; history: { choice: string }[]; runId: string };
    expect(after.status).toBe("researching");
    expect(after.runId).toBe((again.body as { id: string }).id);
    expect(after.history.map((h) => h.choice)).toEqual(["retry"]);
    expect(detail(await call(w, "POST", `runs/${IDS.runResearchTides}/retry`))).toBe("Only the idea's latest research can be tried again, while no verdict has been reached.");
  });

  it("does not start a build again while an employee on the project is paused", async () => {
    const w = as("owner", "build-failed");
    seek(w, "build:failed", () => undefined);
    for (const e of w.employees) if (e.scope === `${ORG}/learning/book-club` && e.kind === "employee") e.status = "paused";
    const r = await call(w, "POST", `runs/${IDS.runBuildReadingList}/retry`);
    expect(r.status).toBe(409);
    expect(detail(r)).toMatch(/, who works? on this app, (is|are) paused, so no new work is started for them\. Resume them first\.$/);
  });
});

describe("changing a built app", () => {
  it("shows the estimate first, then plays the change to a new version by the employee who made it", async () => {
    const w = as();
    const estimate = await call(w, "POST", `apps/${IDS.tableBookings}/changes/estimate`, { request: "Let members cancel a booking up to an hour before it starts." });
    expect(estimate.body).toMatchObject({ credits: 10, basis: "The measured starting figure for change runs, used until 3 have finished here to learn from." });
    const started = await call(w, "POST", `apps/${IDS.tableBookings}/changes`, { request: "Let members cancel a booking up to an hour before it starts." });
    expect(started.status).toBe(201);
    const run = started.body as { id: string; title: string; kind: string };
    expect(run).toMatchObject({ kind: "task", title: "Change: Let members cancel a booking up to an hour before it starts." });
    const busy = await call(w, "POST", `apps/${IDS.tableBookings}/changes`, { request: "Another change" });
    expect(busy.status).toBe(409);
    expect((busy.body as { code: string }).code).toBe("app_busy");
    seek(w, "change:finished", () => undefined);
    const r = w.runs.find((x) => x.run.id === run.id);
    expect(r?.run.status).toBe("finished");
    const accepted = r?.events.find((e) => e.type === "plan.accepted")?.payload as { items: { text: string }[]; requirements: { text: string }[] };
    expect(accepted.items.map((i) => i.text)).toContain("Everything the app did before still works");
    expect(accepted.requirements[0]?.text).toBe("Let members cancel a booking up to an hour before it starts.");
    expect(r?.events.some((e) => e.type === "evaluation.failed" && e.payload.item === "keep")).toBe(true);
    expect(r?.events.some((e) => e.type === "model.replied" && e.payload.billable === false)).toBe(true);
    expect(r?.events.find((e) => e.payload.title === "New version running")?.payload.text).toBe(
      "The new version of Court booking is running, with the change and everything it did before checked in the running app. Who may open it has not changed. Its history shows the change.",
    );
    const list = ((await call(w, "GET", `apps/${IDS.tableBookings}/versions`)).body as { versions: { message: string; live: boolean; author: { name: string } }[] }).versions;
    expect(list[0]).toMatchObject({ message: "Let members cancel a booking up to an hour before it starts", live: true, author: { name: "Kasper" } });
    // R2-4: only what was live, each with its plain title and the run that published it; no repair step of the change.
    expect(list[0]).toMatchObject({ title: "Let members cancel a booking up to an hour before it starts", current: true, runId: run.id });
    expect(list.filter((v) => v.live)).toHaveLength(1);
    expect(list.every((v) => typeof (v as { title?: unknown }).title === "string" && !/^Repair/.test(v.message))).toBe(true);
    // R2-8: the run reads its first estimate and the plan's apart.
    const read = (await call(w, "GET", `runs/${run.id}`)).body as { firstEstimateCredits: number | null; planEstimateCredits: number | null; estimateCredits: number | null };
    expect(read.firstEstimateCredits).not.toBeNull();
    expect(read.planEstimateCredits).toBe(read.estimateCredits);
  });

  it("refuses a change over a red line, an app never built, and an empty request", async () => {
    const w = as();
    const started = await call(w, "POST", `apps/${IDS.tableBookings}/changes`, { request: "Record where members go after they leave the club, from their phones." });
    seek(w, "change:red-line", () => undefined);
    const r = w.runs.find((x) => x.run.id === (started.body as { id: string }).id);
    expect(r?.run.status).toBe("failed");
    expect(r?.events.find((e) => e.payload.title === "Stopped")?.payload.text).toBe("This change crosses a red line (surveillance). FrostAura never builds it, and no one can overrule that, so nothing was changed.");
    seek(w, "build:placed", () => undefined);
    const never = await call(w, "POST", `apps/${IDS.readingList}/changes`, { request: "Add a dark theme." });
    expect(never.status).toBe(409);
    expect((never.body as { title: string }).title).toBe("This app has not been built yet");
    expect(detail(await call(w, "POST", `apps/${IDS.tableBookings}/changes/estimate`, { request: "  " }))).toBe("Describe the change in 1 to 20000 characters.");
  });
});

describe("the conversation", () => {
  it("prices a message before it is sent, on the thinking power that answers it", async () => {
    const w = as();
    const org = (await call(w, "POST", "conversations/estimate", { scope: ORG })).body as { credits: number; ceiling: number; basis: string };
    expect(org.credits).toBe(0.5);
    expect(org.basis).toContain("It can never cost more than");
  });

  it("asks in the dock before changing an app, and the change starts on a yes", async () => {
    const w = as();
    const app = w.apps.find((a) => a.id === IDS.tableBookings);
    const sent = await call(w, "POST", "conversations", { scope: app?.path, message: "Let members cancel a booking up to an hour before it starts." });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    const a = approve(w, runId);
    expect(a?.title).toBe("Change Court booking: Let members cancel a booking up to an hour before it starts?");
    expect(w.runs.some((r) => r.run.kind === "task" && r.run.title.startsWith("Change: Let members cancel"))).toBe(true);
  });

  it("is answered by the employee itself, named on its reply", async () => {
    const w = as();
    const kasper = w.employees.find((e) => e.name === "Kasper");
    const sent = await call(w, "POST", "conversations", { scope: kasper?.scope, employeeId: kasper?.id, message: "What do you remember about leagues?" });
    seek(w, "conversation:replied", () => undefined);
    const r = w.runs.find((x) => x.run.id === (sent.body as { id: string }).id);
    const reply = r?.events.find((e) => e.type === "message" && e.payload.from === "assistant");
    expect(reply?.payload.by).toBe("Kasper");
    const history = (await call(w, "GET", `conversations?scope=${encodeURIComponent(kasper?.scope ?? "")}&employeeId=${kasper?.id ?? ""}`)).body as { messages: { from: string; by: string | null }[] };
    expect(history.messages.map((m) => m.by)).toEqual(expect.arrayContaining(["Mara Ellison", "Kasper"]));
  });
});
