import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credits } from "@/store/types";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { CreditsView } from "./CreditsView";

const CREDITS: Credits = {
  scope: "acme",
  balance: 4321,
  month: { spent: 300, ai: 200, hosting: 100 },
  monthsLeftAtPace: 14.4,
  budgets: [
    { scope: "acme", name: "Acme", level: "organisation", depth: 0, spentCredits: 300, capCredits: 1000, appId: null },
    { scope: "acme/tools", name: "Tools", level: "division", depth: 1, spentCredits: 250, capCredits: null, appId: null },
    { scope: "acme/tools/ledger/web", name: "Ledger web", level: "app", depth: 3, spentCredits: 90, capCredits: 100, appId: "a1" },
  ],
  estimates: { pieces: 8, withinPercent: 11, under: 5, over: 3, largestMissPercent: 19, typicalGapPercent: -12.5, typically: "under" },
  notCharged: { credits: 42, repairs: 3 },
  overdraft: { frostauraLimit: 2000, ownLimit: null, limits: [] },
  topUps: [{ at: "2026-11-01T00:00:00Z", credits: 5000, note: "Added by FrostAura" }],
  heldCredits: 6,
  available: 6321,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreditsView", () => {
  it("reads credits at the division of someone granted only that division, and lets its Admin set caps there", async () => {
    const division: Credits = {
      ...CREDITS,
      scope: "acme/tools",
      budgets: [
        { scope: "acme/tools", name: "Tools", level: "division", depth: 0, spentCredits: 250, capCredits: null, appId: null },
        { scope: "acme/tools/ledger/web", name: "Ledger web", level: "app", depth: 2, spentCredits: 90, capCredits: 100, appId: "a1" },
      ],
    };
    const me = { ...ME, memberships: [{ id: "m2", scope: "acme/tools", level: "division", role: "admin", organisationId: "o1", organisationSlug: "acme", organisationName: "Acme" }] };
    const api = stubApi({ "GET /api/me": json(me), "GET /api/credits?scope=acme%2Ftools": json(division) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText(/Your role is in Tools, so this shows its spending and caps/)).toBeTruthy();
    // The page asks at the division; only the header's balance pill asks at the organisation (ORG-19).
    expect(api.calls.map((c) => c.path)).toContain("/api/credits?scope=acme%2Ftools");
    const budgets = screen.getByRole("list", { name: "Budgets" });
    expect(within(budgets).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/An Admin or the Owner sets the caps/)).toBeNull();
  });

  it("shows a skeleton while loading", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": "pending" });
    renderWithStore(<CreditsView />);
    expect((await screen.findByText("Loading credits")).closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
  });

  it("records a failed read rather than a zero balance", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": problem(500, "Ledger unavailable") });
    renderWithStore(<CreditsView />);
    const alert = await screen.findByText("Credits could not be loaded");
    expect(alert.closest('[role="alert"]')?.textContent).toContain("Ledger unavailable (500)");
    expect(screen.queryByText("Credits left")).toBeNull();
  });

  it("shows the balance, AI against hosting, budgets down the cascade, accuracy and what was not charged", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByRole("heading", { name: "4,321" })).toBeTruthy();
    expect(screen.getByText("At this month’s pace, about 14 months.")).toBeTruthy();
    expect(screen.getByText("On AI work").nextSibling?.textContent).toBe("200");
    expect(screen.getByText("On hosting").nextSibling?.textContent).toBe("100");
    const budgets = screen.getByRole("list", { name: "Budgets" });
    expect(within(budgets).getAllByRole("listitem")).toHaveLength(3);
    expect(within(budgets).getByText("No cap here; the cap on Acme, 1,000 credits, holds")).toBeTruthy();
    expect(within(budgets).getByRole("link", { name: "Ledger web" }).getAttribute("href")).toBe("/apps/a1");
    expect(screen.getByText("Usually 13% under the estimate")).toBeTruthy();
    expect(screen.getByText("42 credits")).toBeTruthy();
    expect(screen.getByText(/3 repairs where an employee got it wrong/)).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
  });

  it("says how far off the estimates usually are, and which way, rather than the share that landed close", async () => {
    // Every build was estimated far too high (90 against 14.56): none came within 10%, but that is not "within 0%".
    const estimates = { pieces: 4, withinPercent: 0, under: 4, over: 0, largestMissPercent: 85, typicalGapPercent: -83.8, typically: "under" };
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json({ ...CREDITS, estimates }) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Usually 84% under the estimate")).toBeTruthy();
    expect(screen.queryByText(/Within 0%/)).toBeNull();
    expect(screen.getByText(/Across 4 pieces of work this month\. None came within 10% of its estimate; 4 cost less, 0 more\. The largest miss was 85%\./)).toBeTruthy();
  });

  it("says when the estimates usually land close, or usually run over", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json({ ...CREDITS, estimates: { pieces: 3, withinPercent: 67, under: 1, over: 0, largestMissPercent: 14, typicalGapPercent: 3.2, typically: "within" } }) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Usually within 3%")).toBeTruthy();
    cleanup();
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json({ ...CREDITS, estimates: { pieces: 2, withinPercent: 0, under: 0, over: 2, largestMissPercent: 40, typicalGapPercent: 21, typically: "over" } }) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Usually 21% over the estimate")).toBeTruthy();
  });

  it("says when nothing has been scored or topped up yet", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json({ ...CREDITS, budgets: [], estimates: null, topUps: [], overdraft: null, monthsLeftAtPace: null }) });
    renderWithStore(<CreditsView />);
    expect(await screen.findByText(/no estimate has been scored yet/)).toBeTruthy();
    expect(screen.getByText("No spending or caps anywhere in the tree yet.").dataset.state).toBe("empty");
    expect(screen.getByText(/No top-ups yet/)).toBeTruthy();
    expect(screen.getByText(/no pace to project/)).toBeTruthy();
  });
});
