import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDetail } from "@/store/types";
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
  runningCost: { sleep: 10, alwaysOn: 80 },
  sharedWith: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(app: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/apps/a1": app, ...extra });
}

describe("AppView", () => {
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
});
