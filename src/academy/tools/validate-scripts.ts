import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import type { Flow } from "../src/content/types.ts";
import type { StepScript } from "../src/content/scripts.ts";

/**
 * Validates every `scripts/<FLOW-ID>.json` against the JSON Schema and against the parsed flows:
 * the flow exists, each step number is one of its steps, no step is scripted twice, and every
 * image named is on disk under `public/shots/`.
 */

export interface Coverage {
  flows: number;
  flowsWithScript: number;
  steps: number;
  stepsWithMedia: number;
  byKind: Record<string, number>;
  scripted: string[];
  /** Branches of "What else can happen" shown live. */
  variations: number;
}

export interface ScriptReport {
  scripts: Record<string, StepScript>;
  problems: string[];
  coverage: Coverage;
}

const root = path.resolve(import.meta.dirname, "..");
export const schemaPath = path.join(root, "schema/step-script.schema.json");

export function compileSchema() {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  return ajv.compile<StepScript>(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
}

export function validateScripts(flows: Flow[], scriptsDir = path.join(root, "scripts"), shotsDir = path.join(root, "public/shots")): ScriptReport {
  const validate = compileSchema();
  const byId = new Map(flows.map((f) => [f.id, f]));
  const problems: string[] = [];
  const scripts: Record<string, StepScript> = {};
  const files = existsSync(scriptsDir) ? readdirSync(scriptsDir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(scriptsDir, file), "utf8"));
    } catch (e) {
      problems.push(`${file}: not valid JSON (${(e as Error).message})`);
      continue;
    }
    if (!validate(data)) {
      for (const err of validate.errors ?? []) problems.push(`${file}: ${err.instancePath || "/"} ${err.message ?? "is invalid"}`);
      continue;
    }
    const script = data;
    const flow = byId.get(id);
    if (!flow) {
      problems.push(`${file}: no flow ${id} in docs/flows`);
      continue;
    }
    if (script.flow !== id) problems.push(`${file}: "flow" says ${script.flow} but the file is ${id}`);
    const seen = new Set<number>();
    for (const step of script.steps) {
      if (step.step > flow.steps.length) problems.push(`${file}: step ${step.step} does not exist; ${id} has ${flow.steps.length} steps`);
      if (seen.has(step.step)) problems.push(`${file}: step ${step.step} is scripted twice`);
      seen.add(step.step);
      if (step.kind === "demo" && step.shot && !existsSync(path.join(shotsDir, step.shot.file))) problems.push(`${file}: step ${step.step} names public/shots/${step.shot.file}, which does not exist`);
      if (step.kind === "image" && !existsSync(path.join(shotsDir, step.file))) problems.push(`${file}: step ${step.step} names public/shots/${step.file}, which does not exist`);
      if (step.kind === "demo" && !step.goto && !step.highlight && !step.act && !step.clock) problems.push(`${file}: step ${step.step} is a demo step that sends the console nothing`);
    }
    for (const [i, v] of (script.variations ?? []).entries()) {
      const where = `${file}: variation ${i + 1} ("${v.title}")`;
      v.steps.forEach((step, j) => {
        if (step.step !== j + 1) problems.push(`${where}: its steps are numbered from 1 in order; step ${j + 1} says ${step.step}`);
        if (step.kind === "demo" && !step.goto && !step.highlight && !step.act && !step.clock) problems.push(`${where}: step ${step.step} sends the console nothing`);
        if (step.kind === "demo" && !step.note && !step.highlight?.note) problems.push(`${where}: step ${step.step} says nothing; a variation's step is read from its note`);
        if (step.kind === "demo" && step.shot && !existsSync(path.join(shotsDir, step.shot.file))) problems.push(`${where}: step ${step.step} names public/shots/${step.shot.file}, which does not exist`);
        if (step.kind === "image" && !existsSync(path.join(shotsDir, step.file))) problems.push(`${where}: step ${step.step} names public/shots/${step.file}, which does not exist`);
      });
    }
    scripts[id] = script;
  }
  const byKind: Record<string, number> = {};
  let stepsWithMedia = 0;
  for (const s of Object.values(scripts))
    for (const step of s.steps) {
      byKind[step.kind] = (byKind[step.kind] ?? 0) + 1;
      stepsWithMedia++;
    }
  return {
    scripts,
    problems,
    coverage: {
      flows: flows.length,
      flowsWithScript: Object.keys(scripts).length,
      steps: flows.reduce((n, f) => n + f.steps.length, 0),
      stepsWithMedia,
      byKind,
      scripted: Object.keys(scripts),
      variations: Object.values(scripts).reduce((n, s) => n + (s.variations?.length ?? 0), 0),
    },
  };
}
