import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { ME, json, renderWithStore, stubApi } from "@/test/harness";
import { OrgChart } from "./OrgChart";
import { tidyFigures } from "./needsYouModel";
import { nodeName } from "./ontologyModel";
import { appChips, workerActivity, workerLabel } from "./treeModel";

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

  it("draws a part the person holds no role in, but not as theirs to open or manage", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tree = { ...TREE, divisions: TREE.divisions.map((d, i) => (i === 0 ? { ...d, role: null } : d)) } as Tree;
    renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect((screen.getByRole("button", { name: /Tools/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Manage Tools" })).toBeNull();
  });
});

describe("the chart after the real-stack walk", () => {
  // D30: an app that was never built is one quiet chip, not "Waking" and "Health unknown".
  it("shows a draft app as not built yet", () => {
    const draft = { health: "unknown", running: "starting", access: "private", sharedWith: 0, visitsToday: null, lastVisitAt: null } as const;
    expect(appChips(draft).map((c) => c.label)).toEqual(["Not built yet"]);
    expect(appChips({ ...draft, running: "asleep", health: "healthy" }).map((c) => c.label)).toEqual(["Healthy", "Asleep", "Private"]);
  });

  // D51: a contractor is named by its role, and its step is what it is doing.
  it("names a contractor by its role, with its step as its activity", () => {
    const c = { name: "Looked for evidence people will pay (contractor)", role: "demand researcher", kind: "contractor" as const, activity: null };
    expect(workerLabel(c)).toBe("Demand researcher · contractor");
    expect(workerActivity(c)).toBe("Looked for evidence people will pay");
    expect(workerLabel({ name: "Kit", role: "Engineer", kind: "employee" })).toBe("Kit · Engineer");
    expect(nodeName({ id: "contractor:1", type: "contractor", name: c.name, scope: null, status: null, attributes: { role: "Demand researcher" } }, "normal")).toBe("Demand researcher · contractor");
  });

  // D44: a figure written to six places reads as the console writes figures.
  it("rounds a long figure in a needs-you line", () => {
    expect(tidyFigures("277.323824 credits are left in the budget.")).toBe("277 credits are left in the budget.");
    expect(tidyFigures("Start this work? Estimated 2.4567 credits.")).toBe("Start this work? Estimated 2.5 credits.");
    expect(tidyFigures("Version 1.2.3 stays")).toBe("Version 1.2.3 stays");
  });
});
