import type { Mode } from "@/features/runs/runModel";
import type { OntologyEdge, OntologyNode } from "@/store/types";
import { capitalise } from "@/lib/format";
import { serviceLabel } from "../workforce/workforceModel";

/**
 * The organisation graph read two ways, each shaped for the question it answers rather than drawn
 * as nodes and lines (three blind reviews found the node-link drawing a tangle at real sizes):
 *
 * - **Who works on what** (`teamsOf`): the people, grouped by the division they work in, each team
 *   a reporting tree (a report sits under the person they report to), and beside each person what
 *   they work on — and what they are on now.
 * - **How data flows** (`flowOf`): a matrix, apps by the platform services they have used, each
 *   cell saying which way data travels between the two and what it is.
 */

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

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
  return TYPES[node.type] ?? capitalise(node.type);
}

/** Services the shared label list does not name, said plainly and title-cased (never "data"). */
const SERVICE_NAMES: Record<string, string> = { data: "Stored data" };

/** A node's name as normal mode says it: a service by what it does, never by its internal name. */
export function nodeName(node: OntologyNode, mode: Mode): string {
  if (node.type === "service") {
    const own = SERVICE_NAMES[node.name];
    if (own) return mode === "technical" ? `${own} (${node.name})` : own;
    return capitalise(serviceLabel(node.name, mode));
  }
  const role = node.attributes && typeof node.attributes.role === "string" ? node.attributes.role : null;
  // A contractor is named after its step by the runner; it reads as its role (D51).
  if (node.type === "contractor" || /\(contractor\)\s*$/i.test(node.name)) return `${role ? capitalise(role) : "Contractor"} · contractor`;
  if (node.type === "employee" && role) return `${node.name} · ${role}`;
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

// ---------------------------------------------------------------------------------------------
// Who works on what
// ---------------------------------------------------------------------------------------------

const WORKERS = new Set(["employee", "contractor", "person"]);

export interface Worker {
  node: OntologyNode;
  /** Their role, as the record says it. */
  role: string | null;
  working: boolean;
  /** Where they work: the places their record is set at. */
  places: OntologyNode[];
  /** What they are on right now, when it is somewhere other than where they work ("Build: Pager"). */
  now: { node: OntologyNode; title: string }[];
  /** How they hang under the person above them: "reports to", or "briefed by" (a contractor). */
  under: { name: string; how: string } | null;
  reports: Worker[];
  /** Contractors alike in every way (the same role, work and briefing) are one row: how many it stands for. */
  count: number;
}

export interface Team {
  /** The division they work in; the organisation itself for those who work across it; null for members. */
  place: OntologyNode | null;
  /** "Division", "Across the organisation", "Members". */
  kind: string;
  title: string;
  /** The tree's top: people who report to nobody here. */
  heads: Worker[];
  size: number;
}

/**
 * The people in the graph, grouped into teams by the division their work sits in, each team a tree
 * by reporting line. Order follows the graph: the organisation's own people first, then each
 * division in the order the organisation holds them, then members who sign in.
 */
export function teamsOf(nodes: OntologyNode[], edges: OntologyEdge[]): Team[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const e of edges) if (e.type === "owns" && byId.has(e.from) && byId.has(e.to) && !parent.has(e.to)) parent.set(e.to, e.from);
  const divisionOf = (id: string): OntologyNode | null => {
    const seen = new Set<string>();
    let at: string | undefined = id;
    while (at && !seen.has(at)) {
      seen.add(at);
      const n = byId.get(at);
      if (n?.type === "division") return n;
      at = parent.get(at);
    }
    return null;
  };

  const workers = new Map<string, Worker>();
  const manager = new Map<string, { id: string; how: string }>();
  for (const n of nodes) {
    if (!WORKERS.has(n.type)) continue;
    const mine = edges.filter((e) => e.from === n.id);
    const works = mine.filter((e) => e.type === "works-on" && byId.has(e.to));
    const ups = mine.filter((e) => e.type === "reports-to" && byId.has(e.to) && e.to !== n.id);
    if (works.length === 0 && ups.length === 0 && !edges.some((e) => e.type === "reports-to" && e.to === n.id)) continue;
    const role = typeof n.attributes?.role === "string" ? n.attributes.role : (works.find((e) => e.label && !e.label.startsWith("now:"))?.label ?? null);
    const places: OntologyNode[] = [];
    const now: Worker["now"] = [];
    for (const e of works) {
      const to = byId.get(e.to);
      if (!to) continue;
      if (e.label?.startsWith("now:")) now.push({ node: to, title: e.label.replace(/^now:\s*/, "") });
      else if (!places.includes(to)) places.push(to);
    }
    const up = ups.find((e) => !e.label) ?? ups[0];
    if (up) manager.set(n.id, { id: up.to, how: up.label ?? "reports to" });
    workers.set(n.id, { node: n, role, working: n.status === "working", places, now, under: null, reports: [], count: 1 });
  }

  // Each person hangs under their manager unless that would close a loop; then they head a tree of their own.
  const above = new Map<string, string>();
  const reaches = (from: string, target: string) => {
    for (let at: string | undefined = from; at; at = above.get(at)) if (at === target) return true;
    return false;
  };
  for (const id of workers.keys()) {
    const m = manager.get(id);
    if (m && workers.has(m.id) && !reaches(m.id, id)) above.set(id, m.id);
  }
  const roots: Worker[] = [];
  for (const [id, w] of workers) {
    const boss = workers.get(above.get(id) ?? "");
    if (boss) {
      boss.reports.push(w);
      w.under = { name: plainName(boss.node), how: manager.get(id)?.how ?? "reports to" };
    } else roots.push(w);
  }

  // Identical contractors side by side read as one row with a count, not the same line three times.
  const merge = (list: Worker[]): Worker[] => {
    const out: Worker[] = [];
    for (const w of list) {
      w.reports = merge(w.reports);
      const key = (x: Worker) => `${x.node.type}|${plainName(x.node)}|${x.places.map((p) => p.id).join(",")}|${x.under?.how ?? ""}|${x.reports.length}`;
      const twin = w.node.type === "contractor" && w.reports.length === 0 ? out.find((o) => o.node.type === "contractor" && key(o) === key(w)) : undefined;
      if (!twin) {
        out.push(w);
        continue;
      }
      twin.count += w.count;
      twin.working ||= w.working;
      for (const n of w.now) if (!twin.now.some((t) => t.title === n.title && t.node.id === n.node.id)) twin.now.push(n);
    }
    return out;
  };
  roots.splice(0, roots.length, ...merge(roots));

  const organisation = nodes.find((n) => n.type === "organisation") ?? null;
  const divisions = nodes.filter((n) => n.type === "division");
  const teams = new Map<string, Team>();
  const team = (key: string, make: () => Team) => {
    const t = teams.get(key) ?? make();
    teams.set(key, t);
    return t;
  };
  for (const r of roots) {
    const where = r.places[0] ?? r.now[0]?.node ?? null;
    if (r.node.type === "person") team("members", () => ({ place: null, kind: "Members", title: "People who sign in", heads: [], size: 0 })).heads.push(r);
    else {
      const d = where ? divisionOf(where.id) : null;
      if (d) team(d.id, () => ({ place: d, kind: "Division", title: d.name, heads: [], size: 0 })).heads.push(r);
      else team("organisation", () => ({ place: organisation, kind: "Across the organisation", title: organisation?.name ?? "The organisation", heads: [], size: 0 })).heads.push(r);
    }
  }
  const count = (w: Worker): number => w.count + w.reports.reduce((a, x) => a + count(x), 0);
  const order = ["organisation", ...divisions.map((d) => d.id), "members"];
  return [...teams.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, t]) => ({ ...t, size: t.heads.reduce((a, w) => a + count(w), 0) }));
}

