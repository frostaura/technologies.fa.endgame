import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ONTOLOGY } from "@/test/fixtures";
import { json, problem, renderWithStore, stubApi } from "@/test/harness";
import type { Ontology, OntologyEdge, OntologyNode } from "@/store/types";
import { OntologyView } from "./OntologyView";
import { cellSentence, flowOf, nodeName, teamsOf } from "./ontologyModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The real stack's shape: one division, five projects and apps, eight employees (two reporting lines, a contractor), a member, seven services, a webhook and a schedule. */
function realShaped(): Ontology {
  const n = (id: string, type: string, name: string, attributes: Record<string, unknown> | null = null, status: string | null = null): OntologyNode => ({ id, type, name, scope: null, status, attributes });
  const e = (from: string, to: string, type: string, label: string | null = null): OntologyEdge => ({ from, to, type, label });
  const apps = ["Dive Trip Ready", "Compressor Service Log", "Dive Seat Sheet", "Club Reading List", "Gear Locker"];
  const nodes: OntologyNode[] = [n("organisation:o", "organisation", "FrostAura"), n("division:d", "division", "Technologies")];
  const edges: OntologyEdge[] = [e("organisation:o", "division:d", "owns")];
  apps.forEach((a, i) => {
    nodes.push(n(`project:p${i}`, "project", a), n(`app:a${i}`, "app", a));
    edges.push(e("division:d", `project:p${i}`, "owns"), e(`project:p${i}`, `app:a${i}`, "owns"));
  });
  const people: [string, string, string, string | null][] = [
    ["e0", "Iris", "Market researcher", null],
    ["e1", "Security reviewer", "Security reviewer", null],
    ["e2", "Odile", "Division lead", null],
    ["e3", "Theo", "Software engineer", "e2"],
    ["e4", "Mina", "QA engineer", "e2"],
    ["e5", "Kasper", "Software engineer", "e3"],
    ["e6", "Ruth", "Software engineer", "e2"],
  ];
  for (const [id, name, role, boss] of people) {
    nodes.push(n(`employee:${id}`, "employee", name, { role }, id === "e3" ? "working" : "idle"));
    edges.push(e(`employee:${id}`, id === "e0" || id === "e1" ? "organisation:o" : id === "e2" ? "division:d" : `project:p${Number(id.slice(1)) - 3}`, "works-on", role));
    if (boss) edges.push(e(`employee:${id}`, `employee:${boss}`, "reports-to"));
  }
  edges.push(e("employee:e3", "app:a2", "works-on", "now: Build: Dive Seat Sheet"));
  nodes.push(n("contractor:c1", "contractor", "Gap researcher (contractor)", { role: "gap researcher" }, "working"));
  edges.push(e("contractor:c1", "division:d", "works-on", "gap researcher"), e("contractor:c1", "employee:e2", "reports-to", "briefed by"));
  nodes.push(n("person:u1", "person", "Dean"));
  edges.push(e("person:u1", "organisation:o", "works-on", "owner"));
  for (const s of ["identity", "data", "models", "email", "telemetry", "webhooks", "schedules"]) nodes.push(n(`service:${s}`, "service", s));
  apps.forEach((_, i) => {
    const a = `app:a${i}`;
    edges.push(e(a, "service:data", "depends-on"), e(a, "service:data", "data-flows-to", "stored records"));
    edges.push(e(a, "service:identity", "depends-on"), e("service:identity", a, "data-flows-to", "signed-in people"));
    if (i % 2 === 0) edges.push(e(a, "service:models", "depends-on"), e(a, "service:models", "data-flows-to", "prompts"));
    if (i === 1) edges.push(e(a, "service:email", "depends-on"), e(a, "service:email", "data-flows-to", "outbound mail"));
    edges.push(e(a, "service:telemetry", "depends-on"), e(a, "service:telemetry", "data-flows-to", "operational telemetry"));
  });
  nodes.push(n("webhook:w1", "webhook", "Booking partner"), n("schedule:s1", "schedule", "Nightly digest"));
  edges.push(e("app:a0", "webhook:w1", "owns"), e("app:a0", "service:webhooks", "depends-on"), e("webhook:w1", "app:a0", "data-flows-to", "inbound calls"));
  edges.push(e("app:a3", "schedule:s1", "owns"), e("app:a3", "service:schedules", "depends-on"), e("schedule:s1", "app:a3", "data-flows-to", "scheduled calls"));
  return { scope: "frostaura", generatedAt: "2026-11-27T10:00:00Z", nodes, edges, views: {} };
}

