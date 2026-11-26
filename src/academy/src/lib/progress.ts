import { useSyncExternalStore } from "react";
import { content, flow } from "./data.ts";
import { createProgressStore, type Snapshot } from "../progress/store.ts";
import { streak, type Progress } from "../progress/model.ts";
import type { Catalogue } from "../progress/derive.ts";

/**
 * The academy's one progress store, on this device's localStorage, read synchronously before the
 * first paint so nothing that shows progress shifts the page when it appears. Nothing leaves the
 * device.
 */

export const catalogue: Catalogue = { tracks: content.tracks, flow };

const resolve = (id: string) => {
  const f = flow(id);
  return f ? { id: f.id, steps: f.steps.length } : undefined;
};

export const progressStore = createProgressStore({ storage: () => window.localStorage, resolve });

// Another tab of the academy moved on: follow it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key.startsWith("endgame-academy:progress")) progressStore.reload();
  });
}

export function useProgressSnapshot(): Snapshot {
  return useSyncExternalStore(progressStore.subscribe, progressStore.get, progressStore.get);
}

export function useProgress(): Progress {
  return useProgressSnapshot().progress;
}

/** Not started, seen or done: what a flow's row shows. */
export type State = "seen" | "done";

export function stateOf(p: Progress, id: string): State | undefined {
  const f = p.flows[id];
  return f ? (f.done ? "done" : "seen") : undefined;
}

/** Days in a row up to today, from the stored days. */
export function streakNow(days: string[]): number {
  return streak(days, Date.now());
}