/** A person's own name, without their role: "Odile", not "Odile · Division lead"; a contractor by its role ("Research contractor"). */
export function plainName(node: OntologyNode): string {
  if (node.type === "contractor" || /\(contractor\)\s*$/i.test(node.name)) {
    const role = typeof node.attributes?.role === "string" ? node.attributes.role : null;
    return role ? capitalise(role) : "Contractor";
  }
  return node.name;
}

// ---------------------------------------------------------------------------------------------
// How data flows
// ---------------------------------------------------------------------------------------------

export interface FlowCell {
  relies: boolean;
  /** What the app sends to this service ("prompts"). */
  sends: string[];
  /** What this service, or a source behind it, sends the app ("signed-in people", "inbound calls from Stripe"). */
  receives: string[];
}

export interface FlowColumn {
  /** The column's key: a service's node id, or the kind of source it stands for. */
  id: string;
  name: string;
  /** How many apps use it. */
  uses: number;
}

export interface FlowRow {
  app: OntologyNode;
  cells: Record<string, FlowCell>;
}

export interface Flow {
  columns: FlowColumn[];
  rows: FlowRow[];
}

/** Columns in the order a person thinks of an app: who signs in, what it keeps, what it calls, what it reports, what wakes it. */
const SERVICE_ORDER = ["identity", "data", "models", "email", "secrets", "telemetry", "schedules", "webhooks"];
/** A declared source of data folds into the service that carries it. */
const SOURCE_SERVICE: Record<string, string> = { webhook: "webhooks", schedule: "schedules" };

