import { describe, expect, it } from "vitest";
import { variationScript, type StepScript } from "../content/scripts.ts";
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

  it("moving on by one plays only that step, in the order goto, clock, act, highlight", () => {
    expect(ops(plan(script, 1, 2))).toEqual(["act", "highlight"]);
    expect(ops(plan(script, 3, 4))).toEqual(["goto", "clock", "highlight"]);
  });

  it("a step with no spotlight of its own clears the one before, ring and note", () => {
    const p = plan(script, 3, 4);
    expect(p.at(-1)).toEqual({ op: "highlight", args: {}, catchUp: false });
  });

  it("a step with no demo media only clears the ring of the step before when moving on by one", () => {
    expect(plan(script, 2, 3)).toEqual([{ op: "highlight", args: {}, catchUp: false }]);
  });

  it("a step the script leaves out clears the ring too, so no step shows another's", () => {
    expect(plan(script, 4, 5)).toEqual([{ op: "highlight", args: {}, catchUp: false }]);
    expect(ops(plan(script, 0, 5)).at(-1)).toBe("highlight");
  });

  it("jumping resets and replays earlier steps instantly, without their spotlights", () => {
    const p = plan(script, 0, 4);
    expect(ops(p)).toEqual(["reset", "goto", "act", "goto", "clock", "highlight"]);
    expect(p.find((o) => o.op === "act")?.args).toMatchObject({ instant: true });
    expect(p.filter((o) => !o.catchUp).map((o) => o.op)).toEqual(["goto", "clock", "highlight"]);
  });

  it("show me again replays even when moving on by one", () => {
    expect(ops(plan(script, 1, 2, true))).toEqual(["reset", "goto", "act", "highlight"]);
  });

  it("a step can hand the same world to someone else, who stays signed in for the steps after it", () => {
    const handover: StepScript = {
      flow: "OP-07",
      persona: "operator",
      scenario: "god-mode",
      start: "/operator",
      steps: [
        { step: 1, kind: "demo", highlight: { text: "Deepest overdraft" } },
        { step: 2, kind: "demo", goto: "/operator-access", persona: "owner", highlight: { text: "Operator access" } },
        { step: 3, kind: "demo", goto: "/credits" },
      ],
    };
    expect(plan(handover, 1, 2)[0]?.args).toEqual({ route: "/operator-access", persona: "owner", scenario: "god-mode" });
    expect(plan(handover, 2, 3)[0]?.args).toEqual({ route: "/credits", persona: "owner", scenario: "god-mode" });
    const jump = plan(handover, 0, 3);
    expect(jump[1]?.args).toMatchObject({ persona: "operator" });
    expect(jump.filter((o) => o.op === "goto").map((o) => o.args.persona)).toEqual(["operator", "owner", "owner"]);
  });

  it("an unscripted screen flow opens on its own start address", () => {
    expect(planExplore("/credits").map((o) => [o.op, o.args.route])).toEqual([["reset", undefined], ["goto", "/credits"]]);
  });

  it("plays a branch from \"What else can happen\" from its own start, as its own person and world", () => {
    const withBranch: StepScript = {
      ...script,
      variations: [{ title: "A stranger is refused", persona: "signed-out", scenario: "established", start: "/sign-in", steps: [{ step: 1, kind: "demo", act: [{ click: { text: "Create passkey" } }], highlight: { text: "invite-only", note: "Refused." } }] }],
    };
    const branch = variationScript(withBranch, 0);
    expect(branch?.scenario).toBe("established");
    expect(variationScript(withBranch, 1)).toBeUndefined();
    const p = plan(branch as StepScript, 0, 1, true);
    expect(ops(p)).toEqual(["reset", "goto", "act", "highlight"]);
    expect(p[1]?.args).toEqual({ route: "/sign-in", persona: "signed-out", scenario: "established" });
  });
});
