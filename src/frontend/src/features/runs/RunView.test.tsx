import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeSet } from "@/store/uiSlice";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { RunView } from "./RunView";
import { flushRunStreams } from "./useRunStream";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const RUN = { id: "r1", kind: "research", title: "Researching Pager", scope: "acme", status: "running", startedAt: "2026-11-24T10:00:00Z", finishedAt: null, lastSeq: 0, ideaId: "i1", estimateCredits: 60, spentCredits: 0 };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function base(extra: Record<string, Response | "pending"> = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/runs/r1": json(RUN), ...extra });
}

function feed(events: [string, Record<string, unknown>?][]) {
  act(() => {
    const es = FakeEventSource.latest();
    es.open();
    events.forEach(([type, payload], i) => es.emit(i + 1, type, payload ?? {}));
    flushRunStreams();
  });
}

const SCRIPT: [string, Record<string, unknown>?][] = [
  ["run.started", { reason: "Research first." }],
  ["estimate.made", { credits: 60 }],
  ["plan.proposed", { summary: "Argue against it first.", items: [{ id: "c1", text: "Name the competitors", check: "Three named" }] }],
  ["task.created", { taskId: "t1", summary: "Sweep competitors" }],
  ["task.claimed", { taskId: "t1", holder: "Ada" }],
  ["model.requested", { callId: "k1", model: "vendor/small", taskType: "research", reservedCredits: 4 }],
  ["model.replied", { callId: "k1", model: "vendor/small", settledCredits: 3 }],
  ["tool.requested", { tool: "shell.exec" }],
  ["tool.denied", { tool: "shell.exec", rule: "protected floor" }],
  ["evaluation.passed", { item: "c1", evidence: "Three named." }],
  ["approval.requested", { approvalId: "a1", question: "Spend 20 more credits?" }],
];

