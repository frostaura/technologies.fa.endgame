import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB, MEMORY, MEMORY_CHANGES, employeeDetailFixture, employeeFixture, hireFixture } from "@/test/fixtures";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { EmployeeView } from "./EmployeeView";
import { HireView } from "./HireView";
import { HiresView } from "./HiresView";
import { draftOf, employeePatchFrom } from "./workforceModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = {
  generatedAt: "t",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] },
  divisions: [
    { id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] },
    { id: "d2", slug: "labs", name: "Labs", spend: { monthCredits: 0 }, workers: [], projects: [] },
  ],
  needsYou: [],
};
const BOSS = employeeFixture({ id: "e2", name: "Grace", role: "Division lead" });
const PEOPLE = [employeeFixture(), BOSS, employeeFixture({ id: "e3", name: "Old Tom", role: "Tester", status: "released", releasedAt: "2026-11-01T00:00:00Z" })];

function stub(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}, me: { memberships: { role: string }[] } = ME) {
  return stubApi({
    "GET /api/me": json(me),
    "GET /api/credits": json(CREDITS),
    "GET /api/tree": json({ ...TREE, viewerRole: me.memberships[0]?.role ?? "none" }),
    "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }),
    "GET /api/employees": (req) => json(req.path.includes("includeReleased") ? PEOPLE : PEOPLE.filter((p) => p.status !== "released")),
    "GET /api/employees/e1": json(employeeDetailFixture({ reportsTo: { id: "e2", name: "Grace" } })),
    "GET /api/employees/e1/memory": json(MEMORY),
    "GET /api/employees/e1/memory/changes": json(MEMORY_CHANGES),
    "GET /api/tasks": json([]),
    "GET /api/conversations": json({ scope: "acme/tools", conversationId: null, employeeId: "e1", messages: [] }),
    ...extra,
  });
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("a job as a patch", () => {
  it("sends only what changed, and clears an emptied budget or manager instead of keeping it", () => {
    const before = draftOf({ name: "Ada", role: "Researcher", reportsTo: { id: "e2", name: "Grace" } }, { mandate: "M", scope: "acme", tools: ["read_file"], services: [], monthlyCreditLimit: 40, modelTier: "research" });
    expect(employeePatchFrom(before, before)).toEqual({});
    expect(employeePatchFrom(before, { ...before, budget: "", reportsTo: "", tools: ["read_file", "web_search"], modelTier: "build" })).toEqual({
      clearMonthlyCreditLimit: true,
      clearReportsTo: true,
      jobDescription: { tools: ["read_file", "web_search"], modelTier: "build" },
    });
  });
});

describe("an employee's whole job", () => {
  it("is edited at once and put back with the reason when refused", async () => {
    const api = stub({ "PATCH /api/employees/e1": problem(400, "'x' is not a model tier") });
    renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the job" }));
    const form = within(screen.getByRole("form", { name: "Edit Ada's job" }));
    fireEvent.change(form.getByLabelText("Role"), { target: { value: "Lead researcher" } });
    fireEvent.click(form.getByRole("checkbox", { name: "Change files" }));
    fireEvent.change(form.getByLabelText("Its own monthly budget"), { target: { value: "" } });
    fireEvent.click(form.getByRole("button", { name: "Save the job" }));
    expect(await screen.findByText(/Could not change the job: 'x' is not a model tier\./)).toBeTruthy();
    expect(screen.getByText(/Product researcher · Employee/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ role: "Lead researcher", clearMonthlyCreditLimit: true, jobDescription: { tools: ["read_file", "web_search", "spawn", "edit_file"] } });
  });

  it("reassigns keeping the manager unless another is chosen", async () => {
    const api = stub({ "POST /api/employees/e1/reassign": json(employeeFixture({ scope: "acme/labs" })) });
    renderWithStore(<EmployeeView employeeId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reassign" }));
    await screen.findByRole("option", { name: /Labs/ });
    fireEvent.change(screen.getByLabelText("Move Ada to"), { target: { value: "acme/labs" } });
    await waitFor(() => expect((screen.getByLabelText("Reports to") as HTMLSelectElement).value).toBe("e2"));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/reassign"))?.body).toEqual({ scope: "acme/labs", reportsTo: "e2" }));
  });

  it("rehires a released employee somewhere else", async () => {
    const api = stub({
      "GET /api/employees/e1": json(employeeDetailFixture({ status: "released", releasedAt: "2026-11-01T00:00:00Z" })),
      "POST /api/employees/e1/rehire": json(employeeFixture({ scope: "acme/labs" })),
    });
    renderWithStore(<EmployeeView employeeId="e1" />);
    await screen.findByRole("option", { name: /Labs/ });
    fireEvent.change(screen.getByLabelText("Where Ada works again"), { target: { value: "acme/labs" } });
    fireEvent.click(screen.getByRole("button", { name: "Rehire Ada" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/rehire"))?.body).toEqual({ scope: "acme/labs" }));
  });

  it("links each contractor working now to its record, and lists what changed in the memory", async () => {
    stub();
    renderWithStore(<EmployeeView employeeId="e1" />);
    const working = await screen.findByRole("list", { name: "Contractors working now" });
    expect(within(working).getByRole("link").getAttribute("href")).toBe("/employees/c1");
    const changes = await screen.findByRole("list", { name: "Changes to the memory" });
    expect(within(changes).getAllByRole("listitem")).toHaveLength(4);
    expect(changes.textContent).toContain("Corrected at a review: Three contractors, not six");
    expect(changes.textContent).toContain("“Out of date”");
    expect(changes.textContent).toContain("Added by the employee: Proof before building");
  });

  it("stops a contractor after confirming, and caps what it may spend", async () => {
    const contractor = employeeFixture({ id: "c1", kind: "contractor", name: "Data contractor", role: "Data contractor", status: "working", brief: "Count the courts.", briefedBy: { id: "e1", name: "Odile" }, jobDescription: { ...JOB, monthlyCreditLimit: null } });
    const detail = { ...employeeDetailFixture(), employee: contractor, contractors: [] };
    const api = stub({
      "GET /api/employees/c1": json(detail),
      "GET /api/employees/c1/memory": json([]),
      "GET /api/employees/c1/memory/changes": json([]),
      "PATCH /api/employees/c1": json({ ...contractor, jobDescription: { ...JOB, monthlyCreditLimit: 25 } }),
      "POST /api/employees/c1/stop": json({ ...contractor, status: "released", releasedAt: "2026-11-25T10:00:00Z" }),
    });
    renderWithStore(<EmployeeView employeeId="c1" />);
    expect(await screen.findByText("No cap of its own; Odile’s budget holds")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Let go" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cap its spending" }));
    fireEvent.change(screen.getByLabelText("Credits a month, at most"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the cap" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ jobDescription: { monthlyCreditLimit: 25 } }));

    fireEvent.click(screen.getByRole("button", { name: "Stop this contractor" }));
    const confirm = screen.getByRole("group", { name: "Confirm stopping" });
    expect(confirm.textContent).toContain("It makes no more calls from its next step.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, stop it" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/employees/c1/stop")).toBe(true));
  });

  it("records a failed read of the memory's history, never an empty one", async () => {
    stub({ "GET /api/employees/e1/memory/changes": problem(500, "Down") });
    renderWithStore(<EmployeeView employeeId="e1" />);
    expect(await screen.findByText("What changed in the memory could not be loaded")).toBeTruthy();
  });
});

describe("editing a proposal", () => {
  it("clears its budget when the field is emptied, and edits what it may use", async () => {
    const api = stub({ "GET /api/hires/h1": json(hireFixture()), "PATCH /api/hires/h1": json(hireFixture({ jobDescription: { ...hireFixture().jobDescription, monthlyCreditLimit: null } })) });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the proposal" }));
    fireEvent.change(screen.getByLabelText("Its own monthly budget (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Search the web" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the proposal" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ clearMonthlyCreditLimit: true, jobDescription: { tools: ["read_file", "edit_file", "run", "web_search"] } }));
  });

  it("refuses an empty reason instead of silently keeping the old one", async () => {
    const api = stub({ "GET /api/hires/h1": json(hireFixture()) });
    renderWithStore(<HireView hireId="h1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit the proposal" }));
    fireEvent.change(screen.getByLabelText("Why this hire"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save the proposal" }));
    expect(await screen.findByText("Say why this hire is needed; a proposal always gives its reason.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("hiring by hand", () => {
  const HIRES = { "GET /api/hires": json([]), "GET /api/employees/recurring-roles": json([{ scope: "acme/tools", role: "Competitor sweep", contractors: 3, windowDays: 30, costCredits: 90, lastBriefedBy: "e1", lastBrief: "Sweep the competitors." }]) };

  it("asks for a hire of your own choosing, and opens the proposal", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme/tools");
    const api = stub({ ...HIRES, "POST /api/hires": json(hireFixture({ id: "h7" }), 201) });
    renderWithStore(<HiresView />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a hire" }));
    const form = within(await screen.findByRole("form", { name: "Ask for a hire for Tools" }));
    fireEvent.change(form.getByLabelText("Name"), { target: { value: "Kit" } });
    fireEvent.change(form.getByLabelText("Role"), { target: { value: "Designer" } });
    fireEvent.change(form.getByLabelText("What it should cost a month"), { target: { value: "120" } });
    fireEvent.change(form.getByLabelText("Why this hire"), { target: { value: "Nobody designs here." } });
    fireEvent.click(form.getByRole("button", { name: "Ask for this hire" }));
    await waitFor(() => expect(window.location.pathname).toBe("/hires/h7"));
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ scope: "acme/tools", name: "Kit", role: "Designer", reason: "Nobody designs here.", expectedMonthlyCredits: 120, trigger: "owner" });
  });

  it("proposes a recurring role with the role itself, so the system's own need is the same one", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme");
    const api = stub({ ...HIRES, "POST /api/hires": json(hireFixture({ id: "h9" }), 201) });
    renderWithStore(<HiresView />);
    fireEvent.click(await screen.findByRole("button", { name: "Propose as a permanent hire" }));
    fireEvent.change(screen.getByLabelText("Name the new employee"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose the hire" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ trigger: "promotion", contractorRole: "Competitor sweep" }));
    expect((api.calls.find((c) => c.method === "POST")?.body as Record<string, unknown>).needKey).toBeUndefined();
  });

  it("offers neither to a Builder, and says who may", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme");
    stub(HIRES, { ...ME, memberships: [{ ...ME.memberships[0], role: "builder" }] });
    renderWithStore(<HiresView />);
    expect(await screen.findByText("An Admin or the Owner proposes it as a hire.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Propose as a permanent hire" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask for a hire" })).toBeNull();
  });

  it("lists the people let go, each to its record", async () => {
    window.history.replaceState(null, "", "/hires?scope=acme");
    stub(HIRES);
    renderWithStore(<HiresView />);
    const list = await screen.findByRole("list", { name: "People let go" });
    expect(within(list).getByRole("link").getAttribute("href")).toBe("/employees/e3");
    expect(list.textContent).toContain("Old Tom");
  });
});