describe("teamsOf", () => {
  it("groups people by the division they work in, each team a reporting tree", () => {
    const g = realShaped();
    const teams = teamsOf(g.nodes, g.edges);
    expect(teams.map((t) => t.title)).toEqual(["FrostAura", "Technologies", "People who sign in"]);
    const tech = teams[1];
    expect(tech?.heads.map((h) => h.node.name)).toEqual(["Odile"]);
    const odile = tech?.heads[0];
    expect(odile?.reports.map((r) => r.node.name)).toEqual(["Theo", "Mina", "Ruth", "Gap researcher (contractor)"]);
    expect(odile?.reports[0]?.reports.map((r) => r.node.name)).toEqual(["Kasper"]);
    expect(odile?.reports[3]?.under).toEqual({ name: "Odile", how: "briefed by" });
    expect(odile?.reports[0]?.now).toEqual([expect.objectContaining({ title: "Build: Dive Seat Sheet" })]);
    expect(tech?.size).toBe(6);
  });

  it("ends on a reporting loop, and leaves out secrets and places nobody works on", () => {
    const g = realShaped();
    g.edges.push({ from: "employee:e2", to: "employee:e5", type: "reports-to", label: null });
    g.nodes.push({ id: "secret:x", type: "secret", name: "API_KEY", scope: null, status: null, attributes: null });
    g.edges.push({ from: "division:d", to: "secret:x", type: "owns", label: null });
    const teams = teamsOf(g.nodes, g.edges);
    const count = teams.reduce((a, t) => a + t.size, 0);
    expect(count).toBe(9);
    expect(JSON.stringify(teams.map((t) => t.title))).not.toContain("API_KEY");
  });

  it("is empty when nobody works on anything", () => {
    const g = ONTOLOGY as Ontology;
    expect(teamsOf(g.nodes, g.edges.filter((e) => e.type === "owns"))).toEqual([]);
  });
});

describe("flowOf", () => {
  it("puts every relation between an app and a service in one cell, services in a reader's order", () => {
    const g = realShaped();
    const flow = flowOf(g.nodes, g.edges, "normal");
    expect(flow.rows).toHaveLength(5);
    expect(flow.columns.map((c) => c.name)).toEqual(["Sign-in", "Stored data", "AI inside apps", "Email", "Health and traffic", "Scheduled jobs", "Incoming data"]);
    const first = flow.rows[0]?.cells;
    expect(first?.["service:identity"]).toEqual({ relies: true, sends: [], receives: ["signed-in people"] });
    expect(first?.["service:models"]).toEqual({ relies: true, sends: ["prompts"], receives: [] });
    expect(first?.["service:webhooks"]).toEqual({ relies: true, sends: [], receives: ["inbound calls (Booking partner)"] });
    expect(flow.columns.find((c) => c.name === "AI inside apps")?.uses).toBe(3);
  });

  it("says a cell as a sentence", () => {
    expect(cellSentence("Court booking", "Sign-in", { relies: true, sends: [], receives: ["signed-in people"] })).toBe("Court booking relies on Sign-in, and receives signed-in people from it.");
    expect(cellSentence("Court booking", "AI inside apps", { relies: true, sends: ["prompts"], receives: [] })).toBe("Court booking relies on AI inside apps, and sends it prompts.");
    expect(cellSentence("Court booking", "Email", { relies: true, sends: [], receives: [] })).toBe("Court booking relies on Email.");
  });

  it("title-cases every service", () => {
    for (const s of ["data", "identity", "models", "email", "telemetry", "webhooks", "schedules", "something-new"]) {
      const name = nodeName({ id: `service:${s}`, type: "service", name: s, scope: null, status: null, attributes: null }, "normal");
      expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
    }
  });
});

