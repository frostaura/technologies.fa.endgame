/**
 * The learner's progress, as plain data and pure functions over it. The site is static and has no
 * accounts, so this lives on the device (see `store.ts`); nothing here touches storage or the DOM,
 * so every rule can be proved in a unit test.
 *
 * Keyed by flow id, so it survives content updates: a flow whose step count changed is clamped to
 * it, and a flow that no longer exists is dropped without a word.
 */

export const KEY = "endgame-academy:progress:v2";
/** The first version kept only "seen" or "done" per flow and the last step; it is read once and moved on. */
export const LEGACY_KEY = "endgame-academy:progress:v1";
/** A progress code starts with this, so a pasted code from somewhere else is told apart at once. */
export const CODE_PREFIX = "EGA2.";
/** Days of activity kept for the streak: a little over a year. */
const DAYS_KEPT = 400;

export interface FlowProgress {
  /** The step last shown. */
  step: number;
  /** The furthest step shown. */
  furthest: number;
  done: boolean;
  /** Epoch milliseconds; 0 when it is not known (progress carried from the first version). */
  started: number;
  seen: number;
  doneAt: number;
}

export interface Progress {
  v: 2;
  flows: Record<string, FlowProgress>;
  last: { flow: string; step: number; at: number } | null;
  /** The local calendar days ("2026-11-26") on which a step was shown, oldest first. */
  days: string[];
}

/** What a flow id means today: its own id (an old alias is answered by its flow) and how many steps it has. */
export type Resolve = (id: string) => { id: string; steps: number } | undefined;

export const empty = (): Progress => ({ v: 2, flows: {}, last: null, days: [] });

/** A local calendar day, so a streak follows the learner's own midnight. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.round(n), lo), hi);

function mergeFlow(a: FlowProgress, b: FlowProgress): FlowProgress {
  const later = b.seen > a.seen ? b : a;
  const done = a.done || b.done;
  const doneAts = [a, b].filter((x) => x.done && x.doneAt > 0).map((x) => x.doneAt);
  const starts = [a.started, b.started].filter((x) => x > 0);
  return {
    step: later.step,
    furthest: Math.max(a.furthest, b.furthest),
    done,
    started: starts.length ? Math.min(...starts) : 0,
    seen: Math.max(a.seen, b.seen),
    doneAt: done ? (doneAts.length ? Math.min(...doneAts) : 0) : 0,
  };
}

function sortedDays(days: Iterable<unknown>): string[] {
  const set = new Set<string>();
  for (const d of days) if (typeof d === "string" && DAY.test(d)) set.add(d);
  return [...set].sort().slice(-DAYS_KEPT);
}

/**
 * Anything read back — from storage, a file, a code — made into progress for today's content. It
 * never throws: what cannot be read is left out.
 */
