/**
 * TEST ONLY. Managing the tree and the cascade in the mock control plane: creating, renaming,
 * archiving and deleting divisions, projects and apps; the cascade's values at a scope and beneath it;
 * an app's rebuild and restart. Shapes as the control plane answers (TreeEndpoints, CascadeService,
 * AppVersionService). Every name is invented; nothing here is built into the console.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

type Send = (res: ServerResponse, status: number, body?: unknown) => void;
type Problem = (res: ServerResponse, status: number, title: string, detail?: string, code?: string) => void;
type Level = "organisation" | "division" | "project" | "app";
type Node = { id: string; slug: string; name: string; status?: string; projects?: Node[]; apps?: Node[] } & Record<string, unknown>;
type Tree = { organisation: (Node & { slug: string }) | null; divisions: Node[] } & Record<string, unknown>;
interface Value {
  kind: string;
  key: string;
  value: unknown;
  scope: string;
  setAt: string;
}

const LEVELS: Level[] = ["organisation", "division", "project", "app"];
const PLURAL: Record<string, Level> = { divisions: "division", projects: "project", apps: "app" };
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;
const now = () => new Date().toISOString();

interface Overlay {
  added: { level: Level; parent: string; node: Node }[];
  renamed: Map<string, string>;
  status: Map<string, string>;
  deleted: Set<string>;
  values: Map<string, Value>;
  /** The app whose status the next read reports, to reach "Rebuild and restart". */
  appStatus: Map<string, string>;
  republishFails: boolean;
  counter: number;
}

let overlay: Overlay = fresh();

function fresh(): Overlay {
  const values = new Map<string, Value>();
  const seed = (kind: string, key: string, scope: string, value: unknown) => values.set(`${kind}|${scope}|${key}`, { kind, key, value, scope, setAt: "2026-11-01T00:00:00Z" });
  // The caps the populated organisation's Credits page shows, and a sentence about what it is.
  seed("budget", "monthly_credits", "northwind", 2000);
  seed("budget", "monthly_credits", "northwind/software", 1000);
  seed("budget", "monthly_credits", "northwind/software/booking/desk", 500);
  seed("budget", "monthly_credits", "northwind/research/field-notes", 300);
  seed("context", "purpose", "northwind", "Northwind runs a squash club and the small products around it.");
  seed("context", "audience", "northwind/software/booking", "Club members booking courts from a phone.");
  return { added: [], renamed: new Map(), status: new Map(), deleted: new Set(), values, appStatus: new Map(), republishFails: false, counter: 0 };
}

export function resetManage() {
  overlay = fresh();
}

const levelOf = (scope: string): Level => LEVELS[Math.min(scope.split("/").length - 1, 3)] ?? "app";

/** The tree as the control plane answers it once the changes made through the console are applied. */
export function applyTree(tree: Tree): Tree {
  if (!tree.organisation) return tree;
  const t = structuredClone(tree);
  const org = t.organisation as Node;
  const touch = (n: Node) => {
    const name = overlay.renamed.get(n.id);
    if (name) n.name = name;
    const status = overlay.status.get(n.id);
    if (status) n.status = status;
  };
  touch(org);
  for (const a of overlay.added) {
    const parts = a.parent.split("/");
    if (a.level === "division") t.divisions.push(a.node);
    const d = t.divisions.find((x) => x.slug === parts[1]);
    if (a.level === "project") d?.projects?.push(a.node);
    if (a.level === "app") d?.projects?.find((p) => p.slug === parts[2])?.apps?.push(a.node);
  }
  t.divisions = t.divisions.filter((d) => !overlay.deleted.has(d.id));
  for (const d of t.divisions) {
    touch(d);
    d.projects = (d.projects ?? []).filter((p) => !overlay.deleted.has(p.id));
    for (const p of d.projects) {
      touch(p);
      p.apps = (p.apps ?? []).filter((a) => !overlay.deleted.has(a.id));
      for (const a of p.apps) touch(a);
    }
  }
  return t;
}

/** An app's detail with what the console changed: its name, and the status set for a test. */
export function applyApp<T extends { id: string; name: string; status: string; idleMinutes?: number }>(app: T): T {
  const name = overlay.renamed.get(app.id);
  const status = overlay.appStatus.get(app.id) ?? overlay.status.get(app.id);
  return { ...app, ...(name ? { name } : {}), ...(status ? { status } : {}) };
}

