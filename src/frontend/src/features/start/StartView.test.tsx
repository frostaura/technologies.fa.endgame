import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { StartView } from "./StartView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const IDEA_TEXT = "A shared shopping list that sorts by aisle.";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function describeIdea(text = IDEA_TEXT) {
  fireEvent.change(screen.getByLabelText("The idea"), { target: { value: text } });
}

describe("StartView", () => {
  it("asks for the idea before it shows any estimate, and will not start without one", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS) });
    renderWithStore(<StartView />);
    expect(await screen.findByText(/research estimate appears here before anything is charged/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Research this idea" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the estimate loading, then the figure, before anything is charged", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "POST /api/ideas/estimate": json({ credits: 64, basis: "Three sweeps." }) });
    renderWithStore(<StartView />);
    await screen.findByLabelText("The idea");
    describeIdea();
    const panel = screen.getByRole("region", { name: "Research estimate" });
    expect(panel.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(await screen.findByText("Estimated 64 credits", {}, { timeout: 2000 })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Research this idea" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("records a failed estimate on the page and keeps research from starting", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "POST /api/ideas/estimate": problem(503, "Estimates are unavailable") });
    renderWithStore(<StartView />);
    await screen.findByLabelText("The idea");
    describeIdea();
    const alert = await screen.findByText(/The estimate could not be worked out/, {}, { timeout: 2000 });
    expect(alert.textContent).toContain("Estimates are unavailable (503)");
    expect((screen.getByRole("button", { name: "Research this idea" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the organisation on first run, sends the idea with its constraints, and opens the live research", async () => {
    const api = stubApi({
      "GET /api/me": json({ ...ME, organisation: null }),
      "POST /api/ideas/estimate": json({ credits: 50, basis: "" }),
      "POST /api/organisations": json({ id: "o9", slug: "north-star", name: "North Star" }, 201),
      "POST /api/ideas": json({ id: "i9", runId: "run-9" }, 201),
    });
    renderWithStore(<StartView />);
    fireEvent.change(await screen.findByLabelText("Your organisation"), { target: { value: "North Star" } });
    expect(screen.getByText(/Its apps appear at .*\/north-star\./)).toBeTruthy();
    describeIdea();
    fireEvent.click(screen.getByRole("button", { name: "Works on a phone" }));
    fireEvent.change(screen.getByLabelText("Anything else, in your own words"), { target: { value: "No ads" } });
    await screen.findByText("Estimated 50 credits", {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Research this idea" }));
    await waitFor(() => expect(window.location.pathname).toBe("/runs/run-9"));
    expect(api.calls.find((c) => c.path === "/api/organisations")?.body).toEqual({ name: "North Star", slug: "north-star" });
    expect(api.calls.find((c) => c.path === "/api/ideas")?.body).toEqual({ text: IDEA_TEXT, constraints: ["Works on a phone", "No ads"] });
  });

  it("says research did not start, and that nothing was charged, when the request fails", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "POST /api/ideas/estimate": json({ credits: 50, basis: "" }), "POST /api/ideas": problem(402, "The budget would be exceeded") });
    renderWithStore(<StartView />);
    await screen.findByLabelText("The idea");
    describeIdea();
    await screen.findByText("Estimated 50 credits", {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Research this idea" }));
    const alert = await screen.findByText(/Research did not start/);
    expect(alert.textContent).toContain("The budget would be exceeded (402)");
    expect(alert.textContent).toContain("Nothing was charged.");
  });
});
