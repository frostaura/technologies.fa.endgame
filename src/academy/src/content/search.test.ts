// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlows } from "../../tools/parse-flows.ts";
import { buildIndex, loadIndex, search, tokenize } from "./search.ts";

const content = parseFlows(path.resolve(import.meta.dirname, "../../../../docs/flows"));
// The index the site loads: serialised at build, read back with the same options.
const index = loadIndex(JSON.parse(JSON.stringify(buildIndex(content.flows))));
const all = () => true;

describe("search", () => {
  it("keeps flow ids and hyphenated words whole as well as split", () => {
    expect(tokenize("ID-07 is invite-only.")).toEqual(["ID-07", "ID", "07", "is", "invite-only", "invite", "only"]);
  });

  it("finds a flow by its id first", () => {
    expect(search(index, "ID-07", all)[0]?.id).toBe("ID-07");
    expect(search(index, "ops-12", all)[0]?.id).toBe("OPS-12");
  });

  it("finds the flow that explains a refusal message someone saw on screen", () => {
    const hits = search(index, "Endgame is invite-only. Sign in, or register with the invitation code you were sent.", all).map((h) => h.id);
    expect(hits.slice(0, 3)).toContain("ID-07");
    expect(search(index, "That passkey could not be verified", all).map((h) => h.id)).toContain("ID-02");
  });

  it("finds flows by on-screen labels and titles", () => {
    expect(search(index, "Research this idea", all).map((h) => h.id)).toContain("IDEA-02");
    expect(search(index, "backup", all).map((h) => h.id)).toContain("OPS-12");
  });

  it("filters by scope, so client search never returns an operator flow", () => {
    const operator = new Set(content.flows.filter((f) => f.level === "Operator").map((f) => f.id));
    const hits = search(index, "backup", (id) => !operator.has(id), 50);
    expect(hits.every((h) => !operator.has(h.id))).toBe(true);
  });

  it("falls back to any word when every word together finds nothing, and returns nothing for nothing", () => {
    expect(search(index, "passkey zzzqqq", all).length).toBeGreaterThan(0);
    expect(search(index, "   ", all)).toEqual([]);
  });
});
