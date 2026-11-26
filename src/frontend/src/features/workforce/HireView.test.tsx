import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hireFixture } from "@/test/fixtures";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { HireView } from "./HireView";
import { HiresView } from "./HiresView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };

function stub(hire: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/hires/h1": hire, ...extra });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("HireView", () => {
  it("loading, failed", async () => {
    stub("pending");
    const first = renderWithStore(<HireView hireId="h1" />);
    expect(screen.getAllByRole("status")[0]?.dataset.state).toBe("loading");
    first.unmount();
    stub(problem(404, "Not found"));
    renderWithStore(<HireView hireId="h1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("This hire proposal could not be found");
    // A not-found is an answer: the way back, not a retry (D62).
    expect(screen.getByRole("link", { name: "Back to the org chart" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says one cost everywhere when its own budget is below the expected cost (D24)", async () => {
    const capped = hireFixture({ expectedMonthlyCredits: 1500, jobDescription: { ...hireFixture().jobDescription, monthlyCreditLimit: 800 } });
    stub(json(capped));
    renderWithStore(<HireView hireId="h1" />);
    expect(await screen.findByText("800")).toBeTruthy();
    expect(screen.getByText("credits a month at most: its own budget caps it")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hire Lin" }));
    expect(screen.getByText("Hire Lin at about 800 credits a month?")).toBeTruthy();
    expect(document.body.textContent).not.toContain("1,500");
  });

  it("shows the drafted job and its monthly cost in plain words, and whether it fits the budget", async () => {
    stub(json(hireFixture()));
    renderWithStore(<HireView hireId="h1" />);
    expect(await screen.findByRole("heading", { name: "Lin, Engineer" })).toBeTruthy();
    expect(screen.getByText("Build Ledger to its plan.")).toBeTruthy();
    expect(screen.getByText("Strong, for building")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("More than the budget has room for")).toBeTruthy();
    expect(document.body.textContent).not.toContain("build-t1");
  });

  it("accepts after confirming, with a note", async () => {
    const api = stub(json(hireFixture()), { "POST /api/hires/h1/accept": json(hireFixture({ status: "accepted", employeeId: "e7", decision: { via: "person", by: "Owner", at: "2026-11-24T10:00:00Z", note: "Go" } })) });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hire Lin" }));
    const form = screen.getByRole("form", { name: "Confirm the hire" });
    fireEvent.change(within(form).getByLabelText(/A note for the record/), { target: { value: "Go" } });
    fireEvent.click(within(form).getByRole("button", { name: "Yes, hire" }));
    expect(await screen.findByRole("link", { name: "See Lin’s record" })).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ note: "Go" });
  });

  it("declines, and a refused decision rolls back with the reason", async () => {
    stub(json(hireFixture()), { "POST /api/hires/h1/decline": problem(409, "Already decided") });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, decline" }));
    expect(await screen.findByText(/Your decision was not recorded: Already decided/)).toBeTruthy();
    expect(screen.getByText("Hire proposed")).toBeTruthy();
  });

  it("edits the proposal optimistically and puts it back when refused", async () => {
    const api = stub(json(hireFixture()), { "PATCH /api/hires/h1": problem(400, "Unknown model tier") });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the proposal" }));
    fireEvent.change(screen.getByLabelText("Expected credits a month"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the proposal" }));
    expect(await screen.findByText(/The edit was not saved: Unknown model tier/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("300")).toBeTruthy());
    expect((api.calls.find((c) => c.method === "PATCH")?.body as { expectedMonthlyCredits: number }).expectedMonthlyCredits).toBe(250);
  });

  it("saves a budget below the expected cost as the cost too, so the page and the server agree (D24)", async () => {
    const api = stub(json(hireFixture()), { "PATCH /api/hires/h1": "pending" });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the proposal" }));
    fireEvent.change(screen.getByLabelText("Its own monthly budget (optional)"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the proposal" }));
    expect(await screen.findByText("200")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ expectedMonthlyCredits: 200, jobDescription: { monthlyCreditLimit: 200 } });
  });
});

describe("HiresView", () => {
  it("lists proposals waiting and decided, and proposes a recurring contractor role as a hire", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme");
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/tree": json(TREE),
      "GET /api/hires": json([hireFixture(), hireFixture({ id: "h2", status: "declined", name: "Ruth" })]),
      "GET /api/employees/recurring-roles": json([{ scope: "acme/tools", role: "Competitor sweep", contractors: 3, windowDays: 30, costCredits: 90, lastBriefedBy: "e1", lastBrief: "Sweep the competitors." }]),
      "POST /api/hires": json(hireFixture({ id: "h9" }), 201),
    });
    renderWithStore(<HiresView />);
    expect(await screen.findByRole("link", { name: /Lin, Engineer for Tools/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Decided" }).textContent).toContain("Ruth");
    fireEvent.click(await screen.findByRole("button", { name: "Propose as a permanent hire" }));
    fireEvent.change(screen.getByLabelText("Name the new employee"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose the hire" }));
    await waitFor(() => expect(window.location.pathname).toBe("/hires/h9"));
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ scope: "acme/tools", name: "Sam", role: "Competitor sweep", trigger: "promotion", expectedMonthlyCredits: 90 });
  });

  it("shows nothing proposed as an empty state, and a failed read as a failure", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme");
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/hires": json([]), "GET /api/employees/recurring-roles": problem(500, "Down") });
    renderWithStore(<HiresView />);
    expect(await screen.findByText("No hires have been proposed here")).toBeTruthy();
    expect(await screen.findByText("Recurring roles could not be loaded")).toBeTruthy();
  });
});
