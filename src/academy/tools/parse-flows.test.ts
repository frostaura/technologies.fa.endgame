// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseLevel, normaliseReach, orderByPrerequisites, parseFlows, readTracks, rolesOf } from "./parse-flows.ts";
import { parseBlocks } from "./markdown.ts";

const docs = path.resolve(import.meta.dirname, "../../../docs/flows");
const content = parseFlows(docs);
const byId = new Map(content.flows.map((f) => [f.id, f]));

describe("the flow parser, against the real docs/flows", () => {
  it("reads every flow in the five files, and nothing fatal", () => {
    // Loose bounds: a new flow must not break the suite.
    expect(content.flows.length).toBeGreaterThanOrEqual(321);
    expect(content.areas.map((a) => a.id)).toEqual(["01", "02", "03", "04", "05"]);
    expect(content.problems.filter((p) => p.fatal)).toEqual([]);
  });

  it("gives every flow steps, except the documented entries that have none on purpose", () => {
    const stepless = content.flows.filter((f) => !f.steps.length).map((f) => f.id);
    expect(stepless.every((id) => content.unplaced.includes(id))).toBe(true);
    expect(byId.get("TREE-10")?.unsupported).toBe(true);
  });

  it("reads fields written on one line with a middle dot, or a full stop", () => {
    const org = byId.get("ORG-04");
    expect(org?.level).toBe("Foundation");
    expect(org?.learnFirst).toEqual(["ORG-02"]);
    expect(org?.whatYouLearn).toMatch(/band totals the whole organisation/);
    const idea = byId.get("IDEA-02");
    expect(idea?.learnFirst).toEqual(["IDEA-01"]);
    expect(idea?.steps).toHaveLength(5);
  });

  it("keeps nested bullets and tables under the step they belong to", () => {
    const step1 = byId.get("ORG-04")?.steps[0];
    expect(step1?.text).toBe("The header shows:");
    const list = step1?.children[0];
    expect(list?.kind).toBe("list");
    const table = byId.get("ORG-05")?.steps[0]?.children.find((b) => b.kind === "table");
    expect(table && table.kind === "table" ? table.header : []).toContain("Badge");
  });

  it("numbers steps on across two step sections", () => {
    const ppl = byId.get("PPL-08");
    expect(ppl?.steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(ppl?.steps[2]?.section).toBe("Steps in the console");
  });

  it("resolves learn-first to flow ids, dropping words that are not ids", () => {
    expect(byId.get("ID-10")?.learnFirst).toEqual(["ID-02", "SHL-05"]);
    expect(byId.get("ID-01")?.learnFirst).toEqual([]);
    for (const f of content.flows) for (const p of f.learnFirst) expect(byId.has(p) || content.flows.some((g) => g.aliases.includes(p))).toBe(true);
  });

  it("normalises how a flow is reached into five kinds, as the README counts them", () => {
    const count = (r: string) => content.flows.filter((f) => f.reach === r).length;
    expect(count("screen")).toBeGreaterThan(200);
    expect(count("cli")).toBeGreaterThan(15);
    expect(byId.get("OPS-01")?.reach).toBe("cli");
    expect(byId.get("ID-08")?.reach).toBe("api");
  });

  it("places flows on the README's paths, every learn-first ahead of what needs it", () => {
    const sizes = Object.fromEntries(content.tracks.map((t) => [t.level, t.flows.length]));
    expect(sizes.Foundation).toBeGreaterThan(60);
    expect(sizes.Operator).toBeGreaterThan(25);
    // A learn-first cycle is reported as a shape problem; every other prerequisite comes first.
    const inCycle = new Set(content.problems.filter((p) => p.message.includes("in a circle")).flatMap((p) => p.message.match(/[A-Z]{2,5}-\d{2}/g) ?? []));
    for (const t of content.tracks) {
      const at = new Map(t.flows.map((id, i) => [id, i]));
      for (const id of t.flows) for (const p of byId.get(id)?.learnFirst ?? []) if (at.has(p) && !inCycle.has(id)) expect(at.get(p)).toBeLessThan(at.get(id) ?? 0);
    }
  });

  it("harvests the on-screen words a learner may search for", () => {
    expect(byId.get("ID-07")?.labels).toContain("Endgame is invite-only. Sign in, or register with the invitation code you were sent.");
    expect(byId.get("ID-01")?.startRoute).toBe("/sign-in");
  });

  it("expands a grouped entry's ids as aliases", () => {
    expect(byId.get("AST-07")?.aliases).toContain("AST-16");
    expect(byId.get("AST-07")?.steps.length).toBeGreaterThanOrEqual(10);
  });
});

describe("the parser's helpers", () => {
  it("normalises levels and reach", () => {
    expect(normaliseLevel("Operator / Developer")).toBe("Operator");
    expect(normaliseLevel("not applicable")).toBeNull();
    expect(normaliseReach("UI; MCP `run_events`.")).toBe("screen");
    expect(normaliseReach("command line only")).toBe("cli");
    expect(normaliseReach("system only.")).toBe("automatic");
    expect(normaliseReach("API / MCP only.")).toBe("api");
    expect(normaliseReach("nowhere.")).toBe("none");
  });

  it("reads roles from who", () => {
    expect(rolesOf("Viewer or above.")).toEqual(expect.arrayContaining(["viewer", "builder", "admin", "owner"]));
    expect(rolesOf("Admin or Owner.")).not.toContain("viewer");
    expect(rolesOf("host administrator")).toEqual(["host-admin"]);
    expect(rolesOf("AI assistant")).toContain("assistant");
  });

  it("orders by prerequisite without losing or duplicating any id", () => {
    expect(orderByPrerequisites(["B", "A", "C"], (id) => (id === "B" ? ["A"] : []))).toEqual(["A", "B", "C"]);
    expect(orderByPrerequisites(["A", "B"], (id) => (id === "A" ? ["B"] : ["A"]))).toHaveLength(2);
  });

  it("reads the README's tracks and the not-placed list", () => {
    const t = readTracks("### Core — 2 flows\n\nDay to day.\n\n| Flow | What | Reached by | Area |\n| --- | --- | --- | --- |\n| ID-02 | x | Screen | y |\n### Not placed in a track — 1\n| AST-07 to AST-16 | x | API or assistant only | y |\n");
    expect(t.order.get("Core")).toEqual(["ID-02"]);
    expect(t.summaries.get("Core")).toBe("Day to day.");
    expect(t.unplaced).toEqual(["AST-07"]);
    expect(t.reach.get("AST-07")).toBe("api");
  });

  it("parses nested lists and paragraphs by indentation", () => {
    const blocks = parseBlocks(["  1. One", "     - a", "     - b", "", "     More.", "  2. Two"]);
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list?.kind === "list" && list.items.map((i) => i.text)).toEqual(["One", "Two"]);
    expect(list?.kind === "list" && list.items[0]?.children.map((c) => c.kind)).toEqual(["list", "para"]);
  });
});
