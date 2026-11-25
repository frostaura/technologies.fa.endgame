import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBERS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { PeopleView } from "./PeopleView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = {
  generatedAt: "t",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] },
  divisions: [{ id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }],
  needsYou: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(members: Response | "pending", extra = {}) {
  return stubApi({
    "GET /api/me": json(ME),
    "GET /api/credits": json(CREDITS),
    "GET /api/tree": json(TREE),
    "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }),
    "GET /api/members": members,
    ...extra,
  });
}

describe("PeopleView", () => {
  it("shows a skeleton while the people load", () => {
    stub("pending");
    renderWithStore(<PeopleView />);
    expect(screen.getByText("Loading the people").closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
  });

  it("records a refusal as a failed read, never an empty list", async () => {
    stub(problem(403, "This needs the admin role"));
    renderWithStore(<PeopleView />);
    expect(await screen.findByText("Only an Admin or the Owner can see the people here")).toBeTruthy();
    expect(screen.queryByText(/No one holds a role/)).toBeNull();
  });

  it("says when no one holds a role", async () => {
    stub(json([]));
    renderWithStore(<PeopleView />);
    expect(await screen.findByText("No one holds a role in Acme yet")).toBeTruthy();
  });

  it("lists each person with their role and where it was set, and says what every role may do", async () => {
    stub(json(MEMBERS));
    renderWithStore(<PeopleView />);
    const list = await screen.findByRole("list", { name: "People" });
    const kit = list.querySelector('[data-member="kit@example.test"]') as HTMLElement;
    expect(within(kit).getByText("Set at Tools")).toBeTruthy();
    expect(within(kit).getByText(/No passkey yet/)).toBeTruthy();
    expect(within(list.querySelector('[data-member="o@example.test"]') as HTMLElement).getAllByText("Owner").length).toBe(2);
    const roles = screen.getByRole("region", { name: "What each role may do" });
    for (const r of ["Owner", "Admin", "Builder", "Viewer"]) expect(within(roles).getByText(r)).toBeTruthy();
  });

  it("invites by e-mail to a role at a level, and shows the one-time code once, saying whether it was e-mailed", async () => {
    const invited = { member: { ...MEMBERS[1], membershipId: "ms3", email: "ann@example.test", displayName: "Ann", scope: "acme/tools", role: "admin" }, invitationCode: "one-time-code-123", expiresAt: "2026-12-09T00:00:00Z", emailed: false };
    const api = stub(json(MEMBERS), { "POST /api/members": json(invited, 201) });
    const { store } = renderWithStore(<PeopleView />);
    await screen.findByRole("list", { name: "People" });
    fireEvent.change(screen.getByLabelText("E-mail address"), { target: { value: "ann@example.test" } });
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Ann" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "acme/tools" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const code = await screen.findByRole("status", { name: "Invitation code" });
    expect(within(code).getByText("one-time-code-123")).toBeTruthy();
    expect(code.textContent).toContain("E-mail is not set up here, so give them this code yourself.");
    expect(api.calls.find((c) => c.path === "/api/members" && c.method === "POST")?.body).toEqual({ scope: "acme/tools", email: "ann@example.test", displayName: "Ann", role: "admin" });
    // The code never reaches the store.
    expect(JSON.stringify(store.getState())).not.toContain("one-time-code-123");
  });

  it("changes a role at once and puts it back when refused", async () => {
    const own = { ...MEMBERS[1], scope: "acme" };
    // The refusal arrives a moment later, so the change is seen to happen first.
    stub(json([MEMBERS[0], own]), { "PATCH /api/members/ms2": () => new Promise<Response>((r) => setTimeout(() => r(problem(403, "Only the Owner changes an Admin")), 80)) });
    renderWithStore(<PeopleView />);
    const select = (await screen.findByLabelText("Role for Kit")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "viewer" } });
    await waitFor(() => expect((screen.getByLabelText("Role for Kit") as HTMLSelectElement).value).toBe("viewer"));
    expect(await screen.findByText(/The role was not changed: Only the Owner changes an Admin/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Role for Kit") as HTMLSelectElement).value).toBe("builder"));
  });

  it("asks before removing someone and removes them", async () => {
    const own = { ...MEMBERS[1], scope: "acme" };
    const api = stub(json([MEMBERS[0], own]), { "DELETE /api/members/ms2": json(null, 204) });
    renderWithStore(<PeopleView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Kit" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm removing Kit" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("kit@example.test")).toBeNull());
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/members/ms2")).toBe(true);
  });

  it("below the organisation, shows the Owner and grants from above as set there", async () => {
    window.history.replaceState(null, "", "/people?scope=acme/tools");
    stub(json([MEMBERS[0], { ...MEMBERS[1], scope: "acme/tools" }]));
    renderWithStore(<PeopleView />);
    const list = await screen.findByRole("list", { name: "People" });
    const owner = list.querySelector('[data-member="o@example.test"]') as HTMLElement;
    expect(within(owner).getByText("Set at Acme")).toBeTruthy();
    expect(within(list.querySelector('[data-member="kit@example.test"]') as HTMLElement).getByText("Set here")).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });

  it("does not offer inviting where the role is below Admin, though the organisation grant is higher", async () => {
    window.history.replaceState(null, "", "/people?scope=acme/tools");
    const me = { ...ME, memberships: [
      { id: "m1", scope: "acme", level: "organisation", role: "admin", organisationId: "o1", organisationSlug: "acme", organisationName: "Acme" },
      { id: "m2", scope: "acme/tools", level: "division", role: "viewer", organisationId: "o1", organisationSlug: "acme", organisationName: "Acme" },
    ] };
    stub(problem(403, "Only an Admin or the Owner"), {
      "GET /api/me": json(me),
      "GET /api/tree": json({ ...TREE, viewerRole: "admin", organisation: { ...TREE.organisation, role: "admin" }, divisions: [{ ...TREE.divisions[0], role: "viewer" }] }),
    });
    renderWithStore(<PeopleView />);
    expect(await screen.findByText("Only an Admin or the Owner can see the people here")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invite someone" })).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("sends a pending person a new code, shown once, and says how long a code works", async () => {
    const own = { ...MEMBERS[1], scope: "acme", invitationExpiresAt: "2099-12-02T00:00:00Z" };
    const api = stub(json([MEMBERS[0], own]), {
      "POST /api/members/ms2/invitation": json({ member: { ...own, invitationExpiresAt: "2099-12-09T00:00:00Z" }, invitationCode: "fresh-code-456", expiresAt: "2099-12-09T00:00:00Z", emailed: true }),
    });
    const { store } = renderWithStore(<PeopleView />);
    const list = await screen.findByRole("list", { name: "People" });
    const kit = list.querySelector('[data-member="kit@example.test"]') as HTMLElement;
    expect(within(kit).getByText(/No passkey yet: their code works until/)).toBeTruthy();
    expect(screen.getByText(/It works for 7 days; a new one can be sent from their row./)).toBeTruthy();
    // The Owner, who has a passkey, has no such control.
    expect(within(list.querySelector('[data-member="o@example.test"]') as HTMLElement).queryByRole("button", { name: "Send a new code" })).toBeNull();
    fireEvent.click(within(kit).getByRole("button", { name: "Send a new code" }));
    const code = await screen.findByRole("status", { name: "New invitation code for Kit" });
    expect(within(code).getByText("fresh-code-456")).toBeTruthy();
    expect(code.textContent).toContain("It was e-mailed to them too.");
    expect(code.textContent).toContain("the code they had before no longer does");
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/members/ms2/invitation")).toBe(true);
    expect(JSON.stringify(store.getState())).not.toContain("fresh-code-456");
  });
});
