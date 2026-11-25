import { describe, expect, it } from "vitest";
import { technicalMark } from "@/lib/plain";
import type { RunEvent } from "@/store/types";
import realRuns from "@/test/fixtures/real-runs.json";
import { deriveRun, planItemLabel } from "./runModel";
import { buildTimeline, workflowStepTitle, type TimelineItem } from "./timeline";

/**
 * Normal mode, read against two real run logs (a research run and a build run from the factory,
 * trimmed): no line the owner reads may carry a `:`-separated key, an id, a model or a file path.
 */

const RUNS = realRuns as unknown as Record<"research" | "build", RunEvent[]>;

function lines(items: TimelineItem[]): string[] {
  return items.flatMap((item) => (item.kind === "group" ? [item.title, item.outcome ?? "", ...lines(item.items)] : [item.title, item.detail ?? ""])).filter(Boolean);
}

describe("the plain-language detector", () => {
  it.each([
    ["Hire:stage:research:frostaura", "key"],
    ["item:backend-books", "key"],
    ["Working on 54016561-46ad-4f36-b1bc-b477c0a934bb", "id"],
    ["Running version f2a84f83c1f6d2852e9f62f57720ec931052273d", "id"],
    ["Asked anthropic/claude-sonnet-4.5", "model"],
    ["api/Books/Book.cs gets a status", "file"],
    ["Changed BooksEndpoints.cs", "file"],
    ["make test passed", "machinery"],
  ])("finds the machinery in %s", (text, mark) => {
    expect(technicalMark(text)).toBe(mark);
  });

  it.each([
    "Verdict: do not build",
    "Club Reading List is built and running privately at /frostaura/community/book-club/web/. Only you and the people you choose can open it.",
    "Iris joins as a market researcher, at up to 400 credits a month.",
    "Checked the estimate against your budget",
    "See https://bookclubs.com/ for their prices",
  ])("leaves plain language alone: %s", (text) => {
    expect(technicalMark(text)).toBeNull();
  });
});

describe("normal mode against real run logs", () => {
  for (const name of ["research", "build"] as const) {
    it(`prints no key, id, model or file in the ${name} run`, () => {
      const events = RUNS[name];
      const derived = deriveRun(events);
      const timeline = buildTimeline(events, "normal", (id) => planItemLabel(derived.plan, id, "normal"));
      const offending = lines(timeline.items).filter((line) => technicalMark(line) !== null);
      expect(offending).toEqual([]);
      expect(timeline.items.length).toBeGreaterThan(3);
    });
  }

  it("names each hire from its people, never by its key", () => {
    const timeline = buildTimeline(RUNS.research, "normal");
    const text = lines(timeline.items).join("\n");
    expect(text).toContain("Hired Iris");
    expect(text).not.toMatch(/hire:stage|Hire:stage/i);
  });

  it("shows the build plan's parts without the files behind them", () => {
    const derived = deriveRun(RUNS.build);
    expect(derived.plan?.items.length).toBe(3);
    const labels = (derived.plan?.items ?? []).map((i) => planItemLabel(derived.plan, i.id, "normal") ?? "");
    for (const label of labels) expect(technicalMark(label)).toBeNull();
    // Technical mode keeps every file name.
    expect(planItemLabel(derived.plan, "backend-books", "technical")).toContain("api/Books/Book.cs");
  });

  it("keeps the raw keys in technical mode", () => {
    const timeline = buildTimeline(RUNS.research, "technical");
    expect(lines(timeline.items).join("\n")).toContain("hire:stage:research:frostaura");
  });
});

