import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDetail } from "@/store/types";
import { ONTOLOGY_APP, VERSIONS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { AppView } from "./AppView";
import { capNote } from "./appModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const NO_HISTORY: AppDetail["runningCost"] = { state: "not-enough-history", windowDays: 14, minimumHours: 24, measuredHours: 0, basis: "Nothing measured yet.", prices: "Today's prices.", sleep: null, alwaysOn: null, measured: null };
const APP: AppDetail = {
  id: "a1",
  name: "Ledger web",
  scope: "acme/tools/ledger/web",
  health: { state: "healthy", summary: "Running." },
  running: "asleep",
  addresses: { path: "https://host.test/acme/tools/ledger", subdomain: null },
  telemetry: null,
  cost: { monthCredits: 33, capCredits: 400 },
  settings: { running: "sleep", access: "shared" },
  runningCost: NO_HISTORY,
  sharedWith: 2,
  endUsers: 0,
  status: "sleeping",
  version: "1.2.0",
  publishedAt: "2026-11-20T10:00:00Z",
  idleMinutes: 15,
};
const CAP = { kind: "budget", key: "monthly_credits", value: 400, setAtLevel: "division", setAtPath: "acme/tools", setAt: "t", overrides: [] };
const INHERITED_CAP = [CAP];
const TREE = {
  generatedAt: "t",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] },
  divisions: [{ id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }],
  needsYou: [],
};
const VIEWER = { ...ME, memberships: [{ ...ME.memberships[0], role: "viewer" }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}, me: { memberships: { role: string }[] } = ME, app: AppDetail = APP) {
  return stubApi({
    "GET /api/me": json(me),
    "GET /api/credits": json(CREDITS),
    "GET /api/tree": json({ ...TREE, viewerRole: me.memberships[0]?.role ?? "none" }),
    "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }),
    "GET /api/apps/a1": json(app),
    "GET /api/secrets": json({ scope: APP.scope, effective: [], setBelow: [] }),
    "GET /api/apps/a1/shares": json([]),
    "GET /api/ontology": json(ONTOLOGY_APP),
    "GET /api/apps/a1/dashboard": json([]),
    "GET /api/apps/a1/versions": json(VERSIONS),
    // The app's own conversation reads its history and a message's cost; unstubbed, a slow run drew their failure as an alert.
    "GET /api/conversations": json({ scope: APP.scope, conversationId: null, employeeId: null, messages: [] }),
    "GET /api/conversations/estimate": json({ credits: 0.5, ceiling: 2, basis: "" }),
    "GET /api/cascade": (req) => json(req.path.includes("kind=budget") ? INHERITED_CAP : []),
    ...extra,
  });
}

describe("the cap note", () => {
  const names = (path: string) => (path === "acme/tools" ? "Tools" : path);
  it("names the app's own cap, a cap above it and where, or none anywhere", () => {
    expect(capNote(APP, [{ ...CAP, setAtPath: APP.scope }] as never, names)).toBe("Its own cap: 400 credits a month");
    expect(capNote(APP, INHERITED_CAP as never, names)).toBe("No cap of its own; Tools's 400 credits applies");
    expect(capNote({ ...APP, cost: { monthCredits: 0, capCredits: null } }, [], names)).toBe("No cap on it or above it");
  });
});

describe("what the app may spend", () => {
  it("says where its cap comes from and that its AI allowance is the standard one", async () => {
    stub();
    renderWithStore(<AppView appId="a1" />);
    const section = within(await screen.findByRole("region", { name: "What it may spend" }));
    expect((await section.findByTestId("monthly_credits-now")).textContent).toBe("400 credits a month, from Tools");
    expect(section.getByText("None is set on it or above it, so FrostAura's standard allowance applies.")).toBeTruthy();
    expect(screen.getByText("No cap of its own; Tools's 400 credits applies")).toBeTruthy();
  });

  it("lets an Admin set the app's own AI allowance", async () => {
    const api = stub({ "PUT /api/cascade": json({ kind: "setting", key: "app_models.monthly_credits", value: 80, setAtLevel: "app", setAtPath: APP.scope, setAt: "t", overrides: [] }) });
    renderWithStore(<AppView appId="a1" />);
    const offers = await screen.findAllByRole("button", { name: "Set one for Ledger web" });
    fireEvent.click(offers[offers.length - 1] as HTMLElement);
    const form = within(screen.getByRole("form", { name: "Set its ai allowance" }));
    fireEvent.change(form.getByLabelText("Credits a month"), { target: { value: "80" } });
    fireEvent.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: APP.scope, kind: "setting", key: "app_models.monthly_credits", value: 80 }));
    expect(await screen.findByText("Ledger web may spend 80 credits a month here.")).toBeTruthy();
  });
});

describe("the app page by role", () => {
  it("shows a Viewer how it runs and who may open it, with who changes them, and asks for no secrets or shares", async () => {
    const api = stub({}, VIEWER);
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("A Builder or above changes how it runs.")).toBeTruthy();
    expect(screen.getByText("An Admin or the Owner chooses who can open it.")).toBeTruthy();
    for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("An Admin or the Owner sees which secrets it is given, and adds or changes them.")).toBeTruthy();
    expect(screen.getByText("Ledger web is shared with 2 people.")).toBeTruthy();
    expect(screen.getByText("It sleeps after 15 idle minutes. A Builder or above changes it.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.calls.some((c) => c.path.startsWith("/api/secrets") || c.path.endsWith("/shares"))).toBe(false);
  });

  it("changes the idle minutes at once, and puts them back when refused", async () => {
    stub({ "POST /api/apps/a1/settings": problem(403, "This needs the builder role") });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Sleeps after this many idle minutes"), { target: { value: "30" } });
    fireEvent.click(within(screen.getByRole("form", { name: "Idle minutes before it sleeps" })).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/It was not changed: This needs the builder role\. It still sleeps after 15 idle minutes\./)).toBeTruthy();
  });

  it("refuses idle minutes outside 1 to 1,440 before asking", async () => {
    stub();
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Sleeps after this many idle minutes"), { target: { value: "2000" } });
    expect(screen.getByText("A whole number of minutes, from 1 to 1,440.")).toBeTruthy();
  });

  it("says when an invitation was e-mailed as well as shown", async () => {
    stub({ "POST /api/apps/a1/shares": json({ email: "ann@example.test", invitationCode: "c0de", expiresAt: "2026-12-09T00:00:00Z", emailed: true }, 201) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Invite by e-mail"), { target: { value: "ann@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByText(/the code was e-mailed to them/)).toBeTruthy();
  });
});

describe("rebuild and restart", () => {
  it("is offered when the app stopped working, and says when it is running again", async () => {
    const api = stub({ "POST /api/apps/a1/republish": json({ version: VERSIONS.versions[0], published: true, madePrivate: false, publishError: null }) }, ME, { ...APP, status: "failed", health: { state: "down", summary: "It stopped working and needs attention." } });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("Ledger web stopped working.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild and restart" }));
    expect(await screen.findByText("Ledger web is rebuilt and running again.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/apps/a1/republish")).toBe(true);
  });

  it("says plainly when it could not be rebuilt", async () => {
    stub({ "POST /api/apps/a1/republish": json({ version: VERSIONS.versions[0], published: false, madePrivate: false, publishError: "docker build failed" }) }, ME, { ...APP, status: "stopped" });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Rebuild and restart" }));
    expect(await screen.findByText(/Ledger web could not be rebuilt\. Its last version stays as it is/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("docker");
  });
});
