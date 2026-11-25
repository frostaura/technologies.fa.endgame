import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credits } from "@/store/types";
import { TOP_UP_REQUESTS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { CreditsView } from "./CreditsView";
import { parseCredits } from "./creditsModel";

const CREDITS: Credits = {
  scope: "acme",
  balance: 4321,
  month: { spent: 300, ai: 200, hosting: 100 },
  monthsLeftAtPace: 14.4,
  budgets: [],
  estimates: null,
  notCharged: { credits: 0, repairs: 0 },
  overdraft: { frostauraLimit: 2000, ownLimit: null },
  topUps: [],
  heldCredits: 0,
  available: 6321,
};
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

function stub(extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }), "GET /api/credits/top-up-requests": json(TOP_UP_REQUESTS), ...extra });
}

describe("the Owner's own overdraft", () => {
  it("never lets it go deeper than FrostAura allows, and says so", async () => {
    stub();
    renderWithStore(<CreditsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Change your limit" }));
    expect(screen.getByText("FrostAura allows at most 2,000 below zero. Yours can be tighter, never deeper.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("How far below zero you may go"), { target: { value: "2500" } });
    expect(screen.getByText("That is deeper than the 2,000 FrostAura allows.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save my limit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a tighter limit at once and rolls it back when refused", async () => {
    const api = stub({ "PUT /api/credits/overdraft": () => new Promise<Response>((r) => setTimeout(() => r(problem(400, "Deeper than allowed")), 60)) });
    renderWithStore(<CreditsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Change your limit" }));
    fireEvent.change(screen.getByLabelText("How far below zero you may go"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my limit" }));
    await waitFor(() => expect(screen.getByText("1,000 below zero")).toBeTruthy());
    expect(await screen.findByText(/Your limit was not changed: Deeper than allowed/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Not set")).toBeTruthy());
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme", credits: 1000 });
  });

  it("sets a narrower limit for one division", async () => {
    const api = stub({ "PUT /api/credits/overdraft": json(CREDITS) });
    renderWithStore(<CreditsView />);
    fireEvent.change(await screen.findByLabelText("Below zero, at most"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Set this limit" }));
    expect(await screen.findByText("Tools now stops at 500 below zero.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/tools", credits: 500 });
  });

  it("is the Owner's alone", async () => {
    stub({ "GET /api/me": json({ ...ME, memberships: [{ ...ME.memberships[0], role: "admin" }] }) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Only the Owner sets the organisation’s own limit.")).toBeTruthy();
  });
});

describe("asking for a top-up", () => {
  it("lists requests with what became of them, and sends a new one", async () => {
    const api = stub({ "POST /api/credits/top-up-requests": json({ ...TOP_UP_REQUESTS[0], id: "tr2", credits: 500, note: "" }, 201) });
    renderWithStore(<CreditsView />);
    const list = await screen.findByRole("list", { name: "Top-up requests" });
    expect(within(list).getByText("Waiting for FrostAura")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a top-up" }));
    fireEvent.change(screen.getByLabelText("How many credits"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for it" }));
    expect(await screen.findByText(/Asked FrostAura for 500 credits/)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ organisation: "acme", credits: 500, note: "" });
  });

  it("records a failed read of the requests", async () => {
    stub({ "GET /api/credits/top-up-requests": problem(500, "No requests") });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Your top-up requests could not be loaded")).toBeTruthy();
  });

  it("reads typed credits", () => {
    expect(parseCredits("1,500")).toBe(1500);
    expect(parseCredits("abc")).toBeNull();
  });
});
