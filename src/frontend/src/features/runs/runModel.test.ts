import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/store/types";
import { accuracy, deriveRun, describeEvent, isTerminal, lastSeq, mergeEvents } from "./runModel";

let at = 0;
const e = (seq: number, type: string, payload: Record<string, unknown> = {}): RunEvent => ({ seq, type, at: `2026-11-24T10:00:${String(at++ % 60).padStart(2, "0")}Z`, payload });

describe("mergeEvents", () => {
  it("orders by sequence and drops repeats, so a resumed stream neither loses nor doubles a step", () => {
    const first = mergeEvents([], [e(1, "run.started"), e(2, "task.created", { taskId: "a" })]);
    const resumed = mergeEvents(first, [e(2, "task.created", { taskId: "a" }), e(4, "task.done", { taskId: "a" }), e(3, "task.claimed", { taskId: "a" })]);
    expect(resumed.map((x) => x.seq)).toEqual([1, 2, 3, 4]);
    expect(lastSeq(resumed)).toBe(4);
  });

  it("returns the same array when nothing new arrived", () => {
    const log = [e(1, "run.started")];
    expect(mergeEvents(log, [e(1, "run.started")])).toBe(log);
  });

  it("ignores an event without an integer sequence number", () => {
    expect(mergeEvents([], [{ ...e(1, "message"), seq: Number.NaN }])).toEqual([]);
  });
});

describe("deriveRun", () => {
  it("is empty and says nothing about status before any event", () => {
    const run = deriveRun([]);
    expect(run.status).toBeNull();
    expect(run.tasks).toEqual([]);
  });

  it("follows tasks through created, claimed, done and failed", () => {
    const run = deriveRun([
      e(1, "task.created", { taskId: "a", summary: "Sweep" }),
      e(2, "task.created", { taskId: "b", summary: "Demand" }),
      e(3, "task.claimed", { taskId: "a", holder: "Ada" }),
      e(4, "task.done", { taskId: "a", summary: "Three found" }),
      e(5, "task.failed", { taskId: "b", reason: "No sources" }),
    ]);
    expect(run.tasks).toEqual([
      { id: "a", summary: "Sweep", status: "done", holder: "Ada", note: "Three found" },
      { id: "b", summary: "Demand", status: "failed", holder: null, note: "No sources" },
    ]);
  });

  it("settles credits from replies and holds reservations only while calls are in flight", () => {
    const inFlight = deriveRun([e(1, "model.requested", { callId: "k1", reservedCredits: 4 }), e(2, "model.requested", { callId: "k2", reservedCredits: 6 }), e(3, "model.replied", { callId: "k1", settledCredits: 1.5 })]);
    expect(inFlight.settledCredits).toBe(1.5);
    // A repair of the work's own mistake settles but is never billed: what was spent is what the ledger charged.
    const repaired = deriveRun([e(1, "model.replied", { callId: "a", settledCredits: 2 }), e(2, "model.replied", { callId: "b", settledCredits: 0.5, billable: false })]);
    expect(repaired.settledCredits).toBe(2);
    expect(inFlight.reservedCredits).toBe(6);
    expect(inFlight.modelCalls).toBe(1);
    const finished = deriveRun([e(1, "model.requested", { callId: "k1", reservedCredits: 4 }), e(2, "run.finished", { outcome: "succeeded" })]);
    expect(finished.reservedCredits).toBe(0);
  });

  it("waits on an approval and resumes once it is answered", () => {
    const waiting = deriveRun([e(1, "run.started"), e(2, "approval.requested", { approvalId: "a1", question: "Spend more?" })]);
    expect(waiting.status).toBe("waiting");
    expect(waiting.approvals).toMatchObject([{ id: "a1", question: "Spend more?", answer: null }]);
    const answered = deriveRun([e(1, "run.started"), e(2, "approval.requested", { approvalId: "a1" }), e(3, "approval.answered", { approvalId: "a1", answer: "Approved" })]);
    expect(answered.status).toBe("running");
    expect(answered.approvals[0]?.answer).toBe("Approved");
  });

  it("marks plan items against their evaluations", () => {
    const run = deriveRun([
      e(1, "plan.proposed", { summary: "S", items: [{ id: "c1", text: "Opens", check: "Browser walk" }, { id: "c2", text: "Signs in" }] }),
      e(2, "plan.accepted"),
      e(3, "evaluation.passed", { item: "c1", evidence: "Opened" }),
      e(4, "evaluation.failed", { item: "c2", evidence: "No button" }),
    ]);
    expect(run.plan?.accepted).toBe(true);
    expect(run.plan?.items.map((i) => i.result)).toEqual(["passed", "failed"]);
  });

  it("reads the finish outcome", () => {
    expect(deriveRun([e(1, "run.finished", { outcome: "failed" })]).status).toBe("failed");
    expect(deriveRun([e(1, "run.finished", { outcome: "cancelled" })]).status).toBe("cancelled");
    expect(deriveRun([e(1, "run.paused"), e(2, "run.resumed")]).status).toBe("running");
    expect(isTerminal("finished")).toBe(true);
    expect(isTerminal("paused")).toBe(false);
  });

  it("counts tool calls and denials, and keeps messages in order", () => {
    const run = deriveRun([e(1, "tool.requested", { tool: "x" }), e(2, "tool.denied", { tool: "x" }), e(3, "message", { text: "Hi", from: "Ada" }), e(4, "message", { text: "" })]);
    expect(run.toolCalls).toBe(1);
    expect(run.toolDenials).toBe(1);
    expect(run.messages.map((m) => m.text)).toEqual(["Hi"]);
  });

  it("survives payloads of the wrong shape", () => {
    expect(() => deriveRun([e(1, "plan.proposed", { items: "nope" }), e(2, "model.replied", { settledCredits: "3" }), e(3, "estimate.scored", { estimated: 1 })])).not.toThrow();
  });
});

