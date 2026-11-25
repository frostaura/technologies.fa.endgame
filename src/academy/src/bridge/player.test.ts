import { describe, expect, it } from "vitest";
import type { StepScript } from "../content/scripts.ts";
import { plan, planExplore } from "./player.ts";

const script: StepScript = {
  flow: "ID-01",
  persona: "signed-out",
  scenario: "fresh-install",
  start: "/sign-in",
  steps: [
    { step: 1, kind: "demo", highlight: { text: "Sign in" } },
    { step: 2, kind: "demo", act: [{ click: { text: "First time here? Create your passkey" } }], highlight: { text: "Create your passkey" } },
    { step: 3, kind: "terminal", command: "make up", output: [] },
    { step: 4, kind: "demo", goto: "/", clock: { seek: 15000 } },
  ],
};

const ops = (p: ReturnType<typeof plan>) => p.map((o) => o.op);

describe("the step player", () => {
  it("opens the start screen as the script's persona and scenario, then plays step 1", () => {
    const p = plan(script, 0, 1);
    expect(ops(p)).toEqual(["reset", "goto", "highlight"]);
    expect(p[1]?.args).toEqual({ route: "/sign-in", persona: "signed-out", scenario: "fresh-install" });
  });

  it("moving on by one plays only that step, in the order goto, clock, highlight, act", () => {
    expect(ops(plan(script, 1, 2))).toEqual(["highlight", "act"]);
    expect(ops(plan(script, 3, 4))).toEqual(["goto", "clock"]);
  });

  it("a step with no demo media sends the console nothing when moving on by one", () => {
    expect(plan(script, 2, 3)).toEqual([]);
  });

  it("jumping resets and replays earlier steps instantly, without their spotlights", () => {
    const p = plan(script, 0, 4);
    expect(ops(p)).toEqual(["reset", "goto", "act", "goto", "clock"]);
    expect(p.find((o) => o.op === "act")?.args).toMatchObject({ instant: true });
    expect(p.filter((o) => !o.catchUp).map((o) => o.op)).toEqual(["goto", "clock"]);
  });

  it("show me again replays even when moving on by one", () => {
    expect(ops(plan(script, 1, 2, true))).toEqual(["reset", "goto", "highlight", "act"]);
  });

  it("an unscripted screen flow opens on its own start address", () => {
    expect(planExplore("/credits").map((o) => [o.op, o.args.route])).toEqual([["reset", undefined], ["goto", "/credits"]]);
  });
});
