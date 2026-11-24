import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { describeError } from "@/lib/queryState";
import { API_BASE, api } from "./api";
import type { AppDispatch } from "./index";
import type { AppShareCreated, ScopeLevel, SecretName } from "./types";

/**
 * Writes that carry something no one may read back: a secret's value going in, an invitation's
 * one-time code coming out. They are sent with `fetch` directly rather than through RTK Query,
 * because a mutation keeps its arguments and its result in the store — and a secret's value or a
 * one-time code must never be held there. Only names and addresses reach the cache.
 */

export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string; status: number | null };

async function send<T>(method: string, path: string, body: unknown): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
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
  return { ok: true, data: data as T };
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
