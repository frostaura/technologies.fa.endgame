import type { Me, MemberRole, Tree } from "@/store/types";

/** The four roles, least to most (spec, *Four fixed member roles*). */
export const ROLES: readonly MemberRole[] = ["viewer", "builder", "admin", "owner"] as const;

export function roleRank(role: MemberRole | "none" | null | undefined): number {
  return role && role !== "none" ? ROLES.indexOf(role) : -1;
}

export const ROLE_NAME: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", builder: "Builder", viewer: "Viewer" };

/** What each role may do, in plain words. */
export const ROLE_MAY: Record<MemberRole, string> = {
  owner: "Everything, including credits, the overdraft limit, managing Admins and closing the organisation.",
  admin: "Manages people, secrets, sharing, public or private, budgets and rules, within where the grant is set.",
  builder: "Creates and changes projects and apps, directs employees, and spends credits within budget.",
  viewer: "Sees everything there — the org chart, dashboards and apps — and changes nothing.",
};

/** A scope is a path of slugs; a grant set at a level holds for everything beneath it. */
export function covers(grantScope: string, scope: string): boolean {
  return scope === grantScope || scope.startsWith(`${grantScope}/`);
}

/**
 * The person's role at a scope, resolved exactly as the server resolves it (`RoleResolver`): the
 * deepest grant on the scope's chain wins — an organisation Admin who is a Viewer in one division is
 * a Viewer there — except that the organisation's Owner is the Owner everywhere. Prefer
 * {@link roleInTree}, which reads the server's own answer; this is for screens without the tree.
 */
export function roleAt(me: Pick<Me, "memberships"> | undefined, scope: string): MemberRole | null {
  const chain = (me?.memberships ?? []).filter((m) => covers(m.scope, scope));
  if (chain.some((m) => m.level === "organisation" && m.role === "owner")) return "owner";
  let deepest: { depth: number; role: MemberRole } | null = null;
  for (const m of chain) {
    const depth = m.scope.split("/").length;
    if (!deepest || depth > deepest.depth) deepest = { depth, role: m.role };
  }
  return deepest?.role ?? null;
}

/** The node of the tree at a scope (a path of slugs), with the viewer's role the server sent for it. */
function nodeAt(tree: Tree, scope: string): { role?: MemberRole | null } | null {
  const [org, division, project, app] = scope.split("/");
  if (!tree.organisation || org !== tree.organisation.slug) return null;
  if (!division) return tree.organisation;
  const d = tree.divisions.find((x) => x.slug === division);
  if (!d || !project) return d ?? null;
  const p = d.projects.find((x) => x.slug === project);
  if (!p || !app) return p ?? null;
  return p.apps.find((x) => x.slug === app) ?? null;
}

/**
 * The viewer's role at a scope, as the server resolved it for the tree (PPL-01): null where they
 * hold none, undefined when the tree does not say (it is not loaded, or an older control plane sent
 * no roles) — then fall back to {@link roleAt}.
 */
export function roleInTree(tree: Tree | undefined | null, scope: string): MemberRole | null | undefined {
  if (!tree) return undefined;
  const node = nodeAt(tree, scope);
  return node ? node.role : undefined;
}

/**
 * The role at a scope: the tree's answer where it gives one; from an older control plane that sends one
 * role for the whole tree, that role; with no tree, the same rule applied to `me`.
 */
export function effectiveRole(tree: Tree | undefined | null, me: Pick<Me, "memberships"> | undefined, scope: string): MemberRole | null {
  const fromTree = roleInTree(tree, scope);
  if (fromTree !== undefined) return fromTree;
  if (tree && tree.organisation?.role === undefined && tree.viewerRole !== "none") return tree.viewerRole;
  return roleAt(me, scope);
}

/** Their highest role anywhere in an organisation, which caps an assistant's token. */
export function highestIn(me: Pick<Me, "memberships"> | undefined, organisation: string): MemberRole | null {
  let best: MemberRole | null = null;
  for (const m of me?.memberships ?? []) if (m.organisationSlug === organisation && roleRank(m.role) > roleRank(best)) best = m.role;
  return best;
}
