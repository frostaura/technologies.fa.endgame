import { useSyncExternalStore } from "react";
import { useLocation } from "@/lib/router";
import { highestIn, roleAt } from "@/lib/roles";
import { useGetMeQuery, useGetTreeQuery } from "@/store/api";
import type { Me, MemberRole, OrganisationRef } from "@/store/types";

/**
 * The organisation a screen works in: the one an operator entered in God mode (`?organisation=`),
 * else the one a person in several chose with the switcher, else their own first one. Every screen
 * that reads an organisation asks this, so God mode and the switcher reach all of them.
 */
export interface ActiveOrganisation {
  organisation: { id: string; slug: string; name: string } | null;
  /** True when an operator entered an organisation they hold no role in. */
  entered: boolean;
  /** The person's role over the organisation; an operator in God mode acts as an Admin. */
  role: MemberRole | null;
  isLoading: boolean;
}

const KEY = "endgame.organisation";
const listeners = new Set<() => void>();
/** The choice, kept for this visit when the browser stores nothing. */
let memory: string | null = null;

function readChosen(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Choose the organisation a person in more than one works in. It is remembered on this device only. */
export function chooseOrganisation(slug: string | null) {
  try {
    if (slug) window.localStorage.setItem(KEY, slug);
    else window.localStorage.removeItem(KEY);
  } catch {
    // A browser that keeps nothing still switches for this visit.
    memory = slug;
  }
  for (const l of listeners) l();
}

/** Every organisation the person holds a role in, once each, in the order the session lists them. */
export function organisationsOf(me: Pick<Me, "memberships"> | undefined): OrganisationRef[] {
  const seen = new Map<string, OrganisationRef>();
  for (const m of me?.memberships ?? []) if (!seen.has(m.organisationSlug)) seen.set(m.organisationSlug, { id: m.organisationId, slug: m.organisationSlug, name: m.organisationName });
  return [...seen.values()];
}

export function useActiveOrganisation(): ActiveOrganisation {
  const me = useGetMeQuery(undefined);
  const { search } = useLocation();
  const chosen = useSyncExternalStore(subscribe, () => readChosen() ?? memory, () => null);
  const asked = search.get("organisation");
  const own = organisationsOf(me.data);
  const operatorEntry = !!asked && me.data?.isOperator === true && !own.some((o) => o.slug === asked);
  // An entered organisation's name and id come from its tree, which the org chart reads the same way.
  const entered = useGetTreeQuery(asked ?? undefined, { skip: !operatorEntry });

  if (!me.data) return { organisation: null, entered: false, role: null, isLoading: me.isLoading || me.isFetching };
  if (operatorEntry && asked) {
    const org = entered.data?.organisation;
    return { organisation: org ? { id: org.id, slug: org.slug, name: org.name } : { id: "", slug: asked, name: asked }, entered: true, role: "admin", isLoading: entered.isLoading };
  }
  const pick = own.find((o) => o.slug === asked) ?? own.find((o) => o.slug === chosen) ?? me.data.organisation ?? own[0] ?? null;
  return { organisation: pick, entered: false, role: pick ? (roleAt(me.data, pick.slug) ?? highestIn(me.data, pick.slug)) : null, isLoading: false };
}

/** What to read the tree with for the active organisation: nothing for the person's default, else its slug. */
export function treeArgFor(active: ActiveOrganisation, me: Pick<Me, "organisation"> | undefined): string | undefined {
  const slug = active.organisation?.slug;
  return slug && slug !== me?.organisation?.slug ? slug : undefined;
}
