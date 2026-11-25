import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autonomyFixture } from "@/test/fixtures";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { modeSet } from "@/store/uiSlice";
import { AutonomyView } from "./AutonomyView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [{ id: "d", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [] }], needsYou: [] };

function stub(autonomy: Response | "pending", extra = {}, tree: object = TREE) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(tree), "GET /api/autonomy": autonomy, ...extra });
}

beforeEach(() => window.history.replaceState(null, "", "/autonomy?scope=acme/tools"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("AutonomyView", () => {
  it("loading and failed", async () => {
    stub("pending");
    const first = renderWithStore(<AutonomyView />);
    expect((await screen.findAllByRole("status"))[0]?.dataset.state).toBe("loading");
    first.unmount();
    stub(problem(500, "Down"));
    renderWithStore(<AutonomyView />);
    expect((await screen.findByRole("alert")).textContent).toContain("The autonomy settings could not be loaded");
  });

  it("shows each value with the level that set it, or that it was inherited", async () => {
    stub(json(autonomyFixture()));
    renderWithStore(<AutonomyView />);
    const mode = await screen.findByRole("radiogroup", { name: "How it works" });
    expect(within(mode).getByRole("radio", { name: /Checkpoints/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByText("Inherited from Acme").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "Before work starts" }).getAttribute("aria-checked")).toBe("true");
    const build = document.querySelector('[data-stage="build"]') as HTMLElement;
    expect(within(build).getByText("Set here")).toBeTruthy();
    expect(within(build).getByText("Replaces the rules set at Acme.")).toBeTruthy();
    expect(within(build).getByText("Change files")).toBeTruthy();
    const all = document.querySelector('[data-stage="all"]') as HTMLElement;
    expect(within(all).getByText("Run commands and tests, limited")).toBeTruthy();
    expect(document.body.textContent).not.toContain("rm -rf");
    expect(within(document.querySelector('[data-stage="research"]') as HTMLElement).getByText("No rules set for this stage")).toBeTruthy();
  });

  it("technical mode shows the rules as the harness reads them", async () => {
    stub(json(autonomyFixture()));
    const { store } = renderWithStore(<AutonomyView />);
    store.dispatch(modeSet("technical"));
    expect(await screen.findByText(/run\(rm -rf \*\)/)).toBeTruthy();
  });

  it("switches a checkpoint at once, and back with the reason when refused", async () => {
    const api = stub(json(autonomyFixture()), { "PUT /api/autonomy": problem(403, "Admins only") });
    renderWithStore(<AutonomyView />);
    fireEvent.click(await screen.findByRole("switch", { name: "Before the plan is carried out" }));
    expect(await screen.findByText(/Not changed: Admins only/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Before the plan is carried out" }).getAttribute("aria-checked")).toBe("false");
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/tools", checkpoints: { plan: true } });
  });

  it("sets a stage's rules here and removes them again", async () => {
    const after = autonomyFixture({ ruleSets: [...autonomyFixture().ruleSets as object[], { stage: "research", deny: ["edit_file"], ask: [], allow: [], checkpoints: [], setAtPath: "acme/tools", overrides: [] }] });
    let current: unknown = autonomyFixture();
    const api = stub(json(autonomyFixture()), {
      "GET /api/autonomy": () => json(current),
      "PUT /api/autonomy/rule-sets": () => json((current = after)),
      "DELETE /api/autonomy/rule-sets": () => json((current = autonomyFixture())),
    });
    renderWithStore(<AutonomyView />);
    const research = () => document.querySelector('[data-stage="research"]') as HTMLElement;
    await screen.findByRole("radiogroup", { name: "How it works" });
    fireEvent.click(within(research()).getByRole("button", { name: "Set rules here" }));
    fireEvent.change(within(research()).getByLabelText("Add to May not"), { target: { value: "edit_file" } });
    fireEvent.click(within(research()).getAllByRole("button", { name: "Add" })[0] as HTMLElement);
    fireEvent.click(within(research()).getByRole("button", { name: "Save for Tools" }));
    await waitFor(() => expect(within(research()).getByText("Set here")).toBeTruthy());
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/tools", stage: "research", deny: ["edit_file"], ask: [], allow: [], checkpoints: [] });
    fireEvent.click(within(research()).getByRole("button", { name: "Remove here" }));
    await waitFor(() => expect(within(research()).getByText("No rules set for this stage")).toBeTruthy());
  });

  it("a Viewer reads but cannot change", async () => {
    stub(json(autonomyFixture()), {}, { ...TREE, viewerRole: "viewer" });
    renderWithStore(<AutonomyView />);
    expect(await screen.findByText(/An Admin or the Owner sets them/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Before work starts" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Set rules here" })).toBeNull();
  });

  it("decides who may change by the role at this level, as the server resolves it", async () => {
    // An organisation Admin who is a Viewer in Tools reads Tools' settings but cannot change them.
    stub(json(autonomyFixture()), {}, { ...TREE, viewerRole: "admin", organisation: { ...TREE.organisation, role: "admin" }, divisions: [{ ...TREE.divisions[0], role: "viewer" }] });
    renderWithStore(<AutonomyView />);
    expect(await screen.findByText(/An Admin or the Owner sets them/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Before work starts" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
