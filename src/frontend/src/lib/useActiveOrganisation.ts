import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetMeQuery, useGetTreeQuery } from "@/store/api";
import type { Me, MemberRole, OrganisationRef } from "@/store/types";
import { organisationEntered, organisationLeft, storeEntered } from "@/store/uiSlice";
import { navigate, paths, useLocation } from "./router";

export interface ActiveOrganisation {
  organisation: { id: string; slug: string; name: string } | null;
  /** True when a FrostAura operator is inside an organisation they hold no role in (God mode). */
  entered: boolean;
  /** The person's role at the organisation itself, as the server resolves it; null when their grants all sit lower. */
  role: MemberRole | null;
  isLoading: boolean;
}

/**
 * The organisation every screen works on (OP-04). For a FrostAura operator who entered one in God
 * mode it is that organisation — named in the address as `?organisation=<slug>`, and remembered so
 * that a link without it keeps working until they leave through "Every organisation". For anyone
 * else it is their own (`me.organisation`).
 */
export function useActiveOrganisation(): ActiveOrganisation {
  const me = useGetMeQuery(undefined);
  const chosen = useChosenOrganisation();
  const { search } = useLocation();
  const remembered = useAppSelector((s) => s.ui.entered);
  const dispatch = useAppDispatch();
  const isOperator = me.data?.isOperator === true;
  const own = me.data?.organisation ?? null;
  const named = isOperator ? search.get("organisation") || null : null;
  const slug = named ?? (isOperator ? (remembered?.slug ?? null) : null);
  // An operator who is a member of the organisation named is simply inside their own.
  const membership = slug ? me.data?.memberships.find((m) => m.organisationSlug === slug) : undefined;
  const entering = slug !== null && !membership;
  const tree = useGetTreeQuery(slug ?? undefined, { skip: !entering });
  const found = entering && tree.data?.organisation?.slug === slug ? tree.data.organisation : null;

  // Remember what the address names, once it is known to be an organisation.
  useEffect(() => {
    if (!found || (remembered?.slug === found.slug && remembered.name === found.name)) return;
    const ref = { id: found.id, slug: found.slug, name: found.name };
    dispatch(organisationEntered(ref));
    storeEntered(ref);
  }, [found, remembered, dispatch]);

  if (entering) {
    const organisation = found ? { id: found.id, slug: found.slug, name: found.name } : remembered?.slug === slug ? remembered : null;
    return {
      organisation,
      entered: organisation !== null,
      // God mode enters as an Admin, never the Owner; an older control plane does not say so per node.
      role: found ? (found.role === undefined ? "admin" : found.role) : organisation ? "admin" : null,
      isLoading: me.isLoading || (tree.isLoading && !organisation),
    };
  }

  // A person in more than one organisation works in the one they chose with the switcher (ID-09).
  const picked = membership ?? (chosen ? me.data?.memberships.find((m) => m.organisationSlug === chosen) : undefined);
  const organisation = picked
    ? { id: picked.organisationId, slug: picked.organisationSlug, name: picked.organisationName }
    : own
      ? { id: own.id, slug: own.slug, name: own.name }
      : null;
  const atTop = organisation ? me.data?.memberships.find((m) => m.organisationSlug === organisation.slug && m.level === "organisation") : undefined;
  return { organisation, entered: false, role: atTop?.role ?? null, isLoading: me.isLoading };
}

/**
 * The org chart of the active organisation: the entered one in God mode, the person's own otherwise.
 * Its `data` is only ever the answer for that organisation — never the previous one's while the next
 * loads — so a screen cannot show one organisation under another's name.
 */
export function useActiveTree(options: { pollingInterval?: number; skipPollingIfUnfocused?: boolean } = {}) {
  const me = useGetMeQuery(undefined);
  const { search } = useLocation();
  const remembered = useAppSelector((s) => s.ui.entered);
  const active = useActiveOrganisation();
  const named = search.get("organisation") || null;
  // Only an address that names an organisation, or one entered before, has to wait to learn who is asking.
  const maybeEntering = named !== null || remembered !== null;
  const chosen = !active.entered && active.organisation && active.organisation.slug !== me.data?.organisation?.slug ? active.organisation.slug : undefined;
  const asked = active.entered && active.organisation ? active.organisation.slug : me.data?.isOperator && named ? named : chosen;
  const query = useGetTreeQuery(asked, { ...options, skip: maybeEntering && active.isLoading });
  return { ...query, data: query.currentData };
}

/** Leaves the entered organisation — every screen goes back to the operator's own — then goes to `to` (null: stay). */
export function useLeaveOrganisation(): (to?: string | null) => void {
  const dispatch = useAppDispatch();
  return useCallback(
    (to: string | null = paths.operator()) => {
      dispatch(organisationLeft());
      storeEntered(null);
      if (to) navigate(to);
    },
    [dispatch],
  );
}

// ---------------------------------------------------------------------------------------------
// The organisation a person in several chose (ID-09), kept on this device only.
// ---------------------------------------------------------------------------------------------

const CHOSEN_KEY = "endgame.organisation";
const chosenListeners = new Set<() => void>();
/** The choice, kept for this visit when the browser stores nothing. */
let chosenInMemory: string | null = null;

function readChosen(): string | null {
  try {
    return window.localStorage.getItem(CHOSEN_KEY);
  } catch {
    return chosenInMemory;
  }
}

function subscribeChosen(listener: () => void) {
  chosenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    chosenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useChosenOrganisation(): string | null {
  return useSyncExternalStore(subscribeChosen, readChosen, () => null);
}

/** Choose the organisation a person in more than one works in; every screen follows. */
export function chooseOrganisation(slug: string | null) {
  chosenInMemory = slug;
  try {
    if (slug) window.localStorage.setItem(CHOSEN_KEY, slug);
    else window.localStorage.removeItem(CHOSEN_KEY);
  } catch {
    // A browser that keeps nothing still switches for this visit.
  }
  for (const l of chosenListeners) l();
}

/** Every organisation the person holds a role in, once each, in the order the session lists them. */
export function organisationsOf(me: Pick<Me, "memberships"> | undefined): OrganisationRef[] {
  const seen = new Map<string, OrganisationRef>();
  for (const m of me?.memberships ?? []) if (!seen.has(m.organisationSlug)) seen.set(m.organisationSlug, { id: m.organisationId, slug: m.organisationSlug, name: m.organisationName });
  return [...seen.values()];
}
