import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { api as consoleApi } from "@/store/api";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { HomeView } from "./HomeView";

const CREDITS = { scope: "acme", balance: 1234, month: { spent: 10, ai: 6, hosting: 4 }, monthsLeftAtPace: 3, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };

const worker = (id: string, name: string, activity: string | null = null) => ({ id, name, role: "Engineer", kind: "employee" as const, activity });

const TREE: Tree = {
  generatedAt: "2026-11-24T10:00:00Z",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: "All apps healthy", spend: { monthCredits: 77 }, workers: [] },
  divisions: [
    {
      id: "d1",
      slug: "tools",
      name: "Tools",
      spend: { monthCredits: 70 },
      workers: [],
      projects: [
        {
          id: "p1",
          slug: "ledger",
          name: "Ledger",
          stage: "live",
          ideaId: null,
          note: null,
          progress: null,
          spend: { monthCredits: 70 },
          workers: [worker("w1", "Kit", "Fixing the export")],
          apps: [{ id: "a1", slug: "web", name: "Ledger web", health: "healthy", running: "asleep", access: "public", sharedWith: 0, visitsToday: 5, lastVisitAt: null, spend: { monthCredits: 70 }, workers: [] }],
        },
      ],
    },
  ],
  needsYou: [{ kind: "verdict", id: "n1", ideaId: "i1", title: "Research says change “Pager”", verdict: "change", detail: "Read it, or overrule." }],
};

const NO_HISTORY = { scope: "acme", conversationId: null, employeeId: null, messages: [] };

