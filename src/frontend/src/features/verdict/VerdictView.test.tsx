import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Idea, Verdict } from "@/store/types";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { VerdictView } from "./VerdictView";
import { decisionOptions } from "./verdictModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };

const VERDICT: Verdict = {
  outcome: "do-not-build",
  headline: "Do not build Pager.",
  summary: "Already sold.",
  existing: [{ name: "Beeper Co", description: "Pages people.", url: "https://example.test" }],
  gap: ["Only the price."],
  demand: { paragraphs: ["Nobody asked."], evidenceFound: false },
  wouldChange: { text: "Add it to Ledger.", changeLabel: "add to Ledger", estimateCredits: 90 },
  method: "Argued against first.",
};
const IDEA: Idea = {
  id: "i1",
  title: "Pager",
  text: "Pages people",
  constraints: [],
  status: "verdict",
  runId: "r1",
  scope: "acme/tools",
  research: { estimatedCredits: 60, spentCredits: 54, by: "Ada" },
  verdict: VERDICT,
  decision: null,
  record: { total: 3, build: 1, change: 1, doNotBuild: 1, overruled: [] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(idea: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/ideas/i1": idea, ...extra });
}

describe("decisionOptions", () => {
  it("offers change, overrule and drop against a no, and build, change and drop for a yes", () => {
    expect(decisionOptions(VERDICT).map((o) => o.choice)).toEqual(["change", "overrule", "drop"]);
    expect(decisionOptions({ ...VERDICT, outcome: "build", wouldChange: null }).map((o) => o.choice)).toEqual(["build", "drop"]);
    expect(decisionOptions({ ...VERDICT, wouldChange: null })[0]).toMatchObject({ choice: "overrule", variant: "primary" });
  });
});

describe("VerdictView", () => {
  it("shows a skeleton while loading", () => {
    stub("pending");
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(screen.getByRole("status").dataset.state).toBe("loading");
  });

  it("records a failed read", async () => {
    stub(problem(500, "Boom"));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect((await screen.findByRole("alert")).textContent).toContain("The verdict could not be loaded");
  });

  it("says research is still running, with a way to watch it, before there is a verdict", async () => {
    stub(json({ ...IDEA, status: "researching", verdict: null }));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByText("The verdict is being worked out.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Watch the research" }).getAttribute("href")).toBe("/runs/r1");
  });

  it("shows the verdict, its three kinds of evidence and what would change it", async () => {
    stub(json(IDEA));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByRole("heading", { name: "Do not build Pager." })).toBeTruthy();
    expect(screen.getByText("Verdict · do not build")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Beeper Co" })).toBeTruthy();
    expect(screen.getByText("Only the price.")).toBeTruthy();
    expect(screen.getByText(/No evidence of demand was found/)).toBeTruthy();
    expect(screen.getByText("Add it to Ledger.")).toBeTruthy();
    expect(screen.getAllByText("1 of 3", { selector: "span" })).toHaveLength(3);
    expect(screen.getByText("You have not overruled research yet.").dataset.state).toBe("empty");
    expect(screen.getByRole("navigation", { name: "Where you are" }).textContent).toBe("Acme/Tools/Pager");
  });

  it("records an overrule only after it is confirmed, and shows it as an overrule", async () => {
    const api = stub(json(IDEA), { "POST /api/ideas/i1/decision": json({ ...IDEA, status: "decided", decision: { choice: "overrule", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: true, runId: null } }) });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Overrule and build anyway" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ choice: "overrule" }));
  });

  it("shows a recorded overrule clearly", async () => {
    stub(json({ ...IDEA, status: "decided", decision: { choice: "overrule", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: true, runId: "r2" } }));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByText(/You overruled the verdict and chose to build it/)).toBeTruthy();
    expect(screen.getByText(/carries a note that research advised against it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Overrule/ })).toBeNull();
  });

  it("keeps the decision open and says why when it was not recorded", async () => {
    stub(json(IDEA), { "POST /api/ideas/i1/decision": problem(409, "Someone else decided first") });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Change it: add to Ledger" }));
    expect(await screen.findByText(/Your decision was not recorded: Someone else decided first/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change it: add to Ledger" })).toBeTruthy();
  });
});
