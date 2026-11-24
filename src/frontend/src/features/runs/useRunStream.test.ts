import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStore } from "@/store";
import { FakeEventSource } from "@/test/harness";
import { followRun, parseEvent } from "./useRunStream";

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseEvent", () => {
  it("reads the body, falling back to the id line for the sequence number", () => {
    expect(parseEvent('{"type":"message","payload":{"text":"hi"}}', "7", "message")).toMatchObject({ seq: 7, type: "message", payload: { text: "hi" } });
    expect(parseEvent('{"seq":3}', "", "task.done")).toMatchObject({ seq: 3, type: "task.done", payload: {} });
    expect(parseEvent("not json", "1", "message")).toBeNull();
    expect(parseEvent("{}", "", "message")).toBeNull();
  });
});

describe("followRun", () => {
  it("stores events, and on a dropped connection resumes after the last sequence held", () => {
    const store = makeStore();
    const stop = followRun("r1", store.dispatch, store.getState);
    const first = FakeEventSource.latest();
    expect(first.url).toContain("/api/runs/r1/events?after=0");
    first.open();
    first.emit(1, "run.started");
    first.emit(2, "task.created", { taskId: "t" });
    expect(store.getState().runs.r1?.stream).toBe("open");

    first.fail();
    expect(first.closed).toBe(true);
    expect(store.getState().runs.r1?.stream).toBe("reconnecting");
    vi.advanceTimersByTime(20_000);
    const second = FakeEventSource.latest();
    expect(second).not.toBe(first);
    expect(second.url).toContain("after=2");

    // A repeat across the reconnect is dropped; the log stays gapless and single.
    second.emit(2, "task.created", { taskId: "t" });
    second.emit(3, "message", { text: "hello" });
    expect(store.getState().runs.r1?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    stop();
    expect(second.closed).toBe(true);
  });

  it("closes for good once the run has finished", () => {
    const store = makeStore();
    followRun("r2", store.dispatch, store.getState);
    const es = FakeEventSource.latest();
    es.open();
    es.emit(1, "run.finished", { outcome: "succeeded" });
    expect(es.closed).toBe(true);
    expect(store.getState().runs.r2?.stream).toBe("ended");
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("gives up after repeated failures and says so, rather than spinning forever", () => {
    const store = makeStore();
    followRun("r3", store.dispatch, store.getState);
    for (let i = 0; i < 6; i += 1) {
      FakeEventSource.latest().fail();
      vi.advanceTimersByTime(20_000);
    }
    expect(store.getState().runs.r3?.stream).toBe("failed");
    expect(store.getState().runs.r3?.streamError).toMatch(/could not be kept open/);
  });
});
