import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modeSet } from "@/store/uiSlice";
import { TOKENS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi, type Route } from "@/test/harness";
import { AssistantsView } from "./AssistantsView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = {
  generatedAt: "t",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] },
  divisions: [{ id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [{ id: "p1", slug: "ledger", name: "Ledger", stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 0 }, workers: [], apps: [{ id: "a1", slug: "web", name: "Ledger web", health: "healthy", running: "awake", access: "private", sharedWith: 0, visitsToday: null, lastVisitAt: null, spend: { monthCredits: 0 }, workers: [] }] }] }],
  needsYou: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(tokens: Route, extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }), "GET /api/tokens": tokens, ...extra });
}

/** When the console last received the list of keys from the server. */
function tokensFetchedAt(store: ReturnType<typeof renderWithStore>["store"]): number {
  const entry = Object.entries(store.getState().api.queries).find(([key]) => key.startsWith("getTokens"))?.[1];
  return entry?.fulfilledTimeStamp ?? 0;
}

describe("AssistantsView", () => {
  it("speaks plainly in normal mode and names the protocol only in technical mode", async () => {
    stub(json(TOKENS));
    const { store } = renderWithStore(<AssistantsView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Let an AI assistant work with your organisation" })).toBeTruthy();
    expect(document.querySelector("main")?.textContent).not.toMatch(/\bMCP\b|token/);
    act(() => void store.dispatch(modeSet("technical")));
    expect(screen.getByRole("heading", { level: 1, name: "MCP access tokens" })).toBeTruthy();
  });

  it("says when a revoked key was revoked, never an end it will not reach (D7)", async () => {
    const revoked = { ...TOKENS[0], id: "t3", name: "Lost laptop", revokedAt: "2026-11-24T10:00:00Z", active: false };
    stub(json([revoked]));
    renderWithStore(<AssistantsView />);
    const row = (await screen.findByText("Lost laptop")).closest("li") as HTMLElement;
    expect(row.textContent).toContain("revoked 24 Nov 2026");
    expect(row.textContent).not.toMatch(/ended|ends/);
  });

  it("shows loading, a failed read and an empty list distinctly", async () => {
    stub("pending");
    renderWithStore(<AssistantsView />);
    expect((await screen.findByText("Loading the assistants you let in")).closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
    cleanup();
    stub(problem(500, "The database did not answer"));
    renderWithStore(<AssistantsView />);
    expect(await screen.findByText("The assistants you let in could not be loaded")).toBeTruthy();
    cleanup();
    stub(json([]));
    renderWithStore(<AssistantsView />);
    expect(await screen.findByText("No assistant has a key yet")).toBeTruthy();
  });

  it("lists each key with its role, when it was last used and whether it still works", async () => {
    stub(json(TOKENS));
    renderWithStore(<AssistantsView />);
    const list = await screen.findByRole("list", { name: "Keys" });
    const laptop = list.querySelector('[data-token="t1"]') as HTMLElement;
    expect(within(laptop).getByText(/Last used/)).toBeTruthy();
    expect(within(laptop).getByText("Active")).toBeTruthy();
    expect(within(list.querySelector('[data-token="t2"]') as HTMLElement).getByText("Never used")).toBeTruthy();
    expect(within(list.querySelector('[data-token="t2"]') as HTMLElement).getByText("Revoked")).toBeTruthy();
  });

  it("gives the two kinds of address: the organisation's and each app's", async () => {
    stub(json(TOKENS));
    renderWithStore(<AssistantsView />);
    // Shown whole, in one piece, and free to break only after a "/" — never inside a name or an id.
    const address = (text: string) => (_: string, el: Element | null) => el?.tagName === "CODE" && el.textContent === text;
    const org = await screen.findByText(address(`${window.location.origin}/mcp`));
    expect(org.querySelectorAll("wbr")).toHaveLength(`${window.location.origin}/mcp`.split("/").length - 1);
    expect(org.className).toContain("break-normal");
    expect(within(await screen.findByRole("list", { name: "App addresses" })).getByText(address(`${window.location.origin}/mcp/apps/a1`))).toBeTruthy();
  });

  it("makes a key no higher than the person's role and shows it once, never in the store", async () => {
    const made = { token: "egp_secret_value_shown_once", accessToken: { ...TOKENS[0], id: "t3", name: "Desk assistant", role: "admin" } };
    // The server keeps what it made: the console invalidates its list after a create and refetches it, and on a fast
    // machine that refetch lands before the assertions below — a stub that forgot the new key made this test flaky.
    // The refetch after the create is held until the test lets it land, so its order is fixed.
    let held: unknown[] = TOKENS;
    let created = false;
    let land: (() => void) | null = null;
    const list = () => (created ? new Promise<Response>((resolve) => (land = () => resolve(json(held)))) : json(held));
    const api = stub(list, { "POST /api/tokens": () => ((created = true), (held = [made.accessToken, ...TOKENS]), json(made, 201)) });
    const { store } = renderWithStore(<AssistantsView />);
    await screen.findByRole("list", { name: "Keys" });
    const role = screen.getByLabelText("What it may do") as HTMLSelectElement;
    expect([...role.options].map((o) => o.value)).toEqual(["admin", "builder", "viewer"]);
    fireEvent.change(screen.getByLabelText("Which assistant is it for?"), { target: { value: "Desk assistant" } });
    fireEvent.change(role, { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("It stops working"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the key" }));
    const once = await screen.findByRole("status", { name: "The new key" });
    expect(within(once).getByText("egp_secret_value_shown_once")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Desk assistant", organisation: "acme", role: "admin", expiresInDays: 30 });
    expect(JSON.stringify(store.getState())).not.toContain("egp_secret_value_shown_once");
    expect(within(screen.getByRole("list", { name: "Keys" })).getByText("Desk assistant")).toBeTruthy();
    // After the refetch the list is the server's, and the key is still there.
    await waitFor(() => expect(land).not.toBeNull());
    const before = tokensFetchedAt(store);
    act(() => land?.());
    await waitFor(() => expect(tokensFetchedAt(store)).toBeGreaterThan(before));
    await act(async () => {});
    expect(within(screen.getByRole("list", { name: "Keys" })).getByText("Desk assistant")).toBeTruthy();
  });

  it("revokes at once after a confirmation, and puts the key back when refused", async () => {
    stub(json(TOKENS), { "DELETE /api/tokens/t1": () => new Promise<Response>((r) => setTimeout(() => r(problem(409, "Already revoked elsewhere")), 60)) });
    renderWithStore(<AssistantsView />);
    const row = (await screen.findByRole("list", { name: "Keys" })).querySelector('[data-token="t1"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(row).getByRole("button", { name: "Revoke it" }));
    await waitFor(() => expect(within(row).getByText("Revoked")).toBeTruthy());
    expect(await within(row).findByText(/The key still works: Already revoked elsewhere/)).toBeTruthy();
    await waitFor(() => expect(within(row).getByText("Active")).toBeTruthy());
  });
});
