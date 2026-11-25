import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modeSet } from "@/store/uiSlice";
import type { AppDetail } from "@/store/types";
import { ASK_ANSWER, ASK_ESTIMATE, ONTOLOGY_APP, SAVED, VERSIONS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { AppView } from "./AppView";
import { versionTitle } from "./appModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const APP: AppDetail = {
  id: "a1",
  name: "Ledger web",
  scope: "acme/tools/ledger/web",
  health: { state: "healthy", summary: "Running version f2a84f83c1f6d2852e9f62f57720ec931052273d." },
  running: "awake",
  addresses: { path: "https://host.test/acme/tools/ledger/web/", subdomain: "https://acme.host.test/tools/ledger/web/" },
  telemetry: { visitsToday: 2, requestsToday: 22, errorsToday: 0, latencyP50Ms: 1.9, latencyP95Ms: 174.3, lastVisitAt: null },
  cost: { monthCredits: 0.07, capCredits: null },
  settings: { running: "sleep", access: "public" },
  runningCost: { sleep: 74, alwaysOn: 184 },
  sharedWith: 0,
  status: "running",
  version: "f2a84f83c1f6d2852e9f62f57720ec931052273d",
  publishedAt: "2026-11-25T01:59:54Z",
  idleMinutes: 15,
};
const SECRETS = { scope: APP.scope, effective: [{ name: "MAIL_KEY", setAtLevel: "organisation", setAtPath: "acme", setAt: "2026-11-01T00:00:00Z", inherited: true, overrides: [] }], setBelow: [] };
const VIEWER = { ...ME, memberships: [{ ...ME.memberships[0], role: "viewer" }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The mode toggle is remembered; each test starts in normal mode.
  localStorage.clear();
});

function stub(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return stubApi({
    "GET /api/me": json(ME),
    "GET /api/credits": json(CREDITS),
    "GET /api/tree": json({ generatedAt: "t", viewerRole: "owner", organisation: null, divisions: [], needsYou: [] }),
    "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }),
    "GET /api/apps/a1": json(APP),
    "GET /api/secrets": json(SECRETS),
    "GET /api/ontology": json(ONTOLOGY_APP),
    "GET /api/apps/a1/dashboard": json([]),
    "GET /api/apps/a1/versions": json(VERSIONS),
    ...extra,
  });
}

