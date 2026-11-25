import type { Mode } from "@/features/runs/runModel";
import type { OntologyEdge, OntologyNode } from "@/store/types";
import { serviceLabel } from "../workforce/workforceModel";

/**
 * The organisation graph laid out to be read: a layered diagram, left to right. Things flow
 * rightwards — the organisation holds its divisions, an app relies on a service, data travels
 * from a webhook into an app — and the people sit one column beyond what they work on. Cycles
 * (an app that relies on sign-in, which then sends it its users) are broken by keeping the first
 * direction met, so the layout always ends.
 */

export const NODE = { width: 216, height: 60 } as const;
const GAP = { column: 112, row: 20, margin: 24 } as const;

/** Edge types whose target sits to the right of their source. */
const FORWARD = new Set(["owns", "depends-on", "data-flows-to"]);
/** Edge types whose source (a worker) sits to the right of their target. */
const BACKWARD = new Set(["works-on", "reports-to"]);

export interface PlacedNode {
  node: OntologyNode;
  rank: number;
  order: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  edge: OntologyEdge;
  d: string;
  /** Where its label sits. */
  mid: { x: number; y: number };
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

export function layoutGraph(nodes: OntologyNode[], edges: OntologyEdge[]): Layout {
  const ids = new Set(nodes.map((n) => n.id));
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n.id, []);
  for (const e of live) {
    if (FORWARD.has(e.type)) out.get(e.from)?.push(e.to);
    else if (BACKWARD.has(e.type)) out.get(e.to)?.push(e.from);
  }

  // Depth-first, dropping back edges, gives a topological order.
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const dag = new Map<string, string[]>();
  const visit = (id: string) => {
    state.set(id, 1);
    const kept: string[] = [];
    for (const next of out.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) continue; // back edge: a cycle, ignored for layout
      kept.push(next);
      if (s === 0) visit(next);
    }
    dag.set(id, kept);
    state.set(id, 2);
    order.push(id);
  };
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);
  order.reverse();

  // Longest path from the sources.
  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const id of order) for (const next of dag.get(id) ?? []) rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));

  // Columns, ordered to keep linked nodes level with each other.
  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    columns.set(r, [...(columns.get(r) ?? []), n.id]);
  }
  const position = new Map<string, number>();
  const ranks = [...columns.keys()].sort((a, b) => a - b);
  for (const r of ranks) (columns.get(r) ?? []).forEach((id, i) => position.set(id, i));
  const neighbours = new Map<string, string[]>();
  for (const e of live) {
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to]);
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from]);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const r of ranks) {
      const col = columns.get(r) ?? [];
      const score = (id: string) => {
        const ns = (neighbours.get(id) ?? []).filter((x) => (rank.get(x) ?? 0) !== r).map((x) => position.get(x) ?? 0);
        return ns.length === 0 ? (position.get(id) ?? 0) : ns.reduce((a, b) => a + b, 0) / ns.length;
      };
      const sorted = [...col].sort((a, b) => score(a) - score(b) || (position.get(a) ?? 0) - (position.get(b) ?? 0));
      sorted.forEach((id, i) => position.set(id, i));
      columns.set(r, sorted);
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedNode[] = [];
  const at = new Map<string, PlacedNode>();
  let height = 0;
  ranks.forEach((r, column) => {
    (columns.get(r) ?? []).forEach((id, i) => {
      const node = byId.get(id);
      if (!node) return;
      const p = { node, rank: column, order: i, x: GAP.margin + column * (NODE.width + GAP.column), y: GAP.margin + i * (NODE.height + GAP.row) };
      placed.push(p);
      at.set(id, p);
      height = Math.max(height, p.y + NODE.height + GAP.margin);
    });
  });
  const width = GAP.margin * 2 + ranks.length * NODE.width + Math.max(0, ranks.length - 1) * GAP.column;

  const placedEdges = live.flatMap((edge): PlacedEdge[] => {
    const a = at.get(edge.from);
    const b = at.get(edge.to);
    if (!a || !b) return [];
    const ay = a.y + NODE.height / 2;
    const by = b.y + NODE.height / 2;
    if (a.x === b.x) {
      const x = a.x + NODE.width;
      const bend = x + 48;
      return [{ edge, d: `M ${x} ${ay} C ${bend} ${ay}, ${bend} ${by}, ${x} ${by}`, mid: { x: bend - 12, y: (ay + by) / 2 } }];
    }
    const rightward = a.x < b.x;
    const x1 = rightward ? a.x + NODE.width : a.x;
    const x2 = rightward ? b.x : b.x + NODE.width;
    const dx = (x2 - x1) / 2;
    return [{ edge, d: `M ${x1} ${ay} C ${x1 + dx} ${ay}, ${x2 - dx} ${by}, ${x2} ${by}`, mid: { x: (x1 + x2) / 2, y: (ay + by) / 2 } }];
  });

  return { nodes: placed, edges: placedEdges, width: Math.max(width, NODE.width + GAP.margin * 2), height: Math.max(height, NODE.height + GAP.margin * 2) };
}

const TYPES: Record<string, string> = {
  organisation: "Organisation",
  division: "Division",
  project: "Project",
  app: "App",
  employee: "Employee",
  contractor: "Contractor",
  person: "Person",
  secret: "Secret",
  service: "Platform service",
  webhook: "Incoming data",
  schedule: "Schedule",
};

export function nodeType(node: OntologyNode): string {
  return TYPES[node.type] ?? node.type;
}

/** A node's name as normal mode says it: a service by what it does, never by its internal name. */
export function nodeName(node: OntologyNode, mode: Mode): string {
  if (node.type === "service") return serviceLabel(node.name, mode);
  const role = node.attributes && typeof node.attributes.role === "string" ? node.attributes.role : null;
  if ((node.type === "employee" || node.type === "contractor") && role) return `${node.name} · ${role}`;
  return node.name;
}

const EDGE_WORDS: Record<string, string> = {
  owns: "holds",
  "works-on": "works on",
  "reports-to": "reports to",
  "depends-on": "relies on",
  "data-flows-to": "sends data to",
};

export function edgeWords(type: string): string {
  return EDGE_WORDS[type] ?? type;
}

/** An edge's own label, said plainly ("now: Build: Pager" → "now on Build: Pager"). */
export function edgeLabel(edge: OntologyEdge): string | null {
  if (!edge.label) return null;
  return edge.label.replace(/^now:\s*/, "now on ");
}

/** The id an ontology node carries for the record it stands for: `employee:<id>` → `<id>`. */
export function recordId(node: OntologyNode): string {
  return node.id.slice(node.id.indexOf(":") + 1);
}