describe("workflow steps", () => {
  const none = new Set<string>();
  it("reads a hire from its human fields when nothing else announced it", () => {
    expect(workflowStepTitle("hire:stage:build:acme/tools", { data: { name: "Theo", role: "Software engineer", status: "accepted" } }, none)).toBe("Theo joined as a software engineer");
    expect(workflowStepTitle("hire:division:acme/tools", { data: { name: "Sol", role: "Division lead", status: "proposed" } }, none)).toBe("Proposed hiring Sol as a division lead");
    expect(workflowStepTitle("contractor:sweep", { data: { name: "Kit", role: "Analyst" } }, none)).toBe("Briefed Kit, an analyst");
  });

  it("prefers a plain title the step carries, as newer runners write it", () => {
    expect(workflowStepTitle("hire:stage:research:acme", { title: "Hired Iris, a market researcher" }, none)).toBe("Hired Iris, a market researcher");
    expect(workflowStepTitle("hire:stage:research:acme", { data: { title: "Hired Iris" } }, none)).toBe("Hired Iris");
  });

  it("leaves out a hire the runner announced, a raw key and lines another event says", () => {
    expect(workflowStepTitle("hire:stage:research:acme", { data: { name: "Iris", role: "Researcher" } }, new Set(["hired:stage:research:acme"]))).toBeNull();
    expect(workflowStepTitle("item:backend-books:round:0", {}, none)).toBeNull();
    expect(workflowStepTitle("security:1", {}, none)).toBeNull();
    expect(workflowStepTitle("something:odd/key", {}, none)).toBeNull();
    expect(workflowStepTitle("estimate.gate", {}, none)).toBe("Checked the estimate against your budget");
  });
});

describe("the newer run-log shapes (ARCH-004, the wiring lane)", () => {
  const at = "2026-11-25T03:00:00Z";
  const log: RunEvent[] = [
    { seq: 1, type: "message", at, payload: { kind: "workflow.step", step: "hire:stage:build:acme/tools", data: { name: "Theo", role: "Software engineer", status: "accepted" } } },
    { seq: 2, type: "message", at, payload: { from: "runner", title: "Hired Theo", text: "Theo joins as a software engineer, at up to 1500 credits a month." } },
    {
      seq: 3,
      type: "plan.proposed",
      at,
      payload: {
        summary: "Three parts, each checked in the running app.",
        requirements: [{ id: "r1", text: "Members sign in" }],
        items: [{ id: "books", text: "Keep the club's books", detail: "api/Books/Book.cs and BooksEndpoints.cs", check: "make test", covers: ["r1"] }],
        leftOut: [{ requirement: "r2", text: "Reminders by e-mail", reason: "Left for later: it needs a schedule the club has not asked for yet." }],
      },
    },
    { seq: 4, type: "evaluation.passed", at, payload: { item: "books", text: "Keep the club's books", summary: "Checked and working: Keep the club's books (1 of 1 of your requirements shown working in the running app).", evidence: "GET /api/books returned 200", tier: "build" } },
    { seq: 5, type: "approval.requested", at, payload: { approvalId: "a1", title: "Accept this plan?", detail: "rule plan.checkpoint; tool propose_plan" } },
  ];

  it("tells a hire once, from the runner's plain message, never from its key", () => {
    const text = lines(buildTimeline(log, "normal").items).join("\n");
    expect(text.match(/Theo/g)?.length).toBe(2);
    expect(text).not.toContain("Theo joined as");
    expect(text).not.toMatch(/hire:stage/);
  });

  it("reads requirements, items, what was left out, and an evaluation's plain summary", () => {
    const derived = deriveRun(log);
    expect(derived.plan?.requirements).toEqual([{ id: "r1", text: "Members sign in" }]);
    expect(derived.plan?.leftOut[0]?.text).toBe("Reminders by e-mail");
    expect(derived.plan?.items[0]).toMatchObject({ plain: "Keep the club's books", detail: "api/Books/Book.cs and BooksEndpoints.cs", covers: ["r1"], result: "passed" });
    const normal = lines(buildTimeline(log, "normal", (id) => planItemLabel(derived.plan, id, "normal")).items);
    expect(normal).toContain("Checked and passed: Keep the club's books");
    expect(normal.join("\n")).toContain("1 of 1 of your requirements shown working");
    expect(normal.join("\n")).not.toContain("GET /api/books");
    expect(derived.approvals[0]?.question).toBe("Accept this plan?");
  });
});
