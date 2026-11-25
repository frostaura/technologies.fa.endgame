/**
 * Step scripts: `src/academy/scripts/<FLOW-ID>.json`, one per flow, saying what each numbered step
 * shows beside its text. The JSON Schema is `schema/step-script.schema.json`; these types are its
 * TypeScript twin and `tools/validate-scripts.ts` holds the two together at build.
 */

/** Who the embedded console is signed in as. */
export const PERSONAS = ["owner", "admin", "builder", "viewer", "operator", "signed-out", "end-user", "assistant", "host-admin", "division-admin"] as const;
export type Persona = (typeof PERSONAS)[number];

/**
 * The mock worlds the demo can load. Each is a named, fixed dataset on the demo's side; routes in a
 * script may name its records as `{idea}`, `{run}`, `{app}`, `{employee}` and `{hire}`, which the
 * demo resolves inside the scenario.
 */
export const SCENARIOS = ["fresh-install", "first-idea", "established", "researching", "verdict-build", "verdict-change", "building", "app-live", "low-credits", "god-mode", "quiet", "hire-pending", "employee-memory", "employee-released", "at-overdraft-limit", "screening-offline", "hiring", "hires-all-decided", "hire-manager-gone", "contractor-working", "contractor-finishes", "employee-working", "employee-record", "employee-team", "employee-at-cap", "idle-sweep", "released-with-memory", "memory-to-tidy", "credits-at-zero", "below-zero", "top-ups-waiting", "operator-log", "operator-log-empty", "build-running"] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** Where a spotlight lands: a CSS selector, a `data-testid`, or the visible text of a control. */
export interface Target {
  selector?: string;
  testId?: string;
  text?: string;
}

export type Action =
  | { click: Target }
  | { type: { into: Target; text: string } }
  | { select: { into: Target; value: string } }
  | { press: string }
  | { wait: number }
  | { clock: ClockOp };

export type ClockOp = { play: true } | { pause: true } | { seek: number };

export interface DemoStep {
  step: number;
  kind: "demo";
  /** Navigate first. */
  goto?: string;
  /** From this step on, someone else is signed in to the same world; needs a `goto`. */
  persona?: Persona;
  /** Spotlight a control, with an optional callout. */
  highlight?: Target & { note?: string };
  /** Perform these, in order, with visible motion. */
  act?: Action[];
  /** Move the demo's clock (live progress, timers). */
  clock?: ClockOp;
  /** The caption shown under the frame. */
  note?: string;
  /** A captured image of this step: shown in print, and whenever the live console cannot load. */
  shot?: { file: string; alt: string };
}

export interface TerminalStep {
  step: number;
  kind: "terminal";
  /** The working directory shown in the prompt. */
  cwd?: string;
  command: string;
  /** What the command prints, line for line. */
  output: string[];
  note?: string;
}

export interface RequestStep {
  step: number;
  kind: "request";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  response: { status: number; body?: unknown };
  note?: string;
}

export interface EmailStep {
  step: number;
  kind: "email";
  from: string;
  to: string;
  subject: string;
  /** Paragraphs of the message body. */
  body: string[];
  note?: string;
}

export interface ImageStep {
  step: number;
  kind: "image";
  /** A file under `src/academy/public/shots/`. */
  file: string;
  alt: string;
  note?: string;
}

export type ScriptStep = DemoStep | TerminalStep | RequestStep | EmailStep | ImageStep;
export type ScriptKind = ScriptStep["kind"];

/**
 * One branch of "What else can happen" — a refusal, a limit, an empty state — played in its own
 * console. Its steps are numbered 1, 2, 3 in order; the flow has no text for them, so each says what
 * it shows in its `note` or its spotlight's note.
 */
export interface Variation {
  title: string;
  persona: Persona;
  scenario: Scenario;
  start: string;
  steps: ScriptStep[];
}

export interface StepScript {
  $schema?: string;
  flow: string;
  persona: Persona;
  scenario: Scenario;
  /** The console address the frame opens at before step 1. */
  start: string;
  steps: ScriptStep[];
  variations?: Variation[];
}

/** A variation as a script of its own, so the player plays it exactly as it plays a flow. */
export function variationScript(flow: string, v: Variation): StepScript {
  return { flow, persona: v.persona, scenario: v.scenario, start: v.start, steps: v.steps };
}

/** What a step says beside the console: its note, or its spotlight's note. */
export function stepCaption(step: ScriptStep | undefined): string | undefined {
  return step?.note ?? (step?.kind === "demo" ? step.highlight?.note : undefined);
}
