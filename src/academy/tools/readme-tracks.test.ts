// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlows, readTracks } from "./parse-flows.ts";
import { placement, regenerate } from "./readme-tracks.ts";

const docs = path.resolve(import.meta.dirname, "../../../docs/flows");
const readme = readFileSync(path.join(docs, "README.md"), "utf8");
const content = parseFlows(docs);

describe("the README's counted parts", () => {
  it("are what the flow files say, so no flow is left off its path", () => {
    expect(regenerate(readme, content)).toBe(readme);
  });

  it("place every flow exactly once, on a path or under not placed", () => {
    const { tracks, unplaced } = placement(content);
    const placed = [...tracks.values()].flat().concat(unplaced).map((f) => f.id);
    expect(placed.length).toBe(content.flows.length);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("put a flow added to a file on its path without a second edit", () => {
    const without = readme
      .split("\n")
      .filter((l) => !l.startsWith("| ID-02 |"))
      .join("\n");
    expect(readTracks(without).order.get("Foundation")).not.toContain("ID-02");
    expect(readTracks(regenerate(without, content)).order.get("Foundation")).toContain("ID-02");
  });
});
