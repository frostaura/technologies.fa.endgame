import type { DemoStep, ScriptStep, StepScript } from "../content/scripts.ts";
import type { Op } from "./protocol.ts";

/**
 * Turns "the learner is now on step n" into the ops the embedded console must receive, in the
 * order goto, clock, act, highlight: the demo performs the action with visible motion, then the
 * spotlight lands on what the step asks the learner to look at. Moving on
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

/** Who is signed in at step n: the script's persona, or the last one a step up to n switched to. */
export function personaAt(script: StepScript, n: number): StepScript["persona"] {
  let who = script.persona;
  for (const s of demoSteps(script, n)) if (s.persona) who = s.persona;
  return who;
}

function opsFor(script: StepScript, s: DemoStep, catchUp: boolean): PlannedOp[] {
  const ops: PlannedOp[] = [];
  const who = { persona: personaAt(script, s.step), scenario: script.scenario };
  if (s.goto) ops.push({ op: "goto", args: { route: s.goto, ...who }, catchUp });
  if (s.clock) ops.push({ op: "clock", args: { ...s.clock }, catchUp });
  if (s.act) ops.push({ op: "act", args: { actions: s.act, ...(catchUp ? { instant: true } : {}) }, catchUp });
  // A step with no spotlight of its own clears the one before: its ring and note name another step.
  if (!catchUp) ops.push({ op: "highlight", args: s.highlight ? { ...s.highlight } : {}, catchUp });
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
  // A step with no console play of its own (a request, a step the script leaves out) still clears
  // the ring of the step before: it names what that step showed, not this one.
  const clear: PlannedOp = { op: "highlight", args: {}, catchUp: false };
  if (forwardByOne) {
    if (target?.kind !== "demo") return [clear];
    return opsFor(script, target, false);
  }
  const ops: PlannedOp[] = [
    { op: "reset", args: {}, catchUp: true },
    { op: "goto", args: { route: script.start, ...who }, catchUp: true },
  ];
  for (const s of demoSteps(script, to - 1)) ops.push(...opsFor(script, s, true));
  if (target?.kind === "demo") ops.push(...opsFor(script, target, false));
  else ops.push(clear);
  return ops;
}

/** The ops for opening a screen with no script: the flow's own "Starts at" address. */
export function planExplore(route: string): PlannedOp[] {
  return [
    { op: "reset", args: {}, catchUp: true },
    { op: "goto", args: { route, persona: "owner", scenario: "established" }, catchUp: false },
  ];
}
