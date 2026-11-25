import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { check } from "@/lib/guards";
import { ideaGuard } from "@/store/guards";
import type { Verdict } from "@/store/types";
import { RESEARCH_VERDICT, ideaFixture } from "@/test/fixtures";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { VerdictView } from "./VerdictView";
import { decisionOptions, normaliseVerdict, plainProductName } from "./verdictModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "2026-11-24T10:00:00Z", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };

/** The agreed verdict document (ARCH-004 on build/factory, *The verdict document*), field for field. */
const STRUCTURED = {
  outcome: "change",
  headline: "Build it as a feature of Ledger.",
  summary: "The gap is real but small.",
  against: "Beeper Co already pages people, and the market is crowded.",
  suggestedChange: "Make it a feature of Ledger, for teams already on it.",
  existing: {
    evidence: "Two products cover most of it.",
    products: [
      { name: "Beeper Co", what: "Pages people with escalation.", url: "https://beeper.example.test/" },
      { name: "Ringer", what: "Paid paging for small teams.", url: null },
    ],
    sources: ["https://beeper.example.test/", "https://ringer.example.test/pricing"],
  },
  gap: { evidence: "Paging tied to the ledger's own events." },
  demand: { evidence: "Two teams asked for it.", signals: ["Asked on the forum twice"] },
  wouldChange: "A third team asking unprompted.",
  redLines: { breached: false, line: null, reasoning: "Nothing near a red line." },
  placement: { division: "tools", project: "ledger", app: "pager", name: "Pager" },
  method: {
    searches: 7,
    strands: [
      { id: "existing", title: "Existing products", searches: 4, sources: 6, confidence: "high" },
      { id: "demand", title: "Demand", searches: 3, sources: 2, confidence: "low" },
    ],
    confidence: "medium",
  },
  rulesApplied: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(idea: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/ideas/i1": idea, ...extra });
}

const read = (v: unknown): Verdict => {
  const r = check(normaliseVerdict, v);
  if (!r.ok) throw new Error(r.problem);
  return r.value;
};

describe("normaliseVerdict", () => {
  it("reads the document research writes today: { evidence } sections and products as text", () => {
    const v = read(RESEARCH_VERDICT);
    expect(v.existing.products.map((p) => p.name)).toEqual(["Beeper Co (beeper/beeper-server)", "Ringer"]);
    expect(v.existing.products[0]?.does).toBe("open-source paging with escalation");
    expect(v.existing.products[0]?.sources).toEqual(["https://beeper.example.test/docs"]);
    expect(v.gap.paragraphs).toEqual(["No defensible gap survives the evidence."]);
    expect(v.demand.evidenceFound).toBe(false);
    expect(v.against).toEqual(["1) Paging is solved by Beeper Co.", "2) Nobody asked for another one."]);
    expect(v.wouldChange).toEqual({ text: "A verified cohort paying a real price.", changeLabel: null, estimateCredits: null });
    expect(v.method.contractors).toBe(3);
  });

  it("reads the agreed document: products with what each does and its address, sources, signals, strands and confidence", () => {
    const v = read(STRUCTURED);
    expect(v.existing.products).toEqual([
      { name: "Beeper Co", does: "Pages people with escalation.", sources: ["https://beeper.example.test/"] },
      { name: "Ringer", does: "Paid paging for small teams.", sources: ["https://ringer.example.test/pricing"] },
    ]);
    expect(v.demand.signals).toEqual([{ text: "Asked on the forum twice", source: null }]);
    expect(v.demand.evidenceFound).toBe(true);
    expect(v.suggestedChange).toBe("Make it a feature of Ledger, for teams already on it.");
    expect(v.wouldChange?.text).toBe("A third team asking unprompted.");
    expect(v.method.searchCount).toBe(7);
    expect(v.method.strands[1]).toEqual({ id: "demand", title: "Demand", searches: 3, sources: 2, confidence: "low" });
    expect(v.method.confidence).toBe("medium");
    expect(v.placement).toEqual({ division: "tools", project: "ledger", app: "pager", name: "Pager" });
  });

  it("reads the older list shapes too", () => {
    const v = read({ outcome: "build", headline: "Yes", summary: "", existing: [{ name: "X", description: "Does x.", url: "https://x.example.test" }], gap: ["One"], demand: { paragraphs: ["Asked"], evidenceFound: true }, wouldChange: null, method: "Argued first." });
    expect(v.existing.products).toEqual([{ name: "X", does: "Does x.", sources: ["https://x.example.test"] }]);
    expect(v.gap.paragraphs).toEqual(["One"]);
    expect(v.method.summary).toBe("Argued first.");
  });

  it("turns a document that is not a verdict into a failed read, never a crash", () => {
    expect(check(ideaGuard, ideaFixture({ verdict: { outcome: "maybe" } }))).toMatchObject({ ok: false });
    expect(check(ideaGuard, ideaFixture({ verdict: "Build it" }))).toMatchObject({ ok: false });
    expect(check(ideaGuard, ideaFixture({ verdict: { ...RESEARCH_VERDICT, existing: 42 } }))).toMatchObject({ ok: true });
  });

  it("drops a repository from a product name in normal mode", () => {
    expect(plainProductName("Nightscout (nightscout/cgm-remote-monitor)")).toBe("Nightscout");
    expect(plainProductName("Oura (ring)")).toBe("Oura (ring)");
  });
});

describe("decisionOptions", () => {
  const no = read(RESEARCH_VERDICT);
  it("offers change, overrule and drop against a no; build, change and drop for a yes; never overrule for a change", () => {
    expect(decisionOptions(no).map((o) => o.choice)).toEqual(["change", "overrule", "drop"]);
    expect(decisionOptions({ ...no, outcome: "build" }).map((o) => o.choice)).toEqual(["build", "change", "drop"]);
    expect(decisionOptions({ ...no, outcome: "change" }).map((o) => o.choice)).toEqual(["change", "build", "drop"]);
    expect(decisionOptions({ ...no, wouldChange: null })[0]).toMatchObject({ choice: "overrule", variant: "primary" });
  });

  it("offers neither build nor overrule over a breached red line", () => {
    expect(decisionOptions(no, "weapons against civilians").map((o) => o.choice)).toEqual(["change", "drop"]);
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

  it("records an answer in a shape it does not understand as a failed read naming the field — never a blank page", async () => {
    stub(json(ideaFixture({ verdict: { ...RESEARCH_VERDICT, outcome: 7 } })));
    renderWithStore(<VerdictView ideaId="i1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("verdict.outcome");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says research is still running, with a way to watch it, before there is a verdict", async () => {
    stub(json(ideaFixture({ status: "researching", verdict: null })));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByText("The verdict is being worked out.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Watch the research" }).getAttribute("href")).toBe("/runs/r1");
  });

  it("shows the verdict as research wrote it: the case against, existing products and their sources, the gap, demand, the red-line screen and the method", async () => {
    stub(json(ideaFixture()));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByRole("heading", { name: RESEARCH_VERDICT.headline })).toBeTruthy();
    expect(screen.getByText("Verdict · do not build")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The case against, argued first" })).toBeTruthy();
    const products = screen.getByRole("list", { name: "Existing products" });
    // Normal mode never names a repository.
    expect(within(products).getByText("Beeper Co")).toBeTruthy();
    expect(products.textContent).not.toContain("beeper/beeper-server");
    expect(within(products).getByRole("link", { name: "beeper.example.test" }).getAttribute("href")).toBe("https://beeper.example.test/docs");
    expect(screen.getByText("No defensible gap survives the evidence.")).toBeTruthy();
    expect(screen.getByText(/No evidence of demand was found. That counts/)).toBeTruthy();
    expect(screen.getByText("A verified cohort paying a real price.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No red line is crossed" })).toBeTruthy();
    expect(screen.getAllByText("1 of 3", { selector: "span" })).toHaveLength(3);
    expect(screen.getByText("existing products, the gap, demand")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Where you are" }).textContent).toBe("Acme/Tools/Pager");
  });

  it("shows the agreed document: what to change, demand signals, each strand and the method's searches and confidence", async () => {
    stub(json(ideaFixture({ verdict: STRUCTURED })));
    renderWithStore(<VerdictView ideaId="i1" />);
    const signals = await screen.findByRole("list", { name: "Signals of demand" });
    expect(within(signals).getByText("Asked on the forum twice")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What to change" })).toBeTruthy();
    expect(screen.getByText("medium")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Strands" })).getByText("3 searches · 2 sources · low confidence")).toBeTruthy();
    // A change verdict is not overruled: it is built as described, or changed.
    expect(screen.queryByRole("button", { name: /Overrule/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Build it as described" })).toBeTruthy();
  });

  it("over a breached red line offers no overrule, and says why", async () => {
    stub(json(ideaFixture({ redLine: "surveillance", verdict: { ...RESEARCH_VERDICT, redLines: { breached: true, line: "surveillance", reasoning: "It tracks people against their interest." } } })));
    renderWithStore(<VerdictView ideaId="i1" />);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("This idea crosses a red line: surveillance and authoritarian tooling");
    expect(banner.textContent).toContain("no one can overrule that");
    expect(screen.queryByRole("button", { name: /Overrule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Build/ })).toBeNull();
    expect(screen.getByText("Overruling is not offered: no one may build over a red line.")).toBeTruthy();
  });

  it("records an overrule only after it is confirmed", async () => {
    const api = stub(json(ideaFixture()), { "POST /api/ideas/i1/decision": json(ideaFixture({ status: "decided", decision: { choice: "overrule", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: true, runId: null, via: "person" } })) });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Overrule and build anyway" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ choice: "overrule" }));
  });

  it("asks what should change, and sends it as the note", async () => {
    const api = stub(json(ideaFixture()), { "POST /api/ideas/i1/decision": json(ideaFixture({ status: "researching", verdict: null, decision: { choice: "change", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: false, runId: "r9", via: "person" } })) });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Change the idea" }));
    const form = screen.getByRole("form", { name: "Change the idea" });
    fireEvent.change(within(form).getByLabelText("What should change?"), { target: { value: "Only for teams already on Ledger" } });
    fireEvent.click(within(form).getByRole("button", { name: "Research it again with this change" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ choice: "change", note: "Only for teams already on Ledger" }));
  });

  it("shows a recorded overrule clearly", async () => {
    stub(json(ideaFixture({ status: "decided", decision: { choice: "overrule", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: true, runId: "r2", via: "person" } })));
    renderWithStore(<VerdictView ideaId="i1" />);
    expect(await screen.findByText(/You overruled the verdict and chose to build it/)).toBeTruthy();
    expect(screen.getByText(/carries a note that research advised against it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Overrule/ })).toBeNull();
  });

  it("keeps the decision open and says why when it was not recorded", async () => {
    stub(json(ideaFixture()), { "POST /api/ideas/i1/decision": problem(409, "Someone else decided first") });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop the idea" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Yes" }));
    expect(await screen.findByText(/Your decision was not recorded: Someone else decided first/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drop the idea" })).toBeTruthy();
  });
});