export function normalize(raw: unknown, resolve: Resolve): Progress {
  const out = empty();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const flows = r.flows && typeof r.flows === "object" ? (r.flows as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(flows)) {
    const known = resolve(key);
    if (!known || known.steps < 1 || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const furthest = clamp(num(v.furthest, num(v.step, 1)), 1, known.steps);
    const done = v.done === true;
    const entry: FlowProgress = {
      step: clamp(num(v.step, 1), 1, known.steps),
      furthest,
      done,
      started: Math.max(0, num(v.started)),
      seen: Math.max(0, num(v.seen)),
      doneAt: done ? Math.max(0, num(v.doneAt)) : 0,
    };
    const had = out.flows[known.id];
    out.flows[known.id] = had ? mergeFlow(had, entry) : entry;
  }
  const last = r.last && typeof r.last === "object" ? (r.last as Record<string, unknown>) : null;
  const lastKnown = last && typeof last.flow === "string" ? resolve(last.flow) : undefined;
  if (last && lastKnown && lastKnown.steps > 0) out.last = { flow: lastKnown.id, step: clamp(num(last.step, 1), 1, lastKnown.steps), at: Math.max(0, num(last.at)) };
  out.days = sortedDays(Array.isArray(r.days) ? r.days : []);
  return out;
}

/** The first version's record (`{ flows: { ID: "seen" | "done" }, last }`), carried forward. Its dates are not known. */
export function migrateLegacy(raw: unknown, resolve: Resolve): Progress {
  if (!raw || typeof raw !== "object") return empty();
  const r = raw as { flows?: Record<string, unknown>; last?: { flow?: unknown; step?: unknown } | null };
  const flows: Record<string, unknown> = {};
  const lastFlow = typeof r.last?.flow === "string" ? resolve(r.last.flow)?.id : undefined;
  for (const [id, state] of Object.entries(r.flows ?? {})) {
    const known = resolve(id);
    if (!known || (state !== "seen" && state !== "done")) continue;
    const at = lastFlow === known.id ? num(r.last?.step, 1) : 1;
    flows[known.id] = state === "done" ? { step: at, furthest: known.steps, done: true } : { step: at, furthest: at, done: false };
  }
  return normalize({ flows, last: lastFlow ? { flow: lastFlow, step: r.last?.step, at: 0 } : null, days: [] }, resolve);
}

/**
 * A step was shown for a moment: it is seen, it is where the learner left off, today counts toward
 * the streak, and reaching the last step makes the flow done.
 */
export function view(p: Progress, flow: string, step: number, steps: number, now: number): Progress {
  if (steps < 1) return p;
  const n = clamp(step, 1, steps);
  const was = p.flows[flow];
  const furthest = Math.max(was?.furthest ?? 0, n);
  const doneNow = !was?.done && n === steps;
  const entry: FlowProgress = {
    step: n,
    furthest,
    done: !!was?.done || n === steps,
    started: was?.started || now,
    seen: now,
    doneAt: was?.done ? was.doneAt : doneNow ? now : 0,
  };
  return { ...p, flows: { ...p.flows, [flow]: entry }, last: { flow, step: n, at: now }, days: sortedDays([...p.days, localDay(now)]) };
}

/** "Mark as done", or taking it back. Taking it back keeps how far the learner had read. */
export function setDone(p: Progress, flow: string, done: boolean, now: number): Progress {
  const was = p.flows[flow];
  if (!!was?.done === done) return p;
  const entry: FlowProgress = was
    ? { ...was, done, doneAt: done ? now : 0, seen: now }
    : { step: 1, furthest: 1, done, started: now, seen: now, doneAt: now };
  return { ...p, flows: { ...p.flows, [flow]: entry }, days: sortedDays([...p.days, localDay(now)]) };
}

/** Two records of the same learner — this device and an imported one — as one: the furthest of each, the newest place. */
export function merge(a: Progress, b: Progress): Progress {
  const flows: Record<string, FlowProgress> = { ...a.flows };
  for (const [id, f] of Object.entries(b.flows)) flows[id] = flows[id] ? mergeFlow(flows[id], f) : f;
  const last = !a.last ? b.last : !b.last ? a.last : b.last.at > a.last.at ? b.last : a.last;
  return { v: 2, flows, last, days: sortedDays([...a.days, ...b.days]) };
}

/** Where opening a flow should land: the step the learner left it on, unless they finished it or never got past the first. */
export function resumeStep(p: Progress, flow: string): number | null {
  const f = p.flows[flow];
  if (!f || f.done || f.step <= 1) return null;
  return f.step;
}

/**
 * Days in a row with a step shown, ending today — or yesterday, since today is not over. Only what
 * the stored days prove: a gap of a day ends the run.
 */
export function streak(days: string[], now: number): number {
  const set = new Set(days);
  const at = new Date(now);
  at.setHours(12, 0, 0, 0);
  if (!set.has(localDay(at.getTime()))) at.setDate(at.getDate() - 1);
  let n = 0;
  while (set.has(localDay(at.getTime()))) {
    n += 1;
    at.setDate(at.getDate() - 1);
  }
  return n;
}

/* ------------------------------------------------------------ moving between devices */

type Compact = { f: Record<string, [number, number, 0 | 1, number, number, number]>; l: [string, number, number] | null; d: string[] };

const toSec = (ms: number) => Math.round(ms / 1000);

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The progress as a short code, to paste on another device. */
export function encode(p: Progress): string {
  const c: Compact = {
    f: Object.fromEntries(Object.entries(p.flows).map(([id, f]) => [id, [f.step, f.furthest, f.done ? 1 : 0, toSec(f.started), toSec(f.seen), toSec(f.doneAt)]])),
    l: p.last ? [p.last.flow, p.last.step, toSec(p.last.at)] : null,
    d: p.days,
  };
  return CODE_PREFIX + base64url(JSON.stringify(c));
}

/** The progress as a file's contents: readable, and marked so an import can tell it apart. */
export function toFile(p: Progress, now: number): string {
  return `${JSON.stringify({ kind: "endgame-academy-progress", exported: new Date(now).toISOString(), ...p }, null, 2)}\n`;
}

/**
 * A pasted code or a file's text back into progress, or null when it is neither. Read as raw data
 * and then normalised, so a code from an older academy still lands on today's flows.
 */
export function parseImport(text: string, resolve: Resolve): Progress | null {
  const t = text.trim();
  try {
    if (t.startsWith(CODE_PREFIX)) {
      const c = JSON.parse(unbase64url(t.slice(CODE_PREFIX.length).replace(/\s+/g, ""))) as Partial<Compact>;
      if (!c || typeof c !== "object" || !c.f || typeof c.f !== "object") return null;
      const flows = Object.fromEntries(
        Object.entries(c.f).map(([id, a]) => [id, Array.isArray(a) ? { step: a[0], furthest: a[1], done: a[2] === 1, started: num(a[3]) * 1000, seen: num(a[4]) * 1000, doneAt: num(a[5]) * 1000 } : null]),
      );
      const last = Array.isArray(c.l) ? { flow: c.l[0], step: c.l[1], at: num(c.l[2]) * 1000 } : null;
      return normalize({ flows, last, days: c.d ?? [] }, resolve);
    }
    const v = JSON.parse(t) as Record<string, unknown>;
    if (!v || typeof v !== "object" || v.kind !== "endgame-academy-progress") return null;
    return normalize(v, resolve);
  } catch {
    return null;
  }
}
