import { describe, expect, it } from "vitest";
import type { Flow, Level, Track } from "../content/types.ts";
import { milestones, nextUp, overallNext, trackStats, type Catalogue } from "./derive.ts";
import { empty, setDone, view, type Progress } from "./model.ts";

const mk = (id: string, level: Level, learnFirst: string[] = []): Flow => ({ id, level, learnFirst, steps: [{ n: 1 }, { n: 2 }] }) as unknown as Flow;

const flows = [mk("F-1", "Foundation"), mk("F-2", "Foundation", ["F-1"]), mk("F-3", "Foundation", ["C-2"]), mk("C-1", "Core"), mk("C-2", "Core", ["C-1"]), mk("O-1", "Operator")];
const tracks: Track[] = [
  { level: "Foundation", title: "Foundation", summary: "", flows: ["F-1", "F-2", "F-3"] },
  { level: "Core", title: "Core", summary: "", flows: ["C-1", "C-2"] },
  { level: "Operator", title: "Operator handbook", summary: "", flows: ["O-1"] },
];
const cat: Catalogue = { tracks, flow: (id) => flows.find((f) => f.id === id) };
const CLIENT: Level[] = ["Foundation", "Core"];
const done = (...ids: string[]): Progress => ids.reduce((p, id, i) => setDone(p, id, true, 1000 + i), empty());
const t = (level: Level) => tracks.find((x) => x.level === level);

describe("paths", () => {
  it("counts done and started flows, and knows when a path is complete", () => {
    const p = view(done("F-1"), "F-2", 1, 2, 5);
    expect(trackStats(p, tracks[0] as Track)).toMatchObject({ done: 1, total: 3, started: 1, complete: false });
    expect(trackStats(done("C-1", "C-2"), tracks[1] as Track)).toMatchObject({ complete: true, completedAt: 1001 });
  });
});

describe("next up", () => {
  it("is the first flow not done, in the path's order", () => {
    expect(nextUp(empty(), t("Foundation"), cat)?.flow.id).toBe("F-1");
    expect(nextUp(done("F-1"), t("Foundation"), cat)?.flow.id).toBe("F-2");
  });

  it("after a flow, goes on from it (here F-3, whose “Learn first” comes ahead), then wraps to what was skipped", () => {
    expect(nextUp(done("F-2"), t("Foundation"), cat, "F-2")).toMatchObject({ flow: { id: "C-1" }, before: { id: "F-3" } });
    expect(nextUp(done("F-2", "F-3"), t("Foundation"), cat, "F-3")?.flow.id).toBe("F-1");
  });

  it("puts a missing “Learn first” ahead of the flow that needs it, however deep", () => {
    const n = nextUp(done("F-1", "F-2"), t("Foundation"), cat);
    expect(n?.flow.id).toBe("C-1");
    expect(n?.before?.id).toBe("F-3");
  });

  it("has nothing next on a finished path", () => {
    expect(nextUp(done("C-1", "C-2"), t("Core"), cat)).toBeUndefined();
  });

  it("across paths, carries on in the path last read, else the first not finished", () => {
    expect(overallNext(empty(), cat, CLIENT)?.flow.id).toBe("F-1");
    const p = view(empty(), "C-1", 2, 2, 5);
    expect(overallNext(p, cat, CLIENT)?.flow.id).toBe("C-2");
  });

  it("never offers an operator flow on a client path", () => {
    expect(overallNext(done("F-1", "F-2", "F-3", "C-1", "C-2"), cat, CLIENT)).toBeUndefined();
  });
});

describe("milestones", () => {
  it("earns the first flow when one is done, dated when it was, and counts what is left", () => {
    const m = milestones(done("F-1"), cat, CLIENT);
    expect(m.find((x) => x.id === "flows-1")).toMatchObject({ earned: true, at: 1000 });
    // Ten flows is more than this academy has, so it is not offered.
    expect(m.find((x) => x.id === "flows-10")).toBeUndefined();
    expect(m.find((x) => x.id === "path-1")).toMatchObject({ earned: false, toGo: "2 flows to go on Foundation" });
  });

  it("earns a whole path and every path, and the operator handbook counts toward neither", () => {
    const m = milestones(done("C-1", "C-2", "O-1"), cat, CLIENT);
    expect(m.find((x) => x.id === "path-1")).toMatchObject({ earned: true, at: 1001 });
    expect(m.find((x) => x.id === "path-all")).toMatchObject({ earned: false, toGo: "3 flows to go" });
    const all = milestones(done("F-1", "F-2", "F-3", "C-1", "C-2"), cat, CLIENT);
    expect(all.find((x) => x.id === "path-all")?.earned).toBe(true);
  });
});

describe("the next flow", () => {
  it("is never the flow being read, even when it is the open prerequisite of the next one", () => {
    // F-2 needs F-1 first; reading F-1, the way on is F-2 itself, not F-1 again.
    expect(nextUp(empty(), t("Foundation"), cat, "F-1")?.flow.id).toBe("F-2");
    for (const f of flows) expect(nextUp(empty(), cat.tracks.find((x) => x.level === f.level), cat, f.id)?.flow.id).not.toBe(f.id);
  });
});
