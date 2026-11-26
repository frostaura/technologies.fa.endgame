import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDetail } from "@/store/types";
import { ONTOLOGY_APP } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { AppView } from "./AppView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { organisation: null, divisions: [], needsYou: [] };
const APP: AppDetail = {
  id: "a1",
  name: "Ledger web",
  scope: "acme/tools/ledger/web",
  health: { state: "healthy", summary: "No errors today" },
  running: "asleep",
  addresses: { path: "https://host.test/acme/tools/ledger", subdomain: "https://acme.host.test/ledger" },
  telemetry: { visitsToday: 12, requestsToday: 90, errorsToday: 0, latencyP50Ms: 120, latencyP95Ms: 1500, lastVisitAt: null },
  cost: { monthCredits: 33, capCredits: 100 },
  settings: { running: "sleep", access: "private" },
  runningCost: { state: "estimated", windowDays: 14, minimumHours: 24, measuredHours: 58, basis: "Measured over the last 14 days: awake 8 of the 58 hours measured, using 448 MB while awake, 2 GB stored and about 59,586 requests a month.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: { credits: 10, awakeHoursPerMonth: 99.3, basis: "Awake about 99 hours a month, as it was 8 of the 58 hours measured in the last 14 days, using 448 MB while awake, with 2 GB stored and about 59,586 requests a month." }, alwaysOn: { credits: 80, awakeHoursPerMonth: 720, basis: "Awake all 720 hours of a month at the 448 MB it uses while awake, with the same 2 GB stored and about 59,586 requests a month." }, measured: { awakeHours: 8, memoryMb: 448, storageMb: 2048, requestsPerMonth: 59586 } },
  sharedWith: 0,
  endUsers: 0,
  status: "sleeping",
  version: "1.2.0",
  publishedAt: "2026-11-20T10:00:00Z",
  idleMinutes: 15,
};

const NO_HISTORY: AppDetail["runningCost"] = { state: "not-enough-history", windowDays: 14, minimumHours: 24, measuredHours: 0, basis: "Nothing measured yet. An estimate needs at least 24 hours of this app's own use in the last 14 days.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: null, alwaysOn: null, measured: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SECRETS = {
  scope: "acme/tools/ledger/web",
  effective: [
    { name: "MAIL_KEY", setAtLevel: "organisation", setAtPath: "acme", setAt: "2026-11-01T00:00:00Z", inherited: true, overrides: [] },
    { name: "PAY_KEY", setAtLevel: "app", setAtPath: "acme/tools/ledger/web", setAt: "2026-11-02T00:00:00Z", inherited: false, overrides: [] },
  ],
  setBelow: [],
};
const SHARED: AppDetail = { ...APP, settings: { running: "sleep", access: "shared" }, sharedWith: 1 };
const SHARES = [{ email: "ann@example.test", invitedAt: "2026-11-20T00:00:00Z", registered: true }];

function stub(app: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/apps/a1": app, "GET /api/secrets": json(SECRETS), "GET /api/cascade": json([]), ...extra });
}

describe("AppView", () => {
  it("names the app's own organisation, not the person's first one", async () => {
    const other = { ...APP, scope: "beta/tools/ledger/web" };
    stub(json(other), {
      "GET /api/me": json({ ...ME, memberships: [...ME.memberships, { id: "m2", scope: "beta", level: "organisation", role: "owner", organisationId: "o2", organisationSlug: "beta", organisationName: "Beta Works" }] }),
    });
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("Private: only people in Beta Works")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Where you are" }).textContent).toContain("Beta Works");
    expect(screen.queryByText("Private: only people in Acme")).toBeNull();
  });

  it("shows a skeleton while loading", () => {
    stub("pending");
    renderWithStore(<AppView appId="a1" />);
    expect(screen.getByRole("status").dataset.state).toBe("loading");
  });

  it("records a failed read and names a missing app", async () => {
    stub(problem(404, "App not found"));
    renderWithStore(<AppView appId="a1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("This app could not be found");
  });

  it("a missing app is an answer: no 'Nothing here is known', and a way back instead of Try again", async () => {
    stub(problem(404, "App not found"));
    renderWithStore(<AppView appId="a1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("Nothing here is known until it loads.");
    expect(within(alert).getByRole("link", { name: "Back to the org chart" }).getAttribute("href")).toBe("/");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows status, both addresses, telemetry and its running and access settings", async () => {
    stub(json(APP));
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByRole("heading", { name: "Ledger web" })).toBeTruthy();
    expect(screen.getByText(/https:\/\/acme.host.test\/ledger · also at https:\/\/host.test\/acme\/tools\/ledger/)).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("120 ms")).toBeTruthy();
    expect(screen.getByText("Slowest 1 in 20: 1.5 s")).toBeTruthy();
    expect(screen.getByText("Cap 100 credits")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Sleeps when unused/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/About 80 credits a month/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Private: only people in Acme/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("says when there is no traffic to measure, rather than showing zeros", async () => {
    stub(json({ ...APP, telemetry: { visitsToday: 0, requestsToday: 0, errorsToday: 0, latencyP50Ms: null, latencyP95Ms: null, lastVisitAt: null } }));
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText("No traffic yet")).toBeTruthy();
    expect(screen.getByText("No visits yet")).toBeTruthy();
  });

  it("switches running at once and keeps the change when it saves", async () => {
    const api = stub(json(APP), { "POST /api/apps/a1/settings": json({ ...APP, settings: { running: "always-on", access: "private" } }) });
    renderWithStore(<AppView appId="a1" />);
    const on = (await screen.findByRole("radio", { name: /Always on/ })) as HTMLInputElement;
    fireEvent.click(on);
    // Optimistic: checked before the control plane has answered.
    await waitFor(() => expect(on.checked).toBe(true));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ running: "always-on" }));
  });

  it("rolls a refused change back and says why on the page", async () => {
    stub(json(APP), { "POST /api/apps/a1/settings": problem(403, "Only an Admin can change this") });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Shared/ }));
    expect(await screen.findByText(/The change was not saved: Only an Admin can change this/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Private/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("makes an app public only after a person confirms it", async () => {
    const api = stub(json(APP), { "POST /api/apps/a1/settings": json({ ...APP, settings: { running: "sleep", access: "public" } }) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Public/ }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Make it public" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ access: "public" }));
  });

  it("says an app that has measured nothing yet is not measured, never zero, and does not crash", async () => {
    stub(json({ ...APP, telemetry: null, runningCost: NO_HISTORY }));
    renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByRole("heading", { name: "Ledger web" })).toBeTruthy();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByText("Not measured yet")).toHaveLength(2);
    expect(within(today).queryByText("0")).toBeNull();
    expect(screen.getAllByText(/Not enough history yet to say what it costs a month/)).toHaveLength(2);
    expect(screen.queryByText(/About \d+ credits a month/)).toBeNull();
    expect(screen.getByText(/Not enough history yet\. Nothing measured yet\. An estimate needs at least 24 hours/)).toBeTruthy();
  });

  it("gives each running choice its monthly figure with what it assumes, and today's prices", async () => {
    stub(json(APP));
    renderWithStore(<AppView appId="a1" />);
    const sleeps = (await screen.findByRole("radio", { name: /Sleeps when unused/ })).closest("label") as HTMLElement;
    expect(sleeps.textContent).toContain("About 10 credits a month.");
    expect(sleeps.textContent).toContain("Awake about 99 hours a month, as it was 8 of the 58 hours measured in the last 14 days");
    const always = screen.getByRole("radio", { name: /Always on/ }).closest("label") as HTMLElement;
    expect(always.textContent).toContain("About 80 credits a month.");
    expect(always.textContent).toContain("Awake all 720 hours of a month at the 448 MB");
    expect(screen.getByText(/Today's prices: 0\.2 credits an awake hour/)).toBeTruthy();
    expect(screen.queryByText(/Not enough history yet/)).toBeNull();
  });

  it("says how many people signed up to it in what it uses", async () => {
    stub(json({ ...APP, endUsers: 14 }), { "GET /api/ontology": json(ONTOLOGY_APP) });
    renderWithStore(<AppView appId="a1" />);
    const uses = await screen.findByRole("list", { name: "What it uses" });
    expect(within(uses).getByText("14 people signed up")).toBeTruthy();
    cleanup();
    stub(json({ ...APP, endUsers: 0 }), { "GET /api/ontology": json(ONTOLOGY_APP) });
    renderWithStore(<AppView appId="a1" />);
    expect(within(await screen.findByRole("list", { name: "What it uses" })).getByText("No one has signed up yet")).toBeTruthy();
  });

  it("asks a person to confirm making it public, in a dialog that can be declined", async () => {
    const api = stub(json(APP));
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("radio", { name: /Public/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Make Ledger web public?" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it as it is" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("lists the secrets the app can read by name, never a value, with a way to manage them", async () => {
    stub(json(APP));
    renderWithStore(<AppView appId="a1" />);
    const secrets = await screen.findByRole("region", { name: "Secrets" });
    expect(await within(secrets).findByText("MAIL_KEY")).toBeTruthy();
    expect(within(secrets).getByText("Set at organisation level")).toBeTruthy();
    expect(within(secrets).getByText("Set on this app")).toBeTruthy();
    expect(within(secrets).getByRole("link", { name: "Manage secrets" }).getAttribute("href")).toBe("/secrets?scope=acme%2Ftools%2Fledger%2Fweb");
  });

  it("tells a private app how to share it, and lists who a shared app is shared with", async () => {
    stub(json(APP));
    const first = renderWithStore(<AppView appId="a1" />);
    expect(await screen.findByText(/Set it to Shared to invite people by e-mail/)).toBeTruthy();
    first.unmount();
    stub(json(SHARED), { "GET /api/apps/a1/shares": json(SHARES) });
    renderWithStore(<AppView appId="a1" />);
    const list = await screen.findByRole("list", { name: "People it is shared with" });
    expect(within(list).getByText("ann@example.test")).toBeTruthy();
    expect(within(list).getByText("Registered")).toBeTruthy();
  });

  it("shows a refused share list as a failure, never as nobody", async () => {
    stub(json(SHARED), { "GET /api/apps/a1/shares": problem(403, "This needs the admin role") });
    renderWithStore(<AppView appId="a1" />);
    const sharing = await screen.findByRole("region", { name: "Sharing" });
    const alert = await within(sharing).findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("This needs the admin role.");
    expect(within(sharing).queryByText(/Not shared with anyone yet/)).toBeNull();
  });

  it("says plainly when a shared app has nobody on its list yet", async () => {
    stub(json(SHARED), { "GET /api/apps/a1/shares": json([]) });
    renderWithStore(<AppView appId="a1" />);
    expect((await screen.findByText(/Not shared with anyone yet/)).dataset.state).toBe("empty");
  });

  it("invites by e-mail and shows the one-time code once, keeping it out of the store", async () => {
    const created = { email: "bo@example.test", invitationCode: "c0ffee1234", expiresAt: "2026-12-08T00:00:00Z" };
    let answer: (r: Response) => void = () => {};
    let invited = false;
    const api = stub(json(SHARED), {
      "GET /api/apps/a1/shares": () => json(invited ? [...SHARES, { email: "bo@example.test", invitedAt: "2026-11-25T00:00:00Z", registered: false }] : SHARES),
      "POST /api/apps/a1/shares": () =>
        new Promise<Response>((resolve) => {
          answer = (r) => {
            invited = true;
            resolve(r);
          };
        }),
    });
    const { store } = renderWithStore(<AppView appId="a1" />);
    await screen.findByRole("list", { name: "People it is shared with" });
    const input = screen.getByLabelText("Invite by e-mail");
    fireEvent.change(input, { target: { value: "not an address" } });
    expect(screen.getByText("That does not look like an e-mail address.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Invite" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: " Bo@Example.test " } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    // Optimistic: the address is on the list before the control plane has answered.
    expect(await screen.findByText("bo@example.test", { selector: "span" })).toBeTruthy();
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ email: "bo@example.test" }));
    answer(json(created, 201));
    const code = await screen.findByRole("status", { name: "Invitation code" });
    expect(within(code).getByText("c0ffee1234")).toBeTruthy();
    expect(within(code).getByText("It will not be shown again.")).toBeTruthy();
    expect(JSON.stringify(store.getState())).not.toContain("c0ffee1234");
    fireEvent.click(within(code).getByRole("button", { name: "Done" }));
    expect(screen.queryByText("c0ffee1234")).toBeNull();
    expect(screen.getByText("bo@example.test", { selector: "span" })).toBeTruthy();
  });

  it("takes a refused invitation back off the list and says why", async () => {
    stub(json(SHARED), { "GET /api/apps/a1/shares": json(SHARES), "POST /api/apps/a1/shares": problem(409, "That address is already registered") });
    renderWithStore(<AppView appId="a1" />);
    await screen.findByRole("list", { name: "People it is shared with" });
    fireEvent.change(screen.getByLabelText("Invite by e-mail"), { target: { value: "cy@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByText(/cy@example.test was not invited: That address is already registered\./)).toBeTruthy();
    expect(screen.queryByText("cy@example.test", { selector: "span" })).toBeNull();
  });

  it("stops sharing only after it is confirmed", async () => {
    const api = stub(json(SHARED), { "GET /api/apps/a1/shares": json(SHARES), "DELETE /api/apps/a1/shares": json(null, 204) });
    renderWithStore(<AppView appId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop sharing with ann@example.test" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    const confirm = screen.getByRole("group", { name: "Confirm stopping sharing with ann@example.test" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/apps/a1/shares?email=ann%40example.test"));
    await waitFor(() => expect(screen.queryByText("ann@example.test")).toBeNull());
  });
});
