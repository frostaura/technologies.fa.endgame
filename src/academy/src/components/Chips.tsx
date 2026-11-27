import type { Level, Reach } from "../content/types.ts";
import { REACH_LABEL } from "../lib/labels.ts";
import type { State } from "../lib/progress.ts";
import { ui } from "./ui.ts";

export function LevelBadge({ level }: { level: Level | null }) {
  if (!level) return null;
  // One accent: the operator handbook's flows are told apart by their name, not by a dark slab.
  const tone = level === "Operator" ? "border border-border-strong bg-surface text-ink-body" : "bg-primary-tint text-primary-link";
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{level === "Operator" ? "Operator" : level}</span>;
}

/** Each route's small sign: a screen, a terminal prompt, a plug, a gear. */
const REACH_ICON: Record<Reach, string> = {
  screen: "M3 5h18v11H3zM8 20h8M12 16v4",
  cli: "m5 8 4 4-4 4M12 17h7",
  api: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5",
  automatic: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  none: "M5 12h14",
};

/** A route's sign on its own, at the size its context sets. */
export function ReachIcon({ reach, className = "h-5 w-5" }: { reach: Reach; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d={REACH_ICON[reach]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** How a flow is reached: one neutral chip with an icon per route. Colour is kept for state, never for kind. */
export function ReachChip({ reach }: { reach: Reach }) {
  return (
    <span className={ui.chip}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true"><path d={REACH_ICON[reach]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {REACH_LABEL[reach]}
    </span>
  );
}

/** Not started, seen or done, as a ring, a half ring and a filled tick. */
export function ProgressDot({ state, className = "", size = "md" }: { state: State | undefined; className?: string; size?: "md" | "sm" }) {
  const label = state === "done" ? "Done" : state === "seen" ? "Started" : "Not started";
  return (
    <span className={`inline-flex ${size === "sm" ? "h-4 w-4" : "h-5 w-5"} shrink-0 items-center justify-center rounded-full ${state === "done" ? "bg-success text-primary-ink" : state === "seen" ? "border-2 border-primary bg-primary-tint" : "border-2 border-border-strong"} ${className}`}>
      <span className="sr-only">{label}</span>
      {state === "done" && (
        <svg aria-hidden="true" viewBox="0 0 16 16" className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </span>
  );
}

/** Started or done, in words, for a list where a bare ring would need a legend (search results). Nothing for a flow not begun. */
export function ProgressWord({ state }: { state: State | undefined }) {
  if (!state) return null;
  return <span className={`shrink-0 whitespace-nowrap text-xs font-medium ${state === "done" ? "text-success-text" : "text-primary-link"}`}>{state === "done" ? "Done" : "Started"}</span>;
}