/**
 * Apps × the services they use. Every relation between an app and a service lands in one cell:
 * whether it relies on it, what it sends there, and what comes back. A webhook or a schedule an app
 * declares is read as data arriving through its service ("inbound calls (Payments)").
 */
export function flowOf(nodes: OntologyNode[], edges: OntologyEdge[], mode: Mode): Flow {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const columnOf = (n: OntologyNode): { id: string; name: string } | null => {
    if (n.type === "app") return null;
    if (n.type === "service") return { id: n.id, name: nodeName(n, mode) };
    const via = SOURCE_SERVICE[n.type];
    if (via) {
      const id = `service:${via}`;
      const svc = byId.get(id);
      return { id, name: svc ? nodeName(svc, mode) : nodeName({ ...n, type: "service", name: via }, mode) };
    }
    return { id: n.id, name: nodeName(n, mode) };
  };
  const rows = new Map<string, FlowRow>();
  const columns = new Map<string, { id: string; name: string; apps: Set<string> }>();
  const cell = (app: OntologyNode, col: { id: string; name: string }): FlowCell => {
    const row = rows.get(app.id) ?? { app, cells: {} };
    rows.set(app.id, row);
    const c = columns.get(col.id) ?? { ...col, apps: new Set<string>() };
    c.apps.add(app.id);
    columns.set(col.id, c);
    const found = row.cells[col.id] ?? { relies: false, sends: [], receives: [] };
    row.cells[col.id] = found;
    return found;
  };
  const add = (list: string[], what: string) => {
    if (!list.includes(what)) list.push(what);
  };
  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (e.type === "depends-on" && from.type === "app") {
      const col = columnOf(to);
      if (col) cell(from, col).relies = true;
    } else if (e.type === "data-flows-to") {
      if (from.type === "app") {
        const col = columnOf(to);
        if (col) add(cell(from, col).sends, e.label ?? "data");
      } else if (to.type === "app") {
        const col = columnOf(from);
        if (!col) continue;
        const what = from.type === "service" ? (e.label ?? "data") : `${e.label ?? "data"} (${from.name})`;
        add(cell(to, col).receives, what);
      }
    }
  }
  const rank = (id: string) => {
    const i = SERVICE_ORDER.indexOf(id.replace(/^service:/, ""));
    return i < 0 ? SERVICE_ORDER.length : i;
  };
  return {
    columns: [...columns.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, uses: c.apps.size })),
    // Apps in the order the organisation holds them.
    rows: nodes.filter((n) => rows.has(n.id)).map((n) => rows.get(n.id) as FlowRow),
  };
}

/** One cell said as a sentence: "Court booking relies on Sign-in, and receives signed-in people from it." */
export function cellSentence(app: string, service: string, c: FlowCell): string {
  const it = c.relies ? "it" : service;
  const parts: string[] = [];
  if (c.sends.length) parts.push(`sends ${it} ${list(c.sends)}`);
  if (c.receives.length) parts.push(`receives ${list(c.receives)} from ${it}`);
  if (!c.relies) return `${app} ${parts.join(" and ")}.`;
  return parts.length ? `${app} relies on ${service}, and ${parts.join(" and ")}.` : `${app} relies on ${service}.`;
}

function list(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
