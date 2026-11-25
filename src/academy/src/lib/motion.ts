import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** True when the learner asked for less motion: every animation then shows its final state. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia?.(query);
      m?.addEventListener("change", l);
      return () => m?.removeEventListener("change", l);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
