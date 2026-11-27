import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/store/types";
import { interrupted, receiptsOf, segmentsOf, turnsOf } from "./turnModel";
import { deriveWork } from "./workModel";

const ev = (seq: number, type: string, payload: Record<string, unknown>, at = `2026-11-27T10:00:${String(seq).padStart(2, "0")}Z`): RunEvent => ({ seq, type, at, payload });

describe("a turn's order (ARCH-012)", () => {
  it("groups the history by run, owner first, replies and notices apart", () => {
    const turns = turnsOf(
      [
        { runId: "r1", seq: 1, at: "", from: "owner", text: "Hi", by: "Dean", code: null, attachments: [] },
        { runId: "r1", seq: 3, at: "", from: "assistant", text: "Hello.", by: null, code: null, attachments: [] },
        { runId: "r2", seq: 1, at: "", from: "owner", text: "More?", by: null, code: null, attachments: [] },
        { runId: "r2", seq: 4, at: "", from: "runner", text: "The budget ran out.", by: null, code: "budget_exhausted", attachments: [] },
      ],
      [{ runId: "r2", status: "failed", toolCalls: 0, started: [] }],
    );
    expect(turns.map((t) => [t.runId, t.owner?.text, t.replies.length, t.notices.length])).toEqual([
      ["r1", "Hi", 1, 0],
      ["r2", "More?", 0, 1],
    ]);
    expect(turns[1]?.info?.status).toBe("failed");
  });

  it("splits the reply at an approval and keeps its receipt with who answered, when and the note", () => {
    const events = [ev(4, "approval.requested", { approvalId: "a1", title: "Change Court booking: “Add a waitlist”" }), ev(5, "approval.answered", { approvalId: "a1", answer: "rejected", byName: "Dean", comment: "Not now" })];
    const receipts = receiptsOf(events);
    expect(receipts[0]).toMatchObject({ answer: "rejected", by: "Dean", note: "Not now", question: "Change Court booking: “Add a waitlist”" });
    const segments = segmentsOf([{ seq: 3, text: "I can ask.", by: null }, { seq: 7, text: "Not asked.", by: null }], receipts);
    expect(segments.map((s) => s.kind)).toEqual(["bubble", "approval", "bubble"]);
  });

  it("calls a turn interrupted only when its run ended with nothing said", () => {
    expect(interrupted("failed", 0, 0)).toBe(true);
    expect(interrupted("cancelled", 0, 0)).toBe(true);
    expect(interrupted("failed", 0, 1)).toBe(false);
    expect(interrupted("finished", 0, 0)).toBe(false);
    expect(interrupted("running", 0, 0)).toBe(false);
  });
});

describe("the card's figures (C-3, C-4, finding 39)", () => {
  const PLAN = { items: [{ id: "a", text: "First" }, { id: "b", text: "Second" }] };
  it("reads carried parts as done before, counts them, and keeps a role as a holder", () => {
    const w = deriveWork([
      ev(1, "run.started", {}),
      ev(2, "plan.accepted", { by: "earlier-attempt", ...PLAN }),
      ev(3, "message", { kind: "plan.carried", items: ["a"] }),
      ev(4, "task.created", { taskId: "t1", title: "First" }),
      ev(5, "task.created", { taskId: "t2", title: "Second" }),
      ev(6, "task.claimed", { taskId: "t2", holder: "Software engineer", holderKind: "role", summary: "Second" }),
    ]);
    expect(w.parts.map((p) => p.state)).toEqual(["carried", "working"]);
    expect(w.done).toBe(1);
    expect(w.parts[1]?.tasks[0]).toMatchObject({ holder: "Software engineer", holderKind: "role" });
    // A role is not a person on the card.
    expect(w.workers.map((x) => x.name)).not.toContain("Software engineer");
  });

  it("says when the estimate was made again from the plan, and keeps waiting for a person out of the working time", () => {
    const w = deriveWork([
      ev(1, "run.started", {}),
      ev(2, "estimate.made", { credits: 10 }),
      ev(3, "estimate.made", { credits: 15, stage: "plan", previousCredits: 10, reason: "Re-estimated after planning: 3 parts." }),
      ev(4, "approval.requested", { approvalId: "x" }, "2026-11-27T10:00:10Z"),
      ev(5, "approval.answered", { approvalId: "x", answer: "approved" }, "2026-11-27T10:05:10Z"),
    ]);
    expect(w.reestimate).toEqual({ from: 10, to: 15, reason: "Re-estimated after planning: 3 parts." });
    expect(w.waitedMs).toBe(5 * 60 * 1000);
    expect(w.waitingSince).toBeNull();
  });
});
