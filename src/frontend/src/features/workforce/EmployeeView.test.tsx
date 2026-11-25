import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY, MEMORY_CHANGES, employeeDetailFixture } from "@/test/fixtures";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { modeSet } from "@/store/uiSlice";
import { EmployeeView } from "./EmployeeView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };
const TASKS = [{ id: "t1", scope: "acme/tools", runId: "r5", parentTaskId: null, title: "Research: Pager", description: "", status: "done", holderRunId: "r5", holderEmployeeId: "e1", claimedAt: null, estimateCredits: 60, actualCredits: 54, dependsOn: [], createdAt: "t", updatedAt: "t" }];

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
    expect(record.textContent).toContain("Within 12%");
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
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ title: "Weekends off", body: "No deploys on weekends.", kind: "fact" });
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
});
