import contentJson from "../generated/content.json";
import scriptsJson from "../generated/scripts.json";
import siteJson from "../generated/site.json";
import indexJson from "../generated/search-index.json";
import shotsJson from "../generated/shots.json";
import printsJson from "../generated/prints.json";
import { CLIENT_LEVELS, type Content, type Flow, type Level, type Reach, type Role } from "../content/types.ts";
import type { StepScript } from "../content/scripts.ts";
import { loadIndex, search as runSearch, type Hit } from "../content/search.ts";

/**
 * Everything the site knows, built from docs/flows by `tools/build-content.ts` and bundled, so the
 * academy makes no request beyond its own files and still works from file://.
 */

export const content = contentJson as unknown as Content;
export const scripts = scriptsJson as unknown as Record<string, StepScript>;

/** Captured images (`make academy-shots`): "<FLOW-ID>/<step>" or "<FLOW-ID>/v<n>" → a file under ./shots/. */
export const shots = shotsJson as Record<string, string>;

/** The image of a step: the script's own `shot`, or the one captured for it. */
export function shotFor(flowId: string, key: number | string): string | undefined {
  return shots[`${flowId}/${key}`];
}
/** A step's print picture: a detail around what it rings, or the whole screen (`make academy-shots`). */
const prints = printsJson as Record<string, { file: string; whole: boolean }>;
export function printFor(flowId: string, key: number | string): { file: string; whole: boolean } | undefined {
  return prints[`${flowId}/${key}`];
}

export const site = siteJson as {
  siteUrl: string;
  qr: { size: number; path: string };
  coverage: { flows: number; flowsWithScript: number; steps: number; stepsWithMedia: number; byKind: Record<string, number>; scripted: string[]; variations: number };
  builtFrom: string[];
};

const byId = new Map<string, Flow>();
for (const f of content.flows) {
  byId.set(f.id, f);
  for (const a of f.aliases) byId.set(a, f);
}

export function flow(id: string): Flow | undefined {
  return byId.get(id.toUpperCase());
}

export function isOperator(f: Flow): boolean {
  return f.level === "Operator";
}

/** What client-facing navigation shows: everything but the operator handbook. */
export const clientFlows = content.flows.filter((f) => !isOperator(f));
export const operatorFlows = content.flows.filter(isOperator);

const stepsOf = (flows: Flow[]) => flows.reduce((n, f) => n + f.steps.length, 0);

/**
 * The flows the four client paths teach — what progress is counted against, and what "flows" means
 * wherever the academy gives a figure. A handful of reference entries sit outside every path (a
 * behaviour with no steps of its own); they are browsable, and counted apart as `reference`.
 */
export const pathFlows: Flow[] = [...new Set(content.tracks.filter((t) => CLIENT_LEVELS.includes(t.level)).flatMap((t) => t.flows))].flatMap((id) => byId.get(id) ?? []);

/**
 * The academy's headline figures, counted once and shown the same on every page: the cover, your
 * progress and About all read these. The operator handbook is counted apart, and never mixed in.
 */
export const figures = {
  flows: pathFlows.length,
  steps: stepsOf(pathFlows),
  reference: clientFlows.length - pathFlows.length,
  areas: content.areas.length,
  paths: CLIENT_LEVELS.length,
  operatorFlows: operatorFlows.length,
  operatorSteps: stepsOf(operatorFlows),
} as const;

export function track(level: Level) {
  return content.tracks.find((t) => t.level === level);
}

export function area(id: string) {
  return content.areas.find((a) => a.id === id);
}

export function flowsForRole(role: Role, operator = false): Flow[] {
  return (operator ? operatorFlows : clientFlows).filter((f) => f.roles.includes(role));
}

export function flowsForReach(reach: Reach, operator = false): Flow[] {
  return (operator ? operatorFlows : clientFlows).filter((f) => f.reach === reach);
}

/** The flow after this one on its path, if any. */
export function nextInPath(f: Flow): Flow | undefined {
  if (!f.level) return undefined;
  const ids = track(f.level)?.flows ?? [];
  const at = ids.indexOf(f.id);
  return at >= 0 && at + 1 < ids.length ? flow(ids[at + 1] ?? "") : undefined;
}

let index: ReturnType<typeof loadIndex> | null = null;

export function searchFlows(query: string, scope: "client" | "operator" | "all" = "client", limit = 12): (Hit & { flow: Flow })[] {
  index ??= loadIndex(indexJson as unknown as Parameters<typeof loadIndex>[0]);
  const allow = (id: string) => {
    const f = byId.get(id);
    if (!f) return false;
    return scope === "all" || (scope === "operator" ? isOperator(f) : !isOperator(f));
  };
  return runSearch(index, query, allow, limit).flatMap((h) => {
    const f = byId.get(h.id);
    return f ? [{ ...h, flow: f }] : [];
  });
}
