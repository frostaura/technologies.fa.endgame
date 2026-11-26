import { describe, expect, it } from "vitest";
import { CODE_PREFIX, empty, encode, localDay, merge, migrateLegacy, normalize, parseImport, resumeStep, setDone, streak, toFile, view, type Resolve } from "./model.ts";

const STEPS: Record<string, number> = { "ID-01": 7, "ID-02": 4, "ORG-01": 3, "NOTE-01": 0 };
const ALIASES: Record<string, string> = { "ID-01A": "ID-01" };
const resolve: Resolve = (id) => {
  const key = ALIASES[id] ?? id;
  return key in STEPS ? { id: key, steps: STEPS[key] ?? 0 } : undefined;
};

const T0 = new Date(2026, 10, 24, 9, 0).getTime();
const DAY = 86_400_000;

describe("seen and done", () => {
  it("a step shown is seen, it is where the learner left off, and today counts", () => {
    const p = view(empty(), "ID-01", 3, 7, T0);
    expect(p.flows["ID-01"]).toEqual({ step: 3, furthest: 3, done: false, started: T0, seen: T0, doneAt: 0 });
    expect(p.last).toEqual({ flow: "ID-01", step: 3, at: T0 });
    expect(p.days).toEqual([localDay(T0)]);
  });

  it("going back keeps the furthest step, and the start time stays the first", () => {
    let p = view(empty(), "ID-01", 5, 7, T0);
    p = view(p, "ID-01", 2, 7, T0 + 1000);
    expect(p.flows["ID-01"]).toMatchObject({ step: 2, furthest: 5, started: T0, seen: T0 + 1000 });
  });

  it("reaching the last step makes the flow done, once, at that moment", () => {
    let p = view(empty(), "ID-02", 4, 4, T0);
    expect(p.flows["ID-02"]).toMatchObject({ done: true, doneAt: T0, furthest: 4 });
    p = view(p, "ID-02", 4, 4, T0 + 5000);
    expect(p.flows["ID-02"]?.doneAt).toBe(T0);
  });

  it("marking done by hand and taking it back keeps how far the learner read", () => {
    let p = view(empty(), "ID-01", 3, 7, T0);
    p = setDone(p, "ID-01", true, T0 + 1);
    expect(p.flows["ID-01"]).toMatchObject({ done: true, doneAt: T0 + 1, furthest: 3 });
    p = setDone(p, "ID-01", false, T0 + 2);
    expect(p.flows["ID-01"]).toMatchObject({ done: false, doneAt: 0, furthest: 3 });
    expect(setDone(p, "ID-01", false, T0 + 3)).toBe(p);
  });
});

describe("pick up where you left off", () => {
  it("resumes a flow begun and not finished at its step; not a finished one, nor one left on its first step", () => {
    let p = view(empty(), "ID-01", 4, 7, T0);
    expect(resumeStep(p, "ID-01")).toBe(4);
    p = view(p, "ORG-01", 1, 3, T0);
    expect(resumeStep(p, "ORG-01")).toBeNull();
    p = view(p, "ID-02", 4, 4, T0);
    expect(resumeStep(p, "ID-02")).toBeNull();
    expect(resumeStep(p, "NOPE-01")).toBeNull();
  });
});

describe("surviving content updates", () => {
  it("clamps a flow whose step count shrank, drops a flow that is gone or has no steps, and files an alias under its flow", () => {
    const stored = {
      flows: {
        "ID-01": { step: 9, furthest: 12, done: false, started: 1, seen: 2, doneAt: 0 },
        "GONE-01": { step: 1, furthest: 1, done: false, started: 1, seen: 1, doneAt: 0 },
        "NOTE-01": { step: 1, furthest: 1, done: false, started: 1, seen: 1, doneAt: 0 },
        "ID-01A": { step: 2, furthest: 2, done: true, started: 0, seen: 5, doneAt: 5 },
      },
      last: { flow: "GONE-01", step: 3, at: 4 },
      days: ["2026-11-24", "nonsense", "2026-11-24", "2026-11-23"],
    };
    const p = normalize(stored, resolve);
    expect(Object.keys(p.flows)).toEqual(["ID-01"]);
    expect(p.flows["ID-01"]).toMatchObject({ step: 2, furthest: 7, done: true, started: 1, seen: 5, doneAt: 5 });
    expect(p.last).toBeNull();
    expect(p.days).toEqual(["2026-11-23", "2026-11-24"]);
  });

  it("reads nonsense as nothing, never throwing", () => {
    for (const raw of [null, 3, "x", [], { flows: 7 }, { flows: { "ID-01": "seen" } }]) expect(normalize(raw, resolve).flows).toEqual({});
  });

  it("carries the first version's record forward", () => {
    const p = migrateLegacy({ flows: { "ID-01": "seen", "ID-02": "done", "GONE-01": "done" }, last: { flow: "ID-01", step: 3 } }, resolve);
    expect(p.flows["ID-01"]).toMatchObject({ step: 3, furthest: 3, done: false });
    expect(p.flows["ID-02"]).toMatchObject({ done: true, furthest: 4 });
    expect(p.flows["GONE-01"]).toBeUndefined();
    expect(p.last).toMatchObject({ flow: "ID-01", step: 3 });
  });
});

describe("the streak", () => {
  const days = (...offsets: number[]) => offsets.map((o) => localDay(T0 + o * DAY));
  it("counts days in a row ending today", () => {
    expect(streak(days(-2, -1, 0), T0)).toBe(3);
  });
  it("still counts a run that ended yesterday, since today is not over", () => {
    expect(streak(days(-3, -2, -1), T0)).toBe(3);
  });
  it("a missed day ends the run, and no days is no streak", () => {
    expect(streak(days(-4, -3, -1, 0), T0)).toBe(2);
    expect(streak(days(-5), T0)).toBe(0);
    expect(streak([], T0)).toBe(0);
  });
});

describe("moving between devices", () => {
  const sample = () => setDone(view(view(empty(), "ID-01", 5, 7, T0), "ID-02", 4, 4, T0 + DAY), "ORG-01", true, T0 + 2 * DAY);

  it("a code round-trips the progress (to the second)", () => {
    const p = sample();
    const code = encode(p);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(parseImport(code, resolve)).toEqual(p);
  });

  it("a code survives being pasted with spaces and line breaks", () => {
    const code = encode(sample());
    const broken = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(parseImport(broken, resolve)).toEqual(sample());
  });

  it("a file round-trips the progress", () => {
    const p = sample();
    expect(parseImport(toFile(p, T0), resolve)).toEqual(p);
  });

  it("refuses what is not progress from this academy", () => {
    expect(parseImport("hello", resolve)).toBeNull();
    expect(parseImport(`${CODE_PREFIX}!!!`, resolve)).toBeNull();
    expect(parseImport(JSON.stringify({ flows: {} }), resolve)).toBeNull();
  });

  it("merging keeps the furthest of each flow, the earliest start, the newest place, and every day", () => {
    const here = view(empty(), "ID-01", 6, 7, T0 + DAY);
    const there = view(view(empty(), "ID-01", 2, 7, T0), "ID-02", 4, 4, T0 + 2 * DAY);
    const m = merge(here, there);
    expect(m.flows["ID-01"]).toMatchObject({ furthest: 6, started: T0, step: 6 });
    expect(m.flows["ID-02"]?.done).toBe(true);
    expect(m.last?.flow).toBe("ID-02");
    expect(m.days).toEqual([localDay(T0), localDay(T0 + DAY), localDay(T0 + 2 * DAY)]);
  });
});
