import contentJson from "../generated/content.json";
import scriptsJson from "../generated/scripts.json";
import siteJson from "../generated/site.json";
import indexJson from "../generated/search-index.json";
import type { Content, Flow, Level, Reach, Role } from "../content/types.ts";
import type { StepScript } from "../content/scripts.ts";
import { loadIndex, search as runSearch, type Hit } from "../content/search.ts";

/**
 * Everything the site knows, built from docs/flows by `tools/build-content.ts` and bundled, so the
 * academy makes no request beyond its own files and still works from file://.
 */

export const content = contentJson as unknown as Content;
export const scripts = scriptsJson as unknown as Record<string, StepScript>;
export const site = siteJson as {
  siteUrl: string;
  qr: { size: number; path: string };
  coverage: { flows: number; flowsWithScript: number; steps: number; stepsWithMedia: number; byKind: Record<string, number>; variations: number; scripted: string[] };
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
