import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page's own building blocks (ARCH-011). The shell (`AppShell`) draws the frame — the header, the
 * page column, the side panel and the width cap — and a page fills it with these:
 *
 * - {@link PageHeader}: the one title style — words only, never an icon: a page is told apart by its title and
 *   the trail above it; icons belong to navigation, side cards and section headings — a line of lead text at
 *   a readable measure, and the page's actions.
 * - {@link ContentGrid}: independent sections set one under another, and two across from the `3xl` tier
 *   (1600) up, so a wide screen is used rather than left as one long column.
 * - {@link SideCard}: a card in the side panel. The side panel is a column of these; each ends with its
 *   content, and the column stays in view while the page scrolls when it fits the screen.
 * - {@link useShowAll}: a list longer than a screen shows its first few and "Show all".
 */

/** The one heading scale. `TITLE` is the page's h1; `SECTION` a section's h2. */
export const TITLE = "font-display text-3xl font-semibold leading-tight tracking-tight max-sm:text-2xl";
export const SECTION = "font-display text-lg font-semibold";

export function PageHeader({
  title,
  eyebrow,
  lead,
  actions,
  titleId,
  className,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 max-w-prose flex-col gap-2">
        {eyebrow && <span className="text-eyebrow font-semibold uppercase text-ink-muted">{eyebrow}</span>}
        <h1 id={titleId} className={cn(TITLE, "min-w-0 break-words")}>
          {title}
        </h1>
        {lead && <div className="text-ink-body">{lead}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Independent sections: one column, then two across at 1600 and wider. `masonry`: sections of very
 * different heights flow down two columns, each under the one before it, instead of sitting in rows
 * where a short section beside a long one leaves a hole — read in order, top to bottom, left then right.
 */
export function ContentGrid({ className, masonry = false, label, children }: { className?: string; masonry?: boolean; label?: string; children: ReactNode }) {
  if (masonry)
    return (
      <div aria-label={label} role={label ? "group" : undefined} className={cn("flex flex-col gap-6 3xl:block 3xl:columns-2 3xl:gap-6 3xl:[&>*]:mb-6 3xl:[&>*]:break-inside-avoid 3xl:[&>*:last-child]:mb-0", className)}>
        {children}
      </div>
    );
  return (
    <div aria-label={label} role={label ? "group" : undefined} className={cn("grid grid-cols-1 items-start gap-6 3xl:grid-cols-2", className)}>
      {children}
    </div>
  );
}

/** A card in the side panel: it ends where its content ends. */
export function SideCard({ title, label, className, children, testId }: { title?: ReactNode; label?: string; className?: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={label} data-testid={testId} className={cn("flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card max-sm:p-4", className)}>
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

/**
 * The first `limit` items of a long list, and a "Show all (n)" control that shows the rest. `shown` is
 * what to draw; `control` is the button, or null when everything already shows.
 */
export function useShowAll<T>(items: readonly T[], limit = 5, noun = "") {
  const [all, setAll] = useState(false);
  const extra = items.length - limit;
  const shown = all || extra <= 1 ? items : items.slice(0, limit);
  const control =
    extra > 1 ? (
      <button type="button" aria-expanded={all} onClick={() => setAll((was) => !was)} className="min-h-touch self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
        {all ? "Show fewer" : `Show all ${items.length}${noun ? ` ${noun}` : ""}`}
      </button>
    ) : null;
  return { shown, control };
}

/**
 * Whether an element fits the screen below `top`, kept current as either changes: the side panel sticks
 * only when it does, so nothing in it is ever out of reach.
 */
export function useFitsScreen<T extends HTMLElement>(top = 24) {
  const ref = useRef<T | null>(null);
  const [fits, setFits] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setFits(el.offsetHeight + top * 2 <= window.innerHeight);
  }, [top]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  return { ref, fits };
}
