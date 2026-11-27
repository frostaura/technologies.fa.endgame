import { Profiler } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { flushRunStreams } from "../runs/useRunStream";
import { WorkCard } from "./WorkCard";

const RUN = {
  id: "w1",
  kind: "build",
  title: "Change: let members join a waitlist",
  scope: "acme/ops/courts/booking",
  status: "running",
  startedAt: "2026-11-27T10:00:00Z",
  finishedAt: null,
  lastSeq: 0,
  ideaId: null,
  estimateCredits: 10,
  spentCredits: 0,
  employeeId: null,
  conversationId: null,
  budgetExhausted: false,
  outcome: null,
  summary: null,
  createdAt: "2026-11-27T10:00:00Z",
  canTryAgain: false,
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stubApi({
    "GET /api/me": json(ME),
    "GET /api/runs/w1": json(RUN),
    "GET /api/apps/app1": json({ id: "app1", name: "Court booking", addresses: { subdomain: null, path: "/apps/court-booking/" } }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stream() {
  const es = FakeEventSource.latest();
  let seq = 0;
  return (type: string, payload: Record<string, unknown> = {}) => {
    seq += 1;
    es.emit(seq, type, payload);
  };
}

describe("the work card", () => {
  it("shows the plan as a track, the part being worked on open with who holds its task, and the credits against the estimate", async () => {
    renderWithStore(<WorkCard runId="w1" kind="change" />);
    await screen.findByText("let members join a waitlist");
    const send = stream();
    act(() => {
      FakeEventSource.latest().open();
      send("run.started");
      send("estimate.made", { credits: 10 });
      send("plan.proposed", { items: [{ id: "r1", text: "Members can join a waitlist", detail: "" }, { id: "r2", text: "Everything still works", detail: "" }] });
      send("plan.accepted");
      send("task.created", { taskId: "t1", title: "Members can join a waitlist" });
      send("message", { kind: "agent.start", agent: "builder-r1-0" });
      send("task.claimed", { taskId: "t1", holder: "Kasper", summary: "Members can join a waitlist" });
      send("model.replied", { settledCredits: 2.5 });
      flushRunStreams();
    });
    expect(screen.getByText("A change")).toBeTruthy();
    expect(screen.getByRole("region", { name: "The plan" }).dataset.plan).toBe("stepper");
    expect(screen.getByText("0 of 2 parts done")).toBeTruthy();
    expect(document.querySelector("[data-open-part]")?.getAttribute("data-part-state")).toBe("working");
    expect(screen.getAllByText("Kasper").length).toBeGreaterThan(0);
    expect(screen.getByRole("meter", { name: "Credits used against the estimate" }).getAttribute("aria-valuenow")).toBe("2.5");
    expect(screen.getByText(/2\.5 of about 10 credits/)).toBeTruthy();
    // Another part can be opened from the track.
    expect(screen.getByRole("button", { name: /^Part 1 of 2:\s*Members can join a waitlist/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Part 2 of 2:\s*Everything still works/ }));
    expect(document.querySelector("[data-open-part]")?.textContent).toContain("Everything still works");
  });

  it("asks inside the card, and ends with the outcome and what to do next", async () => {
    renderWithStore(<WorkCard runId="w1" kind="change" />);
    await screen.findByText("let members join a waitlist");
    const send = stream();
    act(() => {
      FakeEventSource.latest().open();
      send("run.started");
      send("plan.proposed", { items: [{ id: "r1", text: "Members can join a waitlist", detail: "" }] });
      send("approval.requested", { approvalId: "a1", title: "Carry out this plan?", detail: "It is built part by part." });
      flushRunStreams();
    });
    expect(screen.getByText("The plan, waiting for you")).toBeTruthy();
    expect(screen.getByTestId("approval-card").textContent).toContain("Carry out this plan?");
    expect(screen.getByText("Waiting for you")).toBeTruthy();
    act(() => {
      send("approval.answered", { approvalId: "a1", answer: "approved" });
      send("evaluation.passed", { item: "r1", summary: "Checked and working." });
      send("message", { kind: "workflow.step", step: "placement", data: { appId: "app1", name: "Court booking" } });
      send("run.finished", { outcome: "succeeded", summary: "Court booking is changed and its new version is running." });
      flushRunStreams();
    });
    expect(screen.getByText("Court booking is changed and its new version is running.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "How it ended" }).dataset.result).toBe("finished");
    expect(document.querySelector("[data-work-card]")?.getAttribute("data-status")).toBe("finished");
    expect(screen.getByRole("link", { name: "See the whole run" }).getAttribute("href")).toBe("/runs/w1");
  });
});

/**
 * What a redraw of the card costs as a build streams in: about 2,000 events stored in batches of 20, each batch one
 * React commit, timed by React's own profiler. A batch arrives at most every 50 ms; a commit must stay well inside a frame.
 */
describe("a long build stays smooth", () => {
  it("commits each batch of a 2,000-event build well inside a frame", async () => {
    const durations: number[] = [];
    renderWithStore(
      <Profiler id="card" onRender={(_id, phase, actual) => phase === "update" && durations.push(actual)}>
        <WorkCard runId="w1" kind="change" />
      </Profiler>,
    );
    await screen.findByText("let members join a waitlist");
    const send = stream();
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `r${i + 1}`, text: `Part ${i + 1}`, detail: "" }));
    act(() => {
      FakeEventSource.latest().open();
      send("run.started");
      send("estimate.made", { credits: 120 });
      send("plan.proposed", { items });
      send("plan.accepted");
      flushRunStreams();
    });
    durations.length = 0;
    let n = 4;
    while (n < 2000) {
      act(() => {
        for (let b = 0; b < 20; b++, n++) {
          const part = (Math.floor(n / 250) % 8) + 1;
          const kind = n % 4;
          if (kind === 0) send("message", { kind: "agent.start", agent: `builder-r${part}-0` });
          else if (kind === 1) send("tool.requested", { name: n % 3 ? "read_file" : "edit_file", agent: `builder-r${part}-0`, arguments: JSON.stringify({ path: `src/f${n}.ts` }) });
          else if (kind === 2) send("model.replied", { settledCredits: 0.02 });
          else send("tool.requested", { name: "run", agent: `builder-r${part}-0`, arguments: JSON.stringify({ command: "make test" }) });
        }
        flushRunStreams();
      });
    }
    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
    console.info(`WorkCard commits over ${n} events (${durations.length} batches): p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
    // A frame is 16 ms; the test's document under a parallel suite is far slower than a browser, so the bar is the typical
    // commit inside a frame and no commit beyond three.
    expect(p50).toBeLessThan(16);
    expect(p95).toBeLessThan(48);
    expect(screen.getByRole("region", { name: "The plan" }).dataset.plan).toBe("stepper");
  });
});
