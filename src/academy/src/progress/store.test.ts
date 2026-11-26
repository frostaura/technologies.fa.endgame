import { describe, expect, it, vi } from "vitest";
import { createProgressStore } from "./store.ts";
import { KEY, LEGACY_KEY, encode, view, empty, type Resolve } from "./model.ts";

const resolve: Resolve = (id) => ({ "ID-01": 7, "ID-02": 4 } as Record<string, number>)[id] !== undefined ? { id, steps: ({ "ID-01": 7, "ID-02": 4 } as Record<string, number>)[id] ?? 0 } : undefined;

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("the progress store", () => {
  it("keeps what it is told in storage, under a versioned key, and tells its listeners", () => {
    const s = memory();
    const store = createProgressStore({ storage: () => s, resolve, now: () => 1000 });
    const heard = vi.fn();
    store.subscribe(heard);
    store.view("ID-01", 3, 7);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.data.get(KEY) ?? "{}").flows["ID-01"].step).toBe(3);
    expect(store.get().persistent).toBe(true);
    // A second store on the same storage reads it back.
    expect(createProgressStore({ storage: () => s, resolve }).get().progress.last).toEqual({ flow: "ID-01", step: 3, at: 1000 });
  });

  it("moves the first version's record to the new key", () => {
    const s = memory({ [LEGACY_KEY]: JSON.stringify({ flows: { "ID-02": "done" }, last: null }) });
    const store = createProgressStore({ storage: () => s, resolve });
    expect(store.get().progress.flows["ID-02"]?.done).toBe(true);
    expect(s.data.has(LEGACY_KEY)).toBe(false);
    expect(s.data.has(KEY)).toBe(true);
  });

  it("with no storage at all (a private window), keeps progress in memory and says so", () => {
    const store = createProgressStore({
      storage: () => {
        throw new Error("SecurityError");
      },
      resolve,
    });
    store.view("ID-01", 2, 7);
    expect(store.get().progress.flows["ID-01"]?.step).toBe(2);
    expect(store.get().persistent).toBe(false);
  });

  it("with storage that refuses to write, keeps progress in memory and says so", () => {
    const s = { ...memory(), setItem: () => {
      throw new Error("QuotaExceededError");
    } };
    const store = createProgressStore({ storage: () => s, resolve });
    expect(store.get().persistent).toBe(false);
    store.view("ID-01", 2, 7);
    expect(store.get().progress.flows["ID-01"]?.step).toBe(2);
  });

  it("a write that starts failing mid-visit drops to memory without losing what was there", () => {
    const s = memory();
    let full = false;
    const store = createProgressStore({ storage: () => ({ ...s, setItem: (k: string, v: string) => (full ? (() => { throw new Error("full"); })() : s.setItem(k, v)) }), resolve });
    store.view("ID-01", 2, 7);
    full = true;
    store.view("ID-01", 3, 7);
    expect(store.get().persistent).toBe(false);
    expect(store.get().progress.flows["ID-01"]?.step).toBe(3);
  });

  it("an unreadable record starts again rather than failing the page", () => {
    const store = createProgressStore({ storage: () => memory({ [KEY]: "{not json" }), resolve });
    expect(store.get().progress).toEqual(empty());
  });

  it("resets to nothing, in storage too", () => {
    const s = memory();
    const store = createProgressStore({ storage: () => s, resolve });
    store.view("ID-01", 2, 7);
    store.reset();
    expect(store.get().progress).toEqual(empty());
    expect(JSON.parse(s.data.get(KEY) ?? "null")).toEqual(empty());
  });

  it("imports a code merged with what is here, and refuses what is not a code", () => {
    const store = createProgressStore({ storage: () => memory(), resolve, now: () => 5 });
    store.view("ID-01", 2, 7);
    expect(store.importText(encode(view(empty(), "ID-02", 4, 4, 9000)))).toBe(1);
    expect(store.get().progress.flows["ID-02"]?.done).toBe(true);
    expect(store.get().progress.flows["ID-01"]?.step).toBe(2);
    expect(store.importText("not a code")).toBeNull();
  });

  it("follows another tab: reload reads storage again", () => {
    const s = memory();
    const store = createProgressStore({ storage: () => s, resolve });
    createProgressStore({ storage: () => s, resolve }).view("ID-02", 3, 4);
    expect(store.get().progress.flows["ID-02"]).toBeUndefined();
    store.reload();
    expect(store.get().progress.flows["ID-02"]?.step).toBe(3);
  });
});