function stub(tree: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": tree, "GET /api/conversations": json(NO_HISTORY), ...extra });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeView", () => {
  it("shows skeletons while the tree loads", () => {
    stub("pending");
    renderWithStore(<HomeView />);
    const loading = screen.getByRole("status", { name: "" });
    expect(loading.dataset.state).toBe("loading");
    expect(screen.queryByRole("region", { name: "Organisation chart" })).toBeNull();
  });

  it("records a failed read on the page, never as an empty organisation", async () => {
    stub(problem(500, "The tree could not be read"));
    renderWithStore(<HomeView />);
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("The organisation could not be loaded");
    expect(alert.textContent).toContain("The tree could not be read (500)");
    expect(screen.queryByText(/has nothing in it yet/)).toBeNull();
    expect(screen.queryByText("Name your organisation, then describe your first idea.")).toBeNull();
  });

  it("leads a first run to Start", async () => {
    stub(json({ organisation: null, divisions: [], needsYou: [] }));
    renderWithStore(<HomeView />);
    expect(await screen.findByText("Name your organisation, then describe your first idea.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start" }).getAttribute("href")).toBe("/start");
  });

  it("says plainly when an organisation is genuinely empty", async () => {
    stub(json({ ...TREE, divisions: [], needsYou: [] }));
    renderWithStore(<HomeView />);
    const empty = await screen.findByText("Acme has nothing in it yet");
    expect(empty.closest("[data-state]")?.getAttribute("data-state")).toBe("empty");
    expect(screen.getByText(/Nothing needs you right now/)).toBeTruthy();
  });

  it("draws the org chart with live status, spend and people from the API", async () => {
    stub(json(TREE));
    renderWithStore(<HomeView />);
    const chart = await screen.findByRole("region", { name: "Organisation chart" });
    expect(within(chart).getByText("Tools")).toBeTruthy();
    const ledger = within(chart).getByRole("article", { name: "Ledger" });
    expect(within(ledger).getByText("Healthy")).toBeTruthy();
    expect(within(ledger).getByText("Asleep")).toBeTruthy();
    expect(within(ledger).getByText("Public")).toBeTruthy();
    expect(within(ledger).getByRole("link", { name: /Ledger web/ }).getAttribute("href")).toBe("/apps/a1");
    expect(within(ledger).getByRole("button", { name: /Kit · Engineer/ })).toBeTruthy();
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByRole("link", { name: /Pager/ }).getAttribute("href")).toBe("/ideas/i1");
    // Totals are counted from the tree, not copied from anywhere.
    const band = screen.getByRole("region", { name: "Organisation" });
    expect(within(band).getByText("division").previousSibling?.textContent).toBe("1");
    expect(within(band).getByText("employee").previousSibling?.textContent).toBe("1");
    expect(within(band).getByText("credits this month").previousSibling?.textContent).toBe("77");
    expect(screen.getByText(/Kit is fixing the export/)).toBeTruthy();
  });

  it("scopes the breadcrumb and the conversation to the selected node, and streams the reply", async () => {
    const api = stub(json(TREE));
    api.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(req.url).pathname;
      if (path === "/api/conversations" && req.method === "GET") return json(NO_HISTORY);
      if (path === "/api/conversations") return json({ id: "run-c1", kind: "conversation", title: "", scope: "acme/tools", status: "running", startedAt: "", finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: null, spentCredits: 0 }, 201);
      if (path === "/api/tree") return json(TREE);
      if (path === "/api/credits") return json(CREDITS);
      return json(ME);
    });
    renderWithStore(<HomeView />);
    await screen.findByRole("region", { name: "Organisation chart" });
    expect(screen.getByRole("heading", { name: "Talking to Acme" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(screen.getByRole("heading", { name: "Talking to Tools" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Where you are" });
    expect(crumbs.textContent).toBe("Acme/Tools");

    fireEvent.change(screen.getByLabelText("Message Tools"), { target: { value: "What needs me?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const sent = api.fetch.mock.calls.map(([r]) => r as Request).find((r) => new URL(r.url).pathname === "/api/conversations" && r.method === "POST");
    expect(await sent?.clone().json()).toEqual({ scope: "acme/tools", message: "What needs me?" });
    expect(screen.getByText("What needs me?")).toBeTruthy();
    expect(screen.getByText("Working on it")).toBeTruthy();

    act(() => {
      const es = FakeEventSource.latest();
      es.open();
      // The control plane writes the owner's own message into the run first; it is not a reply.
      es.emit(1, "message", { from: "owner", text: "What needs me?" });
      es.emit(2, "message", { text: "One verdict waits." });
      es.emit(3, "run.finished", { outcome: "succeeded" });
    });
    expect(screen.getByText("One verdict waits.")).toBeTruthy();
    expect(screen.getAllByText("What needs me?")).toHaveLength(1);
    expect(screen.queryByText("Working on it")).toBeNull();

    // Back up the breadcrumb to the whole organisation.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Acme" }));
    expect(screen.getByRole("heading", { name: "Talking to Acme" })).toBeTruthy();
  });

  it("keeps a message that failed to send, says why, and offers to send it again", async () => {
    stub(json(TREE), { "POST /api/conversations": problem(503, "Busy") });
    renderWithStore(<HomeView />);
    await screen.findByRole("region", { name: "Organisation chart" });
    fireEvent.change(screen.getByLabelText("Message Acme"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByText(/Not sent: Busy \(503\)/);
    expect(within(alert).getByRole("button", { name: "Send again" })).toBeTruthy();
  });

  it("reads what was said before at the selected scope, so the conversation survives a reload", async () => {
    const history = {
      scope: "acme",
      conversationId: "c1",
      employeeId: null,
      messages: [
        { runId: "r1", seq: 1, at: "2026-11-24T09:00:00Z", from: "owner", text: "Is anything over budget?" },
        { runId: "r1", seq: 3, at: "2026-11-24T09:00:05Z", from: "Kit", text: "Nothing is." },
        { runId: "r1", seq: 4, at: "2026-11-24T09:00:06Z", from: "Kit", text: "Ledger web is at 70 credits." },
      ],
    };
    const api = stub(json(TREE), { "GET /api/conversations": json(history) });
    renderWithStore(<HomeView />);
    const log = await screen.findByRole("log", { name: "Conversation with Acme" });
    expect(await within(log).findByText("Is anything over budget?")).toBeTruthy();
    // One run's consecutive replies read as one bubble.
    expect(within(log).getByText("Nothing is.").parentElement).toBe(within(log).getByText("Ledger web is at 70 credits.").parentElement);
    expect(within(log).queryByText(/Ask what needs you/)).toBeNull();
    expect(api.calls.find((c) => c.path.startsWith("/api/conversations"))?.path).toBe("/api/conversations?scope=acme");
  });

  it("asks for one employee's conversation by their id", async () => {
    const api = stub(json(TREE));
    renderWithStore(<HomeView />);
    await screen.findByRole("region", { name: "Organisation chart" });
    fireEvent.click(screen.getByRole("button", { name: /Kit · Engineer/ }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/conversations?scope=acme%2Ftools%2Fledger&employeeId=w1")).toBe(true));
  });

  it("appends a new turn after the history, and does not draw a turn twice when the history includes it", async () => {
    const history = { scope: "acme", conversationId: "c1", employeeId: null, messages: [{ runId: "r0", seq: 1, at: "2026-11-24T09:00:00Z", from: "owner", text: "Earlier question" }] };
    const api = stub(json(TREE), { "GET /api/conversations": json(history) });
    api.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(req.url).pathname;
      if (path === "/api/conversations" && req.method === "POST") return json({ id: "r1", kind: "conversation", title: "", scope: "acme", status: "running", startedAt: "", finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: null, spentCredits: 0 }, 201);
      // A refetch of the history now carries the new turn too.
      if (path === "/api/conversations") return json({ ...history, messages: [...history.messages, { runId: "r1", seq: 1, at: "2026-11-24T10:00:00Z", from: "owner", text: "Newer question" }] });
      if (path === "/api/tree") return json(TREE);
      if (path === "/api/credits") return json(CREDITS);
      return json(ME);
    });
    const { store } = renderWithStore(<HomeView />);
    const log = await screen.findByRole("log", { name: "Conversation with Acme" });
    await within(log).findByText("Earlier question");
    fireEvent.change(screen.getByLabelText("Message Acme"), { target: { value: "Newer question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    act(() => {
      store.dispatch(consoleApi.util.invalidateTags(["Conversation"]));
    });
    const historyReads = () => api.fetch.mock.calls.filter(([r]) => new URL((r as Request).url).pathname === "/api/conversations" && (r as Request).method === "GET").length;
    await waitFor(() => expect(historyReads()).toBe(2));
    await waitFor(() => expect(store.getState().api.queries['getConversation({"scope":"acme"})']?.status).toBe("fulfilled"));
    expect(within(log).getAllByText("Newer question")).toHaveLength(1);
    const texts = [...log.querySelectorAll("p")].map((p) => p.textContent);
    expect(texts.indexOf("Earlier question")).toBeLessThan(texts.indexOf("Newer question"));
  });

  it("records a failed history read on the page, and still lets a message be sent", async () => {
    stub(json(TREE), { "GET /api/conversations": problem(500, "History unavailable") });
    renderWithStore(<HomeView />);
    const log = await screen.findByRole("log", { name: "Conversation with Acme" });
    const alert = await within(log).findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("History unavailable (500)");
    expect(within(log).queryByText(/Ask what needs you/)).toBeNull();
    expect((screen.getByLabelText("Message Acme") as HTMLInputElement).disabled).toBe(false);
  });

  it("offers the Owner the selection's secrets and the operator log", async () => {
    stub(json(TREE));
    renderWithStore(<HomeView />);
    const manage = await screen.findByRole("navigation", { name: "Manage" });
    expect(within(manage).getByRole("link", { name: "Secrets for Acme" }).getAttribute("href")).toBe("/secrets?scope=acme");
    expect(within(manage).getByRole("link", { name: "Operator access" }).getAttribute("href")).toBe("/operator-access");
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    expect(within(manage).getByRole("link", { name: "Secrets for Tools" }).getAttribute("href")).toBe("/secrets?scope=acme%2Ftools");
  });

  it("shows an Admin the secrets but not the operator log, and a Builder neither", async () => {
    stub(json({ ...TREE, viewerRole: "admin" }));
    const first = renderWithStore(<HomeView />);
    const manage = await screen.findByRole("navigation", { name: "Manage" });
    expect(within(manage).queryByRole("link", { name: "Operator access" })).toBeNull();
    first.unmount();
    stub(json({ ...TREE, viewerRole: "builder" }));
    renderWithStore(<HomeView />);
    await screen.findByRole("region", { name: "Organisation chart" });
    expect(screen.queryByRole("navigation", { name: "Manage" })).toBeNull();
  });
});
