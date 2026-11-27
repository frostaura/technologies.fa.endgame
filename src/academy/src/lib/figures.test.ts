import { describe, expect, it } from "vitest";
import { CLIENT_LEVELS } from "../content/types.ts";
import { clientFlows, figures, operatorFlows, pathFlows, track } from "./data.ts";

describe("the academy's figures", () => {
  it("are counted once, from the flows the four paths teach, with the handbook apart", () => {
    const onPaths = new Set(CLIENT_LEVELS.flatMap((l) => track(l)?.flows ?? []));
    expect(figures.flows).toBe(onPaths.size);
    expect(figures.flows).toBe(pathFlows.length);
    expect(figures.steps).toBe(pathFlows.reduce((n, f) => n + f.steps.length, 0));
    expect(figures.flows + figures.reference).toBe(clientFlows.length);
    expect(figures.operatorFlows).toBe(operatorFlows.length);
    expect(pathFlows.some((f) => f.level === "Operator")).toBe(false);
  });
});
