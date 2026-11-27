import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeSet } from "@/store/uiSlice";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { longBuildRun } from "@/demo/world/longRun";
import { RunView } from "./RunView";
import { flushRunStreams } from "./useRunStream";
import { buildTimeline, PART_START } from "./timeline";
import { curlyQuotes, fullRequest, shortRunName } from "./runHeading";

/**
 * The run page against the longest real run's shape (about 2,000 events, 430 actions, a part sent back three times):
 * it is gathered by part, reads in one grid, never names an agent's id, and draws promptly.
 */

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const LONG = longBuildRun("acme/learning");

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(run = LONG.run) {
  stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), [`GET /api/runs/${run.id}`]: json(run) });
  return renderWithStore(<RunView runId={run.id} />);
}

function replay(upTo = LONG.events.length) {
  act(() => {
    const es = FakeEventSource.latest();
    es.open();
    for (const e of LONG.events.slice(0, upTo)) es.emit(e.seq, e.type, e.payload);
    flushRunStreams();
  });
}

describe("a long run", () => {
  it("is about 2,000 events", () => {
    expect(LONG.events.length).toBeGreaterThan(1900);
    expect(LONG.events.length).toBeLessThan(2300);
  });

  it("is named for what it is, never cut mid-word, with the whole request under it", () => {
    expect(LONG.run.title.endsWith("...")).toBe(true);
    expect(shortRunName(LONG.run.title)).toBe("Build: A sign-up sheet for the rowing club's Saturday outings");
    expect(shortRunName("Build: Pager")).toBe("Build: Pager");
    // A first clause still too long is cut at a whole word, and says it goes on.
    const cut = shortRunName(`Research: ${"a long word ".repeat(12)}...`);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
    expect(fullRequest(LONG.run.title, LONG.events)).toContain("Any signed-in member can also add a new outing to the schedule.");
    expect(curlyQuotes("'Keep the books' still failed")).toBe("“Keep the books” still failed");
    expect(curlyQuotes("the club's books")).toBe("the club's books");
  });

  it("never shows a status the run does not have while its log is still arriving", async () => {
    open();
    await screen.findByRole("heading", { name: /^Build: A sign-up sheet/ });
    // The first hundred events say "started"; the run itself says it failed. Until the log has caught up, the run is believed.
    replay(100);
    expect(screen.getByText("Did not succeed")).toBeTruthy();
    expect(screen.queryByText("Working")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.getByText("Reading what the work did")).toBeTruthy();
    replay();
    expect(screen.queryByText("Reading what the work did")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("gathers its steps by part, the last part open, and draws promptly", async () => {
    open();
    await screen.findByRole("heading", { name: /^Build: A sign-up sheet/ });
    const started = performance.now();
    replay();
    const took = performance.now() - started;
    // Recorded for the report: jsdom is several times slower than a browser.
    console.info(`[long run] ${LONG.events.length} events replayed and drawn in normal mode in ${Math.round(took)} ms`);
    expect(took).toBeLessThan(4000);

    const steps = screen.getByRole("list", { name: "Steps" });
    const parts = [...steps.querySelectorAll<HTMLElement>(":scope > li[data-part]")];
    expect(parts.map((p) => p.querySelector("button")?.textContent ?? "")).toEqual([expect.stringContaining("Getting ready"), expect.stringContaining("Part 1 of 5"), expect.stringContaining("Part 2 of 5")]);
    expect(parts.map((p) => p.dataset.open !== undefined)).toEqual([false, false, true]);
    // The part sent back three times ended the run: it says so, and the part's own words are said once, in its heading.
    expect(parts[2]?.textContent).toContain("Did not succeed");
    const open2 = within(screen.getByRole("list", { name: "Steps: Part 2 of 5" }));
    expect(open2.getAllByText("Checked and failed: this part").length).toBe(4);
    // A whole part's lines are a screenful, not hundreds.
    expect(steps.querySelectorAll("li").length).toBeLessThan(120);
    // No agent's id is ever read out as words.
    expect(steps.textContent).not.toMatch(/Evaluator|recheck|claim-seat|outings-list/i);

    // A folded part opens on request.
    fireEvent.click(within(parts[1] as HTMLElement).getByRole("button", { expanded: false }));
    expect(screen.getByText("Checked again, by a second checker: this part")).toBeTruthy();
  });

  it("draws technical mode, with its every event, only for the parts that are open", async () => {
    const { store } = open();
    store.dispatch(modeSet("technical"));
    await screen.findByRole("heading", { name: /^Build: A sign-up sheet/ });
    const started = performance.now();
    replay();
    const took = performance.now() - started;
    console.info(`[long run] ${LONG.events.length} events replayed and drawn in technical mode in ${Math.round(took)} ms`);
    expect(took).toBeLessThan(6000);
    // The open part draws its latest 200 lines; the folded parts draw none.
    expect(screen.getByRole("list", { name: "Steps" }).querySelectorAll("li").length).toBeLessThan(260);
  });

  it("puts every line in the part the work was on when it was written", () => {
    const parts = [
      { id: "outings-list", text: "" },
      { id: "claim-seat", text: "" },
    ];
    const items = buildTimeline(LONG.events, "normal", () => "a part", parts).items;
    expect(items[0]?.part).toBe(PART_START);
    expect(new Set(items.map((i) => i.part))).toEqual(new Set([PART_START, "outings-list", "claim-seat"]));
  });
});
