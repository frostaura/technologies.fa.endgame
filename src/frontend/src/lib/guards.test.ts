import { describe, expect, it } from "vitest";
import { appGuard, autonomyGuard, creditsGuard, employeeDetailGuard, hireGuard, memoryChangesGuard, memoryGuard, ontologyGuard, treeGuard } from "@/store/guards";
import { MEMORY, MEMORY_CHANGES, ONTOLOGY, autonomyFixture, employeeDetailFixture, hireFixture } from "@/test/fixtures";
import { arr, check, either, nullable, num, obj, oneOf, str, withDefault } from "./guards";

describe("guards", () => {
  it("names the path that was wrong", () => {
    const g = obj<{ a: { b: number[] } }>({ a: obj({ b: arr(num) }) });
    expect(check(g, { a: { b: [1, "x"] } })).toEqual({ ok: false, problem: 'a.b[1] should be a number, but was "x"' });
    expect(check(g, { a: { b: [1, 2] } })).toMatchObject({ ok: true });
  });

  it("keeps fields it does not know, fills defaults for fields an older stack does not send, and reads null as null", () => {
    const g = obj<{ a: string; b: number; c: string | null }>({ a: str, b: withDefault(num, 7), c: nullable(str) });
    expect(check(g, { a: "x", extra: true })).toEqual({ ok: true, value: { a: "x", b: 7, c: null, extra: true } });
  });

  it("accepts either of two shapes, and refuses a value outside a vocabulary", () => {
    expect(check(either(num, str), "x")).toMatchObject({ ok: true, value: "x" });
    expect(check(oneOf(["a", "b"] as const), "c")).toMatchObject({ ok: false });
  });
});

describe("endpoint guards against the control plane's real shapes", () => {
  it("read the workforce, memory, hires, autonomy and ontology answers", () => {
    for (const [guard, value] of [
      [employeeDetailGuard, employeeDetailFixture()],
      [memoryGuard, MEMORY],
      [memoryChangesGuard, MEMORY_CHANGES],
      [hireGuard, hireFixture()],
      [autonomyGuard, autonomyFixture()],
      [ontologyGuard, ONTOLOGY],
    ] as const) {
      expect(check(guard as never, value)).toMatchObject({ ok: true });
    }
  });

  it("read a tree from an older control plane whose workers carry five fields, and leave out an unknown need", () => {
    const tree = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o", slug: "o", name: "O", summary: null, spend: { monthCredits: 0 }, workers: [{ id: "w", name: "W", role: "R", kind: "employee", activity: "Building" }] }, divisions: [], needsYou: [{ kind: "party", id: "x" }] };
    const r = check(treeGuard, tree);
    expect(r.ok && r.value.organisation?.workers[0]).toMatchObject({ status: "working", idle: false, standing: null });
    expect(r.ok && r.value.needsYou).toEqual([]);
  });

  it("refuse a credits answer whose budgets are not a list, and an app with no health", () => {
    expect(check(creditsGuard, { scope: "o", balance: 1, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: {}, estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] })).toMatchObject({ ok: false, problem: expect.stringContaining("budgets") });
    expect(check(appGuard, { id: "a" })).toMatchObject({ ok: false });
  });
});
