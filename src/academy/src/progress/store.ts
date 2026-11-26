import { KEY, LEGACY_KEY, empty, merge, migrateLegacy, normalize, parseImport, setDone, view, type Progress, type Resolve } from "./model.ts";

/**
 * The progress kept on this device. Every access to storage is guarded: where the browser will not
 * keep it (a private window, blocked site data, a full quota) progress lives in memory for the
 * visit, and `persistent` says so, so the page can say so quietly.
 */

export interface Snapshot {
  progress: Progress;
  /** False when this browser is not letting the academy keep progress past this visit. */
  persistent: boolean;
}

export interface ProgressStore {
  get(): Snapshot;
  subscribe(listener: () => void): () => void;
  view(flow: string, step: number, steps: number): void;
  setDone(flow: string, done: boolean): void;
  reset(): void;
  /** Brings in a code or a file's text, merged with what is here. Returns how many flows it carried, or null when it is not progress. */
  importText(text: string): number | null;
  /** Reads storage again (another tab changed it). */
  reload(): void;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function createProgressStore({ storage, resolve, now = Date.now }: { storage: () => Storage | null; resolve: Resolve; now?: () => number }): ProgressStore {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { progress: empty(), persistent: false };

  const store = (): Storage | null => {
    try {
      return storage();
    } catch {
      return null;
    }
  };

  function load(): Snapshot {
    const s = store();
    if (!s) return { progress: empty(), persistent: false };
    try {
      // Writable at all? A private window can read and refuse to write.
      s.setItem(`${KEY}:probe`, "1");
      s.removeItem(`${KEY}:probe`);
    } catch {
      return { progress: snapshot.progress, persistent: false };
    }
    try {
      const raw = s.getItem(KEY);
      if (raw) return { progress: normalize(JSON.parse(raw), resolve), persistent: true };
      const legacy = s.getItem(LEGACY_KEY);
      if (legacy) {
        const progress = migrateLegacy(JSON.parse(legacy), resolve);
        s.setItem(KEY, JSON.stringify(progress));
        s.removeItem(LEGACY_KEY);
        return { progress, persistent: true };
      }
    } catch {
      // Unreadable: start again rather than fail the page.
    }
    return { progress: empty(), persistent: true };
  }

  function commit(progress: Progress) {
    if (progress === snapshot.progress) return;
    let persistent = snapshot.persistent;
    if (persistent) {
      try {
        store()?.setItem(KEY, JSON.stringify(progress));
      } catch {
        persistent = false;
      }
    }
    snapshot = { progress, persistent };
    listeners.forEach((l) => l());
  }

  snapshot = load();

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    view: (flow, step, steps) => commit(view(snapshot.progress, flow, step, steps, now())),
    setDone: (flow, done) => commit(setDone(snapshot.progress, flow, done, now())),
    reset() {
      commit(empty());
      try {
        store()?.removeItem(LEGACY_KEY);
      } catch {
        // Nothing to clear.
      }
    },
    importText(text) {
      const incoming = parseImport(text, resolve);
      if (!incoming) return null;
      commit(merge(snapshot.progress, incoming));
      return Object.keys(incoming.flows).length;
    },
    reload() {
      const next = load();
      snapshot = next;
      listeners.forEach((l) => l());
    },
  };
}
