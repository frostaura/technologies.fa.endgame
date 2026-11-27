import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/store/types";
import { hasLooseTasks, partTasks, taskPhrases } from "./runTasks";
import { buildTimeline, latestProgress, PART_START, type TimelineItem } from "./timeline";
import { deriveRun, planItemOf, type DerivedTask } from "./runModel";
import { curlyQuotes, kindWord } from "./runHeading";

/** The run page's shape after the third visual round: one status signal, figures that add up, tasks said under their part. */

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>): RunEvent => ({ seq: ++seq, type, at: `2026-11-27T10:00:${String(seq % 60).padStart(2, "0")}Z`, payload });

describe("the kind beside the status", () => {
  it("is left out when the heading already says it", () => {
    expect(kindWord({ kind: "build", title: "Build: A reading list" })).toBeNull();
    expect(kindWord({ kind: "factory", title: "Memory review: Kasper" })).toBeNull();
    expect(kindWord({ kind: "factory", title: "Change: Each record gets a note" })).toBeNull();
  });

  it("never calls a memory review or a change a build", () => {
    expect(kindWord({ kind: "factory", title: "Tidy the notes" })).toBe("Work");
    expect(kindWord({ kind: "research", title: "A tide board" })).toBe("Research");
  });
});

describe("a quoted phrase in the heading", () => {
  it("is set in typographic quotes, single or double", () => {
    expect(curlyQuotes('Add a short "Done by" text')).toBe("Add a short “Done by” text");
    expect(curlyQuotes("a 'Done by' text")).toBe("a “Done by” text");
  });
});

describe("each part's figure adds up to the run's", () => {
  it("splits what each part was charged from what its repairs used, as the ledger does", () => {
    seq = 0;
    const plan = [planItemOf({ id: "a", text: "Part A", detail: "a" }, 0), planItemOf({ id: "b", text: "Part B", detail: "b" }, 1)];
    const events = [
      ev("model.replied", { settledCredits: 1, billable: true }),
      ev("message", { kind: "agent.start", agent: "builder-a-0" }),
      ev("model.replied", { settledCredits: 2, billable: true }),
      ev("tool.requested", { name: "read_file", agent: "builder-a-0", accounting: { settledCredits: 2 } }),
      ev("message", { kind: "agent.start", agent: "builder-b-1" }),
      ev("model.replied", { settledCredits: 3, billable: false }),
      ev("tool.requested", { name: "edit_file", agent: "builder-b-1", accounting: { settledCredits: 3 } }),
    ];
    const t = buildTimeline(events, "normal", (id) => plan.find((p) => p.id === id)?.text ?? null, plan);
    expect(t.partCredits.get(PART_START)).toEqual({ charged: 1, free: 0 });
    expect(t.partCredits.get("a")).toEqual({ charged: 2, free: 0 });
    expect(t.partCredits.get("b")).toEqual({ charged: 0, free: 3 });
    const charged = [...t.partCredits.values()].reduce((n, x) => n + x.charged, 0);
    expect(charged).toBe(deriveRun(events).settledCredits);
    // A repair's own line says its credits were not charged.
    const repair = t.items.find((i) => i.kind === "group" && i.agent === "builder-b-1");
    expect(repair && repair.kind === "group" ? [repair.credits, repair.freeCredits] : null).toEqual([0, 3]);
  });
});

describe("a long build's progress reports", () => {
  it("keep only the latest in each part, counted", () => {
    const step = (key: string, title: string, progress = false, part = "a"): TimelineItem => ({ kind: "step", key, seq: 0, at: "", tone: "people", icon: "employee", title, detail: key, credits: null, raw: null, part, ...(progress ? { progress: true } : {}) });
    const out = latestProgress([step("1", "The builder · Still building", true), step("2", "Read 4 files"), step("3", "The builder · Still building", true), step("4", "Checked"), step("5", "The builder · Still building", true, "b")]);
    expect(out.map((i) => i.key)).toEqual(["2", "3", "4", "5"]);
    expect(out[1]?.kind === "step" && out[1].repeat).toBe(2);
  });

  it("are written by the harness with their count, and gathered on the timeline", () => {
    seq = 0;
    const events = [1, 2, 3].map((n) => ev("message", { from: "builder", title: "Still building", text: `Still building; ${n * 10} actions so far.`, progress: n * 10 }));
    const t = buildTimeline(events, "normal");
    expect(t.items).toHaveLength(1);
    expect(t.items[0]?.kind === "step" && [t.items[0].detail, t.items[0].repeat]).toEqual(["Still building; 30 actions so far.", 3]);
  });

  it("mark a run of actions whose tests failed as a failure", () => {
    seq = 0;
    const events = [ev("tool.requested", { name: "run", callId: "c1", arguments: { command: "make test" } }), ev("tool.result", { name: "run", callId: "c1", content: "Vitest 1 failed | 10 passed" })];
    const t = buildTimeline(events, "normal");
    expect(t.items[0]?.kind === "step" && [t.items[0].title, t.items[0].tone]).toEqual(["Ran the tests — 1 of 11 failed", "attention"]);
  });
});

describe("tasks are said under their part", () => {
  const item = planItemOf({ id: "a", text: "Keep the books", detail: "x" }, 0);
  const task = (id: string, summary: string, status: DerivedTask["status"], holder: string | null): DerivedTask => ({ id, summary, status, holder, note: null });
  const tasks = [
    task("t1", "Keep the books", "failed", "Rosa"),
    task("t2", "Check: Keep the books", "done", "Nadia"),
    task("t3", "Check: Keep the books", "done", "Nadia"),
    task("t4", "Check: Keep the books", "done", "Nadia"),
    task("t5", "Check: Keep the books", "working", "Kasper"),
    task("t6", "Security review", "done", "Iris"),
  ];

  it("as one line, with checks that ended alike said once", () => {
    const phrases = taskPhrases(partTasks(item, tasks)).map((p) => p.text);
    expect(phrases).toEqual(["Build: did not succeed, Rosa", "3 checks: done by Nadia", "Check 4: in progress, Kasper"]);
  });

  it("so the Tasks card is drawn only for tasks no part holds", () => {
    const plan = { summary: null, items: [item], accepted: true, requirements: [], leftOut: [] };
    expect(hasLooseTasks({ tasks: tasks.slice(0, 5), plan })).toBe(false);
    expect(hasLooseTasks({ tasks, plan })).toBe(true);
    expect(hasLooseTasks({ tasks: [], plan: null })).toBe(false);
  });
});
