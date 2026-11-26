import { useSyncExternalStore } from "react";
import { SPLIT_QUERY } from "../theme/tokens.ts";

/** Whether a media query matches now, and again whenever it changes (a rotation, a resize). */
export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia?.(query);
      m?.addEventListener("change", l);
      return () => m?.removeEventListener("change", l);
    },
    () => window.matchMedia?.(query).matches ?? fallback,
    () => fallback,
  );
}

/** The steps beside the stage (wide, or a phone on its side) rather than under it — the `split:` variant. */
export function useSplit(): boolean {
  return useMedia(SPLIT_QUERY, true);
}

export function isSplit(): boolean {
  return window.matchMedia?.(SPLIT_QUERY).matches ?? true;
}
