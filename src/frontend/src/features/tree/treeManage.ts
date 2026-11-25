import { roleRank } from "@/lib/roles";
import type { ManagedLevel, MemberRole, ScopeLevel, Tree } from "@/store/types";

/**
 * The tree as a list of places a person can manage: every node with its address (a path of slugs),
 * its level, its id and whether it is archived. Reading `status` is defensive: an older control plane
 * sends none, and every node then reads as active.
 */
export interface ManagedNode {
  id: string;
  scope: string;
  level: ScopeLevel;
  name: string;
  slug: string;
  depth: number;
  archived: boolean;
  /** An app's own lifecycle word, when the tree says it. */
  status: string | null;
  parent: string | null;
  children: number;
}

/** A node's status as the tree answers it, whichever of the two shapes it uses. */
export function statusOf(node: object): string | null {
  const n = node as { status?: unknown; archived?: unknown };
  if (typeof n.status === "string") return n.status;
  if (n.archived === true) return "archived";
  return null;
}

export function isArchived(node: object): boolean {
  const n = node as { archived?: unknown };
  if (typeof n.archived === "boolean") return n.archived;
  return statusOf(node) === "archived";
}

export function flatten(tree: Tree | undefined): ManagedNode[] {
  const org = tree?.organisation;
  if (!tree || !org) return [];
  const out: ManagedNode[] = [
    { id: org.id, scope: org.slug, level: "organisation", name: org.name, slug: org.slug, depth: 0, archived: false, status: statusOf(org), parent: null, children: tree.divisions.length },
  ];
  for (const d of tree.divisions) {
    const ds = `${org.slug}/${d.slug}`;
    out.push({ id: d.id, scope: ds, level: "division", name: d.name, slug: d.slug, depth: 1, archived: isArchived(d), status: statusOf(d), parent: org.slug, children: d.projects.length });
    for (const p of d.projects) {
      const ps = `${ds}/${p.slug}`;
      out.push({ id: p.id, scope: ps, level: "project", name: p.name, slug: p.slug, depth: 2, archived: isArchived(p), status: statusOf(p), parent: ds, children: p.apps.length });
      for (const a of p.apps) out.push({ id: a.id, scope: `${ps}/${a.slug}`, level: "app", name: a.name, slug: a.slug, depth: 3, archived: isArchived(a), status: statusOf(a), parent: ps, children: 0 });
    }
  }
  return out;
}

export const LEVEL_NAME: Record<ScopeLevel, string> = { organisation: "Organisation", division: "Division", project: "Project", app: "App" };

/** The level a new node at this one would be: a division under the organisation, and so on. */
export function childLevel(level: ScopeLevel): ManagedLevel | null {
  return level === "organisation" ? "division" : level === "division" ? "project" : level === "project" ? "app" : null;
}

/** The role the control plane asks for, level by level (TreeEndpoints). */
const NEEDS: Record<"create" | "rename" | "archive" | "delete", Record<ScopeLevel, MemberRole>> = {
  // Creating is checked at the parent: a division needs an Admin at the organisation, a project or an app a Builder above it.
  create: { organisation: "admin", division: "builder", project: "builder", app: "owner" },
  rename: { organisation: "owner", division: "admin", project: "builder", app: "builder" },
  archive: { organisation: "owner", division: "admin", project: "builder", app: "builder" },
  delete: { organisation: "owner", division: "admin", project: "admin", app: "admin" },
};

export const ROLE_WORD: Record<MemberRole, string> = { owner: "the Owner", admin: "an Admin", builder: "a Builder", viewer: "a Viewer" };

export function may(action: keyof typeof NEEDS, level: ScopeLevel, role: MemberRole | null): boolean {
  if (action === "create" && level === "app") return false;
  return roleRank(role) >= roleRank(NEEDS[action][level]);
}

/** Who may do it, in plain words, for the line shown instead of a control. */
export function whoMay(action: keyof typeof NEEDS, level: ScopeLevel): string {
  const needed = NEEDS[action][level];
  return needed === "owner" ? "the Owner" : `${ROLE_WORD[needed]} or above`;
}

/** What reactivating an archived node sets: divisions and projects are active again; an app sleeps until visited, or is a draft if it never ran. */
export function reactivatedStatus(level: ScopeLevel, published: boolean): string {
  if (level !== "app") return "active";
  return published ? "sleeping" : "draft";
}

/** The parts of a slug path, as names where the tree knows them. */
export function nodeAt(nodes: ManagedNode[], scope: string): ManagedNode | null {
  return nodes.find((n) => n.scope === scope) ?? null;
}

/** A context key is lower-case letters, digits, dots, hyphens and underscores, up to 200 characters. */
export function isContextKey(key: string): boolean {
  return /^[a-z0-9._-]{1,200}$/.test(key);
}

/** A context value as words: text stays text; anything else is shown as it was written. */
export function contextText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** A short key from what a person typed as its label ("House style" → "house-style"). */
export function contextKeyFrom(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/** A key shown as words in normal mode: "house-style" → "House style". */
export function contextLabel(key: string): string {
  const words = key.replace(/[._-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}
