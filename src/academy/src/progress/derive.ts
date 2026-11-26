import type { Flow, Level, Track } from "../content/types.ts";
import type { Progress } from "./model.ts";

/**
 * What the progress means against the content: counts per path, what to learn next, the badges and
 * milestones. Derived on every render, never stored, so a content update or an import can never
 * leave a badge that the record no longer proves.
 */

export interface Catalogue {
  tracks: Track[];
  flow: (id: string) => Flow | undefined;
}

export const isDone = (p: Progress, id: string) => p.flows[id]?.done === true;

export interface TrackStats {
  level: Level;
  done: number;
  total: number;
  /** Flows opened and not finished. */
  started: number;
  complete: boolean;
  /** When the last of its flows was finished (0 if unknown or incomplete). */
  completedAt: number;
}

export function trackStats(p: Progress, track: Track): TrackStats {
  const ids = track.flows;
  const done = ids.filter((id) => isDone(p, id));
  const complete = ids.length > 0 && done.length === ids.length;
  return {
    level: track.level,
    done: done.length,
    total: ids.length,
    started: ids.filter((id) => p.flows[id] && !p.flows[id]?.done).length,
    complete,
    completedAt: complete ? Math.max(...done.map((id) => p.flows[id]?.doneAt ?? 0)) : 0,
  };
}

export interface Next {
  flow: Flow;
  /** Set when `flow` is a "Learn first" of this one, which is next in the path. */
  before?: Flow;
}

/** The deepest prerequisite of `f` that is not done yet, or undefined when all are done. */
function pendingPrerequisite(f: Flow, p: Progress, cat: Catalogue, operator: boolean, seen = new Set<string>()): Flow | undefined {
  seen.add(f.id);
  for (const id of f.learnFirst) {
    const pre = cat.flow(id);
    if (!pre || seen.has(pre.id) || isDone(p, pre.id) || !pre.steps.length) continue;
    if ((pre.level === "Operator") !== operator) continue;
    return pendingPrerequisite(pre, p, cat, operator, seen) ?? pre;
  }
  return undefined;
}

/**
 * What to learn next on a path: the next flow not done in the path's order — after `after`, when
 * given, then from the top — with any "Learn first" it still lacks put ahead of it.
 */
export function nextUp(p: Progress, track: Track | undefined, cat: Catalogue, after?: string): Next | undefined {
  if (!track) return undefined;
  const ids = track.flows;
  const from = after ? ids.indexOf(after) + 1 : 0;
  const order = [...ids.slice(from), ...ids.slice(0, from)];
  const operator = track.level === "Operator";
  for (const id of order) {
    if (id === after || isDone(p, id)) continue;
    const f = cat.flow(id);
    if (!f) continue;
    const pre = pendingPrerequisite(f, p, cat, operator);
    return pre ? { flow: pre, before: f } : { flow: f };
  }
  return undefined;
}

/** The one thing to do next across the client paths: carry on in the path last read, else the first path not finished. */
export function overallNext(p: Progress, cat: Catalogue, clientLevels: readonly Level[]): Next | undefined {
  const lastFlow = p.last ? cat.flow(p.last.flow) : undefined;
  const lastLevel = lastFlow?.level && clientLevels.includes(lastFlow.level) ? lastFlow.level : undefined;
  const order = lastLevel ? [lastLevel, ...clientLevels.filter((l) => l !== lastLevel)] : clientLevels;
  for (const level of order) {
    const n = nextUp(p, cat.tracks.find((t) => t.level === level), cat, level === lastLevel ? lastFlow?.id : undefined);
    if (n) return n;
  }
  return undefined;
}

export interface Milestone {
  id: string;
  title: string;
  /** How it is earned, said plainly. */
  detail: string;
  earned: boolean;
  /** When it was earned (0 if unknown). */
  at: number;
  /** For one not yet earned: what is left, in words. */
  toGo: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The client milestones: the first flow, ten, twenty-five, fifty and a hundred flows (each only
 * where the academy has that many), the first whole path, and every path.
 */
export function milestones(p: Progress, cat: Catalogue, clientLevels: readonly Level[]): Milestone[] {
  const client = cat.tracks.filter((t) => clientLevels.includes(t.level));
  const pool = new Set(client.flatMap((t) => t.flows));
  const doneAts = [...pool].filter((id) => isDone(p, id)).map((id) => p.flows[id]?.doneAt ?? 0).sort((a, b) => a - b);
  const out: Milestone[] = [];
  const counts: [number, string][] = [[1, "First flow"], [10, "Ten flows"], [25, "Twenty-five flows"], [50, "Fifty flows"], [100, "A hundred flows"]];
  for (const [n, title] of counts) {
    if (n > pool.size) continue;
    const earned = doneAts.length >= n;
    out.push({ id: `flows-${n}`, title, detail: n === 1 ? "Finish your first flow." : `Finish ${n} flows.`, earned, at: earned ? (doneAts[n - 1] ?? 0) : 0, toGo: earned ? "" : `${plural(n - doneAts.length, "flow")} to go` });
  }
  const stats = client.map((t) => trackStats(p, t));
  const complete = stats.filter((s) => s.complete).sort((a, b) => a.completedAt - b.completedAt);
  const closest = stats.filter((s) => !s.complete && s.total).sort((a, b) => a.total - a.done - (b.total - b.done))[0];
  out.push({
    id: "path-1",
    title: "A whole path",
    detail: "Finish every flow on one path.",
    earned: complete.length > 0,
    at: complete[0]?.completedAt ?? 0,
    toGo: complete.length || !closest ? "" : `${plural(closest.total - closest.done, "flow")} to go on ${closest.level}`,
  });
  const all = stats.every((s) => s.complete);
  out.push({
    id: "path-all",
    title: "Every path",
    detail: `Finish all ${pool.size} client flows.`,
    earned: all,
    at: all ? Math.max(...stats.map((s) => s.completedAt)) : 0,
    toGo: all ? "" : `${plural(pool.size - doneAts.length, "flow")} to go`,
  });
  return out;
}
