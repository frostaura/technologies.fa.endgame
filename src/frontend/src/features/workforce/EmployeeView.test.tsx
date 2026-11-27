import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY, MEMORY_CHANGES, employeeDetailFixture } from "@/test/fixtures";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { modeSet } from "@/store/uiSlice";
import { EmployeeView } from "./EmployeeView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };
// A finished task is no longer held by anyone; who did it stays on it.
const TASKS = [{ id: "t1", scope: "acme/tools", runId: "r5", parentTaskId: null, title: "Research: Pager", description: "", status: "done", holderRunId: null, holderEmployeeId: null, employeeId: "e1", claimedAt: null, estimateCredits: 60, actualCredits: 54, dependsOn: [], createdAt: "t", updatedAt: "t" }];

function stub(detail: Response | "pending", extra = {}) {
  return stubApi({
    "GET /api/me": json(ME),
    "GET /api/credits": json(CREDITS),
    "GET /api/tree": json(TREE),
    "GET /api/employees/e1": detail,
    "GET /api/employees/e1/memory": json(MEMORY),
    "GET /api/employees/e1/memory/changes": json(MEMORY_CHANGES),
    "GET /api/tasks": json(TASKS),
    "GET /api/conversations": json({ scope: "acme/tools", conversationId: null, employeeId: "e1", messages: [] }),
    ...extra,
  });
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EmployeeView", () => {
  it("shows a skeleton while loading", () => {
    stub("pending");
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect(screen.getAllByRole("status")[0]?.dataset.state).toBe("loading");
  });

  it("records a failed read", async () => {
    stub(problem(500, "Boom"));
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("The employee could not be loaded");
  });

  it("shows the track record, job in plain words, recent work, contractors, memory and the last review", async () => {
    stub(json(employeeDetailFixture()));
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    const record = screen.getByRole("region", { name: "Track record" });
    expect(record.textContent).toContain("19 of 22");
    expect(record.textContent).toContain("3 pieces sent back");
    expect(record.textContent).toContain("Usually 18% under the estimate");
    expect(screen.getByText("Standard, for reading and judging")).toBeTruthy();
    expect(screen.getByText("Read files, Search the web, Brief contractors")).toBeTruthy();
    expect(document.body.textContent).not.toContain("web_search");
    expect(await screen.findByRole("link", { name: "Research: Pager" })).toBeTruthy();
    expect(screen.getByText("Find every club ladder product.")).toBeTruthy();
    const memory = await screen.findByRole("list", { name: "Memory entries" });
    expect(within(memory).getByText("Proof before building")).toBeTruthy();
    expect(screen.getByText(/1 note merged, 1 removed as out of date, 1 habit corrected/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Talk to Ada" })).toBeTruthy();
  });

  it("shows the work a factory build gave it: the tasks it claimed, judgements it made, and how its estimates went", async () => {
    const trackRecord = {
      employeeId: "e1",
      work: { accepted: 3, sentBack: 0, acceptedPercent: 100, judged: 4 },
      runs: { finished: 1, succeeded: 1, failed: 0, cancelled: 0 },
      repairsNotCharged: { credits: 0, calls: 0 },
      cost: { toDateCredits: 3.2, monthCredits: 3.2 },
      contractors: { engaged: 0, working: 0, toDateCredits: 0, monthCredits: 0 },
      estimates: { pieces: 1, withinPercent: 0, under: 1, over: 0, largestMissPercent: 83.8, typicalGapPercent: -83.8, typically: "under" },
    };
    const tasks = [
      { id: "t7", scope: "acme/tools", runId: "b1", parentTaskId: null, title: "Check: Members book a court.", description: "", status: "done", holderRunId: null, holderEmployeeId: null, employeeId: "e1", claimedAt: "t", estimateCredits: null, actualCredits: null, dependsOn: [], createdAt: "t", updatedAt: "t" },
    ];
    const { calls } = stub(json({ ...employeeDetailFixture(), trackRecord }), { "GET /api/tasks": json(tasks) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    const record = await screen.findByRole("region", { name: "Track record" });
    expect(record.textContent).toContain("3 of 3");
    expect(record.textContent).toContain("4 judgements of others’ work");
    expect(record.textContent).toContain("Usually 84% under the estimate");
    expect(record.textContent).not.toContain("Within 0%");
    expect(await screen.findByRole("link", { name: "Check: Members book a court." })).toBeTruthy();
    expect(screen.queryByText(/has not taken on any tasks/)).toBeNull();
    // Its own tasks are asked for by name, wherever in the scope they sit.
    expect(calls.some((c) => c.method === "GET" && c.path.startsWith("/api/tasks?") && c.path.includes("employeeId=e1"))).toBe(true);
  });

  // D74 + D75: a researcher's cost counts the contractors its budget includes, and research it did is not "no work".
  it("counts the contractors it briefs in its cost, and says research it finished is work", async () => {
    const trackRecord = {
      ...employeeDetailFixture().trackRecord,
      runs: { finished: 7, succeeded: 6, failed: 1, cancelled: 0 },
      cost: { toDateCredits: 1.3, monthCredits: 1.3 },
      contractors: { engaged: 21, working: 0, toDateCredits: 67, monthCredits: 67 },
    };
    stub(json({ ...employeeDetailFixture({ lastRunId: "r7", jobDescription: { ...employeeDetailFixture().employee.jobDescription, monthlyCreditLimit: 400 } }), trackRecord }), { "GET /api/tasks": json([]) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    const record = await screen.findByRole("region", { name: "Track record" });
    // An older control plane's own-only figures read as the whole, as the cap counts it.
    expect(record.textContent).toContain("68 credits");
    expect(record.textContent).toContain("Budget 400 a month, 68 used this month, including the contractors it briefs; 1.3 of its own");
    expect(await screen.findByText(/has finished 7 pieces of work here, none of it split into tasks/)).toBeTruthy();
    expect(screen.queryByText(/has not taken on any/)).toBeNull();
  });

  it("reads the control plane's totals and own share as they are, and lists the runs it led under Recent work", async () => {
    const trackRecord = {
      ...employeeDetailFixture().trackRecord,
      runs: { finished: 2, succeeded: 2, failed: 0, cancelled: 0 },
      cost: { toDateCredits: 68.3, monthCredits: 68.3, ownToDateCredits: 1.3, ownMonthCredits: 1.3 },
      contractors: { engaged: 21, working: 0, toDateCredits: 67, monthCredits: 67 },
    };
    const recentRuns = [
      { id: "r2", title: "Research: A club gear log", kind: "research", status: "succeeded", startedAt: "2026-11-25T10:00:00Z", finishedAt: "2026-11-25T10:20:00Z" },
      { id: "r1", title: "Research: Dive trips", kind: "research", status: "failed", startedAt: "2026-11-24T10:00:00Z", finishedAt: "2026-11-24T10:05:00Z" },
      { id: "r0", title: "Research: A lift-sharing board", kind: "research", status: "cancelled", startedAt: "2026-11-23T10:00:00Z", finishedAt: "2026-11-23T10:05:00Z" },
    ];
    stub(json({ ...employeeDetailFixture({ jobDescription: { ...employeeDetailFixture().employee.jobDescription, monthlyCreditLimit: 400 } }), trackRecord, recentRuns }), { "GET /api/tasks": json([]) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    const record = await screen.findByRole("region", { name: "Track record" });
    expect(record.textContent).toContain("Budget 400 a month, 68 used this month, including the contractors it briefs; 1.3 of its own");
    const led = await screen.findByRole("table", { name: "Work it led" });
    expect(within(led).getByRole("link", { name: "Research: A club gear log" }).getAttribute("href")).toBe("/runs/r2");
    expect(led.textContent).toContain("Did not succeed");
    // One status vocabulary (real-stack 51): a cancelled or failed piece of work never reads "Finished".
    const cancelled = within(led).getByRole("link", { name: "Research: A lift-sharing board" }).closest("tr") as HTMLElement;
    expect(cancelled.textContent).toContain("Cancelled");
    expect(led.textContent).not.toContain("Finished");
    expect(within(led).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Work", "Status", "When"]);
  });

  it("technical mode names the tools and the tier", async () => {
    stub(json(employeeDetailFixture()));
    const { store } = renderWithStore(<EmployeeView employeeId="e1" />);
    store.dispatch(modeSet("technical"));
    expect(await screen.findByText(/Search the web \(web_search\)/)).toBeTruthy();
    expect(screen.getByText("Standard, for reading and judging (research)")).toBeTruthy();
  });

  it("shows an empty memory and a memory that failed to load, distinctly", async () => {
    stub(json(employeeDetailFixture()), { "GET /api/employees/e1/memory": json([]) });
    const first = renderWithStore(<EmployeeView employeeId="e1" />);
    expect((await screen.findByText("Nothing remembered yet")).closest("[data-state]")?.getAttribute("data-state")).toBe("empty");
    first.unmount();
    stub(json(employeeDetailFixture()), { "GET /api/employees/e1/memory": problem(403, "Forbidden") });
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect(await screen.findByText("The memory could not be loaded")).toBeTruthy();
  });

  it("adds to the memory at once, and takes it back with the reason when refused", async () => {
    const api = stub(json(employeeDetailFixture()), { "POST /api/employees/e1/memory": problem(403, "Builders only") });
    renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add something Ada should know" }));
    const form = screen.getByRole("form", { name: "Add to the memory" });
    fireEvent.change(within(form).getByLabelText("In a few words"), { target: { value: "Weekends off" } });
    fireEvent.change(within(form).getByLabelText("What Ada should remember"), { target: { value: "No deploys on weekends." } });
    fireEvent.click(within(form).getByRole("button", { name: "Add it" }));
    expect(await screen.findByText(/It was not saved: Builders only/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Memory entries" })).queryByText("Weekends off")).toBeNull();
    expect(api.calls.find((c) => c.method === "POST" && c.path.includes("/memory"))?.body).toEqual({ title: "Weekends off", body: "No deploys on weekends.", kind: "fact" });
  });

  it("corrects and removes an entry, with why", async () => {
    const api = stub(json(employeeDetailFixture()), {
      "PATCH /api/employees/e1/memory/m1": json({ ...MEMORY[0], body: "Proof of payment first." }),
      "DELETE /api/employees/e1/memory/m2": json(null, 204),
    });
    renderWithStore(<EmployeeView employeeId="e1" />);
    const entries = await screen.findByRole("list", { name: "Memory entries" });
    fireEvent.click(within(entries).getAllByRole("button", { name: "Correct" })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("What Ada should remember"), { target: { value: "Proof of payment first." } });
    fireEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    expect(await screen.findByText("Proof of payment first.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("list", { name: "Memory entries" })).getAllByRole("button", { name: "Remove" })[1] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/Why should Ada forget this/), { target: { value: "Out of date" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(screen.queryByText("Three contractors, not six")).toBeNull());
    expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/employees/e1/memory/m2?why=Out%20of%20date");
  });

  it("starts a review", async () => {
    stub(json(employeeDetailFixture()), { "POST /api/employees/e1/reviews": json({ id: "rv2", kind: "review", title: "Memory review: Ada", scope: "acme/tools", status: "queued", startedAt: "t", finishedAt: null, ideaId: null, estimateCredits: null }, 201) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Review now" }));
    expect((await screen.findByRole("link", { name: "Review started — watch it" })).getAttribute("href")).toBe("/runs/rv2");
  });

  it("pauses at once and rolls back with the reason when refused; a standing hire cannot be let go", async () => {
    stub(json(employeeDetailFixture({ standing: "security-reviewer" })), { "PATCH /api/employees/e1": problem(409, "It is mid-run") });
    renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText(/Could not pause: It is mid-run/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Let go" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/A standing hire is never let go/)).toBeTruthy();
  });

  it("lets an employee go only after confirming, and offers a rehire once released", async () => {
    const api = stub(json(employeeDetailFixture()), { "POST /api/employees/e1/release": json({ ...employeeDetailFixture().employee, status: "released" }) });
    const first = renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Let go" }));
    expect(api.calls.some((c) => c.path.endsWith("/release"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, let Ada go" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/release"))).toBe(true));
    first.unmount();
    stub(json(employeeDetailFixture({ status: "released", releasedAt: "2026-11-20T10:00:00Z" })));
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect(await screen.findByRole("button", { name: "Rehire Ada" })).toBeTruthy();
    expect(screen.getByText(/Archived when it was let go/)).toBeTruthy();
  });

  it("keeps a long record in hand: the newest ten memories and pieces of work, then Show all, and the memory searchable by words and kind", async () => {
    const kinds = ["fact", "practice", "preference", "lesson"] as const;
    const memory = Array.from({ length: 60 }, (_, i) => ({ ...MEMORY[0], id: `lm${i}`, title: i === 37 ? "Court 3 has no lights" : `Note ${i}`, body: `Body ${i}`, kind: kinds[i % 4] }));
    const tasks = Array.from({ length: 40 }, (_, i) => ({ ...TASKS[0], id: `lt${i}`, title: `Piece ${i}`, status: i % 8 === 3 ? "cancelled" : "done", updatedAt: `2026-11-${String(26 - (i % 20)).padStart(2, "0")}T10:00:00Z` }));
    stub(json(employeeDetailFixture()), { "GET /api/employees/e1/memory": json(memory), "GET /api/tasks": json(tasks) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    const entries = await screen.findByRole("list", { name: "Memory entries" });
    expect(within(entries).getAllByRole("listitem")).toHaveLength(10);
    const work = await screen.findByRole("table", { name: "Tasks" });
    expect(within(work).getAllByRole("row")).toHaveLength(11);
    // A cancelled piece of work says so, and never "Finished".
    expect(work.textContent).toContain("Cancelled");
    expect(work.textContent).not.toContain("Finished");
    fireEvent.click(screen.getByRole("button", { name: "Show all 40 pieces of work" }));
    expect(within(work).getAllByRole("row")).toHaveLength(41);
    fireEvent.click(screen.getByRole("button", { name: "Show all 60 entries" }));
    expect(within(screen.getByRole("list", { name: "Memory entries" })).getAllByRole("listitem")).toHaveLength(60);
    fireEvent.change(screen.getByLabelText("Search what Ada remembers"), { target: { value: "no lights" } });
    expect(within(screen.getByRole("list", { name: "Memory entries" })).getAllByRole("listitem").map((li) => li.querySelector("span")?.textContent)).toEqual(["Court 3 has no lights"]);
    fireEvent.change(screen.getByLabelText("Search what Ada remembers"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Show entries of one kind" })).getByRole("button", { name: /^Lessons/ }));
    // Shown in full once "Show all" was chosen: every lesson, and only lessons.
    expect(within(screen.getByRole("list", { name: "Memory entries" })).getAllByRole("listitem")).toHaveLength(15);
  });

  it("draws the actions as one group, the rest behind More on a phone, and opens that menu when a lesson points into it", async () => {
    stub(json(employeeDetailFixture()));
    renderWithStore(<EmployeeView employeeId="e1" />);
    const group = await screen.findByRole("group", { name: "Actions" });
    const more = within(group).getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const menu = document.getElementById(more.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(menu.hasAttribute("data-fold-body")).toBe(true);
    expect(within(menu).getByRole("button", { name: "Let go" }).className).toContain("border-attention-text");
    menu.dispatchEvent(new CustomEvent("endgame:reveal", { bubbles: true }));
    await waitFor(() => expect(more.getAttribute("aria-expanded")).toBe("true"));
    // The panel an action opens is under the header, not inside the group, so the group never moves.
    fireEvent.click(within(menu).getByRole("button", { name: "Reassign" }));
    expect(group.contains(screen.getByRole("form", { name: "Reassign" }))).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
});