describe("OntologyView", () => {
  it("loading, failed and empty are distinct", async () => {
    stubApi({ "GET /api/ontology": "pending" });
    const a = renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    expect(screen.getByRole("status").dataset.state).toBe("loading");
    a.unmount();
    stubApi({ "GET /api/ontology": problem(500, "Down") });
    const b = renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    expect((await screen.findByRole("alert")).textContent).toContain("The organisation graph could not be loaded");
    b.unmount();
    stubApi({ "GET /api/ontology": problem(403, "Not yours") });
    const c = renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    expect((await screen.findByRole("alert")).textContent).not.toContain("Nothing here is known until it loads.");
    c.unmount();
    stubApi({ "GET /api/ontology": json({ ...ONTOLOGY, edges: ONTOLOGY.edges.filter((e) => e.type === "owns") }) });
    const d = renderWithStore(<OntologyView scope="acme" view="data-flow" />);
    expect(await screen.findByText("No data flows yet")).toBeTruthy();
    d.unmount();
    // Divisions always exist, so "holds" alone must not hide the empty state.
    stubApi({ "GET /api/ontology": json({ ...ONTOLOGY, edges: ONTOLOGY.edges.filter((e) => e.type === "owns") }) });
    renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    expect(await screen.findByText("Nobody works on anything yet")).toBeTruthy();
  });

  it("lists who works on what, team by team, in plain words", async () => {
    stubApi({ "GET /api/ontology": json(ONTOLOGY) });
    renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    const list = await screen.findByRole("list", { name: "Who works on what" });
    expect(within(list).getByRole("link", { name: "Ada" }).getAttribute("href")).toBe("/employees/e1");
    expect(within(list).getByRole("list", { name: "What Ada works on" }).textContent).toBe("Works on Tools · Division");
    expect(within(list).getByText("Working")).toBeTruthy();
    // The key names exactly the marks drawn.
    const key = screen.getByRole("list", { name: "Key" });
    const drawn = new Set([...list.querySelectorAll("[data-mark]")].map((m) => m.getAttribute("data-mark")));
    const keyed = new Set([...key.querySelectorAll("[data-mark]")].map((m) => m.getAttribute("data-mark")));
    expect(keyed).toEqual(drawn);
  });

  it("shows data flows app by service, services named by what they do", async () => {
    stubApi({ "GET /api/ontology": json(ONTOLOGY) });
    renderWithStore(<OntologyView scope="acme" view="data-flow" />);
    // jsdom has no width: the narrow form, a card per app.
    const list = await screen.findByRole("list", { name: "How data flows" });
    expect(within(list).getByRole("link", { name: "Ledger web" }).getAttribute("href")).toBe("/apps/a1");
    expect(list.textContent).toContain("Ledger web relies on AI inside apps, and sends it prompts.");
    expect(list.textContent).toContain("Ledger web relies on Sign-in, and receives signed-in people from it.");
    expect(list.textContent).not.toContain("models");
    const key = screen.getByRole("list", { name: "Key" });
    expect(key.textContent).toContain("The app sends it");
    expect(key.textContent).toContain("The app receives it");
    expect(key.textContent).not.toContain("nothing travels");
  });

  it("draws the matrix when the frame has room, and the keyboard walks its cells", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    stubApi({ "GET /api/ontology": json(realShaped()) });
    renderWithStore(<OntologyView scope="frostaura" view="data-flow" />);
    const table = await screen.findByRole("table", { name: "How data flows" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "App",
      "Sign-in5 of 5 apps",
      "Stored data5 of 5 apps",
      "AI inside apps3 of 5 apps",
      "Email1 of 5 apps",
      "Health and traffic5 of 5 apps",
      "Scheduled jobs1 of 5 apps",
      "Incoming data1 of 5 apps",
    ]);
    const first = table.querySelector<HTMLElement>('[data-cell="0-0"]');
    expect(first?.tabIndex).toBe(0);
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("0-1");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("1-1");
    expect(document.activeElement?.getAttribute("title")).toBe("Compressor Service Log relies on Stored data, and sends it stored records.");
    vi.restoreAllMocks();
  });
});
