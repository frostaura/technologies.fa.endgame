import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/store/types";
import { modeSet } from "@/store/uiSlice";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { keptText } from "./retryModel";
import { RunView } from "./RunView";
import { CHECK_LINES, deriveRun, EXPIRED, EXPIRED_NOTE, evaluationDetail, planItemLabel, plainSentences } from "./runModel";
import { buildTimeline, type TimelineItem } from "./timeline";
import { flushRunStreams } from "./useRunStream";

/**
 * Round three (R3-1, R3-2): what the server now records — approvals that expire with their run, a check's second look, its
 * early stop, a screen requirement shown by the screen's own test, and the quoted reason a part was sent back — as the run
 * page shows it.
 */

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const RUN = { id: "r1", kind: "research", title: "Research: dive trips", scope: "acme", status: "running", startedAt: "2026-11-26T10:00:00Z", finishedAt: null, lastSeq: 0, ideaId: "i1", estimateCredits: 60, spentCredits: 0 };
const at = "2026-11-26T10:00:00Z";
const ev = (seq: number, type: string, payload: Record<string, unknown>): RunEvent => ({ seq, type, at, payload });

// Requirement r4 of the real dive-club build (run cafe1c2e), and what the checker wrote for it, word for word.
const R4 = "Make the trip leader's readiness view the product and treat the checklist as just its content";
const R4_SAW =
  "TripPage.tsx renders Readiness component before ShareLink and Checklist components; the packer-list appears first in the DOM, with the checklist as its content below. The trip leader sees who is ready before anything else.";
const PLAN = ev(1, "plan.proposed", {
  summary: "One part.",
  requirements: [
    { id: "r3", text: "The trip leader sees who is ready" },
    { id: "r4", text: R4 },
  ],
  items: [{ id: "leader-screens", text: "The trip leader sees a readiness view on their phone", detail: "web/src/trips/", check: "make test", covers: ["r3", "r4"] }],
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lines(items: TimelineItem[]): string[] {
  return items.flatMap((i) => (i.kind === "group" ? [i.title, ...lines(i.items)] : [i.title, ...(i.detail ? [i.detail] : [])]));
}

function feed(events: [string, Record<string, unknown>?][]) {
  act(() => {
    const es = FakeEventSource.latest();
    es.open();
    events.forEach(([type, payload], i) => es.emit(i + 1, type, payload ?? {}));
    flushRunStreams();
  });
}

describe("an approval its run ended before anyone answered (R3-2)", () => {
  it("is closed with the run in the log: expired, with the plain note, never left waiting", () => {
    const run = deriveRun([
      ev(1, "approval.requested", { approvalId: "a1", title: "Let this step search the web?" }),
      ev(2, "approval.requested", { approvalId: "a2", title: "Spend 20 more credits?" }),
      ev(3, "approval.answered", { approvalId: "a2", answer: "approved" }),
      ev(4, "run.finished", { outcome: "cancelled" }),
    ]);
    expect(run.approvals.map((a) => [a.id, a.answer, a.note])).toEqual([
      ["a1", EXPIRED, EXPIRED_NOTE],
      ["a2", "approved", null],
    ]);
  });

  it("shows on the run page closed, with that note, and offers neither Approve nor Decline", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/runs/r1": json(RUN) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Research: dive trips" });
    feed([
      ["run.started"],
      ["approval.requested", { approvalId: "a1", title: "Let this step search the web for kit list 1?" }],
    ]);
    expect(within(screen.getByRole("region", { name: "Waiting for your approval" })).getByRole("button", { name: "Approve" })).toBeTruthy();
    act(() => {
      FakeEventSource.latest().emit(3, "run.finished", { outcome: "cancelled", summary: "Cancelled." });
      flushRunStreams();
    });
    expect(screen.queryByRole("region", { name: "Waiting for your approval" })).toBeNull();
    const closed = screen.getByRole("region", { name: "No longer waiting" });
    expect(within(closed).getByText("Let this step search the web for kit list 1?")).toBeTruthy();
    expect(within(closed).getByText("The work ended before this was answered.")).toBeTruthy();
    expect(within(closed).queryByRole("button")).toBeNull();
  });

  it("says the server's sentence when an answer arrives after the work ended", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/runs/r1": json(RUN),
      "POST /api/runs/r1/approvals/a1": json({ title: "Conflict", status: 409, detail: "The work ended before this was answered, so there is nothing left to approve." }, 409),
    });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Research: dive trips" });
    feed([["run.started"], ["approval.requested", { approvalId: "a1", title: "Let this step search the web?" }]]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Your answer was not recorded: The work ended before this was answered, so there is nothing left to approve.")).toBeTruthy();
  });
});

