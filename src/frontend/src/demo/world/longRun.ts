import type { Idea, RunEvent } from "@/store/types";
import type { DemoRun } from "../server/world";
import { uuidFor } from "../server/world";
import { clampWords } from "../server/http";

/**
 * A long build that did not succeed, shaped like the longest real run read from a development stack (about 2,000 events and
 * 400 actions): a request cut at the control plane's 120 characters, two hires, a planner, five parts of which the first
 * passed after a second checker's look and the second failed its check through three repair rounds, then the stop. Every
 * name in it is invented. The run page is designed against it (`run-long`), and `timeline.long.test.ts` measures it.
 */

export const LONG_RUN_ID = uuidFor("run:long:rowing-outings");
export const LONG_IDEA_ID = uuidFor("idea:long:rowing-outings");

const REQUEST =
  "A sign-up sheet for the rowing club's Saturday outings: members sign in, see the next outings, and claim a seat in a boat once, so the coach knows who is coming. Coming back later shows the member their own seat, and they can give it up. Any signed-in member can also add a new outing to the schedule.";

const PARTS = [
  { id: "outings-list", text: "Members can see a list of upcoming outings and read an outing's details, and any signed-in member can add an outing to the schedule.", detail: "api/Outings/Outing.cs, OutingsEndpoints.cs, web/src/outings/OutingsPage.tsx and tests.", check: "make test passes; the list shows soonest first." },
  { id: "claim-seat", text: "A signed-in member can claim a seat in a boat once, and the same member coming back later finds their own seat already there.", detail: "api/Seats/SeatClaim.cs with a unique index, web/src/outings/ClaimSeat.tsx and tests.", check: "make test passes; a second claim is refused." },
  { id: "give-up", text: "A member can give up their seat, and the seat is free for someone else straight away.", detail: "DELETE /api/outings/{id}/seat, web button and tests.", check: "make test passes." },
  { id: "coach-view", text: "The coach sees who is coming to each outing on one screen.", detail: "web/src/outings/CoachView.tsx and tests.", check: "make test passes." },
  { id: "docs", text: "The app's own documents say what it does and what it keeps.", detail: "docs/app.md, docs/decisions.md.", check: "The documents describe the app." },
];

const FILES = ["api/Outings/Outing.cs", "api/Outings/OutingsEndpoints.cs", "api/Seats/SeatClaim.cs", "web/src/outings/OutingsPage.tsx", "web/src/outings/ClaimSeat.tsx", "web/src/outings/outings.test.tsx", "api.Tests/SeatClaimTests.cs"];

