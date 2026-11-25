import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ONTOLOGY } from "@/test/fixtures";
import { json, problem, renderWithStore, stubApi } from "@/test/harness";
import type { Ontology } from "@/store/types";
import { OntologyView } from "./OntologyView";
import { layoutGraph } from "./ontologyModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("layoutGraph", () => {
  it("lays things out left to right, workers beyond what they work on, and ends on a cycle", () => {
    const g = ONTOLOGY as Ontology;
    const layout = layoutGraph(g.nodes, g.edges);
    const rank = (id: string) => layout.nodes.find((n) => n.node.id === id)?.rank;
    expect(rank("organisation:o1")).toBe(0);
    expect(rank("division:d1")).toBe(1);
    expect(rank("employee:e1")).toBeGreaterThan(rank("division:d1") ?? 0);
    // app → identity (relies on) and identity → app (sends users) is a cycle: laid out, not looped.
    expect(layout.edges).toHaveLength(g.edges.length);
    expect(layout.width).toBeGreaterThan(0);
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
    stubApi({ "GET /api/ontology": json({ ...ONTOLOGY, edges: ONTOLOGY.edges.filter((e) => e.type === "owns") }) });
    renderWithStore(<OntologyView scope="acme" view="data-flow" />);
    expect(await screen.findByText("No data flows yet")).toBeTruthy();
  });

  it("draws who works on what, and lists it readably, in plain words", async () => {
    stubApi({ "GET /api/ontology": json(ONTOLOGY) });
    renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    const list = await screen.findByRole("list", { name: "Who works on what" });
    expect(within(list).getByRole("link", { name: "Ada · Product researcher" }).getAttribute("href")).toBe("/employees/e1");
    expect(list.textContent).toContain("works on Tools");
    expect(screen.getByRole("region", { name: "Who works on what, drawn" })).toBeTruthy();
  });

  it("names a line on the drawing while the pointer rests on it", async () => {
    stubApi({ "GET /api/ontology": json(ONTOLOGY) });
    const { container } = renderWithStore(<OntologyView scope="acme" view="org-chart" />);
    await screen.findByRole("region", { name: "Who works on what, drawn" });
    const line = container.querySelector<SVGGElement>('g[data-edge^="Ada"]');
    expect(line).toBeTruthy();
    expect(container.querySelector("[data-edge-name]")).toBeNull();
    fireEvent.pointerOver(line as SVGGElement);
    expect(container.querySelector("[data-edge-name]")?.textContent).toBe(line?.getAttribute("data-edge"));
    fireEvent.pointerOut(line as SVGGElement);
    expect(container.querySelector("[data-edge-name]")).toBeNull();
  });

  it("shows data flows with services named by what they do", async () => {
    stubApi({ "GET /api/ontology": json(ONTOLOGY) });
    renderWithStore(<OntologyView scope="acme" view="data-flow" />);
    const list = await screen.findByRole("list", { name: "How data flows" });
    expect(list.textContent).toContain("sends data to AI inside apps");
    expect(list.textContent).toContain("signed-in people");
    expect(list.textContent).not.toContain("models");
  });
});
