import { describe, expect, it } from "vitest";
import { placeInColumns } from "./masonry";

describe("placeInColumns", () => {
  it("puts each item under the shortest column so far, so a short division leaves no hole", () => {
    // Heights: a tall first division, then short ones. Fixed rows would leave a hole under each short one.
    const heights: Record<string, number> = { tech: 900, learning: 300, ops: 300, events: 200, studio: 100 };
    const cols = placeInColumns(Object.keys(heights), 3, (k) => heights[k] ?? 0);
    expect(cols).toEqual([["tech"], ["learning", "events"], ["ops", "studio"]]);
  });

  it("fills the first row left to right, and never makes an empty column", () => {
    expect(placeInColumns(["a", "b"], 2, () => 10)).toEqual([["a"], ["b"]]);
    expect(placeInColumns(["a"], 0, () => 10)).toEqual([["a"]]);
  });
});
