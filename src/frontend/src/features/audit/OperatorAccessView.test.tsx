import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorAction } from "@/store/types";
import { ME, json, problem, renderWithStore, stubApi, type Route } from "@/test/harness";
import { AppShell } from "../shell/AppShell";
import { OperatorAccessView } from "./OperatorAccessView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [], heldCredits: 0, available: 5 };
const LOG: OperatorAction[] = [
  { id: "a2", at: "2026-11-24T10:00:00Z", action: "credits.top_up", operator: { id: "u9", email: "support@frostaura.test", displayName: "Fixture Operator" }, detail: { credits: 500, note: "Added" } },
  { id: "a1", at: "2026-11-20T10:00:00Z", action: "organisation.entered", operator: { id: "u9", email: null, displayName: "" }, detail: { path: "acme" } },
];

function stub(log: Route) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/audit/operator-access": log });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OperatorAccessView", () => {
  it("shows a skeleton while the log loads", () => {
    stub("pending");
    renderWithStore(<OperatorAccessView />);
    expect(screen.getByRole("status", { name: "" }).dataset.state).toBe("loading");
  });

  it("lists every entry in plain words, newest first, for the organisation", async () => {
    const api = stub(json(LOG));
    renderWithStore(<OperatorAccessView />);
    const log = await screen.findByRole("list", { name: "Operator log" });
    const rows = within(log).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Added 500 credits")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Fixture Operator · support@frostaura.test")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Entered the organisation")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("A FrostAura operator")).toBeTruthy();
    expect(api.calls.find((c) => c.path.startsWith("/api/audit"))?.path).toBe("/api/audit/operator-access?organisation=acme");
    // Normal mode keeps the raw action words out.
    expect(screen.queryByText(/credits\.top_up/)).toBeNull();
  });

  it("shows the raw action and its detail in technical mode", async () => {
    stub(json(LOG));
    renderWithStore(
      <>
        <AppShell crumbs={[]}>{null}</AppShell>
        <OperatorAccessView />
      </>,
    );
    await screen.findByRole("list", { name: "Operator log" });
    fireEvent.click(screen.getAllByRole("button", { name: "Technical" })[0] as HTMLElement);
    expect(screen.getByText(/credits\.top_up \{"credits":500/)).toBeTruthy();
  });

  it("records a refusal for anyone but the Owner as a failure, never as an empty log", async () => {
    stub(problem(403, "This needs the owner role at 'acme'"));
    renderWithStore(<OperatorAccessView />);
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("Only the Owner can read the operator log");
    expect(alert.textContent).toContain("This needs the owner role at 'acme' (403)");
    expect(screen.queryByText(/No one from FrostAura has entered/)).toBeNull();
  });

  it("says plainly when no operator has ever entered", async () => {
    stub(json([]));
    renderWithStore(<OperatorAccessView />);
    expect((await screen.findByText("No one from FrostAura has entered Acme")).closest("[data-state]")?.getAttribute("data-state")).toBe("empty");
  });
});
