import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { describeError } from "@/lib/queryState";
import { API_BASE, api, apiFetch } from "./api";
import type { AppDispatch } from "./index";
import { check, type Guard } from "@/lib/guards";
import { accessTokenCreatedGuard, invitationGuard, provisionedGuard } from "./guards";
import type { AccessTokenCreated, AppShareCreated, ManualScreening, MemberInvitation, MemberRole, OrganisationProvisioned, ScopeLevel, SecretName, TokenRole } from "./types";

/**
 * Writes that carry something no one may read back: a secret's value going in, an invitation's
 * one-time code coming out. They are sent with `fetch` directly rather than through RTK Query,
 * because a mutation keeps its arguments and its result in the store — and a secret's value or a
 * one-time code must never be held there. Only names and addresses reach the cache.
 */

export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string; status: number | null };

async function send<T>(method: string, path: string, body: unknown, guard?: Guard<T>): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}/${path}`, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: describeError({ status: "FETCH_ERROR", error: "" }), status: null };
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) return { ok: false, reason: describeError({ status: "PARSING_ERROR", originalStatus: response.status, data: text, error: "" }), status: response.status };
    }
  }
  if (!response.ok) return { ok: false, reason: describeError({ status: response.status, data } as FetchBaseQueryError), status: response.status };
  if (guard) {
    const checked = check(guard, data);
    if (!checked.ok) return { ok: false, reason: `Endgame answered in a shape this screen does not understand: ${checked.problem}.`, status: response.status };
    return { ok: true, data: checked.value };
  }
  return { ok: true, data: data as T };
}

/**
 * Passkey registration for someone who was invited: the one-time code proves the invitation, so it
 * goes straight to the server and never into the store.
 */
export function registerOptionsWithInvitation(body: { displayName: string; email: string; invitationCode: string }): Promise<Outcome<{ publicKey: Record<string, unknown> }>> {
  return send("POST", "auth/passkey/register/options", body);
}

/** The level a scope sits at, from its path of slugs. */
export function levelOf(scope: string): ScopeLevel {
  const depth = scope.split("/").filter(Boolean).length;
  return (["organisation", "division", "project", "app"] as const)[Math.min(3, Math.max(0, depth - 1))] ?? "organisation";
}

/** Secret names: UPPER_SNAKE_CASE, 2 to 128 characters, starting with a letter — the control plane's own rule. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

export function secretNameProblem(name: string): string | null {
  if (name.length === 0) return "Give it a name.";
  if (!SECRET_NAME.test(name)) return "Use capital letters, digits and underscores, starting with a letter, for example STRIPE_API_KEY.";
  return null;
}

/**
 * Sets or replaces a secret at a scope. The name appears in the list at once; if the control
 * plane refuses, it is taken out again and the reason returned. The value is read once, sent, and
 * dropped: it is never put in the store or returned.
 */
export function setSecret(scope: string, name: string, value: string) {
  return async (dispatch: AppDispatch): Promise<Outcome<SecretName>> => {
    const optimistic: SecretName = { name, setAtLevel: levelOf(scope), setAtPath: scope, setAt: new Date().toISOString(), inherited: false, overrides: [] };
    const patch = dispatch(
      api.util.updateQueryData("getSecrets", scope, (list) => {
        const was = list.effective.find((s) => s.name === name);
        const entry = { ...optimistic, overrides: was ? (was.inherited ? [was.setAtPath, ...was.overrides] : was.overrides) : [] };
        list.effective = [...list.effective.filter((s) => s.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
      }),
    );
    const outcome = await send<SecretName>("PUT", "secrets", { scope, name, value });
    if (!outcome.ok) {
      patch.undo();
      return outcome;
    }
    dispatch(api.util.invalidateTags(["Secrets"]));
    return outcome;
  };
}

/**
 * Shares an app with an address. The address joins the list at once; the one-time code comes back
 * to the caller only, to be shown once.
 */
export function shareApp(appId: string, email: string) {
  return async (dispatch: AppDispatch): Promise<Outcome<AppShareCreated>> => {
    const address = email.trim().toLowerCase();
    const patch = dispatch(
      api.util.updateQueryData("getShares", appId, (shares) =>
        shares.some((s) => s.email === address) ? shares : [...shares, { email: address, invitedAt: new Date().toISOString(), registered: false }].sort((a, b) => a.email.localeCompare(b.email)),
      ),
    );
    const outcome = await send<AppShareCreated>("POST", `apps/${encodeURIComponent(appId)}/shares`, { email: address });
    if (!outcome.ok) {
      patch.undo();
      return outcome;
    }
    dispatch(api.util.invalidateTags([{ type: "Shares", id: appId }, { type: "App", id: appId }, "Tree"]));
    return outcome;
  };
}

/**
 * Invites a person to a role at a scope. The control plane answers with a one-time code (and says
 * whether it was e-mailed); the code comes back to the caller only, to be shown once.
 */
export function inviteMember(scope: string, email: string, displayName: string, role: MemberRole) {
  return async (dispatch: AppDispatch): Promise<Outcome<MemberInvitation>> => {
    const outcome = await send<MemberInvitation>("POST", "members", { scope, email: email.trim().toLowerCase(), displayName: displayName.trim(), role }, invitationGuard);
    if (outcome.ok) {
      // Only the person's name and role reach the cache; the code never does.
      const { member } = outcome.data;
      dispatch(api.util.updateQueryData("getMembers", scope, (list) => (list.some((m) => m.membershipId === member.membershipId) ? list : [...list, member])));
      dispatch(api.util.invalidateTags(["Members"]));
    }
    return outcome;
  };
}

/**
 * Sends a pending person a new invitation code (PPL-05). The one they had stops working; the new
 * one comes back to the caller only, to be shown once.
 */
export function reissueInvitation(scope: string, membershipId: string) {
  return async (dispatch: AppDispatch): Promise<Outcome<MemberInvitation>> => {
    const outcome = await send<MemberInvitation>("POST", `members/${encodeURIComponent(membershipId)}/invitation`, {}, invitationGuard);
    if (outcome.ok) {
      const { member } = outcome.data;
      dispatch(api.util.updateQueryData("getMembers", scope, (list) => list.map((m) => (m.membershipId === member.membershipId ? { ...m, invitationExpiresAt: member.invitationExpiresAt } : m))));
    }
    return outcome;
  };
}

/** Makes an access token for an AI assistant. The token itself is returned this once, to the caller only. */
export function createToken(name: string, organisation: string, role: TokenRole, expiresInDays: number | null) {
  return async (dispatch: AppDispatch): Promise<Outcome<AccessTokenCreated>> => {
    const outcome = await send<AccessTokenCreated>("POST", "tokens", { name: name.trim(), organisation, role, ...(expiresInDays ? { expiresInDays } : {}) }, accessTokenCreatedGuard);
    if (outcome.ok) {
      const { accessToken } = outcome.data;
      dispatch(api.util.updateQueryData("getTokens", undefined, (list) => [accessToken, ...list.filter((t) => t.id !== accessToken.id)]));
      dispatch(api.util.invalidateTags(["Tokens"]));
    }
    return outcome;
  };
}

/**
 * God mode: provisions an organisation for an invited Owner. What it does is screened against the red
 * lines first; `screening` is the operator's own decision, used only when no model can be reached.
 * The Owner's one-time code comes back once.
 */
export function provisionOrganisation(name: string, slug: string, ownerEmail: string, ownerDisplayName: string, description: string, screening: ManualScreening | null = null) {
  return async (dispatch: AppDispatch): Promise<Outcome<OrganisationProvisioned>> => {
    const outcome = await send<OrganisationProvisioned>(
      "POST",
      "organisations",
      {
        name: name.trim(),
        slug,
        ownerEmail: ownerEmail.trim().toLowerCase(),
        description: description.trim(),
        ...(ownerDisplayName.trim() ? { ownerDisplayName: ownerDisplayName.trim() } : {}),
        ...(screening ? { screening: { decision: screening.decision, reason: screening.reason.trim() } } : {}),
      },
      provisionedGuard,
    );
    if (outcome.ok) dispatch(api.util.invalidateTags(["Operator"]));
    return outcome;
  };
}

/**
 * The Owner's export: code, its whole history and the app's data, as one archive. It is streamed
 * to the browser and saved as a file; nothing of it is kept in the console.
 */
export async function downloadExport(appId: string, fallbackName: string): Promise<Outcome<{ fileName: string; bytes: number }>> {
  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}/apps/${encodeURIComponent(appId)}/export`, { credentials: "same-origin", headers: { accept: "application/gzip" } });
  } catch {
    return { ok: false, reason: describeError({ status: "FETCH_ERROR", error: "" }), status: null };
  }
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // A problem without a readable body still says its status.
    }
    return { ok: false, reason: describeError({ status: response.status, data } as FetchBaseQueryError), status: response.status };
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = decodeURIComponent(fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, data: { fileName: a.download, bytes: blob.size } };
}
