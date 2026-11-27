import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/store/types";
import { deriveWork, partStateLabel, tallySentence } from "./workModel";

let seq = 0;
const at = (n: number) => new Date(Date.UTC(2026, 10, 27, 10, 0, n)).toISOString();
function e(type: string, payload: Record<string, unknown>): RunEvent {
  seq += 1;
  return { seq, type, at: at(seq), payload };
}

const PLAN = { items: [
  { id: "r1", text: "Members can join a waitlist", detail: "api/Waitlist.cs" },
  { id: "r2", text: "Everything it did before still works", detail: "" },
  { id: "r3", text: "A screen for the waitlist", detail: "web/src/Waitlist.tsx" },
] };

function buildLog(): RunEvent[] {
  seq = 0;
  return [
    e("run.started", {}),
    e("estimate.made", { credits: 10 }),
    e("plan.proposed", PLAN),
    e("plan.accepted", {}),
    e("task.created", { taskId: "t1", title: "Members can join a waitlist" }),
    e("task.created", { taskId: "t2", title: "Everything it did before still works" }),
    e("task.created", { taskId: "t3", title: "A screen for the waitlist" }),
    e("message", { kind: "agent.start", agent: "builder-r1-0" }),
    e("task.claimed", { taskId: "t1", holder: "Kasper", summary: "Members can join a waitlist" }),
    e("tool.requested", { name: "read_file", agent: "builder-r1-0", arguments: JSON.stringify({ path: "api/Program.cs" }) }),
    e("tool.requested", { name: "edit_file", agent: "builder-r1-0", arguments: JSON.stringify({ path: "api/Waitlist.cs" }) }),
    e("tool.requested", { name: "run", agent: "builder-r1-0", arguments: JSON.stringify({ command: "make test" }) }),
    e("model.replied", { settledCredits: 1.5 }),
    e("message", { kind: "agent.start", agent: "evaluator-r1-0" }),
    e("task.claimed", { taskId: "t1", holder: "Mina", summary: "Members can join a waitlist" }),
    e("evaluation.failed", { item: "r1", round: 0, summary: "Sent back for repair, at no charge." }),
    e("message", { kind: "agent.start", agent: "builder-r1-1" }),
  ];
}

describe("the work card's reading of a build", () => {
  it("gives each part its state as the log moves: working, checked, sent back, passed", () => {
    const log = buildLog();
    let w = deriveWork(log);
    expect(w.parts.map((p) => p.state)).toEqual(["repair", "waiting", "waiting"]);
    expect(w.parts[0]?.repairs).toBe(1);
    expect(w.active).toBe("r1");
    expect(partStateLabel("repair", 1)).toBe("Sent back for repair");
    expect(partStateLabel("repair", 2)).toBe("Sent back for repair 2");

    log.push(e("message", { kind: "agent.start", agent: "evaluator-r1-1" }));
    w = deriveWork(log);
    expect(w.parts[0]?.state).toBe("checking");

    log.push(e("evaluation.passed", { item: "r1", round: 1, summary: "Checked and working: members can join a waitlist." }));
    log.push(e("task.done", { taskId: "t1", summary: "Built and handed over." }));
    log.push(e("evaluation.passed", { item: "r2", round: 0, needsLook: true }));
    log.push(e("task.failed", { taskId: "t3", reason: "Still did not work after 3 rounds." }));
    w = deriveWork(log);
    expect(w.parts.map((p) => p.state)).toEqual(["passed", "needs-look", "failed"]);
    expect(w.done).toBe(2);
    expect(w.parts[0]?.outcome).toBe("Checked and working: members can join a waitlist.");
  });

  it("names who held each task in turn, the builder then the checker", () => {
    const w = deriveWork(buildLog());
    const tasks = w.parts[0]?.tasks ?? [];
    expect(tasks.map((t) => [t.role, t.holder, t.status])).toEqual([
      ["build", "Kasper", "done"],
      ["check", "Mina", "working"],
    ]);
    expect(w.workers.map((x) => x.name)).toEqual(["Kasper", "Mina"]);
  });

  it("sums up what the tools did, per part and in one sentence", () => {
    const w = deriveWork(buildLog());
    expect(tallySentence(w.parts[0]?.tools ?? w.tools)).toBe("Read 1 file, changed 1, ran the tests once");
    expect(w.tools.total).toBe(3);
  });

  it("leaves nothing working once the work has ended", () => {
    const log = buildLog();
    log.push(e("run.finished", { outcome: "failed", summary: "It stopped." }));
    const w = deriveWork(log);
    expect(w.active).toBeNull();
    expect(w.parts[0]?.state).toBe("failed");
  });

  it("reads the security review after the parts", () => {
    const log = buildLog();
    log.push(e("message", { kind: "agent.start", agent: "security-reviewer-0" }));
    expect(deriveWork(log).review).toBe("working");
    log.push(e("message", { from: "security-reviewer", title: "Security review passed", text: "Nothing blocks publishing.", milestone: "security:0" }));
    expect(deriveWork(log).review).toBe("passed");
  });
});

