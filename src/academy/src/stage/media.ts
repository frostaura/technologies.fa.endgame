import type { Flow } from "../content/types.ts";
import type { CodeStep, StepScript } from "../content/scripts.ts";
import { stepOf } from "../bridge/player.ts";

/** What shows beside a step: its scripted media, the live console, or the flow's facts. */
export type Media = "demo" | "terminal" | "request" | "email" | "image" | "code" | "facts";

export function mediaOf(flow: Flow, script: StepScript | undefined, n: number): Media {
  const s = stepOf(script, n);
  if (s) return s.kind;
  if (script?.steps.some((x) => x.kind === "demo")) return "demo";
  if (!script && flow.reach === "screen" && flow.startRoute) return "demo";
  return "facts";
}

/** The name of each language a code step can be in. */
export const LANGUAGE: Record<CodeStep["language"], string> = {
  csharp: "C#",
  typescript: "TypeScript",
  tsx: "TypeScript (React)",
  javascript: "JavaScript",
  json: "JSON",
  http: "HTTP",
  bash: "Shell",
  sql: "SQL",
  yaml: "YAML",
  text: "Text",
};

/** The frame bar's words for a code step. */
export const codeAddress = (step: CodeStep) => `code · ${LANGUAGE[step.language]}`;
