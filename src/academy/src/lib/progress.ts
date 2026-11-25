import { useSyncExternalStore } from "react";

/**
 * Progress, per flow: not started, seen or done, plus where the learner last was. Kept in this
 * browser only; every read and write survives storage being unavailable (private windows,
 * blocked site data), and the academy works the same without it.
 */

export type State = "seen" | "done";
interface Store {
  flows: Record<string, State>;
  last: { flow: string; step: number } | null;
}

const KEY = "endgame-academy:progress:v1";
const listeners = new Set<() => void>();
let cache: Store | null = null;

function read(): Store {
  if (cache) return cache;
  let parsed: Store = { flows: {}, last: null };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Store>;
      parsed = { flows: v.flows && typeof v.flows === "object" ? v.flows : {}, last: v.last ?? null };
    }
  } catch {
    // Storage unavailable: progress lives for this visit only.
  }
  cache = parsed;
  return parsed;
}

function write(next: Store) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: keep it in memory.
  }
  listeners.forEach((l) => l());
}

export function useProgress(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}

export function markSeen(flow: string, step: number) {
  const s = read();
  const state = s.flows[flow] === "done" ? "done" : "seen";
  if (s.flows[flow] === state && s.last?.flow === flow && s.last.step === step) return;
  write({ flows: { ...s.flows, [flow]: state }, last: { flow, step } });
}

export function markDone(flow: string, done = true) {
  const s = read();
  const flows = { ...s.flows };
  if (done) flows[flow] = "done";
  else flows[flow] = "seen";
  write({ ...s, flows });
}

export function resetProgress() {
  write({ flows: {}, last: null });
}