/** The Credits page's rows with their caps as the cascade now holds them. */
export function applyCaps<T extends { budgets: { scope: string; level: string; capCredits: number | null }[] }>(credits: T): T {
  return {
    ...credits,
    budgets: credits.budgets.map((b) => (b.level === "employee" ? b : { ...b, capCredits: (overlay.values.get(`budget|${b.scope}|monthly_credits`)?.value as number | undefined) ?? null })),
  };
}

function chain(scope: string): string[] {
  const parts = scope.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

function effective(scope: string, kind: string) {
  const out = new Map<string, { kind: string; key: string; value: unknown; setAtLevel: Level; setAtPath: string; setAt: string; overrides: string[] }>();
  for (const path of chain(scope)) {
    for (const v of overlay.values.values()) {
      if (v.kind !== kind || v.scope !== path) continue;
      const above = out.get(v.key);
      out.set(v.key, { kind, key: v.key, value: v.value, setAtLevel: levelOf(path), setAtPath: path, setAt: v.setAt, overrides: above ? [above.setAtPath, ...above.overrides] : [] });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function findScope(tree: Tree, level: Level, id: string): string | null {
  const org = tree.organisation;
  if (!org) return null;
  if (level === "organisation") return org.id === id ? org.slug : null;
  for (const d of tree.divisions) {
    if (level === "division" && d.id === id) return `${org.slug}/${d.slug}`;
    for (const p of d.projects ?? []) {
      if (level === "project" && p.id === id) return `${org.slug}/${d.slug}/${p.slug}`;
      for (const a of p.apps ?? []) if (level === "app" && a.id === id) return `${org.slug}/${d.slug}/${p.slug}/${a.slug}`;
    }
  }
  return null;
}

/** Handles the managing endpoints; true when it answered. `tree` is the tree as it is now. */
export async function handleManage(_req: IncomingMessage, res: ServerResponse, path: string, method: string, url: URL, body: unknown, tree: () => Tree, send: Send, problem: Problem): Promise<boolean> {
  if (path === "/__mock/manage" && method === "POST") {
    const b = (body ?? {}) as { appStatus?: Record<string, string>; republishFails?: boolean };
    for (const [id, status] of Object.entries(b.appStatus ?? {})) overlay.appStatus.set(id, status);
    if (b.republishFails !== undefined) overlay.republishFails = b.republishFails;
    send(res, 204);
    return true;
  }

  if (path === "/api/cascade" || path === "/api/cascade/below") {
    const scope = method === "PUT" ? String((body as { scope?: string } | null)?.scope ?? "") : (url.searchParams.get("scope") ?? "");
    const kind = method === "PUT" ? String((body as { kind?: string } | null)?.kind ?? "") : (url.searchParams.get("kind") ?? "");
    if (path === "/api/cascade/below") {
      const below = [...overlay.values.values()]
        .filter((v) => v.kind === kind && v.scope.startsWith(`${scope}/`))
        .sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key))
        .map((v) => ({ kind, key: v.key, value: kind === "secret" ? null : v.value, setAtLevel: levelOf(v.scope), setAtPath: v.scope, setAt: v.setAt, overrides: [] }));
      send(res, 200, below);
      return true;
    }
    if (method === "GET") {
      send(res, 200, effective(scope, kind));
      return true;
    }
    if (method === "PUT") {
      const b = body as { key?: string; value?: unknown };
      const key = String(b.key ?? "");
      if (!/^[a-z0-9._-]{1,200}$/.test(key)) {
        problem(res, 400, "Invalid", `'${key}' is not a cascade key: use 1-200 lower-case letters, digits, dots, hyphens and underscores.`);
        return true;
      }
      if ((key === "monthly_credits" || key === "app_models.monthly_credits") && (typeof b.value !== "number" || b.value < 0)) {
        problem(res, 400, "Invalid", `'${key}' is a number of credits.`);
        return true;
      }
      const setAt = now();
      overlay.values.set(`${kind}|${scope}|${key}`, { kind, key, value: b.value, scope, setAt });
      send(res, 200, { kind, key, value: b.value, setAtLevel: levelOf(scope), setAtPath: scope, setAt, overrides: [] });
      return true;
    }
    if (method === "DELETE") {
      const key = url.searchParams.get("key") ?? "";
      if (!overlay.values.delete(`${kind}|${scope}|${key}`)) problem(res, 404, "Not found", `A ${kind} '${key}' set at '${scope}' was not found.`);
      else send(res, 204);
      return true;
    }
  }

  let m = path.match(/^\/api\/(divisions|projects|apps)$/);
  if (m && method === "POST") {
    const level = PLURAL[m[1] as string] as Level;
    const b = (body ?? {}) as { parent?: string; name?: string; slug?: string };
    const parent = String(b.parent ?? "");
    const name = String(b.name ?? "").trim();
    const slug = String(b.slug ?? "");
    if (!SLUG.test(slug)) problem(res, 400, "Invalid", `'${slug}' is not a valid slug: use 2-40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit.`);
    else if (!name) problem(res, 400, "Invalid", "A name cannot be empty.");
    else {
      const t = tree();
      const siblings = level === "division" ? t.divisions : level === "project" ? (t.divisions.find((d) => d.slug === parent.split("/")[1])?.projects ?? []) : (t.divisions.find((d) => d.slug === parent.split("/")[1])?.projects?.find((p) => p.slug === parent.split("/")[2])?.apps ?? []);
      if (siblings.some((s) => s.slug === slug)) {
        problem(res, 409, "Conflict", "A sibling already uses that slug.");
        return true;
      }
      overlay.counter += 1;
      const id = `new-${level}-${overlay.counter}`;
      const spend = { monthCredits: 0 };
      const node: Node =
        level === "division"
          ? { id, slug, name, status: "active", spend, workers: [], projects: [] }
          : level === "project"
            ? { id, slug, name, status: "active", stage: "planning", ideaId: null, note: null, progress: null, spend, workers: [], apps: [] }
            : { id, slug, name, status: "draft", health: "unknown", running: "starting", access: "private", sharedWith: 0, visitsToday: null, lastVisitAt: null, spend, workers: [] };
      overlay.added.push({ level, parent, node });
      send(res, 201, { id, level, slug, name, path: `${parent}/${slug}`, status: String(node.status), createdAt: now() });
    }
    return true;
  }

  m = path.match(/^\/api\/(organisations|divisions|projects|apps)\/([^/]+)$/);
  if (m && (method === "PATCH" || method === "DELETE")) {
    const level: Level = m[1] === "organisations" ? "organisation" : (PLURAL[m[1] as string] as Level);
    const id = m[2] as string;
    const scope = findScope(tree(), level, id);
    if (!scope) {
      problem(res, 404, "Not found", `The ${level} was not found.`);
      return true;
    }
    if (method === "PATCH") {
      const b = (body ?? {}) as { name?: string; status?: string };
      if (b.name !== undefined) {
        if (!b.name.trim()) {
          problem(res, 400, "Invalid", "A name cannot be empty.");
          return true;
        }
        overlay.renamed.set(id, b.name.trim());
      }
      if (b.status !== undefined) {
        overlay.status.set(id, b.status);
        overlay.appStatus.delete(id);
      }
      send(res, 200, { id, level, slug: scope.split("/").pop(), name: overlay.renamed.get(id) ?? scope.split("/").pop(), path: scope, status: overlay.status.get(id) ?? "active", createdAt: "2026-11-01T00:00:00Z" });
      return true;
    }
    // Only a node made here, with nothing in it, has no history; the fixture's own nodes all have some.
    const made = overlay.added.find((a) => a.node.id === id);
    const empty = made && !overlay.added.some((a) => a.parent === scope && !overlay.deleted.has(a.node.id));
    if (!empty) problem(res, 409, "Conflict", `'${scope}' still has children, work or credit history attached. Archive it instead (status: archived).`);
    else {
      overlay.deleted.add(id);
      send(res, 204);
    }
    return true;
  }

  m = path.match(/^\/api\/apps\/([^/]+)\/republish$/);
  if (m && method === "POST") {
    const version = { commit: "9f1c2e7a4b5d6c8e0f1a2b3c4d5e6f708192a3b4", message: "Let members cancel a booking up to an hour before", at: now(), author: { kind: "employee", id: "e2", name: "Lin" }, live: !overlay.republishFails };
    if (!overlay.republishFails) overlay.appStatus.set(m[1] as string, "running");
    send(res, 200, { version, published: !overlay.republishFails, madePrivate: false, publishError: overlay.republishFails ? "The build stopped: a test failed." : null });
    return true;
  }
  return false;
}
