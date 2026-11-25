import { useCallback, useEffect, useState } from "react";
import { api, onApiWrite } from "./api.js";
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
 *
 * It also re-reads after **every successful write through `api()`** anywhere in the app (POST,
 * PUT, PATCH, DELETE), so a change made on one part of the screen shows in every other read on it
 * — a book marked finished leaves "Reading now" without that list's code doing anything. While it
 * re-reads after a write it keeps its current data (`loaded`, no flash to loading); if the re-read
 * fails, it is `failed`. `reload()` starts over from `loading`, as a "Try again" should.
 */
export function useApiQuery<T>(path: string | null): ApiQuery<T> {
  const [attempt, setAttempt] = useState(0);
  // Bumped by a write anywhere in the app: re-read, but keep showing what was read last.
  const [refresh, setRefresh] = useState(0);
  // Each settled read remembers which request it answers; anything else is still loading.
  const [settled, setSettled] = useState<{ key: string; state: ApiState<T> } | null>(null);
  const key = path === null ? null : `${attempt} ${path}`;

  useEffect(() => (path === null ? undefined : onApiWrite(() => setRefresh((n) => n + 1))), [path]);

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
  }, [path, key, refresh]);

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
