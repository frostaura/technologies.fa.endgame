import { useSyncExternalStore } from "react";
import { viewportQueries } from "./tokens";

/**
 * Which layout the console draws: `phone`, `tablet` or `desktop`, read from the width (and, on its
 * side, the height) of the console's own viewport — inside a frame, the frame's. CSS reads the same
 * numbers from `tokens.ts`; this is for what changes structure, not only look: the bottom bar, the
 * conversation's sheet, collapsible sections.
 *
 * Where there is no `matchMedia` (a test's document) the console is a desktop, as it always was.
 */
export type Viewport = "phone" | "tablet" | "desktop";

const queries = (): { phone: MediaQueryList; desktop: MediaQueryList } | null => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return { phone: window.matchMedia(viewportQueries.phone), desktop: window.matchMedia(viewportQueries.desktop) };
};

function subscribe(listener: () => void) {
  const q = queries();
  if (!q) return () => undefined;
  q.phone.addEventListener("change", listener);
  q.desktop.addEventListener("change", listener);
  return () => {
    q.phone.removeEventListener("change", listener);
    q.desktop.removeEventListener("change", listener);
  };
}

export function currentViewport(): Viewport {
  const q = queries();
  if (!q) return "desktop";
  if (q.phone.matches) return "phone";
  return q.desktop.matches ? "desktop" : "tablet";
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, currentViewport, () => "desktop");
}

/** Phone or tablet: the conversation lives in a sheet rather than beside the page. */
export function useCompact(): boolean {
  return useViewport() !== "desktop";
}
