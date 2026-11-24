import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { ApiError, NetworkError } from "./errors.js";

/**
 * A read in one of three states — never two. `loaded` with an empty list is an empty result;
 * `failed` is a failed read. Render all three, and never show a failure as "nothing here".
 */
export type ApiState<T> =
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "failed"; error: ApiError };

/** An {@link ApiState} plus `reload()`, which runs the read again (e.g. a "Try again" button). */
export type ApiQuery<T> = ApiState<T> & { reload: () => void };

/**
 * Reads `path` from the app's API (see `api()`), re-reading when `path` changes. Pass `null` to
 * wait — e.g. until an id is known.
 */
export function useApiQuery<T>(path: string | null): ApiQuery<T> {
  const [attempt, setAttempt] = useState(0);
  // Each settled read remembers which request it answers; anything else is still loading.
  const [settled, setSettled] = useState<{ key: string; state: ApiState<T> } | null>(null);
  const key = path === null ? null : `${attempt} ${path}`;

  useEffect(() => {
    if (path === null || key === null) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then(
      (data) => setSettled({ key, state: { status: "loaded", data } }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ key, state: { status: "failed", error: error instanceof ApiError ? error : new NetworkError(error) } });
      },
    );
    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const state: ApiState<T> = settled !== null && settled.key === key ? settled.state : { status: "loading" };
  return { ...state, reload };
}

/** Who is signed in, as the platform validated them. Matches the server's `EndgameUser`. */
export interface EndgameUser {
  id: string;
  email: string;
  displayName: string;
  kind: "member" | "endUser";
  role: "owner" | "admin" | "builder" | "viewer" | null;
}

/**
 * The signed-in person: `loaded` with `data: null` when nobody is signed in, `failed` when the
 * app could not say. Send signed-out people to `signInUrl()`.
 */
export function useCurrentUser(): ApiQuery<EndgameUser | null> {
  const me = useApiQuery<{ user: EndgameUser | null }>("me");
  if (me.status !== "loaded") return me;
  return { status: "loaded", data: me.data.user, reload: me.reload };
}
