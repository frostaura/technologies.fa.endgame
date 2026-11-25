/**
 * The academy ⇄ demo contract. The academy drives the embedded console ONLY through these
 * messages; lane D's demo implements the other side, and `test-double/demo/` is its stand-in.
 *
 * Envelope: `{ source, id, op, args? }`. The academy sends with source "endgame-academy"; the demo
 * answers with source "endgame-demo", echoing the request's `id`. An `act` is answered when it has
 * finished, by `step-done {id}` (or an echo); a failure is answered by an echo whose op is "error".
 */

export const ACADEMY = "endgame-academy";
export const DEMO = "endgame-demo";

export type Op = "goto" | "highlight" | "act" | "clock" | "reset";
export type DemoEvent = "ready" | "route" | "step-done" | "error";

export interface Envelope {
  source: typeof ACADEMY | typeof DEMO;
  id: string;
  op: string;
  args?: Record<string, unknown>;
}

export function isEnvelope(data: unknown): data is Envelope {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (d.source === ACADEMY || d.source === DEMO) && typeof d.id === "string" && typeof d.op === "string" && (d.args === undefined || (typeof d.args === "object" && d.args !== null));
}