describe("RunView", () => {
  it("shows a skeleton while the run loads", () => {
    base({ "GET /api/runs/r1": "pending" });
    renderWithStore(<RunView runId="r1" />);
    expect(screen.getByRole("status").dataset.state).toBe("loading");
  });

  it("records a failed read, naming a missing run as missing", async () => {
    base({ "GET /api/runs/r1": problem(404, "Run not found") });
    renderWithStore(<RunView runId="r1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This work could not be found");
  });

  it("waits for the first step, then shows the run as finished", async () => {
    base();
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    expect(screen.getByText("Waiting for the first step").closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
    feed([["run.finished", { outcome: "succeeded" }]]);
    expect(screen.getAllByText("Finished").length).toBeGreaterThan(0);
    expect(screen.queryByText("Waiting for the first step")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("streams the plan, tasks, cost and an inline approval in plain language", async () => {
    const api = base({ "POST /api/runs/r1/approvals/a1": json(null, 204) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    expect(FakeEventSource.latest().url).toContain("/api/runs/r1/events?after=0");
    feed(SCRIPT);

    expect(screen.getByText("Waiting for you")).toBeTruthy();
    expect(screen.getAllByText("Argue against it first.").length).toBe(2);
    expect(screen.getByText("Passed its check")).toBeTruthy();
    expect(screen.getByText("Checked and passed: Name the competitors")).toBeTruthy();
    const tasks = screen.getByRole("list", { name: "Tasks" });
    expect(within(tasks).getByText("In progress")).toBeTruthy();
    expect(screen.getByText("3 credits")).toBeTruthy();
    expect(screen.getByText("An action was refused by your rules")).toBeTruthy();
    // Normal mode never names infrastructure.
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(steps.textContent).not.toMatch(/shell|vendor\/small|protected floor/);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText(/Approved\./)).toBeTruthy();
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/runs/r1/approvals/a1")?.body).toEqual({ decision: "approve" }));
  });

  it("shows each plan item in plain words in normal mode and its technical detail only in technical mode", async () => {
    base();
    const { store } = renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed([
      ["run.started", {}],
      [
        "plan.proposed",
        {
          items: [
            // The newer shape: plain text for the owner, the detail for technical mode.
            { id: "backend-books", text: "Keep the club's books and who added each", detail: "api/Books/Book.cs, BooksEndpoints.cs and a fresh migration", check: "make test passes" },
            // The older shape: one technical text.
            { id: "frontend-books", text: "web/src/books/BooksPage.tsx replaces NotesPage", check: "make lint passes" },
          ],
        },
      ],
      ["evaluation.passed", { item: "frontend-books", text: "web/src/books/BooksPage.tsx replaces NotesPage", evidence: "make test passed 17 Vitest tests" }],
    ]);
    const plan = screen.getByRole("list", { name: "Parts of the plan" });
    expect(within(plan).getByText("Keep the club's books and who added each")).toBeTruthy();
    expect(within(plan).getByText("Part 2 of 2 of the plan")).toBeTruthy();
    expect(plan.textContent).not.toMatch(/\.cs|\.tsx|make test|make lint|migration/);
    expect(screen.getByText("Checked and passed: Part 2 of 2 of the plan")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Steps" }).textContent).not.toMatch(/\.tsx|Vitest|make /);

    act(() => void store.dispatch(modeSet("technical")));
    const technical = screen.getByRole("list", { name: "Parts of the plan" });
    expect(within(technical).getByText("api/Books/Book.cs, BooksEndpoints.cs and a fresh migration")).toBeTruthy();
    expect(within(technical).getByText("frontend-books · web/src/books/BooksPage.tsx replaces NotesPage")).toBeTruthy();
    expect(within(technical).getByText("Check: make test passes")).toBeTruthy();
  });

  it("shows the raw detail in technical mode", async () => {
    base();
    const { store } = renderWithStore(<RunView runId="r1" />);
    store.dispatch(modeSet("technical"));
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed(SCRIPT);
    expect(screen.getByText("Model call: vendor/small for research")).toBeTruthy();
    expect(screen.getByText("Denied: shell.exec")).toBeTruthy();
    expect(screen.getByText("Rule: protected floor")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Trace" })).toBeTruthy();
  });

  it("rolls an approval back when the answer is not recorded", async () => {
    base({ "POST /api/runs/r1/approvals/a1": problem(409, "Already answered") });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed(SCRIPT);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText(/Your answer was not recorded: Already answered/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("pauses optimistically and rolls back if the control plane refuses", async () => {
    let release: (r: Response) => void = () => {};
    base({});
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/runs/r1": json(RUN),
      "POST /api/runs/r1/pause": () => new Promise<Response>((r) => (release = r)),
    });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed([["run.started"]]);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused")).toBeTruthy();
    release(problem(409, "Cannot pause now"));
    expect(await screen.findByText(/Could not pause: Cannot pause now/)).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/runs/r1/pause")).toBe(true);
  });

  it("keeps what a pause did until the log records it, so the button never flips back", async () => {
    base({ "POST /api/runs/r1/pause": json({ ...RUN, status: "paused" }) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed([["run.started"]]);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    // Answered, and the log has not caught up yet: still paused, not "Working" with a Pause button again.
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    // The log moves on (the runner resumed it): the log is the status again.
    act(() => {
      FakeEventSource.latest().emit(2, "run.paused", { reason: "Paused by the owner." });
      FakeEventSource.latest().emit(3, "run.resumed", {});
      flushRunStreams();
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("draws a long build promptly, folding its earlier steps, and says one cost the log and the run agree on", async () => {
    // About 2,300 events, as a real build writes them: model calls, tools and messages, with free repairs among them.
    const events: [string, Record<string, unknown>?][] = [["run.started"], ["estimate.made", { credits: 40 }]];
    for (let i = 0; i < 460; i += 1) {
      const repair = i % 10 === 9;
      events.push(["model.requested", { callId: `k${i}`, model: "vendor/small", taskType: "build", reservedCredits: 0.2 }]);
      events.push(["model.replied", { callId: `k${i}`, model: "vendor/small", settledCredits: 0.07, billable: !repair }]);
      events.push(["tool.requested", { tool: "edit_file", callId: `t${i}` }]);
      events.push(["tool.result", { tool: "edit_file", callId: `t${i}`, content: "Edited." }]);
      events.push(["message", { from: "builder", title: `Part ${i + 1}`, text: `Built part ${i + 1} of the reading list.` }]);
    }
    base({ "GET /api/runs/r1": json({ ...RUN, kind: "build", spentCredits: 28.98 }) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    const started = performance.now();
    feed(events);
    expect(performance.now() - started).toBeLessThan(3000);

    const cost = screen.getByRole("region", { name: "Cost" });
    expect(within(cost).getByText("Spent so far").nextSibling?.textContent).toBe("29 credits"); // 32 with the free repairs counted
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem").length).toBeLessThanOrEqual(200);
    expect(screen.getByText(/earlier steps folded away; the latest 200 are below\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Show 200 earlier steps$/ }));
    expect(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem").length).toBe(400);
  });

  it("asks before cancelling", async () => {
    const api = base({ "POST /api/runs/r1/cancel": json({ ...RUN, status: "cancelled" }) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.calls.some((c) => c.path.endsWith("/cancel"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/cancel"))).toBe(true));
  });

  it("links a finished research run to its verdict", async () => {
    base();
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Researching Pager" });
    feed([["run.started"], ["run.finished", { outcome: "succeeded", summary: "Do not build." }]]);
    expect(screen.getByRole("link", { name: /The verdict is ready/ }).getAttribute("href")).toBe("/ideas/i1");
    expect(screen.getByRole("heading", { name: "Outcome" }).nextSibling?.textContent).toBe("Do not build.");
  });

  it("never offers a verdict on a build run, even one that came from an idea", async () => {
    base({ "GET /api/runs/r1": json({ ...RUN, kind: "build", title: "Building Pager" }) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Building Pager" });
    feed([["run.started"], ["run.finished", { outcome: "succeeded", summary: "Published." }]]);
    expect(await screen.findByRole("heading", { name: "Outcome" })).toBeTruthy();
    expect(screen.queryByText(/The verdict is ready/)).toBeNull();
    expect(screen.queryByText(/See what research found/)).toBeNull();
  });
});
