import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetMeQuery, useGetTreeQuery } from "@/store/api";
import type { MemberRole } from "@/store/types";
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

  const organisation = membership
    ? { id: membership.organisationId, slug: membership.organisationSlug, name: membership.organisationName }
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
  const asked = active.entered && active.organisation ? active.organisation.slug : me.data?.isOperator && named ? named : undefined;
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
