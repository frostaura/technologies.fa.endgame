import type { DemoStep, ScriptStep, StepScript } from "../content/scripts.ts";
import type { Op } from "./protocol.ts";

/**
 * Turns "the learner is now on step n" into the ops the embedded console must receive. Moving on
 * by one step plays just that step. Jumping, going back, or "Show me again" resets the console and
 * replays every earlier step's navigation and actions quickly (without spotlights), then plays the
 * target step in full, so the frame is always in the state the step's text describes.
 */

export interface PlannedOp {
  op: Op;
  args: Record<string, unknown>;
  /** Part of catching up to the target step, rather than the step itself. */
  catchUp: boolean;
}

export function stepOf(script: StepScript | undefined, n: number): ScriptStep | undefined {
  return script?.steps.find((s) => s.step === n);
}

function demoSteps(script: StepScript, upTo: number): DemoStep[] {
  return script.steps.filter((s): s is DemoStep => s.kind === "demo" && s.step <= upTo).sort((a, b) => a.step - b.step);
}

function opsFor(script: StepScript, s: DemoStep, catchUp: boolean): PlannedOp[] {
  const ops: PlannedOp[] = [];
  const who = { persona: script.persona, scenario: script.scenario };
  if (s.goto) ops.push({ op: "goto", args: { route: s.goto, ...who }, catchUp });
  if (s.clock) ops.push({ op: "clock", args: { ...s.clock }, catchUp });
  if (!catchUp && s.highlight) ops.push({ op: "highlight", args: { ...s.highlight }, catchUp });
  if (s.act) ops.push({ op: "act", args: { actions: s.act, ...(catchUp ? { instant: true } : {}) }, catchUp });
  return ops;
}

/**
 * @param from the step the console is showing now (0: nothing played yet)
 * @param to the step to show
 * @param replay force a reset and replay even when moving on by one
 */
export function plan(script: StepScript, from: number, to: number, replay = false): PlannedOp[] {
  const who = { persona: script.persona, scenario: script.scenario };
  const target = stepOf(script, to);
  const forwardByOne = !replay && from > 0 && to === from + 1;
  if (forwardByOne) {
    if (target?.kind !== "demo") return [];
    return opsFor(script, target, false);
  }
  const ops: PlannedOp[] = [
    { op: "reset", args: {}, catchUp: true },
    { op: "goto", args: { route: script.start, ...who }, catchUp: true },
  ];
  for (const s of demoSteps(script, to - 1)) ops.push(...opsFor(script, s, true));
  if (target?.kind === "demo") ops.push(...opsFor(script, target, false));
  return ops;
}

/** The ops for opening a screen with no script: the flow's own "Starts at" address. */
export function planExplore(route: string): PlannedOp[] {
  return [
    { op: "reset", args: {}, catchUp: true },
    { op: "goto", args: { route, persona: "owner", scenario: "established" }, catchUp: false },
  ];
}
