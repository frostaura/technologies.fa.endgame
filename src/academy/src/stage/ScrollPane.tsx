import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * What a step shows that is taller than the frame (a long response, a terminal's output): it fills
 * the frame from the top and scrolls inside it, and says so — a soft fade and "More below" at its
 * foot while there is more to read, gone once the end is in view.
 */
export function ScrollPane({ children, className = "", label, testId }: { children: ReactNode; className?: string; label?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className="absolute inset-0">
      <div ref={ref} onScroll={measure} className={`h-full overflow-auto overscroll-contain ${className}`} aria-label={label} data-testid={testId} tabIndex={0}>
        {children}
      </div>
      {more && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-surface via-surface/80 to-surface/0 pb-2" aria-hidden="true" data-testid="more-below">
          <span className="rounded-full border bg-surface px-3 py-0.5 text-xs font-medium text-ink-muted shadow-card">More below</span>
        </div>
      )}
    </div>
  );
}
