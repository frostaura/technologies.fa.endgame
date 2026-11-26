import type { RunEvent, RunStatus } from "@/store/types";
import { charge, newId, runRecord, type DemoApproval, type DemoRun, type World } from "./world";

/**
 * Runs that play. Each live run follows a script — a list of steps at script times — rebuilt from
 * its name and parameters whenever it is needed, so only the playback position is saved. A clock
 * moves script time forward; the academy can play, pause, change the speed or jump to a named
 * moment. An approval stops its run until someone answers; pause, resume and cancel work as on
 * the live stack.
 */

export interface Step {
  /** Script milliseconds after the run started. */
  at: number;
  event?: { type: string; payload: Record<string, unknown> };
  /** A change to the world at this moment; returns the tags it invalidates. */
  effect?: (world: World, run: DemoRun) => unknown;
  /** A named moment the academy can jump to, e.g. `build:published`. */
  mark?: string;
  /** Stop here until the approval is answered. */
  approval?: Omit<DemoApproval, "id" | "runId" | "answer">;
  /** An approval decided when the step is reached, from the world as it is then (a rule or a checkpoint set meanwhile); null asks nothing. */
  ask?: (world: World, run: DemoRun) => Omit<DemoApproval, "id" | "runId" | "answer"> | null;
}

export type ScriptBuilder = (world: World, run: DemoRun) => Step[];

const scripts = new Map<string, ScriptBuilder>();

export function defineScript(name: string, build: ScriptBuilder) {
  scripts.set(name, build);
}

const built = new WeakMap<World, Map<string, { key: string; steps: Step[] }>>();

/** A run's steps, built once per world, script and parameters (a script is deterministic in them). */
export function stepsOf(world: World, run: DemoRun): Step[] {
  const build = run.playback ? scripts.get(run.playback.script) : undefined;
  if (!build || !run.playback) return [];
  const key = `${run.playback.script}:${JSON.stringify(run.playback.params)}`;
  let cache = built.get(world);
  if (!cache) {
    cache = new Map();
    built.set(world, cache);
  }
  const hit = cache.get(run.run.id);
  if (hit?.key === key) return hit.steps;
  const steps = build(world, run);
  cache.set(run.run.id, { key, steps });
  return steps;
}

