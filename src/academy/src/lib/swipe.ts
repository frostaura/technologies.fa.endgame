import { useEffect, useRef, type RefObject } from "react";

/**
 * A horizontal swipe on a touch screen: left for the next step, right for the one before. Only a
 * clearly sideways, quick stroke counts, so scrolling the page never changes the step, and a stroke
 * that starts in something that scrolls sideways of its own (a wide table, code) or in a field is
 * left to it. Touches inside the live console's frame never reach this page, so the console keeps
 * its own gestures once it is handed over.
 */

export interface SwipeOptions {
  onLeft: () => void;
  onRight: () => void;
  enabled?: boolean;
}

const MIN_DISTANCE = 56;
const MAX_TIME = 800;
const SIDEWAYS = 1.6;

function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let e = el; e && e !== stop; e = e.parentElement) {
    if (e.matches("input, textarea, select, [data-no-swipe]")) return true;
    if (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX)) return true;
  }
  return false;
}

export function useSwipe(ref: RefObject<HTMLElement | null>, { onLeft, onRight, enabled = true }: SwipeOptions) {
  const handlers = useRef({ onLeft, onRight });
  useEffect(() => {
    handlers.current = { onLeft, onRight };
  }, [onLeft, onRight]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t && !scrollsSideways(e.target as Element, el) ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const s = start;
      start = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.t > MAX_TIME || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < SIDEWAYS * Math.abs(dy)) return;
      if (dx < 0) handlers.current.onLeft();
      else handlers.current.onRight();
    };
    const cancel = () => (start = null);
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [ref, enabled]);
}
