import type { Flow } from "../content/types.ts";
import type { StepScript } from "../content/scripts.ts";
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