/** A little builder for scripts: `s.wait(800).event(...)`. */
export class Script {
  steps: Step[] = [];
  t = 0;
  wait(ms: number) {
    this.t += ms;
    return this;
  }
  event(type: string, payload: Record<string, unknown>, mark?: string) {
    this.steps.push({ at: this.t, event: { type, payload }, ...(mark ? { mark } : {}) });
    return this;
  }
  effect(fn: NonNullable<Step["effect"]>, mark?: string) {
    this.steps.push({ at: this.t, effect: fn, ...(mark ? { mark } : {}) });
    return this;
  }
  mark(name: string) {
    this.steps.push({ at: this.t, mark: name });
    return this;
  }
  approval(a: NonNullable<Step["approval"]>, mark?: string) {
    this.steps.push({ at: this.t, approval: a, ...(mark ? { mark } : {}) });
    return this;
  }
  ask(fn: NonNullable<Step["ask"]>, mark?: string) {
    this.steps.push({ at: this.t, ask: fn, ...(mark ? { mark } : {}) });
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// Streams: what the console's EventSource reads
// ---------------------------------------------------------------------------------------------

type Listener = (event: RunEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function listen(runId: string, fn: Listener): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

function publish(runId: string, event: RunEvent) {
  for (const fn of listeners.get(runId) ?? []) fn(event);
}

// ---------------------------------------------------------------------------------------------
// Writing to a run
// ---------------------------------------------------------------------------------------------

export function append(world: World, r: DemoRun, type: string, payload: Record<string, unknown>): RunEvent {
  const event: RunEvent = { seq: r.events.length + 1, type, at: new Date().toISOString(), payload };
  r.events.push(event);
  r.run.lastSeq = event.seq;
  const status = r.run.status;
  switch (type) {
    case "run.started":
    case "run.resumed":
      r.run.status = "running";
      break;
    case "run.paused":
      r.run.status = "paused";
      break;
    case "model.replied": {
      const credits = typeof payload.settledCredits === "number" ? payload.settledCredits : 0;
      if (payload.billable !== false) {
        r.run.spentCredits += credits;
        charge(world, String(payload.scope ?? r.run.scope), credits);
        const employeeId = typeof payload.employeeId === "string" ? payload.employeeId : null;
        const tr = employeeId ? world.trackRecords.find((t) => t.employeeId === employeeId) : undefined;
        if (tr) {
          tr.cost.monthCredits += credits;
          tr.cost.toDateCredits += credits;
        }
      } else {
        const org = r.run.scope.split("/")[0] ?? "";
        const nc = (world.notCharged[org] ??= { credits: 0, repairs: 0 });
        nc.credits += credits;
      }
      break;
    }
    case "run.finished": {
      const outcome = String(payload.outcome ?? "succeeded");
      r.run.status = (outcome === "failed" ? "failed" : outcome === "cancelled" ? "cancelled" : "finished") as RunStatus;
      r.run.outcome = outcome;
      r.run.summary = typeof payload.summary === "string" ? payload.summary : r.run.summary;
      r.run.finishedAt = event.at;
      r.ended = r.playback ?? r.ended ?? null;
      r.playback = null;
      for (const e of world.employees) if (e.currentRun?.id === r.run.id) settle(world, e.id, r.run.id);
      break;
    }
    default:
      break;
  }
  if (status !== r.run.status) world.changed.push("Run", "Tree");
  publish(r.run.id, event);
  return event;
}

/** An employee finishes its part of a run: idle again, the run is its last. */
export function settle(world: World, employeeId: string, runId: string) {
  const e = world.employees.find((x) => x.id === employeeId);
  if (!e) return;
  e.currentRun = null;
  e.lastRunId = runId;
  e.lastActiveAt = new Date().toISOString();
  if (e.status === "working") e.status = e.kind === "contractor" ? "released" : "idle";
  world.changed.push("Tree", "Employee");
}

// ---------------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------------

export interface ClockState {
  playing: boolean;
  speed: number;
}

export const clock: ClockState = { playing: true, speed: 1 };

function blocked(world: World, r: DemoRun): boolean {
  return world.approvals.some((a) => a.runId === r.run.id && a.answer === null);
}

/** Apply one step; false when it stopped the run for an approval. */
function apply(world: World, r: DemoRun, step: Step): boolean {
  if (step.event) append(world, r, step.event.type, step.event.payload);
  if (step.effect) {
    const tags = step.effect(world, r);
    if (Array.isArray(tags)) world.changed.push(...tags.map(String));
  }
  const approval = step.approval ?? (r.playback ? step.ask?.(world, r) : null) ?? null;
  if (approval) {
    const id = newId(world, "approval");
    world.approvals.push({ id, runId: r.run.id, answer: null, ...approval });
    append(world, r, "approval.requested", { approvalId: id, title: approval.title, question: approval.title, detail: approval.detail, ...(approval.technical ? { technical: approval.technical } : {}), onDecline: approval.onDecline ?? "continues" });
    r.run.status = "waiting";
    world.changed.push("Tree", "Run", "Notifications");
    return false;
  }
  return true;
}

/** Move one run forward by script milliseconds. */
export function advance(world: World, r: DemoRun, ms: number) {
  const pb = r.playback;
  if (!pb || r.run.status === "paused" || blocked(world, r)) return;
  if (r.run.status === "queued") r.run.status = "running";
  pb.elapsed += ms;
  const steps = stepsOf(world, r);
  while (r.playback && pb.cursor < steps.length) {
    const step = steps[pb.cursor];
    if (!step || step.at > pb.elapsed) break;
    pb.cursor += 1;
    if (!apply(world, r, step)) break;
    // A step that paused the run (waiting for budget) stops it here until it is resumed.
    if ((r.run.status as string) === "paused") break;
  }
}

/** Every live run moves forward by real milliseconds at the clock's speed. */
export function tick(world: World, realMs: number) {
  if (!clock.playing) return;
  for (const r of world.runs) if (r.playback) advance(world, r, realMs * clock.speed);
}

/** Every named moment in the live runs, for the academy. */
export function moments(world: World): { runId: string; mark: string; reached: boolean }[] {
  const out: { runId: string; mark: string; reached: boolean }[] = [];
  for (const r of world.runs) {
    if (!r.playback) continue;
    const steps = stepsOf(world, r);
    steps.forEach((s, i) => s.mark && out.push({ runId: r.run.id, mark: s.mark, reached: i < (r.playback?.cursor ?? 0) }));
  }
  return out;
}

/**
 * Jump a run to a named moment: every step before it happens at once, approvals on the way are
 * approved. Returns false when no live run has that moment.
 */
export function seek(world: World, mark: string, answer: (world: World, approvalId: string) => void): boolean {
  const candidates = world.runs.filter((r) => r.playback && stepsOf(world, r).some((s) => s.mark === mark));
  const r = candidates[candidates.length - 1];
  if (!r?.playback) return false;
  for (let guard = 0; guard < 2000 && r.playback; guard += 1) {
    const steps = stepsOf(world, r);
    const target = steps.findIndex((s) => s.mark === mark);
    if (target < 0 || r.playback.cursor > target) return true;
    const pending = world.approvals.find((a) => a.runId === r.run.id && a.answer === null);
    if (pending) {
      answer(world, pending.id);
      continue;
    }
    if (r.run.status === "paused") append(world, r, "run.resumed", { by: "demo" });
    const step = steps[r.playback.cursor];
    if (!step) return true;
    r.playback.elapsed = Math.max(r.playback.elapsed, step.at);
    r.playback.cursor += 1;
    apply(world, r, step);
  }
  return true;
}

export function liveRun(world: World, runId: string): DemoRun | undefined {
  return runRecord(world, runId);
}
