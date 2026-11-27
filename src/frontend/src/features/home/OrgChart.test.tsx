import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { ME, json, renderWithStore, stubApi } from "@/test/harness";
import { AddDivision, OrgChart } from "./OrgChart";
import { tidyFigures } from "./needsYouModel";
import { nodeName } from "./ontologyModel";
import { activityLine, appChips, appNote, progressLine, stageChip, workerActivity, workerLabel } from "./treeModel";

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
    renderWithStore(
      <>
        <AddDivision tree={TREE} />
        <OrgChart tree={TREE} selection={null} onSelect={() => undefined} />
      </>,
    );
    expect(screen.getByRole("link", { name: "Manage Tools" }).getAttribute("href")).toBe("/tree?scope=acme%2Ftools");
    expect(screen.getByRole("link", { name: "Manage Ledger" }).getAttribute("href")).toBe("/tree?scope=acme%2Ftools%2Fledger");
    // An archived division is folded away at the end, under "Archived (1)", never left in the chart's columns.
    expect(within(screen.getByRole("region", { name: "Organisation chart" })).queryByText("Old things")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    const old = within(screen.getByRole("region", { name: "Archived divisions" })).getByRole("button", { name: /Old things/ }).closest("[data-archived]");
    expect(old && within(old as HTMLElement).getByText("Archived")).toBeTruthy();
    const apps = screen.getByRole("list", { name: "Apps in Ledger" });
    expect(within(apps).getByText("Archived")).toBeTruthy();
    expect(within(apps).queryByText("Healthy")).toBeNull();
    expect(screen.getByRole("link", { name: "Add a division" }).getAttribute("href")).toBe("/tree?scope=acme&add=1");
  });

  it("offers a Builder no new division", () => {
    stubApi({ "GET /api/me": json(ME) });
    renderWithStore(<AddDivision tree={{ ...TREE, viewerRole: "builder" }} />);
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

describe("activity as sentences (D82)", () => {
  it("reads a run's title as what the person is doing", () => {
    expect(activityLine("Theo", "Change: Show how many books each member has read")).toBe("Theo is making a change: Show how many books each member has read");
    expect(activityLine("Theo", "Build: Club Reading List")).toBe("Theo is building: Club Reading List");
    expect(activityLine("Iris", "Research: A shared equipment log")).toBe("Iris is researching: A shared equipment log");
    expect(activityLine("Iris", "Looking for competitors")).toBe("Iris is looking for competitors");
    expect(activityLine("Lena", "Paused")).toBe("Lena: Paused");
  });

  it("never prints step 0 of 0, and draws no bar until there is a plan", () => {
    expect(progressLine({ label: "Change: Show how many", step: 0, of: 0 })).toBe("Change: Show how many");
    expect(progressLine({ label: "Build: Ledger", step: 1, of: 4 })).toBe("Build: Ledger, step 1 of 4");
    // R2-9: a plan with no step begun yet is not "step 0 of 1".
    expect(progressLine({ label: "Build: Ledger", step: 0, of: 1 })).toBe("Build: Ledger");
    stubApi({ "GET /api/me": json(ME) });
    const tools = TREE.divisions[0] as Tree["divisions"][number];
    const project = { ...tools.projects[0], stage: "building", progress: { runId: "r1", label: "Change: Show how many", step: 0, of: 0, spentCredits: 2, estimatedCredits: null }, workers: [{ id: "e1", name: "Theo", role: "Software engineer", kind: "employee", activity: "Change: Show how many", status: "working" }] };
    const tree = { ...TREE, divisions: [{ ...tools, projects: [project] }] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect(container.textContent).not.toContain("step 0 of 0");
    expect(container.textContent).not.toMatch(/\b0 of 0\b|0 of an estimated 0/);
    expect(container.textContent).toContain("Theo is making a change: Show how many");
    expect(screen.getByRole("link", { name: "Watch the work" })).toBeTruthy();
  });
});

describe("a project card's work under way (R2-9)", () => {
  it("never prints step 0 of a plan nor 0 of an estimated 0, and says a tiny monthly spend by the one precision rule (ARCH-011)", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tools = TREE.divisions[0] as Tree["divisions"][number];
    const tinyApp = { ...(tools.projects[0]?.apps[0] ?? {}), status: undefined, spend: { monthCredits: 0.004 } };
    const project = { ...tools.projects[0], stage: "building", spend: { monthCredits: 0.004 }, apps: [tinyApp], progress: { runId: "r1", label: "Build: Ledger", step: 0, of: 4, spentCredits: 0, estimatedCredits: 0 }, workers: [] };
    const tree = { ...TREE, divisions: [{ ...tools, projects: [project] }] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect(container.textContent).not.toMatch(/step 0 of|0 of an estimated 0|less than 0\.01/);
    expect(container.textContent).toContain("<0.01 credits this month");
    expect(screen.getByText("Credits this month").nextSibling?.textContent).toBe("<0.01");
  });

  it("fills the bar with the finished steps and names the one under way", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tools = TREE.divisions[0] as Tree["divisions"][number];
    const project = { ...tools.projects[0], stage: "building", progress: { runId: "r1", label: "Build: Ledger", step: 2, of: 4, done: 1, spentCredits: 3, estimatedCredits: 12 }, workers: [] };
    const tree = { ...TREE, divisions: [{ ...tools, projects: [project] }] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect(container.textContent).toContain("Build: Ledger, step 2 of 4");
    expect((screen.getByRole("img", { name: "Build: Ledger, step 2 of 4" }).firstChild as HTMLElement).style.width).toBe("25%");
  });
});

describe("the chart after the real-stack walk", () => {
  // D30: an app that was never built is one quiet chip, not "Waking" and "Health unknown".
  it("reads the control plane's paused and not-built answers: chips and the note beside the app (D66, D81)", () => {
    expect(appChips({ health: "paused", running: "paused", access: "private", sharedWith: 0, visitsToday: 3, lastVisitAt: "t", paused: { reason: "budget_exhausted", note: "Paused: a monthly budget above it is spent." } }).map((c) => c.label)).toEqual(["Paused", "Private"]);
    const cancelled = { health: "unknown", running: "starting", access: "private", sharedWith: 0, visitsToday: null, lastVisitAt: null, status: "draft", notBuilt: { reason: "cancelled", note: "Not built — the build was cancelled.", runId: "b1", ideaId: null } } as const;
    expect(appChips(cancelled).map((c) => c.label)).toEqual(["Not built"]);
    expect(appNote(cancelled)).toBe("Not built — the build was cancelled.");
    expect(appChips({ ...cancelled, notBuilt: null }).map((c) => c.label)).toEqual(["Not built yet"]);
    expect(stageChip("not-built").label).toBe("Not built");
    stubApi({ "GET /api/me": json(ME) });
    const tools = TREE.divisions[0] as Tree["divisions"][number];
    const project = { ...tools.projects[0], stage: "not-built", note: null, notBuilt: cancelled.notBuilt, apps: [{ ...app, status: "draft", archived: false, health: "unknown", running: "starting", visitsToday: null, notBuilt: cancelled.notBuilt }] };
    const tree = { ...TREE, divisions: [{ ...tools, projects: [project] }] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect(container.textContent).toContain("Not built — the build was cancelled.");
    expect(container.textContent).not.toContain("Planning");
  });

  it("shows a project whose build attached at placement with its progress and Watch the work (D80)", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tools = TREE.divisions[0] as Tree["divisions"][number];
    const project = { ...tools.projects[0], stage: "building", progress: { runId: "b9", label: "Build: Dive Trip Ready", step: 1, of: 4, spentCredits: 23, estimatedCredits: 120 } };
    const tree = { ...TREE, divisions: [{ ...tools, projects: [project] }] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    expect(container.textContent).toContain("Build: Dive Trip Ready, step 1 of 4");
    expect(screen.getByRole("link", { name: "Watch the work" }).getAttribute("href")).toBe("/runs/b9");
  });

  it("shows a paused app as Paused, with no Healthy chip beside it (D66)", () => {
    const paused = { health: "healthy", running: "paused", access: "private", sharedWith: 0, visitsToday: 3, lastVisitAt: "t" } as const;
    expect(appChips(paused).map((c) => c.label)).toEqual(["Paused", "Private"]);
  });

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
    expect(tidyFigures("Start this work? Estimated 2.4567 credits.")).toBe("Start this work? Estimated 2.46 credits.");
    expect(tidyFigures("Version 1.2.3 stays")).toBe("Version 1.2.3 stays");
  });
});

describe("the chart's shape", () => {
  const project = (id: string, name: string, apps: unknown[] = []) => ({ id, slug: id, name, stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 5 }, workers: [], apps });
  const division = (id: string, name: string, projects: unknown[]) => ({ id, slug: id, name, spend: { monthCredits: 5 }, workers: [], projects });

  it("hangs every project off its division's wire with one node, and ends the wire at the last project", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tree = { ...TREE, divisions: [division("d1", "Tools", [project("p1", "One"), project("p2", "Two"), project("p3", "Three")]), division("d2", "Kit", [project("p4", "Four")])] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    const tools = screen.getByRole("list", { name: "In Tools" });
    const branches = tools.querySelectorAll(":scope > li[data-branch]");
    expect(branches).toHaveLength(3);
    for (const b of branches) expect(b.querySelectorAll("[data-node]")).toHaveLength(1);
    // Every wire but the last runs on to the next branch; the last stops at its card's title row.
    const wires = [...branches].map((b) => b.querySelector("[data-wire]")?.className ?? "");
    expect(wires.slice(0, 2).every((w) => w.includes("bottom-0"))).toBe(true);
    expect(wires[2]).toContain("h-12");
    expect(wires[2]).not.toContain("bottom-0");
    expect(container.querySelectorAll("[data-node]")).toHaveLength(4);
  });

  it("says a project's name and spend once when it is one app of the same name", () => {
    stubApi({ "GET /api/me": json(ME) });
    const same = { ...app, name: "Ledger", status: "live", spend: { monthCredits: 5 } };
    const tree = { ...TREE, divisions: [division("d1", "Tools", [project("p1", "Ledger", [same])]), division("d2", "Kit", [])] } as unknown as Tree;
    renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    const card = screen.getByRole("article", { name: "Ledger" });
    expect(within(card).queryByText(/credits this month$/)).toBeNull();
    expect(within(card).getByRole("link", { name: "Open the app" }).getAttribute("href")).toBe("/apps/a1");
    expect(within(card).getAllByText("Ledger")).toHaveLength(1);
  });

  it("offers nothing to open on an app with no version yet, saying so in muted words", () => {
    stubApi({ "GET /api/me": json(ME) });
    const draft = { ...app, name: "Ledger", status: "draft", spend: { monthCredits: 5 } };
    const tree = { ...TREE, divisions: [division("d1", "Tools", [project("p1", "Ledger", [draft])]), division("d2", "Kit", [])] } as unknown as Tree;
    renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    const card = screen.getByRole("article", { name: "Ledger" });
    expect(within(card).queryByRole("link", { name: "Open the app" })).toBeNull();
    expect(within(card).getByText("No version yet").className).toContain("text-ink-muted");
  });

  it("draws every division's letter in ink, never in a hue of its own", () => {
    stubApi({ "GET /api/me": json(ME) });
    const tree = { ...TREE, divisions: [division("d1", "Tools", []), division("d2", "Kit", []), division("d3", "Lab", [])] } as unknown as Tree;
    const { container } = renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    const badges = [...container.querySelectorAll("[data-division-header] span[aria-hidden].size-10")];
    expect(badges).toHaveLength(3);
    for (const b of badges) expect(b.className).toContain("bg-ink");
  });

  it("shows a long division's first six projects and Show all, the wire ending at Show all", () => {
    stubApi({ "GET /api/me": json(ME) });
    const many = Array.from({ length: 12 }, (_, i) => project(`p${i}`, `Project ${i}`));
    const tree = { ...TREE, divisions: [division("d1", "Tools", many), division("d2", "Kit", [])] } as unknown as Tree;
    renderWithStore(<OrgChart tree={tree} selection={null} onSelect={() => undefined} />);
    const tools = screen.getByRole("list", { name: "In Tools" });
    expect(within(tools).getAllByRole("article")).toHaveLength(6);
    const more = within(tools).getByRole("button", { name: "Show all 12 projects" });
    expect(more.closest("li")?.querySelector("[data-wire]")?.className).toContain("h-8");
    fireEvent.click(more);
    expect(within(tools).getAllByRole("article")).toHaveLength(12);
  });
});
