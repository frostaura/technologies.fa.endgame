import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { ME, json, renderWithStore, stubApi } from "@/test/harness";
import { OrgChart } from "./OrgChart";

const app = { id: "a1", slug: "web", name: "Ledger web", health: "healthy", running: "awake", access: "private", sharedWith: 0, visitsToday: 1, lastVisitAt: null, spend: { monthCredits: 1 }, workers: [], status: "archived" };
const TREE = {
  generatedAt: "t",
  viewerRole: "admin",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 1 }, workers: [] },
  divisions: [
    { id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 1 }, workers: [], projects: [{ id: "p1", slug: "ledger", name: "Ledger", stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 1 }, workers: [], apps: [app] }] },
    { id: "d2", slug: "old", name: "Old things", archived: true, spend: { monthCredits: 0 }, workers: [], projects: [] },
  ],
  needsYou: [],
} as unknown as Tree;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrgChart", () => {
  it("draws archived nodes as archived, links each to managing it, and offers an Admin a new division", async () => {
    stubApi({ "GET /api/me": json(ME) });
    renderWithStore(<OrgChart tree={TREE} selection={null} onSelect={() => undefined} />);
    expect(screen.getByRole("link", { name: "Manage Tools" }).getAttribute("href")).toBe("/tree?scope=acme%2Ftools");
    expect(screen.getByRole("link", { name: "Manage Ledger" }).getAttribute("href")).toBe("/tree?scope=acme%2Ftools%2Fledger");
    const old = screen.getByRole("button", { name: /Old things/ }).closest("[data-archived]");
    expect(old && within(old as HTMLElement).getByText("Archived")).toBeTruthy();
    const apps = screen.getByRole("list", { name: "Apps in Ledger" });
    expect(within(apps).getByText("Archived")).toBeTruthy();
    expect(within(apps).queryByText("Healthy")).toBeNull();
    expect(screen.getByRole("link", { name: "Add a division" }).getAttribute("href")).toBe("/tree?scope=acme&add=1");
  });

  it("offers a Builder no new division", () => {
    stubApi({ "GET /api/me": json(ME) });
    renderWithStore(<OrgChart tree={{ ...TREE, viewerRole: "builder" }} selection={null} onSelect={() => undefined} />);
    expect(screen.queryByRole("link", { name: "Add a division" })).toBeNull();
  });
});
