import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ideaFixture } from "@/test/fixtures";
import { SUGGESTIONS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { SuggestionsView } from "./SuggestionsView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [], needsYou: [] };
const RUN = { id: "r7", kind: "suggest", title: "Ideas from the portfolio", scope: "acme", status: "queued", startedAt: "2026-11-25T02:00:00Z", finishedAt: null, lastSeq: 2, ideaId: null, estimateCredits: 84, spentCredits: 0 };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

function stub(list: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }), "GET /api/ideas/suggestions": list, ...extra });
}

describe("SuggestionsView", () => {
  it("shows loading, a failed read and an empty list distinctly", async () => {
    stub("pending");
    renderWithStore(<SuggestionsView />);
    expect((await screen.findByText("Loading the suggested ideas")).closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
    cleanup();
    stub(problem(500, "Could not read"));
    renderWithStore(<SuggestionsView />);
    expect(await screen.findByText("The suggested ideas could not be loaded")).toBeTruthy();
    cleanup();
    stub(json([]));
    renderWithStore(<SuggestionsView />);
    expect(await screen.findByText("No suggestions waiting")).toBeTruthy();
  });

  it("shows each open idea with the gap it fills, why this organisation and what it reuses; the rest are set apart", async () => {
    stub(json(SUGGESTIONS));
    renderWithStore(<SuggestionsView />);
    const card = (await screen.findByRole("list", { name: "Suggested ideas" })).querySelector('[data-suggestion="s1"]') as HTMLElement;
    expect(within(card).getByText("Clubs track ladders on paper.")).toBeTruthy();
    expect(within(card).getByText("Acme already runs bookings for the club.")).toBeTruthy();
    expect(within(card).getByText("Member sign-in")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Taken or set aside" })).getByText("Coach notes")).toBeTruthy();
  });

  it("shows what asking for ideas costs before it starts, then says they are being worked out", async () => {
    const api = stub(json([]), { "POST /api/ideas/suggestions/estimate": json({ credits: 83.57, basis: "Up to 6 steps reading what the organisation holds." }), "POST /api/ideas/suggestions": json({ run: RUN, estimate: { credits: 83.57, basis: "x" } }, 201), "GET /api/runs/r7": json({ ...RUN, status: "running" }) });
    renderWithStore(<SuggestionsView />);
    fireEvent.click(await screen.findByRole("button", { name: "See what it costs" }));
    expect(await screen.findByText("About 84 credits.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/ideas/suggestions" && c.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Suggest ideas" }));
    expect((await screen.findAllByRole("link", { name: "Watch it work" }))[0]?.getAttribute("href")).toBe("/runs/r7");
    expect(screen.getByText("The suggestions are being worked out")).toBeTruthy();
  });

  it("prices an idea's research before taking it, then opens the new idea", async () => {
    const api = stub(json(SUGGESTIONS), { "POST /api/ideas/estimate": json({ credits: 40, basis: "Three sweeps and a verdict." }), "POST /api/ideas/suggestions/s1/take": json(ideaFixture({ id: "i9", status: "researching", verdict: null }), 201) });
    renderWithStore(<SuggestionsView />);
    const card = (await screen.findByRole("list", { name: "Suggested ideas" })).querySelector('[data-suggestion="s1"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Take this idea" }));
    expect(await within(card).findByText("Researching it costs about 40 credits.")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Research this idea" }));
    await waitFor(() => expect(window.location.pathname).toBe("/ideas/i9"));
    expect(api.calls.find((c) => c.path === "/api/ideas/suggestions/s1/take")?.body).toEqual({ constraints: [] });
  });

  it("sets an idea aside at once and brings it back when refused", async () => {
    stub(json(SUGGESTIONS), { "POST /api/ideas/suggestions/s1/dismiss": () => new Promise<Response>((r) => setTimeout(() => r(problem(409, "Already taken")), 60)) });
    renderWithStore(<SuggestionsView />);
    const list = await screen.findByRole("list", { name: "Suggested ideas" });
    fireEvent.click(within(list.querySelector('[data-suggestion="s1"]') as HTMLElement).getByRole("button", { name: "Set it aside" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Suggested ideas" })).toBeNull());
    expect(await screen.findByText(/“Court ladder” was not set aside: Already taken/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("list", { name: "Suggested ideas" }).querySelector('[data-suggestion="s1"]')).toBeTruthy());
  });

  // D42: the run is read, so a start that waits for approval is said, with the way to approve it.
  it("says when the suggestions wait for you to approve their start", async () => {
    stub(json([]), {
      "POST /api/ideas/suggestions/estimate": json({ credits: 2, basis: "" }),
      "POST /api/ideas/suggestions": json({ run: RUN, estimate: { credits: 2, basis: "" } }, 201),
      "GET /api/runs/r7": json({ ...RUN, status: "waiting" }),
    });
    renderWithStore(<SuggestionsView />);
    fireEvent.click(await screen.findByRole("button", { name: "See what it costs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Suggest ideas" }));
    expect(await screen.findByText("It is waiting for you to approve the start")).toBeTruthy();
    expect(screen.queryByText("The suggestions are being worked out")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Approve it" })[0]?.getAttribute("href")).toBe("/runs/r7");
  });

  // D50: a platform service the model names by its key reads as the app page names it.
  it("names a reused platform service the way the app page does", async () => {
    stub(json([{ ...SUGGESTIONS[0], reuses: ["identity (service)", "email", "Bookings"] }]));
    renderWithStore(<SuggestionsView />);
    const card = (await screen.findByRole("list", { name: "Suggested ideas" })).querySelector('[data-suggestion="s1"]') as HTMLElement;
    expect(within(card).getByText("Sign-in")).toBeTruthy();
    expect(within(card).getByText("E-mail")).toBeTruthy();
    expect(within(card).getByText("Bookings")).toBeTruthy();
    expect(within(card).queryByText(/\(service\)/)).toBeNull();
  });
});
