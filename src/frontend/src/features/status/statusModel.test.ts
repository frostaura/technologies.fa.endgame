import { describe, expect, it } from "vitest";
import { describeError, formatLatency, toViewState } from "./statusModel";

describe("toViewState", () => {
  it("is loading with no data and no error", () => {
    expect(toViewState({ isLoading: true, isError: false })).toEqual({ kind: "loading" });
  });

  it("is failed — not loaded-and-empty — when the first read errors", () => {
    expect(toViewState({ isLoading: false, isError: true, error: { status: 500, data: null } })).toEqual({
      kind: "failed",
      reason: "The control plane answered 500.",
    });
  });

  it("keeps data and marks it stale when a refresh errors", () => {
    const status = { overall: "healthy" as const, checkedAt: "x", services: [] };
    const view = toViewState({ data: status, isLoading: false, isError: true, error: { status: "FETCH_ERROR", error: "x" } });
    expect(view).toEqual({ kind: "loaded", status, stale: { reason: "The control plane could not be reached." } });
  });
});

describe("formatting", () => {
  it("formats latency", () => {
    expect(formatLatency(42)).toBe("42 ms");
    expect(formatLatency(2000)).toBe("2.0 s");
  });

  it("describes a serialized error by its message", () => {
    expect(describeError({ message: "nope" })).toBe("nope");
  });
});
