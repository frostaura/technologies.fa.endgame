import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDetail, Tree } from "@/store/types";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { AppView } from "../apps/AppView";

/** On a real page (ARCH-012, conversation 1, desktop 6): the conversation is the docked pane, scoped to the page, never a card in the page. */

const TREE: Tree = {
  generatedAt: "2026-11-27T10:00:00Z",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: "", spend: { monthCredits: 0 }, workers: [] },
  divisions: [
    {
      id: "d1",
      slug: "tools",
      name: "Tools",
      spend: { monthCredits: 0 },
      workers: [],
      projects: [
        {
          id: "p1",
          slug: "ledger",
          name: "Ledger",
          stage: "live",
          ideaId: null,
          note: null,
          progress: null,
          spend: { monthCredits: 0 },
          workers: [],
          apps: [{ id: "a1", slug: "web", name: "Ledger web", health: "healthy", running: "asleep", access: "private", sharedWith: 0, visitsToday: 1, lastVisitAt: null, spend: { monthCredits: 0 }, workers: [] }],
        },
      ],
    },
  ],
  needsYou: [],
};

const APP = {
  id: "a1",
  name: "Ledger web",
  scope: "acme/tools/ledger/web",
  health: { state: "healthy", summary: "No errors today" },
  running: "asleep",
  addresses: { path: "https://host.test/acme/tools/ledger", subdomain: null },
  telemetry: { visitsToday: 1, requestsToday: 1, errorsToday: 0, latencyP50Ms: 1, latencyP95Ms: 1, lastVisitAt: null },
  cost: { monthCredits: 0, capCredits: null },
  settings: { running: "sleep", access: "private" },
  runningCost: { state: "not-enough-history", windowDays: 14, minimumHours: 24, measuredHours: 0, basis: "", prices: "", sleep: null, alwaysOn: null, measured: null },
  sharedWith: 0,
  endUsers: 0,
  status: "sleeping",
  version: "1.0.0",
  publishedAt: null,
  idleMinutes: 15,
} as unknown as AppDetail;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an app's page", () => {
  it("docks the conversation about that app beside the page, its side cards in the page column", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "GET /api/apps/a1": json(APP),
      "GET /api/conversations": json({ scope: APP.scope, conversationId: null, employeeId: null, messages: [], turns: [] }),
      "POST /api/conversations/estimate": json({ credits: 0.1, ceiling: 1, basis: "" }),
    });
    renderWithStore(<AppView appId="a1" />);
    const pane = await screen.findByRole("complementary", { name: "Conversation pane" });
    expect(await within(pane).findByRole("heading", { name: "Talking to Ledger web" })).toBeTruthy();
    const column = document.querySelector("[data-page-column]") as HTMLElement;
    expect(column.contains(pane)).toBe(false);
    expect(within(column).queryByRole("region", { name: "Conversation" })).toBeNull();
    const cards = screen.getByRole("complementary", { name: "Beside this page" });
    expect(column.contains(cards)).toBe(true);
    // Beside the open pane, the cards go beside the page only from 3xl.
    expect(column.className).toContain("3xl:flex-row");
  });
});
