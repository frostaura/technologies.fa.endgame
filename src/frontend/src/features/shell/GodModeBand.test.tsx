import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithStore, stubApi } from "@/test/harness";
import { AutonomyView } from "../autonomy/AutonomyView";
import { NotificationsView } from "../notifications/NotificationsView";
import { AppShell } from "./AppShell";

const OPERATOR = { user: { id: "op1", displayName: "Operator", email: "op@example.test" }, organisation: { id: "f1", slug: "frostaura", name: "FrostAura" }, isOperator: true, passkeys: 1, memberships: [
  { id: "m1", scope: "frostaura", level: "organisation", role: "owner", organisationId: "f1", organisationSlug: "frostaura", organisationName: "FrostAura" },
] };
const tree = (slug: string, name: string, role: string) => ({
  generatedAt: "t",
  viewerRole: role,
  organisation: { id: `${slug}-id`, slug, name, summary: null, spend: { monthCredits: 0 }, workers: [], role },
  divisions: [],
  needsYou: [],
});
const credits = (scope: string, balance: number) => ({ scope, balance, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] });
const AUTONOMY = { scope: "acme", autonomy: { value: "checkpoints", setAtPath: null }, checkpoints: { start: { value: false, setAtPath: null }, plan: { value: false, setAtPath: null }, hire: { value: false, setAtPath: null } }, ruleSets: [] };

function stub() {
  return stubApi({
    "GET /api/me": json(OPERATOR),
    "GET /api/tree": (request) => json(new URL(request.path, "http://console.local").searchParams.get("organisation") === "acme" ? tree("acme", "Acme", "admin") : tree("frostaura", "FrostAura", "owner")),
    "GET /api/credits": (request) => json(new URL(request.path, "http://console.local").searchParams.get("scope") === "acme" ? credits("acme", 42) : credits("frostaura", 9000)),
    "GET /api/notifications": (request) => json({ organisation: new URL(request.path, "http://console.local").searchParams.get("organisation"), unread: 0, notifications: [] }),
    "GET /api/autonomy": json(AUTONOMY),
  });
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/?organisation=acme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("God mode on every screen", () => {
  it("names the organisation entered, and the balance and the bell are its own", async () => {
    const api = stub();
    renderWithStore(
      <AppShell crumbs={[]}>
        <p>Page</p>
      </AppShell>,
    );
    const band = await screen.findByRole("note", { name: "God mode" });
    await waitFor(() => expect(band.textContent).toContain("You are inside Acme as a FrostAura operator, acting as an Admin."));
    expect(within(band).getByRole("button", { name: "Leave Acme" })).toBeTruthy();
    expect(await screen.findByText("42")).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/notifications?organisation=acme&limit=50")).toBe(true));
    expect(api.calls.some((c) => c.path === "/api/credits?scope=frostaura")).toBe(false);
  });

  it("keeps working on it on a screen whose address does not name it, until the operator leaves", async () => {
    const api = stub();
    const { store, unmount } = renderWithStore(
      <AppShell crumbs={[]}>
        <p>Page</p>
      </AppShell>,
    );
    await waitFor(() => expect(store.getState().ui.entered?.slug).toBe("acme"));
    unmount();

    // A link without ?organisation= (the Autonomy link, the bell's feed) still shows Acme.
    window.history.replaceState(null, "", "/autonomy");
    const autonomy = renderWithStore(<AutonomyView />);
    autonomy.store.dispatch({ type: "ui/organisationEntered", payload: { id: "acme-id", slug: "acme", name: "Acme" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/autonomy?scope=acme")).toBe(true));
    expect(screen.getByRole("note", { name: "God mode" }).textContent).toContain("inside Acme");
    autonomy.unmount();

    window.history.replaceState(null, "", "/notifications");
    const feed = renderWithStore(<NotificationsView />);
    feed.store.dispatch({ type: "ui/organisationEntered", payload: { id: "acme-id", slug: "acme", name: "Acme" } });
    fireEvent.click(await screen.findByRole("button", { name: "Leave Acme" }));
    expect(window.location.pathname).toBe("/operator");
    expect(feed.store.getState().ui.entered).toBeNull();
    expect(sessionStorage.getItem("endgame.entered")).toBeNull();
    await waitFor(() => expect(screen.getByRole("note", { name: "God mode" }).textContent).toContain("You are a FrostAura operator."));
  });
});
