/**
 * Step scripts: `src/academy/scripts/<FLOW-ID>.json`, one per flow, saying what each numbered step
 * shows beside its text. The JSON Schema is `schema/step-script.schema.json`; these types are its
 * TypeScript twin and `tools/validate-scripts.ts` holds the two together at build.
 */

/** Who the embedded console is signed in as. */
export const PERSONAS = ["owner", "admin", "builder", "viewer", "operator", "signed-out", "end-user", "assistant", "host-admin", "division-admin", "invited", "first-run", "two-organisations"] as const;
export type Persona = (typeof PERSONAS)[number];

/**
 * The mock worlds the demo can load. Each is a named, fixed dataset on the demo's side; routes in a
 * script may name its records as `{idea}`, `{run}`, `{app}`, `{employee}` and `{hire}`, which the
 * demo resolves inside the scenario.
 */
export const SCENARIOS = [
  "fresh-install", "first-idea", "established", "researching", "verdict-build", "verdict-change", "building", "app-live", "low-credits", "god-mode", "account", "two-organisations", "app-asleep", "app-paused", "app-crashed", "at-overdraft-limit", "s1-app-made-private", "s1-app-not-published", "s1-app-private", "s1-app-public", "s1-app-unshared", "s1-development-apps", "s1-development-sign-in", "s1-keys-at-limit", "s1-session-check-fails", "default", "quiet", "empty-organisation", "research-running", "research-verdict", "verdict-do-not-build", "verdict-red-line", "build-running", "build-plan", "build-sent-back", "build-security-finding", "build-published", "build-waiting-on-plan", "build-failed", "app-busy", "app-never-measured", "employee-memory", "hire-pending", "budget-spent", "manage-tree", "employee-released", "screening-offline", "ask-unavailable", "app-private", "app-public", "app-shared-empty", "app-restore-fails", "app-rebuild-fails", "app-not-published", "app-wake-slow", "app-wake-busy", "app-unreachable", "outage", "no-secrets", "dashboard-full", "app-long-history", "wake-failures",
] as const;
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

/** `seek` is script milliseconds, or a named moment such as `build:published` (ARCH-009). */
export type ClockOp = { play: true } | { pause: true } | { seek: number | string };

export interface DemoStep {
  step: number;
  kind: "demo";
  /** Navigate first. */
  goto?: string;
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

/** Code the step is about ("the app calls X"), shown like the terminal, with what it prints or returns. */
export interface CodeStep {
  step: number;
  kind: "code";
  language: "csharp" | "typescript" | "tsx" | "javascript" | "json" | "http" | "bash" | "sql" | "yaml" | "text";
  code: string;
  /** What running it prints or returns, line for line. */
  output?: string[];
  note?: string;
}

export type ScriptStep = DemoStep | TerminalStep | RequestStep | EmailStep | ImageStep | CodeStep;
export type ScriptKind = ScriptStep["kind"];

export interface StepScript {
  $schema?: string;
  flow: string;
  persona: Persona;
  scenario: Scenario;
  /** The console address the frame opens at before step 1. */
  start: string;
  steps: ScriptStep[];
  /** What else can happen: refusals and branches, each played from its own start (shown under the steps). */
  variations?: Variation[];
}

/** One branch of a flow, played on its own: its steps are numbered 1, 2, … within it. */
export interface Variation {
  /** The branch in a few words, as the learner picks it. */
  title: string;
  persona: Persona;
  scenario: Scenario;
  start: string;
  steps: ScriptStep[];
}

/** A variation as a script of its own, so the stage and the player play it like any flow. */
export function variationScript(script: StepScript, index: number): StepScript | undefined {
  const v = script.variations?.[index];
  return v ? { flow: script.flow, persona: v.persona, scenario: v.scenario, start: v.start, steps: v.steps } : undefined;
}
