import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDetail } from "@/store/types";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { RunView } from "./RunView";
import { flushRunStreams } from "./useRunStream";

/**
 * R7-2: a build that ended "built and running" gave no way to the app it built — neither its page in the console nor the
 * app itself. A finished build or change now leads with "Open {app}" and "Manage {app}"; a run that failed, was cancelled
 * or has no app offers neither.
 */
const APP: AppDetail = {
  id: "a1",
  name: "Club dives",
  scope: "acme/tools/club-dives/web",
  health: { state: "healthy", summary: "No errors today" },
  running: "asleep",
  addresses: { path: "https://host.test/acme/tools/club-dives/web/", subdomain: null },
  telemetry: { visitsToday: 12, requestsToday: 90, errorsToday: 0, latencyP50Ms: 120, latencyP95Ms: 1500, lastVisitAt: null },
  cost: { monthCredits: 33, capCredits: 100 },
  settings: { running: "sleep", access: "private" },
  runningCost: { state: "estimated", windowDays: 14, minimumHours: 24, measuredHours: 58, basis: "Measured over the last 14 days: awake 8 of the 58 hours measured, using 448 MB while awake, 2 GB stored and about 59,586 requests a month.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: { credits: 10, awakeHoursPerMonth: 99.3, basis: "Awake about 99 hours a month, as it was 8 of the 58 hours measured in the last 14 days, using 448 MB while awake, with 2 GB stored and about 59,586 requests a month." }, alwaysOn: { credits: 80, awakeHoursPerMonth: 720, basis: "Awake all 720 hours of a month at the 448 MB it uses while awake, with the same 2 GB stored and about 59,586 requests a month." }, measured: { awakeHours: 8, memoryMb: 448, storageMb: 2048, requestsPerMonth: 59586 } },
  sharedWith: 0,
  endUsers: 0,
  status: "sleeping",
  version: "1.2.0",
  publishedAt: "2026-11-20T10:00:00Z",
  idleMinutes: 15,
};
const RUN = { id: "b1", kind: "build", title: "Build: Club dives", scope: "acme/tools/club-dives", status: "finished", startedAt: "2026-11-24T10:00:00Z", finishedAt: "2026-11-24T11:00:00Z", lastSeq: 3, ideaId: "i1", estimateCredits: 20, spentCredits: 12, budgetExhausted: false, canTryAgain: false };
const PLACED = { kind: "workflow.step", agent: "workflow", step: "placement", data: { name: "Club dives", appId: "a1", appPath: "acme/tools/club-dives/web", projectPath: "acme/tools/club-dives" } };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function feed(events: [string, Record<string, unknown>][]) {
  act(() => {
    const source = FakeEventSource.latest();
    source.open();
    events.forEach(([type, payload], i) => source.emit(i + 1, type, payload));
    flushRunStreams();
  });
}

describe("a finished build leads to the app it built (R7-2)", () => {
  it("offers Open and Manage at the top of a build that ended built and running", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/runs/b1": json(RUN), "GET /api/apps/a1": json(APP) });
    renderWithStore(<RunView runId="b1" />);
    await screen.findByRole("heading", { name: "Build: Club dives" });
    feed([
      ["message", PLACED],
      ["run.finished", { outcome: "succeeded", summary: "Club dives is built and running privately." }],
    ]);
    const actions = await screen.findByRole("group", { name: "The app it built" });
    const open = within(actions).getByRole("link", { name: "Open Club dives" });
    expect(open.getAttribute("href")).toBe("https://host.test/acme/tools/club-dives/web/");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(within(actions).getByRole("link", { name: "Manage Club dives" }).getAttribute("href")).toBe("/apps/a1");
    // At the top: before the cost, the plan and the outcome.
    const cost = screen.getByRole("region", { name: "Cost" });
    expect(actions.compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the same after a change to a built app", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/runs/c1": json({ ...RUN, id: "c1", kind: "task", title: "Change: Club dives" }), "GET /api/apps/a1": json(APP) });
    renderWithStore(<RunView runId="c1" />);
    await screen.findByRole("heading", { name: "Change: Club dives" });
    feed([
      ["message", { ...PLACED, data: { ...PLACED.data, existing: true } }],
      ["run.finished", { outcome: "succeeded", summary: "Club dives is changed and running." }],
    ]);
    expect(await screen.findByRole("link", { name: "Open Club dives" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage Club dives" })).toBeTruthy();
  });

  it.each([
    ["failed", { outcome: "failed", summary: "A part did not work." }],
    ["cancelled", { outcome: "cancelled", summary: "Cancelled." }],
  ])("offers neither for a build that %s", async (status, finished) => {
    const api = stubApi({ "GET /api/me": json(ME), "GET /api/runs/b1": json({ ...RUN, status }), "GET /api/apps/a1": json(APP) });
    renderWithStore(<RunView runId="b1" />);
    await screen.findByRole("heading", { name: "Build: Club dives" });
    feed([
      ["message", PLACED],
      ["run.finished", finished],
    ]);
    expect((await screen.findAllByText(status === "failed" ? "Did not succeed" : "Cancelled")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("group", { name: "The app it built" })).toBeNull();
    expect(api.calls.some((c) => c.path === "/api/apps/a1")).toBe(false);
  });

  it("offers neither for finished work without an app", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/runs/r1": json({ ...RUN, id: "r1", kind: "research", title: "Research: Club dives" }) });
    renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { name: "Research: Club dives" });
    feed([["run.finished", { outcome: "succeeded", summary: "Research finished." }]]);
    expect((await screen.findAllByText("Finished")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("group", { name: "The app it built" })).toBeNull();
  });
});
