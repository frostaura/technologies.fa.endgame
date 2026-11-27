import { describe, expect, it } from "vitest";
import { seek, tick, clock } from "../server/engine";
import { answerApproval } from "../server/routes/work";
import { buildWorld, scenarioNamed } from "./scenarios";
import { S3 } from "./scenarios.s3";
import { IDS } from "./default";
import type { World } from "../server/world";

/** The factory's scenarios (docs/flows/03 and TALK) each show what their flow's "What else can happen" names. */

const world = (scenario: string): World => {
  const built = buildWorld(scenario, "owner");
  const target = built.scenarios.find((s) => s.seek !== undefined)?.seek;
  if (typeof target === "string") seek(built.world, target, (w, id) => answerApproval(w, id, "approve", "test"));
  return built.world;
};
const run = (w: World, id: string) => w.runs.find((r) => r.run.id === id);
const said = (w: World, id: string, title: string) => run(w, id)?.events.find((e) => e.payload.title === title)?.payload.text;
const play = (w: World, ms: number) => {
  clock.playing = true;
  for (let t = 0; t < ms; t += 250) tick(w, 250);
};

describe("the factory's scenarios", () => {
  it("registers every one", () => {
    for (const name of ["s3-research-failed", "s3-research-cancelled", "s3-checkpoints", "s3-start-checkpoint", "s3-waiting-for-budget", "s3-checkpoints-waiting-for-budget", "s3-budget-runs-out", "s3-change-running", "s3-change-failed", "s3-stage-rules", "s3-suggestions", "s3-employee-paused"])
      expect(scenarioNamed(name), name).toBeDefined();
  });

  it("research that does not reach a verdict fails, and is offered again", () => {
    const w = world("s3-research-failed");
    expect(run(w, IDS.runResearchTides)?.run).toMatchObject({ status: "failed" });
    expect(said(w, IDS.runResearchTides, "Stopped")).toMatch(/^The research could not reach a verdict in the agreed form/);
  });

  it("waits for budget in auto-mode, and asks first with the start checkpoint", () => {
    const budget = world("s3-waiting-for-budget");
    play(budget, 2000);
    expect(run(budget, IDS.runResearchTides)?.run.status).toBe("paused");
    expect(said(budget, IDS.runResearchTides, "Waiting for budget")).toMatch(/^This work is estimated at 12 credits, more than the 5 left in its budget/);
    const start = world("s3-start-checkpoint");
    play(start, 2000);
    expect(start.approvals.find((a) => a.runId === IDS.runResearchTides)?.title).toBe("Start this work? Estimated 12 credits.");
  });

  it("waits for budget in checkpoints mode too, and asks nothing until the estimate fits", () => {
    const w = world("s3-checkpoints-waiting-for-budget");
    play(w, 2000);
    expect(run(w, IDS.runResearchTides)?.run.status).toBe("paused");
    expect(said(w, IDS.runResearchTides, "Waiting for budget")).toMatch(/^This work is estimated at 12 credits, more than the 5 left in its budget/);
    expect(w.approvals.filter((a) => a.runId === IDS.runResearchTides)).toHaveLength(0);
  });

  it("stops a build when the budget runs out part-way, keeping what was finished", () => {
    const w = world("s3-budget-runs-out");
    seek(w, "build:finished", (x, id) => answerApproval(x, id, "approve", "test"));
    const r = run(w, IDS.runBuildReadingList);
    expect(r?.run).toMatchObject({ status: "failed", budgetExhausted: true });
    expect(r?.events.some((e) => e.payload.code === "budget_exhausted")).toBe(true);
  });

  it("plays a change of Court booking, and a change that fails after its repairs", () => {
    const w = world("s3-change-running");
    seek(w, "change:finished", () => undefined);
    expect(run(w, S3.runChange)?.run.status).toBe("finished");
    const failed = world("s3-change-failed");
    expect(run(failed, S3.runChange)?.run.status).toBe("failed");
    expect(said(failed, S3.runChange, "Stopped")).toMatch(/still did not work after 3 rounds of repair, each on a stronger model, so the app was not changed/);
  });

  it("says who refused what: a rule that never asked, and the owner who declined what they were asked (R6-1)", () => {
    const built = buildWorld("s3-stage-rules", "owner");
    seek(built.world, "build:finished", (x, id) => answerApproval(x, id, "reject", "Not now."));
    const denied = run(built.world, IDS.runBuildReadingList)?.events.filter((e) => e.type === "tool.denied") ?? [];
    expect(denied.find((e) => e.payload.by === "rule")?.payload).toMatchObject({ declined: null });
    expect(denied.find((e) => e.payload.by === "owner")?.payload).toMatchObject({ declined: "change part of the app" });
  });

  it("asks before the rule-bound file changes, and refuses the one denied", () => {
    const w = world("s3-stage-rules");
    seek(w, "build:finished", (x, id) => answerApproval(x, id, "approve", "test"));
    const r = run(w, IDS.runBuildReadingList);
    expect(w.approvals.some((a) => a.runId === IDS.runBuildReadingList && a.title === "Let the agent change part of the app?")).toBe(true);
    expect(r?.events.find((e) => e.type === "tool.denied")?.payload.reason).toBe("Denied by the build rule set set at northwind/learning ('edit_file(docs/decisions.md)').");
  });

  it("holds live work at the overdraft limit without failing it, and draws no project for an idea not yet built", () => {
    const w = world("at-overdraft-limit");
    expect(run(w, IDS.runBuildReadingList)?.run.status).toBe("paused");
    expect(run(w, IDS.runResearchTides)?.run.status).toBe("paused");
    const quiet = world("default");
    expect(quiet.nodes.some((n) => n.ideaId === IDS.ideaAllergen || n.ideaId === IDS.ideaTides)).toBe(false);
  });
});