describe("asking about an app", () => {
  it("shows what it costs before anything is asked, then the answer and its chart, without the query in normal mode", async () => {
    const api = stub({ "POST /api/apps/a1/ask/estimate": json(ASK_ESTIMATE), "POST /api/apps/a1/ask": json(ASK_ANSWER) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Ask about this app"), { target: { value: "Which days are busiest?" } });
    expect(screen.queryByRole("button", { name: "Ask it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    expect(await screen.findByText("At most 0.4 credits.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/apps/a1/ask")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ask it" }));
    expect(await screen.findByText("Tuesday and Thursday are the busiest days.")).toBeTruthy();
    expect(screen.getByRole("img", { name: /visits: Mon 52, Tue 96, Thu 88/ })).toBeTruthy();
    expect(screen.getByText("Cost 0.1 credits of at most 0.4 credits")).toBeTruthy();
    expect(screen.queryByText("The query")).toBeNull();
  });

  it("names a question it cannot answer in words, and keeps the page", async () => {
    stub({ "POST /api/apps/a1/ask/estimate": json(ASK_ESTIMATE), "POST /api/apps/a1/ask": json({ title: "That question could not be turned into a safe query", status: 422, code: "ask_unanswerable" }, 422) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Ask about this app"), { target: { value: "Drop everything" } });
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask it" }));
    expect((await screen.findByText(/Try asking it another way/)).getAttribute("role")).toBe("alert");
  });

  it("keeps an answer on the dashboard at once, and takes it off again when the control plane refuses", async () => {
    stub({ "POST /api/apps/a1/ask/estimate": json(ASK_ESTIMATE), "POST /api/apps/a1/ask": json(ASK_ANSWER), "POST /api/apps/a1/dashboard": problem(403, "This needs the builder role") });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("Nothing is kept on the dashboard yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Ask about this app"), { target: { value: "Which days are busiest?" } });
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask it" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep this on the dashboard" }));
    expect(await screen.findByText(/It was not kept: This needs the builder role/)).toBeTruthy();
    expect(screen.getByText("Nothing is kept on the dashboard yet")).toBeTruthy();
  });

  it("offers estimates but not asking to a Viewer", async () => {
    stub({ "GET /api/me": json(VIEWER), "POST /api/apps/a1/ask/estimate": json(ASK_ESTIMATE) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.change(await screen.findByLabelText("Ask about this app"), { target: { value: "Visits?" } });
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    expect(await screen.findByText(/needs the Builder role here/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask it" })).toBeNull();
  });
});

describe("the dashboard", () => {
  it("shows a skeleton, then each kept question re-run, and a broken one says why", async () => {
    stub({ "GET /api/apps/a1/dashboard": json([SAVED, { ...SAVED, id: "q2", question: "Bookings?", error: "It reads a table the app no longer has." }]) });
    renderWithStore(<AppView appId="a1" />);
    const list = await screen.findByRole("list", { name: "Kept questions" });
    expect(within(list).getByText("About forty a day this week.")).toBeTruthy();
    expect(within(list).getByText("This question no longer runs: It reads a table the app no longer has.")).toBeTruthy();
  });

  it("records a failed read on the page", async () => {
    stub({ "GET /api/apps/a1/dashboard": problem(503, "Questions about apps cannot be answered yet") });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("The dashboard could not be loaded")).toBeTruthy();
  });

  it("shows each saved query only in technical mode", async () => {
    stub({ "GET /api/apps/a1/dashboard": json([SAVED]) });
    const { store } = renderWithStore(<AppView appId="a1" />);
    await screen.findByRole("list", { name: "Kept questions" });
    expect(screen.queryByText("The query")).toBeNull();
    act(() => void store.dispatch(modeSet("technical")));
    expect(screen.getByText("The query")).toBeTruthy();
  });
});

describe("history", () => {
  it("lists versions with who made each and which is live, in plain words", async () => {
    stub();
    renderWithStore(<AppView appId="a1" />);
    const list = await screen.findByRole("list", { name: "Versions" });
    expect(within(list).getByText("Fix ownership check on book status update")).toBeTruthy();
    expect(within(list).getByText("Replace the Notes screens with the Books screens")).toBeTruthy();
    expect(within(list).getByText("The factory recorded its progress")).toBeTruthy();
    expect(within(list).getAllByRole("link", { name: "Theo" })[0]?.getAttribute("href")).toBe("/employees/e1");
    expect(within(list).getByText("Live now")).toBeTruthy();
    expect(list.textContent).not.toMatch(/f2a84f83|web\/src/);
    expect(screen.getByRole("button", { name: "Show earlier versions" })).toBeTruthy();
  });

  it("asks before bringing a version back, says a public app becomes private, and reports the result", async () => {
    const api = stub({ "POST /api/apps/a1/versions/0a38497783f51c9f0e344298c429e72d336b8814/restore": json({ version: VERSIONS.versions[2], published: true, madePrivate: true, publishError: null }) });
    renderWithStore(<AppView appId="a1" />);
    const list = await screen.findByRole("list", { name: "Versions" });
    const row = list.querySelector('[data-version="0a38497783f51c9f0e344298c429e72d336b8814"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^Bring back “Replace the Notes screens/ }));
    const dialog = within(row).getByRole("alertdialog");
    expect(dialog.textContent).toContain("It is public now, so it becomes private");
    fireEvent.click(within(dialog).getByRole("button", { name: "Bring it back" }));
    expect(await screen.findByText("The earlier version is back and running.")).toBeTruthy();
    expect(screen.getByText(/It was public, so it is private now/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/restore"))).toBe(true);
  });

  it("keeps the live version when a restore is refused, with the reason", async () => {
    stub({ "POST /api/apps/a1/versions/0a38497783f51c9f0e344298c429e72d336b8814/restore": problem(502, "Hosting did not answer") });
    renderWithStore(<AppView appId="a1" />);
    const row = (await screen.findByRole("list", { name: "Versions" })).querySelector('[data-version="0a38497783f51c9f0e344298c429e72d336b8814"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^Bring back “Replace the Notes screens/ }));
    fireEvent.click(within(row).getByRole("button", { name: "Bring it back" }));
    expect(await screen.findByText(/That version was not brought back: Hosting did not answer/)).toBeTruthy();
  });

  it("records a failed read and an empty history distinctly", async () => {
    stub({ "GET /api/apps/a1/versions": problem(502, "Hosting did not answer") });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("The history could not be loaded")).toBeTruthy();
    cleanup();
    stub({ "GET /api/apps/a1/versions": json({ appId: "a1", live: null, versions: [], hasMore: false }) });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("No versions yet")).toBeTruthy();
  });

  it("names a version by its first line, its id only in technical mode", () => {
    expect(versionTitle(VERSIONS.versions[2] as never, false)).toBe("Replace the Notes screens with the Books screens");
    expect(versionTitle(VERSIONS.versions[2] as never, true)).toBe("frontend-books: replace the Notes screens with the Books screens");
  });
});

describe("what it uses, and taking it away", () => {
  it("lists the services it leans on, its secrets by name, and that assistants can use it", async () => {
    stub();
    renderWithStore(<AppView appId="a1" />);
    const uses = await screen.findByRole("list", { name: "What it uses" });
    expect(within(uses).getByText("Sign-in")).toBeTruthy();
    expect(within(uses).getByText("Visits and errors measured")).toBeTruthy();
    expect(within(uses).getByText("1 secret")).toBeTruthy();
    expect(within(uses).getByText("Open to AI assistants")).toBeTruthy();
    expect(screen.getByText(/Secrets it can read: MAIL_KEY/)).toBeTruthy();
    expect(screen.queryByText(/MCP:/)).toBeNull();
  });

  it("lets the Owner download everything, and says plainly when the download cannot be made", async () => {
    stub({ "GET /api/apps/a1/export": json({ title: "Not found", detail: "Dock found nothing for the data export.", status: 404 }, 404) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download everything" }));
    expect((await screen.findByText(/The download could not be made: Dock found nothing for the data export/)).getAttribute("role")).toBe("alert");
  });

  it("tells anyone but the Owner that only the Owner can download it", async () => {
    stub({ "GET /api/me": json(VIEWER) });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("Only the Owner can download it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download everything" })).toBeNull();
  });

  it("shows what the app is underneath only in technical mode, and never its version id in normal mode", async () => {
    stub();
    const { store } = renderWithStore(<AppView appId="a1" />);
    await screen.findByRole("heading", { name: "Ledger web" });
    expect(document.body.textContent).not.toContain("f2a84f83c1f6d2852e9f62f57720ec931052273d");
    expect(screen.getByText("No errors today")).toBeTruthy();
    act(() => void store.dispatch(modeSet("technical")));
    const underneath = screen.getByRole("region", { name: "Underneath" });
    expect(within(underneath).getByText("awake")).toBeTruthy();
    expect(within(underneath).getAllByText("f2a84f83c1f6d2852e9f62f57720ec931052273d").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/MCP: .*\/mcp\/apps\/a1/)).toBeTruthy());
  });
});
