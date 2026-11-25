import type { Me, MemberRole } from "@/store/types";

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

/** The person's role at a scope, as the cascade resolves it: their highest grant on its chain. */
export function roleAt(me: Pick<Me, "memberships"> | undefined, scope: string): MemberRole | null {
  let best: MemberRole | null = null;
  for (const m of me?.memberships ?? []) if (covers(m.scope, scope) && roleRank(m.role) > roleRank(best)) best = m.role;
  return best;
}

/** Their highest role anywhere in an organisation, which caps an assistant's token. */
export function highestIn(me: Pick<Me, "memberships"> | undefined, organisation: string): MemberRole | null {
  let best: MemberRole | null = null;
  for (const m of me?.memberships ?? []) if (m.organisationSlug === organisation && roleRank(m.role) > roleRank(best)) best = m.role;
  return best;
}
