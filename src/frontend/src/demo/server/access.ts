import type { MemberRole } from "@/store/types";
import { forbidden, invalid, notFound, unauthenticated } from "./http";
import { chain, newId, node, orgOf, user, type DemoUser, type World } from "./world";

/**
 * Who may do what, as `AccessService.RequireAsync` and `RoleResolver` decide it: the deepest grant
 * on the chain from the organisation down wins, except that the Owner's organisation grant wins
 * everywhere; an operator with no grant enters as an Admin, never the Owner; with no role on the
 * chain the scope is "not found", so the tree's shape is not disclosed.
 */

const RANK: Record<MemberRole, number> = { viewer: 1, builder: 2, admin: 3, owner: 4 };

export function me(world: World): DemoUser {
  const u = user(world, world.sessionUserId);
  if (!u) throw unauthenticated();
  return u;
}

export interface Held {
  role: MemberRole;
  /** Where the deciding grant was set; the organisation for an operator's entry. */
  at: string;
  viaOperator: boolean;
}

export function roleAt(world: World, userId: string, path: string): Held | null {
  const org = orgOf(path);
  const grants = world.memberships.filter((m) => m.userId === userId);
  const owner = grants.find((m) => m.path === org && m.role === "owner");
  if (owner) return { role: "owner", at: org, viaOperator: false };
  let held: Held | null = null;
  for (const p of chain(path)) {
    const g = grants.find((m) => m.path === p);
    if (g) held = { role: g.role, at: g.path, viaOperator: false };
  }
  if (held) return held;
  const u = user(world, userId);
  if (u?.isOperator && world.organisations.some((o) => o.slug === org)) return { role: "admin", at: org, viaOperator: true };
  return null;
}

const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}[a-z0-9]$|^[a-z0-9]{2}$/;

/** `ScopePath.Parse`, then the node must exist. */
export function scopeOf(world: World, value: string | null | undefined): string {
  if (!value) throw invalid("A scope is required, written as org, org/division, org/division/project or org/division/project/app.");
  const parts = value.split("/");
  if (parts.length > 4) throw invalid(`'${value}' is not a scope: it has ${parts.length} segments, and a scope has one to four.`);
  for (const seg of parts) if (!SLUG.test(seg)) throw invalid(`'${seg}' is not a valid slug: use 2-40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit.`);
  if (!node(world, value)) throw notFound(`The scope '${value}'`);
  return value;
}

/** The role with its article, as a sentence says it (`MemberRoles.WithArticle`): "an admin", "a builder". */
export const withArticle = (role: MemberRole): string => (role === "admin" || role === "owner" ? `an ${role}` : `a ${role}`);

/** Require a role at a scope; answers with the control plane's own refusal words. */
export function requireRole(world: World, path: string, needed: MemberRole): Held {
  const u = me(world);
  const held = roleAt(world, u.id, path);
  if (!held) throw notFound(`The scope '${path}'`);
  if (held.viaOperator) {
    operatorVisit(world, u, orgOf(path));
    if (!world.entered.includes(orgOf(path))) world.entered.push(orgOf(path));
    const acted = (world.actedAsOperator ??= []);
    if (!acted.includes(orgOf(path))) acted.push(orgOf(path));
  }
  if (RANK[held.role] < RANK[needed]) throw forbidden(`This needs the ${needed} role at '${path}'; you are ${withArticle(held.role)} there (set at ${held.at}).`);
  return held;
}

/** `OperatorOptions.EntryLogWindowMinutes`: how long a visit lasts between an operator's reads. */
export const VISIT_WINDOW_MS = 10 * 60_000;

/**
 * `AccessService.LogVisitAsync` (and `RecordEntryAsync` when `entered` is set): an operator's read or
 * change inside an organisation continues their visit, and logs nothing, when they were last there
 * within ten minutes; otherwise it is a new visit, and one "Entered the organisation" row is written
 * where the Owner reads it. An explicit entry is always a row.
 */
export function operatorVisit(world: World, u: DemoUser, org: string, entered = false) {
  const now = Date.now();
  const seen = (world.operatorSeen ??= {});
  const key = `${u.id}:${org}`;
  const recent = (iso: string | undefined) => iso !== undefined && now - Date.parse(iso) <= VISIT_WINDOW_MS;
  const lastEntry = world.operatorLog.find((x) => x.organisation === org && x.operator.id === u.id && x.action === "organisation.entered");
  if (entered || !(recent(seen[key]) || recent(lastEntry?.at))) {
    world.operatorLog.unshift({ id: newId(world, "op"), organisation: org, at: new Date(now).toISOString(), action: "organisation.entered", operator: { id: u.id, email: u.email, displayName: u.displayName }, detail: { scope: org } });
    world.changed.push("OperatorAccess");
  }
  seen[key] = new Date(now).toISOString();
}

export function atLeast(held: MemberRole, needed: MemberRole): boolean {
  return RANK[held] >= RANK[needed];
}

export function highestIn(world: World, userId: string, org: string): MemberRole | null {
  let best: MemberRole | null = null;
  for (const m of world.memberships) {
    if (m.userId !== userId || orgOf(m.path) !== org) continue;
    if (!best || RANK[m.role] > RANK[best]) best = m.role;
  }
  return best;
}

export function requireOperator(world: World) {
  const u = me(world);
  if (!u.isOperator) throw forbidden("Only FrostAura operators may do this.");
  return u;
}

/** The organisation the signed-in person belongs to first: organisation-level grants first. */
export function homeOrganisation(world: World, userId: string): string | null {
  const grants = world.memberships.filter((m) => m.userId === userId).sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  return grants[0] ? orgOf(grants[0].path) : null;
}