describe("describeEvent", () => {
  it("names who took on a task and what it is, never 'Someone took on a task'", () => {
    expect(describeEvent(e(20, "task.claimed", { taskId: "t", holder: "Theo", summary: "Keep the club's books" }), "normal")?.title).toBe("Theo took on: Keep the club's books");
    expect(describeEvent(e(21, "task.claimed", { taskId: "t", holder: "Theo" }), "normal")?.title).toBe("Theo took on a task");
    expect(describeEvent(e(22, "task.claimed", { taskId: "t", summary: "Keep the club's books" }), "normal")?.title).toBe("Taken on: Keep the club's books");
    expect(describeEvent(e(23, "task.claimed", { taskId: "t" }), "normal")?.title).not.toContain("Someone");
  });


  const denied = e(9, "tool.denied", { tool: "shell.exec", rule: "protected floor", reason: "No shell" });
  const model = e(10, "model.replied", { model: "vendor/model-x", settledCredits: 2, tokens: { input: 10, output: 5 } });

  it("never names infrastructure in normal mode", () => {
    const step = describeEvent(denied, "normal");
    expect(step?.title).toBe("An action was refused by your rules");
    expect(JSON.stringify(step)).not.toMatch(/shell|protected floor/);
    expect(describeEvent(model, "normal")).toBeNull();
    expect(describeEvent(e(11, "tool.requested", { tool: "shell.exec" }), "normal")).toBeNull();
    expect(describeEvent(e(12, "mystery.event"), "normal")).toBeNull();
  });

  it("says the owner declined what they declined at an approval, never that a rule refused it (R6-1)", () => {
    const declined = e(14, "tool.denied", { name: "web_search", rule: "checkpoint:frostaura:web_search:rejected", by: "owner", declined: "search the web for what they leave undone" });
    expect(describeEvent(declined, "normal")).toMatchObject({ title: "You declined: search the web for what they leave undone", detail: "It was not done. The work continues without it." });
    expect(describeEvent(declined, "technical")?.title).toBe("Declined by you: web_search");
    // An older decline carried only its rule.
    expect(describeEvent(e(15, "tool.denied", { name: "edit_file", rule: "checkpoint:frostaura:edit_file(docs/app.md):rejected" }), "normal")?.title).toBe("You declined: a step the work asked you about");
    expect(describeEvent(denied, "normal")?.title).toBe("An action was refused by your rules");
  });

  it("shows the tool, the rule that decided, the model and its cost in technical mode", () => {
    expect(describeEvent(denied, "technical")).toMatchObject({ title: "Denied: shell.exec", detail: "Rule: protected floor · No shell" });
    expect(describeEvent(e(13, "tool.permitted", { tool: "web.search", rule: "research may search" }), "technical")?.detail).toBe("Rule: research may search");
    const step = describeEvent(model, "technical");
    expect(step).toMatchObject({ title: "Model replied: vendor/model-x", credits: "2 credits", detail: "10 tokens in, 5 out" });
    expect(step?.raw).toContain("vendor/model-x");
  });

  it("names a plan item by its text when it can", () => {
    const step = describeEvent(e(14, "evaluation.passed", { item: "c1" }), "normal", (id) => (id === "c1" ? "It opens" : null));
    expect(step?.title).toBe("Checked and passed: It opens");
  });

  it("scores an estimate against what it cost", () => {
    expect(describeEvent(e(15, "estimate.scored", { estimated: 60, actual: 54 }), "normal")?.detail).toBe("Estimated 60, cost 54 (10% under)");
    expect(accuracy(100, 117)).toBe("17% over");
    expect(accuracy(50, 50)).toBe("on the estimate");
    // An estimate under a credit is too small to score as a percentage ("217% over" says nothing).
    expect(accuracy(0.05, 0.1585)).toBe("under 1 credit, as estimated");
    expect(accuracy(0.5, 1.4)).toBe("estimated under 1 credit");
  });

  it("writes a step's credits with the one formatter: never \"1 credits\", never more than two decimals", () => {
    expect(describeEvent(e(16, "estimate.made", { credits: 1 }), "normal")?.credits).toBe("1 credit");
    expect(describeEvent(e(17, "estimate.made", { credits: 7.4666 }), "normal")?.credits).toBe("7.47 credits");
  });

  it("marks an approval with the hand, asked in the waiting tone and answered in the quiet one, never the red shield", () => {
    const asked = describeEvent(e(18, "approval.requested", { title: "Search the web?" }), "normal");
    const answered = describeEvent(e(19, "approval.answered", { answer: "approved" }), "normal");
    const declined = describeEvent(e(20, "tool.denied", { by: "owner", name: "web_search" }), "normal");
    expect([asked?.icon, asked?.tone]).toEqual(["approval-asked", "approval"]);
    expect([answered?.icon, answered?.tone]).toEqual(["approval-answered", "quiet"]);
    expect([declined?.icon, declined?.tone]).toEqual(["approval-answered", "quiet"]);
  });
});
