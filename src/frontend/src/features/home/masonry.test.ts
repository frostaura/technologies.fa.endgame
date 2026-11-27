import { describe, expect, it } from "vitest";
import { balancedLayout, placeInColumns, raggedness } from "./masonry";

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

describe("balancedLayout", () => {
  it("gives up a column when that closes a hole under the shortest (three divisions, the middle one tall)", () => {
    // Technologies short, Learning tall, Operations middling: three columns leave a 580 px hole under Technologies.
    const heights: Record<string, number> = { tech: 300, learning: 880, ops: 560 };
    expect(balancedLayout(Object.keys(heights), 3, (k) => heights[k] ?? 0, 24)).toEqual({ count: 2, tallFirst: false });
  });

  it("places the tallest first when the reading order would strand one column far below the other", () => {
    const heights: Record<string, number> = { tech: 350, learning: 560, ops: 690 };
    expect(balancedLayout(Object.keys(heights), 2, (k) => heights[k] ?? 0, 24)).toEqual({ count: 2, tallFirst: true });
  });

  it("keeps every column and the reading order when the columns already end nearly level", () => {
    const heights: Record<string, number> = { a: 400, b: 420, c: 390 };
    expect(balancedLayout(Object.keys(heights), 3, (k) => heights[k] ?? 0, 24)).toEqual({ count: 3, tallFirst: false });
  });

  it("never drops to one column where two fit", () => {
    const heights: Record<string, number> = { a: 1000, b: 100 };
    expect(balancedLayout(Object.keys(heights), 2, (k) => heights[k] ?? 0, 24).count).toBe(2);
  });

  it("measures raggedness as the tallest foot above the mean", () => {
    expect(raggedness([300, 880, 560])).toBeCloseTo(300);
    expect(raggedness([])).toBe(0);
  });
});