describe("research and a simple answer", () => {
  it("puts the researchers side by side with their searches and what each reported", () => {
    seq = 0;
    const log = [
      e("subagent.started", { subagent: "contractor-existing", title: "Looked for products that already do this", role: "research contractor", maxSearches: 7 }),
      e("subagent.started", { subagent: "contractor-gap", title: "Looked for the gap that is left", role: "research contractor", maxSearches: 7 }),
      e("tool.requested", { name: "web_search", agent: "contractor-existing", arguments: "{}" }),
      e("tool.requested", { name: "web_search", agent: "contractor-existing", arguments: "{}" }),
      e("subagent.finished", { subagent: "contractor-existing", summary: "Three apps do most of it. None does waitlists." }),
    ];
    const w = deriveWork(log);
    expect(w.researchers.map((r) => [r.state, r.searches, r.maxSearches])).toEqual([
      ["done", 2, 7],
      ["working", 0, 7],
    ]);
    expect(w.researchers[0]?.outcome).toBe("Three apps do most of it.");
    expect(w.workers.filter((x) => x.kind === "contractor")).toHaveLength(2);
  });

  it("says a conversation's own steps plainly, once each, and finds the work it started", () => {
    seq = 0;
    const log = [
      e("tool.requested", { name: "read_organisation", arguments: JSON.stringify({ what: "overview" }) }),
      e("tool.requested", { name: "read_organisation", arguments: JSON.stringify({ what: "overview" }) }),
      e("tool.requested", { name: "read_organisation", arguments: JSON.stringify({ what: "runs" }) }),
      e("message", { kind: "work.started", runId: "run-2", workKind: "change", title: "Change: add a waitlist" }),
      e("message", { kind: "work.started", runId: "run-2", workKind: "change", title: "Change: add a waitlist" }),
    ];
    const w = deriveWork(log);
    expect(w.steps).toEqual(["Read the org chart and what waits for you", "Read the recent work"]);
    expect(w.started).toEqual([{ runId: "run-2", kind: "change", title: "Change: add a waitlist" }]);
  });
});

/**
 * A build of about 2,000 events, read as the stream stores it (a batch every 50 ms, here every 20 events). The card
 * reads the whole log once per batch; this measures that reading, the part of a redraw that grows with the log.
 */
describe("a long build stays cheap to read", () => {
  it("reads a 2,000-event log in well under a frame per batch", () => {
    seq = 0;
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, text: `Part ${i + 1} of the app`, detail: "x" }));
    const log: RunEvent[] = [e("run.started", {}), e("estimate.made", { credits: 120 }), e("plan.proposed", { items }), e("plan.accepted", {})];
    while (log.length < 2000) {
      const i = log.length % 12;
      log.push(e("message", { kind: "agent.start", agent: `builder-r${i + 1}-0` }));
      log.push(e("tool.requested", { name: log.length % 3 ? "read_file" : "edit_file", agent: `builder-r${i + 1}-0`, arguments: JSON.stringify({ path: `src/f${log.length}.ts` }) }));
      log.push(e("model.replied", { settledCredits: 0.01 }));
    }
    const times: number[] = [];
    for (let n = 20; n <= log.length; n += 20) {
      const slice = log.slice(0, n);
      const t0 = performance.now();
      deriveWork(slice);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    console.info(`deriveWork over ${log.length} events, per batch: p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
    expect(p95).toBeLessThan(16);
    const w = deriveWork(log);
    expect(w.parts).toHaveLength(12);
    expect(w.parts[0]?.tools.actions.length).toBeLessThanOrEqual(200);
  });
});