export function longBuildRun(scope: string): DemoRun {
  const events: RunEvent[] = [];
  // Two days ago, a little after nine in the morning; each event a few seconds after the one before.
  const start = Date.now() - 2 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000;
  let clock = start;
  const push = (type: string, payload: Record<string, unknown>, gap = 3) => {
    clock += gap * 1000;
    events.push({ seq: events.length + 1, type, at: new Date(clock).toISOString(), payload });
  };
  let calls = 0;
  let billed = 0;
  let free = 0;
  const cycle = (agent: string, taskType: string, credits: number, tool: { name: string; args: Record<string, unknown>; result: string }, billable = true) => {
    calls += 1;
    const callId = uuidFor(`long:call:${calls}`);
    if (billable) billed += credits;
    else free += credits;
    push("model.requested", { model: "vendor/coder-small", callId, billable, taskType, reservedCredits: Math.round((credits * 12 + 1.5) * 1000) / 1000 });
    push("model.replied", { model: "vendor/coder-small", callId, billable, taskType, settledCredits: credits, tokens: { input: 4100 + (calls % 7) * 600, output: 60 + (calls % 9) * 25 }, finishReason: "tool_calls" }, 6);
    const toolCall = `call_${callId.slice(0, 8)}`;
    push("tool.requested", { name: tool.name, agent, callId: toolCall, arguments: JSON.stringify(tool.args), accounting: { settledCredits: credits } }, 1);
    push("tool.permitted", { name: tool.name, agent, callId: toolCall, rule: "stage:build" }, 0);
    push("tool.result", { name: tool.name, agent, callId: toolCall, content: tool.result, isError: false, verified: tool.name === "run" }, 2);
  };
  const work = (agent: string, taskType: string, rounds: number, credits: number, billable = true) => {
    for (let i = 0; i < rounds; i += 1) {
      const file = FILES[i % FILES.length] ?? "web/src/App.tsx";
      const k = i % 5;
      const tool =
        k === 0 || k === 1
          ? { name: "read_file", args: { path: file }, result: `    1\t// ${file}` }
          : k === 2 || k === 3
            ? { name: "edit_file", args: { path: file }, result: `Edited ${file}.` }
            : { name: "run", args: { command: "make test" }, result: `Vitest ${12 + i} passed · xUnit 9 passed\nexit code 0` };
      cycle(agent, taskType, Math.round(credits * (0.8 + (i % 4) * 0.1) * 1000) / 1000, tool, billable);
    }
  };
  const say = (from: string, title: string, text: string, milestone?: string) => push("message", { from, title, text, ...(milestone ? { milestone } : {}) });
  const reply = (agent: string, text: string) => push("message", { kind: "agent.reply", agent, final: true, text });
  const begin = (agent: string, task: string, taskType: string) => push("message", { kind: "agent.start", agent, task, taskType });

  push("message", { via: "console", from: "owner", text: REQUEST, change: null }, 0);
  push("estimate.made", { credits: 20, basis: "build" }, 1);
  push("run.started", { holder: "runner-1" }, 1);
  push("message", { kind: "workflow.step", agent: "workflow", step: "placement", data: { name: "Outings", appId: uuidFor("app:long:outings"), appPath: `${scope}/outings/web`, projectPath: `${scope}/outings`, newApp: true } });
  say("builder", "Placed", "Outings is a new app. It will live in Learning as a new project of its own, as the project Outings.", "placed");
  say("runner", "Theo is proposed", "The factory proposes hiring Theo as a software engineer, at up to 1500 credits a month. It waits for you; the work goes ahead meanwhile.");
  say("runner", "Nadia is proposed", "The factory proposes hiring Nadia as a QA engineer, at up to 600 credits a month. It waits for you; the work goes ahead meanwhile.");
  begin("planner", "Plan the app now, then reply with the JSON object.", "plan");
  work("planner", "plan", 30, 0.11);
  reply("planner", '{"headline":"Five parts, each built then checked in the running app."}');
  const items = PARTS.map((p) => ({ id: p.id, text: p.text, detail: p.detail, check: p.check, covers: [] }));
  const requirements = ["Members sign in", "See the next outings", "Claim a seat in a boat once", "Coming back later shows the member their own seat", "They can give it up"].map((text, i) => ({ id: `r${i + 1}`, text }));
  const summary = "Build a sign-up sheet for the rowing club's Saturday outings, replacing the Notes template. Members see upcoming outings on the home page, open one to claim a seat, and can give it up later. Any signed-in member can also add an outing to the schedule.";
  push("plan.proposed", { summary, items, requirements });
  push("approval.requested", { approvalId: "long-plan", title: "Accept this plan?", detail: summary, onDecline: "stops" });
  push("approval.answered", { approvalId: "long-plan", answer: "approved" }, 26);
  push("plan.accepted", { summary, items, requirements, by: "owner" });
  say("builder", "The plan", `${summary} 5 parts, each built, then checked in the running app against what you asked for. All 5 things the idea asks for are covered.`);
  push("estimate.made", { credits: 56, stage: "plan", reason: "Re-estimated after planning: 5 parts.", previousCredits: 20 });
  for (const p of PARTS) push("task.created", { taskId: `long-task-${p.id}`, title: p.text }, 0);

  const checkTask = (p: (typeof PARTS)[number], round: number, passed: boolean, last = false) => {
    const id = `long-check-${p.id}-${round}`;
    push("task.created", { taskId: id, title: `Check: ${p.text}` });
    push("task.claimed", { taskId: id, employeeId: null, holder: "QA engineer", holderKind: "role", summary: `Check: ${p.text}` });
    return () => {
      const of = `The check of “${p.text.replace(/\.$/, "")}”${round === 0 ? "" : ` after repair ${round}`} is finished`;
      push("task.done", { taskId: id, summary: passed ? `${of}: it works.` : last ? `${of}: it still does not work, and no repair follows.` : `${of}: it goes back for repair, at no charge.` });
    };
  };

  // Part 1: built, checked, then looked at again by a second checker (an id the factory writes with a suffix).
  const one = PARTS[0];
  const two = PARTS[1];
  if (!one || !two) throw new Error("The long run needs its parts.");
  begin(`builder-${one.id}-0`, `Build this one feature of the plan: [${one.id}] ${one.detail}`, "build");
  push("task.claimed", { taskId: `long-task-${one.id}`, employeeId: null, holder: "Software engineer", holderKind: "role", summary: one.text });
  work(`builder-${one.id}-0`, "build", 70, 0.05);
  reply(`builder-${one.id}-0`, `Done — the ${one.id} item is built, verified and committed.`);
  let done = checkTask(one, 0, true);
  begin(`evaluator-${one.id}-0`, "Evaluate the item now (round 0).", "evaluate");
  work(`evaluator-${one.id}-0`, "evaluate", 16, 0.06);
  reply(`evaluator-${one.id}-0`, '{"passed":true}');
  begin(`evaluator-${one.id}-0-recheck`, "Check the same build again, independently.", "evaluate");
  work(`evaluator-${one.id}-0-recheck`, "evaluate", 12, 0.06, false);
  reply(`evaluator-${one.id}-0-recheck`, '{"passed":true}');
  push("evaluation.passed", { item: one.id, text: one.text, round: 0, rechecked: true, requirements: [{ id: "r2", text: "See the next outings", met: true }], failing: [], faults: [], evidence: "make test and make lint exit 0.", summary: `Checked and working: ${one.text.replace(/\.$/, "")} (1 of 1 of your requirements shown working in the running app).` });
  done();
  push("task.done", { taskId: `long-task-${one.id}`, summary: `Built and handed over: ${one.text.replace(/\.$/, "")}.` });

  // Part 2: built, then sent back three times; each repair on a stronger model, none of it charged.
  begin(`builder-${two.id}-0`, `Build this one feature of the plan: [${two.id}] ${two.detail}`, "build");
  push("task.claimed", { taskId: `long-task-${two.id}`, employeeId: null, holder: "Software engineer", holderKind: "role", summary: two.text });
  work(`builder-${two.id}-0`, "build", 70, 0.05);
  reply(`builder-${two.id}-0`, `Done — the ${two.id} item is built, verified and committed.`);
  for (let round = 0; round <= 3; round += 1) {
    const last = round === 3;
    done = checkTask(two, round, false, last);
    const evaluator = `evaluator-${two.id}-${round}`;
    begin(evaluator, `Evaluate the item now (round ${round}).`, "evaluate");
    work(evaluator, "evaluate", 16, 0.06, round === 0);
    reply(evaluator, '{"passed":false}');
    push("evaluation.failed", {
      item: two.id,
      text: two.text,
      round,
      final: last,
      requirements: [{ id: "r4", text: "Coming back later shows the member their own seat", met: false, evidence: "After signing in again the outing showed every seat as free. The member's claim was not found." }],
      failing: ["r4:not-met"],
      faults: ["The claim is saved against the session, not the member."],
      summary: `Sent back for repair${round > 0 ? " again" : ""}, at no charge: ${two.text.replace(/\.$/, "")} (3 of 4 of your requirements shown working in the running app).`,
    });
    done();
    if (last) break;
    const repair = `builder-${two.id}-${round + 1}`;
    begin(repair, "Repair what the check found, then commit.", "build");
    work(repair, "build", 52, 0.07, false);
    reply(repair, "Repaired and committed.");
  }
  push("task.failed", { taskId: `long-task-${two.id}`, reason: "Still did not work after 3 rounds of repair, each on a stronger model; the repairs were not charged." });
  const what = two.text.replace(/\.$/, "");
  say("runner", "Stopped", `“${what}” still did not work after 3 rounds of repair, each on a stronger model, so the app was not published. Its work so far is saved and the repairs were not charged; “Try again” carries on from it.`);
  const total = Math.round(billed * 100) / 100;
  const notCharged = Math.round(free * 100) / 100;
  push("estimate.scored", { expectedCredits: 56, actualCredits: total, nonBillableCredits: notCharged, modelCalls: calls });
  push("run.finished", { outcome: "failed", totals: { credits: total, modelCalls: calls, nonBillableCredits: notCharged }, summary: `'${two.text}' still failed its check after 3 repair rounds: The claim is saved against the session, not the member.` });

  const startedAt = new Date(start).toISOString();
  const finishedAt = new Date(clock).toISOString();
  const title = `Build: ${clampWords(REQUEST, 120)}`;
  return {
    run: { id: LONG_RUN_ID, kind: "build", title, scope, status: "failed", startedAt, finishedAt, lastSeq: events.length, ideaId: null, estimateCredits: 56, firstEstimateCredits: 20, planEstimateCredits: 56, spentCredits: total, employeeId: null, conversationId: null, budgetExhausted: false, outcome: "failed", summary: `'${two.text}' still failed its check after 3 repair rounds.`, createdAt: startedAt, canTryAgain: false },
    events,
    playback: null,
  };
}

/**
 * The idea the long build was decided from: built by a person, its build the decision's run — so the build that stopped is
 * the idea's latest attempt and can be tried again, from the run page or the conversation (#40).
 */
export function longRunIdea(scope: string): Idea {
  const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000).toISOString();
  return {
    id: LONG_IDEA_ID,
    title: clampWords(REQUEST, 120),
    text: REQUEST,
    constraints: [],
    status: "decided",
    runId: "",
    scope,
    research: { estimatedCredits: 12, spentCredits: 9.6, by: null },
    verdict: null,
    decision: { choice: "build", at, by: "Mara Ellison", overruled: false, runId: LONG_RUN_ID, via: "person" },
    record: { total: 0, build: 0, change: 0, doNotBuild: 0, overruled: [] },
    redLine: null,
    history: [],
    tryAgain: null,
  };
}
