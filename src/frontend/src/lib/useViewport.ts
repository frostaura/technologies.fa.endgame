import { useSyncExternalStore } from "react";
import { breakpoints, viewportQueries } from "./tokens";

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

/** Whether the console's viewport is at least `px` wide; where nothing can say, it is. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const q = window.matchMedia(query);
      q.addEventListener("change", listener);
      return () => q.removeEventListener("change", listener);
    },
    () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches),
    () => true,
  );
}

/**
 * Whether the desktop header has room for the mode switch and Sign out on its own row (from `hd`, 1,100 px).
 * Below it they sit in the account menu, so the header never wraps.
 */
export function useWideHeader(): boolean {
  return useMinWidth(breakpoints.hd);
}