describe("a check's judgement on the run page (R3-1)", () => {
  const failed = ev(2, "evaluation.failed", {
    item: "leader-screens",
    text: "The trip leader sees a readiness view on their phone",
    summary: "Sent back for repair, at no charge: The trip leader sees a readiness view on their phone (1 of 2 of your requirements shown working in the running app).",
    requirements: [
      { id: "r3", text: "The trip leader sees who is ready", met: true, evidence: "GET api/trips/{tripId} returns packers", calls: ["GET api/trips/{id}"] },
      { id: "r4", text: R4, met: false, evidence: R4_SAW, calls: [] },
    ],
    failing: ["r4:unshown"],
    faults: ["Requirement r4 (\"…\") is marked met, but its evidence names no call_app call that was made."],
    evidence: "All 31 tests pass (make test exits 0).",
  });

  it("quotes, under “Sent back for repair”, the requirement and what the checker saw, in its plain sentences only", () => {
    const detail = evaluationDetail(failed.payload, "normal") ?? "";
    const [summary, reason] = detail.split("\n");
    expect(summary).toMatch(/^Sent back for repair, at no charge:/);
    expect(reason).toBe(`“${R4}”: the checker said it works, but nothing it gave shows it in the running app. What the checker saw: “The trip leader sees who is ready before anything else.”`);
    expect(detail).not.toMatch(/TripPage|call_app|api\//);
  });

  it("never drops the reason to nothing: a wholly technical observation still names the requirement and how it failed", () => {
    const technicalOnly = { ...failed.payload, requirements: [{ id: "r4", text: R4, met: false, evidence: "TripPage.tsx renders Readiness before ShareLink.", calls: [] }] };
    expect(evaluationDetail(technicalOnly, "normal")).toContain(`“${R4}”: the checker said it works, but nothing it gave shows it in the running app.`);
    expect(plainSentences("TripPage.tsx renders Readiness before ShareLink.")).toBeNull();
  });

  it("says a second look, an early stop and a screen's own test plainly, and leaves the names to technical mode", () => {
    const passed = ev(3, "evaluation.passed", {
      item: "leader-screens",
      rechecked: true,
      requirements: [{ id: "r4", text: R4, met: true, evidence: "The test passes.", calls: [], tests: ["web/src/trips/TripPage.test.tsx > leads with readiness, above the share link and the kit list"] }],
      failing: [],
      evidence: "Rechecked.",
    });
    const stopped = ev(4, "evaluation.failed", { ...failed.payload, final: true, stoppedEarly: true });
    const normal = evaluationDetail(passed.payload, "normal") ?? "";
    expect(normal).toContain(CHECK_LINES.rechecked);
    expect(normal).toContain("Shown by the screen's own test: “leads with readiness, above the share link and the kit list”.");
    expect(normal).not.toContain("TripPage.test.tsx");
    expect(evaluationDetail(stopped.payload, "normal")).toContain("Stopped early: the same requirement failed the same way three times.");

    const technical = evaluationDetail(passed.payload, "technical") ?? "";
    expect(technical).toContain("Test (r4): web/src/trips/TripPage.test.tsx > leads with readiness, above the share link and the kit list");
    expect(evaluationDetail(failed.payload, "technical")).toContain("Failing: r4:unshown");
  });

  it("says a part's passing sentence once: on the plan card, not again in the steps", () => {
    const log = [
      PLAN,
      ev(2, "evaluation.passed", { item: "leader-screens", text: "The trip leader sees a readiness view on their phone", summary: "Checked and working: The trip leader sees a readiness view on their phone (2 of 2 of your requirements shown working in the running app).", requirements: [], failing: [] }),
      ev(3, "task.done", { taskId: "t1", summary: "The check of “The trip leader sees a readiness view on their phone” is finished: it works." }),
    ];
    const derived = deriveRun(log);
    expect(derived.plan?.items[0]?.outcome).toMatch(/^Checked and working:/);
    const steps = lines(buildTimeline(log, "normal", (id) => planItemLabel(derived.plan, id, "normal")).items).join("\n");
    expect(steps).toContain("Checked and passed: The trip leader sees a readiness view on their phone");
    expect(steps.match(/Checked and working/g)).toBeNull();
    expect(steps).toContain("The check of “The trip leader sees a readiness view on their phone” is finished: it works.");
  });

  it("draws the quoted reason on the run page in normal mode", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/runs/r1": json({ ...RUN, kind: "build", title: "Build: Dive Trip Ready" }) });
    const { store } = renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Build: Dive Trip Ready" });
    feed([
      ["run.started"],
      ["plan.proposed", PLAN.payload],
      ["evaluation.failed", failed.payload],
    ]);
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getByText(/What the checker saw: “The trip leader sees who is ready before anything else\.”/)).toBeTruthy();
    act(() => {
      store.dispatch(modeSet("technical"));
    });
    expect(screen.getByText(/Failing: r4:unshown/)).toBeTruthy();
  });
});

describe("what a try again keeps (R3 walk, item 6a)", () => {
  it("says one part in the singular and more in the plural", () => {
    expect(keptText({ what: "build", credits: 30, basis: "", parts: 4, partsDone: 1 } as never)).toBe("1 of its 4 parts is already built and checked; it is kept, not built or charged again.");
    expect(keptText({ what: "build", credits: 30, basis: "", parts: 4, partsDone: 2 } as never)).toBe("2 of its 4 parts are already built and checked; they are kept, not built or charged again.");
  });

  it("says plainly what is left when every part is built and checked (R7-3)", () => {
    expect(keptText({ what: "build", credits: 4, basis: "", parts: 5, partsDone: 5 } as never)).toBe("Every part is built and checked. What is left is the security review and publishing.");
    expect(keptText({ what: "change", credits: 5, basis: "", parts: 2, partsDone: 2 } as never)).toBe("Every part is built and checked. What is left is the security review and the new version.");
    expect(keptText({ what: "build", credits: 20, basis: "", parts: 5, partsDone: 0 } as never)).toBe("The plan agreed before is kept, and all 5 of its parts are built.");
  });
});
