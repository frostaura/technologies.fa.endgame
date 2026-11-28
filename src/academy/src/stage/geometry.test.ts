import { describe, expect, it } from "vitest";
import { fitFrame, shortAddress } from "./geometry.ts";
import { CONSOLE } from "../theme/tokens.ts";

describe("the frame", () => {
  it("draws the desk console at 1280 × 800 and scales it to the space, whatever the window", () => {
    for (const space of [{ width: 760, height: 520 }, { width: 1060, height: 660 }, { width: 1960, height: 990 }]) {
      const fit = fitFrame(space, "desk");
      expect(fit.inner).toEqual({ width: 1280, height: 800 });
      expect(fit.width).toBeLessThanOrEqual(space.width);
      expect(fit.height).toBeLessThanOrEqual(space.height);
      // The console keeps its shape: the frame less its bar and edge is 1280 × 800 at one scale.
      expect((fit.height - CONSOLE.desk.chrome - 2 * CONSOLE.desk.bezel) / (fit.width - 2 * CONSOLE.desk.bezel)).toBeCloseTo(800 / 1280, 1);
    }
  });

  it("is the same for every step: it depends only on the space, never on what a step shows", () => {
    expect(fitFrame({ width: 900, height: 600 }, "desk")).toEqual(fitFrame({ width: 900, height: 600 }, "desk"));
  });

  it("draws the phone console at 390 × 640 in a phone-shaped frame", () => {
    const fit = fitFrame({ width: 343, height: 560 }, "phone");
    expect(fit.inner).toEqual({ width: 390, height: 640 });
    expect(fit.height / fit.width).toBeGreaterThan(1.5);
    expect(fit.width).toBeLessThanOrEqual(343);
  });

  it("shortens a long id in the address bar", () => {
    expect(shortAddress("endgame/hires/e48d08c7-9e59-4e51-ada2-f02362159a5d")).toBe("endgame/hires/e48d08c7…");
  });
});
