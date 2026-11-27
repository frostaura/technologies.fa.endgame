import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { ManageView } from "./ManageView";
import { flatten, may, statusOf, whoMay } from "./treeManage";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const app = { id: "a1", slug: "web", name: "Ledger web", health: "healthy", running: "awake", access: "private", sharedWith: 0, visitsToday: 1, lastVisitAt: null, spend: { monthCredits: 1 }, workers: [] };
const project = { id: "p1", slug: "ledger", name: "Ledger", stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 1 }, workers: [], apps: [app] };
const TREE = {
  generatedAt: "t",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 1 }, workers: [] },
  divisions: [
    { id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 1 }, workers: [], projects: [project] },
    { id: "d2", slug: "old", name: "Old things", archived: true, spend: { monthCredits: 0 }, workers: [], projects: [] },
  ],
  needsYou: [],
};
const CONTEXT = [{ kind: "context", key: "house-style", value: "Plain English.", setAtLevel: "organisation", setAtPath: "acme", setAt: "2026-11-01T00:00:00Z", overrides: [] }];
const BELOW = [{ kind: "context", key: "house-style", value: "Ledger words.", setAtLevel: "project", setAtPath: "acme/tools/ledger", setAt: "2026-11-02T00:00:00Z", overrides: [] }];

function stub(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}, me: { memberships: { role: string }[] } = ME) {
  return stubApi({
    "GET /api/me": json(me),
    "GET /api/credits": json(CREDITS),
    "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }),
    "GET /api/tree": json({ ...TREE, viewerRole: me.memberships[0]?.role ?? "none" }),
    "GET /api/cascade": json(CONTEXT),
    "GET /api/cascade/below": json(BELOW),
    ...extra,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the tree as places to manage", () => {
  it("reads archived from a status or an archived flag, and active when neither is sent", () => {
    expect(statusOf({ status: "archived" })).toBe("archived");
    expect(statusOf({ archived: true })).toBe("archived");
    expect(statusOf({})).toBeNull();
    const nodes = flatten(TREE as never);
    expect(nodes.map((n) => [n.scope, n.level, n.archived])).toEqual([
      ["acme", "organisation", false],
      ["acme/tools", "division", false],
      ["acme/tools/ledger", "project", false],
      ["acme/tools/ledger/web", "app", false],
      ["acme/old", "division", true],
    ]);
  });

  it("asks for the role the control plane asks for", () => {
    expect(may("create", "organisation", "builder")).toBe(false);
    expect(may("create", "organisation", "admin")).toBe(true);
    expect(may("create", "division", "builder")).toBe(true);
    expect(may("rename", "division", "builder")).toBe(false);
    expect(may("rename", "project", "builder")).toBe(true);
    expect(may("rename", "organisation", "admin")).toBe(false);
    expect(may("delete", "app", "builder")).toBe(false);
    expect(whoMay("rename", "organisation")).toBe("the Owner");
    expect(whoMay("delete", "project")).toBe("an Admin or above");
  });
});

describe("ManageView", () => {
  it("shows a skeleton, then the outline with the archived drawn as archived", async () => {
    stub({ "GET /api/tree": "pending" });
    renderWithStore(<ManageView />);
    expect((await screen.findByText("Loading the organisation")).closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
    cleanup();
    stub();
    renderWithStore(<ManageView />);
    const outline = await screen.findByRole("navigation", { name: "Every part of the organisation" });
    expect(within(outline).getByRole("button", { name: /Old things/ }).textContent).toContain("Archived");
  });

  it("indents each level on a guide, says which row is the app, and names the part chosen in the trail (console-desktop 12, real-stack 52)", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools/ledger");
    stub();
    renderWithStore(<ManageView />);
    const outline = await screen.findByRole("navigation", { name: "Every part of the organisation" });
    const row = (name: RegExp) => within(outline).getByRole("button", { name });
    expect(row(/^Ledger web/).textContent).toContain("App");
    expect(row(/^Ledger$/).textContent).not.toContain("App");
    expect(row(/^Ledger web/).querySelectorAll("[data-guide]")).toHaveLength(3);
    expect(row(/^Tools/).querySelectorAll("[data-guide]")).toHaveLength(1);
    expect(row(/^Acme/).querySelectorAll("[data-guide]")).toHaveLength(0);
    // The trail: the organisation, Manage (back to the outline), then the part chosen.
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Manage" }).some((a) => a.getAttribute("href")?.startsWith("/tree"))).toBe(true));
    expect(screen.getAllByText("Ledger").length).toBeGreaterThan(1);
  });

  it("puts Save at the end of the name's own field, which grows with the panel (console-desktop 13)", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools");
    stub();
    renderWithStore(<ManageView />);
    const form = await screen.findByRole("form", { name: "Rename the division" });
    const row = form.querySelector("[data-rename-row]");
    expect(row?.querySelector("input")).toBeTruthy();
    expect(within(row as HTMLElement).getByRole("button", { name: "Save the name" })).toBeTruthy();
    expect(form.className).not.toContain("max-w-form");
  });

  it("records a failed read of the tree, never an empty organisation", async () => {
    stub({ "GET /api/tree": problem(500, "The database did not answer") });
    renderWithStore(<ManageView />);
    expect((await screen.findByText("The organisation could not be loaded")).closest('[role="alert"]')?.textContent).toContain("The database did not answer.");
  });

  it("adds a division with its address made from the name and editable until it is made", async () => {
    const api = stub({ "POST /api/divisions": json({ id: "d9", level: "division", slug: "field-ops", name: "Field Operations", path: "acme/field-ops", status: "active", createdAt: "t" }, 201) });
    renderWithStore(<ManageView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a division" }));
    const form = within(screen.getByRole("form", { name: "Add a division to Acme" }));
    fireEvent.change(form.getByLabelText("Name"), { target: { value: "Field Operations" } });
    const address = form.getByLabelText("Its address") as HTMLInputElement;
    expect(address.value).toBe("field-operations");
    fireEvent.change(address, { target: { value: "field-ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the division" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ parent: "acme", name: "Field Operations", slug: "field-ops" }));
    await waitFor(() => expect(window.location.search).toContain("scope=acme%2Ffield-ops"));
  });

  it("refuses an address that is not one before asking the server", async () => {
    stub();
    renderWithStore(<ManageView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a division" }));
    fireEvent.change(within(screen.getByRole("form", { name: "Add a division to Acme" })).getByLabelText("Name"), { target: { value: "X" } });
    expect(screen.getByText(/Use 2 to 40 lower-case letters/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add the division" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renames at once and puts the old name back with the reason when refused", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools");
    stub({ "PATCH /api/divisions/d1": problem(403, "This needs the admin role") });
    renderWithStore(<ManageView />);
    const name = (await screen.findByRole("textbox", { name: "Name" })) as HTMLInputElement;
    expect(screen.getByText(/Its address stays tools/)).toBeTruthy();
    fireEvent.change(name, { target: { value: "Toolkit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name" }));
    expect(await screen.findByText(/The name was not changed: This needs the admin role\. It is back to Tools\./)).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Every part of the organisation" })).getByRole("button", { name: "Tools" })).toBeTruthy();
  });

  it("shows the refusal to delete what has history, and archives it instead", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools/ledger");
    const api = stub({
      "DELETE /api/projects/p1": problem(409, "'acme/tools/ledger' still has children, work or credit history attached. Archive it instead (status: archived)."),
      "PATCH /api/projects/p1": json({ id: "p1", level: "project", slug: "ledger", name: "Ledger", path: "acme/tools/ledger", status: "archived", createdAt: "t" }),
    });
    renderWithStore(<ManageView />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Ledger" }));
    expect(screen.getByText(/^This cannot be undone\. Only a project with nothing in it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete Ledger" }));
    // D79: in normal mode the refusal is a plain sentence: no path, no wire hint, no status code.
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("Ledger was not deleted: It still has things beneath it, work or credit history. Archive it instead");
    expect(refusal.textContent).not.toMatch(/acme\/|\(409\)|status: archived|children/);
    fireEvent.click(screen.getByRole("button", { name: "Archive it instead" }));
    expect(await screen.findByText("Ledger is archived instead. Nothing in it was deleted.")).toBeTruthy();
    // One note at a time: the refusal is gone once archiving instead has answered (D37).
    expect(screen.queryByText(/was not deleted/)).toBeNull();
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "archived" });
  });

  it("says one thing at a time in a node's panel: a later action replaces the earlier note (D37)", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools/ledger");
    stub({
      "PATCH /api/projects/p1": json({ id: "p1", level: "project", slug: "ledger", name: "Ledger books", path: "acme/tools/ledger", status: "active", createdAt: "t" }),
      "DELETE /api/projects/p1": problem(409, "'acme/tools/ledger' still has children, work or credit history attached. Archive it instead (status: archived)."),
    });
    renderWithStore(<ManageView />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), { target: { value: "Ledger books" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name" }));
    expect(await screen.findByText("It is called Ledger books now.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete Ledger/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes, delete Ledger/ }));
    expect(await screen.findByText(/was not deleted/)).toBeTruthy();
    expect(screen.queryByText("It is called Ledger books now.")).toBeNull();
  });

  it("asks before deleting an app in plain English: an app, not a app", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools/ledger/web");
    stub();
    renderWithStore(<ManageView />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Ledger web" }));
    expect(screen.getByText(/^This cannot be undone\. Only an app with nothing in it, no work and no spending can be deleted/)).toBeTruthy();
  });

  it("reactivates an archived division as active", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/old");
    const api = stub({ "PATCH /api/divisions/d2": json({ id: "d2", level: "division", slug: "old", name: "Old things", path: "acme/old", status: "active", createdAt: "t" }) });
    renderWithStore(<ManageView />);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate Old things" }));
    expect(await screen.findByText("Old things is active again.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "active" });
  });

  it("tells a Viewer who may change each thing instead of offering controls that fail", async () => {
    stub({}, { ...ME, memberships: [{ ...ME.memberships[0], role: "viewer" }] });
    renderWithStore(<ManageView />);
    expect(await screen.findByText("The Owner renames the organisation.")).toBeTruthy();
    expect(screen.getByText("An Admin or above adds a division here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save the name" })).toBeNull();
    expect(await screen.findByText("A Builder or above changes what is said here.")).toBeTruthy();
  });

  it("describes a level: what is said, where it was set, and what a lower level replaces", async () => {
    window.history.replaceState(null, "", "/tree?scope=acme/tools");
    stub();
    renderWithStore(<ManageView />);
    const list = await screen.findByRole("list", { name: "What Tools is" });
    expect(within(list).getByText("House style")).toBeTruthy();
    expect(within(list).getByText("From Acme")).toBeTruthy();
    const below = await screen.findByRole("list", { name: "Said beneath Tools" });
    expect(within(below).getByText("Ledger replaces it")).toBeTruthy();
    expect(within(below).getByText("Ledger words.")).toBeTruthy();
  });

  it("adds what a level is at once, and takes it back with the reason when refused", async () => {
    const api = stub({ "GET /api/cascade": json([]), "PUT /api/cascade": problem(403, "This needs the builder role") });
    renderWithStore(<ManageView />);
    expect(await screen.findByText("Nothing is said about Acme yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Say something about Acme" }));
    fireEvent.change(screen.getByLabelText("What it is about"), { target: { value: "Purpose" } });
    fireEvent.change(screen.getByLabelText("What it says"), { target: { value: "Runs every product we own." } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    expect(await screen.findByText(/Purpose was not saved: This needs the builder role\./)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme", kind: "context", key: "purpose", value: "Runs every product we own." });
    await waitFor(() => expect(screen.getByText("Nothing is said about Acme yet.")).toBeTruthy());
  });
});
