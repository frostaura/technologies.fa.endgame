import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Credits } from "@/store/types";
import { employeeFixture } from "@/test/fixtures";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { CreditsView } from "./CreditsView";

const row = (scope: string, name: string, level: Credits["budgets"][number]["level"], capCredits: number | null, extra: Partial<Credits["budgets"][number]> = {}) => ({
  scope,
  name,
  level,
  depth: scope.split("/").length - 1 + (level === "employee" ? 1 : 0),
  spentCredits: 10,
  capCredits,
  appId: null,
  employeeId: null,
  ...extra,
});
const CREDITS: Credits = {
  scope: "acme",
  balance: 0,
  month: { spent: 300, ai: 200, hosting: 100 },
  monthsLeftAtPace: 0,
  budgets: [row("acme", "Acme", "organisation", 1000), row("acme/tools", "Tools", "division", 400), row("acme/tools", "Ada", "employee", 50, { employeeId: "e1" }), row("acme/web", "Web", "division", null)],
  estimates: null,
  notCharged: { credits: 0, repairs: 0 },
  overdraft: { frostauraLimit: 2000, ownLimit: 500, limits: [{ scope: "acme/tools", name: "Tools", level: "division", credits: 100, setAt: "2026-11-01T00:00:00Z", setBy: "u1", setByName: "Owner" }] },
  topUps: [],
  heldCredits: 0,
  available: 500,
};
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [], needsYou: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(extra = {}, me: unknown = ME) {
  return stubApi({ "GET /api/me": json(me), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }), "GET /api/credits/top-up-requests": json([]), ...extra });
}

const budgets = async () => within(await screen.findByRole("list", { name: "Budgets" }));

describe("caps on the Credits screen", () => {
  it("says at zero that work carries on into the overdraft", async () => {
    stub();
    renderWithStore(<CreditsView />);
    expect(await screen.findByText("Nothing is left above zero. Work carries on into the overdraft, down to 500 credits below zero; the next top-up settles it.")).toBeTruthy();
  });

  it("names the cap that holds a row with none, and says when none does", async () => {
    stub();
    renderWithStore(<CreditsView />);
    const list = await budgets();
    // Said once per row as the cell's name (the legend explains the mark), never repeated as a sentence on every row.
    expect(list.getByLabelText("No cap here; the cap on Acme, 1,000 credits, holds")).toBeTruthy();
    expect(list.queryByText(/No cap here/)).toBeNull();
  });

  it("sets a cap on a row at once, as a budget on the cascade", async () => {
    const api = stub({ "PUT /api/cascade": json({ kind: "budget", key: "monthly_credits", value: 250, setAtLevel: "division", setAtPath: "acme/web", setAt: "t", overrides: [] }) });
    renderWithStore(<CreditsView />);
    fireEvent.click((await budgets()).getByRole("button", { name: "Set a cap on Web" }));
    fireEvent.change(screen.getByLabelText("Credits a month"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the cap" }));
    expect(await screen.findByText("Web may spend 250 credits a month.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/web", kind: "budget", key: "monthly_credits", value: 250 });
  });

  it("puts a refused cap back, with the reason", async () => {
    stub({ "PUT /api/cascade": problem(403, "This needs the admin role") });
    renderWithStore(<CreditsView />);
    fireEvent.click((await budgets()).getByRole("button", { name: "Change the cap on Tools" }));
    fireEvent.change(screen.getByLabelText("Credits a month"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the cap" }));
    expect(await screen.findByText(/The cap was not changed: This needs the admin role\. It is as it was\./)).toBeTruthy();
    expect((await budgets()).getByRole("img", { name: "10 of 400 used" })).toBeTruthy();
  });

  it("removes a cap and says which one holds it then", async () => {
    const api = stub({ "DELETE /api/cascade": json(null, 204) });
    renderWithStore(<CreditsView />);
    fireEvent.click((await budgets()).getByRole("button", { name: "Change the cap on Tools" }));
    fireEvent.click((await budgets()).getByRole("button", { name: "Remove the cap on Tools" }));
    expect(await screen.findByText("Tools has no cap of its own now; the cap on Acme, 1,000 credits a month, holds it.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/cascade?scope=acme%2Ftools&kind=budget&key=monthly_credits");
  });

  it("caps an employee on its own record, with its contractors, and links to it", async () => {
    const api = stub({ "PATCH /api/employees/e1": json(employeeFixture()) });
    renderWithStore(<CreditsView />);
    const list = await budgets();
    expect(list.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe("/employees/e1");
    expect(screen.getByText(/An employee’s spending is with the contractors it briefs/)).toBeTruthy();
    fireEvent.click(list.getByRole("button", { name: "Change the cap on Ada" }));
    fireEvent.click(list.getByRole("button", { name: "Remove the cap on Ada" }));
    expect(await screen.findByText("Ada has no cap of its own now; the cap on Tools, 400 credits a month, holds it.")).toBeTruthy();
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ clearMonthlyCreditLimit: true }));
  });

  it("offers no cap controls below Admin, and says who sets them", async () => {
    stub({}, { ...ME, memberships: [{ ...ME.memberships[0], role: "builder" }] });
    renderWithStore(<CreditsView />);
    await budgets();
    expect(screen.queryByRole("button", { name: /Set a cap|Change the cap/ })).toBeNull();
    expect(screen.getByText(/An Admin or the Owner sets the caps\./)).toBeTruthy();
  });
});

describe("removing an overdraft limit", () => {
  it("lets the Owner remove their own limit, and says FrostAura's then applies", async () => {
    const api = stub({ "DELETE /api/cascade": json(null, 204) });
    renderWithStore(<CreditsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove your own limit" }));
    expect(await screen.findByText("Your own limit is removed. The most FrostAura allows, 2,000 below zero, applies now.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/cascade?scope=acme&kind=setting&key=overdraft_own_limit");
  });

  it("removes a part's tighter limit and says the organisation's applies, or puts it back", async () => {
    stub({ "DELETE /api/cascade": problem(500, "Boom") });
    renderWithStore(<CreditsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Tools's tighter limit" }));
    expect(await screen.findByText(/Tools's limit was not removed: Boom\. It still stops at its own limit\./)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Tighter limits already set" })).getByText("100 below zero")).toBeTruthy();
    cleanup();
    stub({ "DELETE /api/cascade": json(null, 204) });
    renderWithStore(<CreditsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Tools's tighter limit" }));
    expect(await screen.findByText("Tools is no longer held to less; the organisation's 500 below zero applies.")).toBeTruthy();
  });
});
