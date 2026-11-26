import type { Level, Reach } from "../content/types.ts";
import { REACH_LABEL } from "../lib/labels.ts";
import type { State } from "../lib/progress.ts";

export function LevelBadge({ level }: { level: Level | null }) {
  if (!level) return null;
  const tone = level === "Operator" ? "bg-night text-primary-ink" : "bg-primary-tint text-primary-link";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{level === "Operator" ? "Operator" : level}</span>;
}

export function ReachChip({ reach }: { reach: Reach }) {
  const tone = reach === "screen" ? "bg-success-tint text-success-text" : reach === "cli" ? "bg-quiet text-quiet-text" : reach === "api" ? "bg-violet-tint text-violet-text" : "bg-teal-tint text-teal-text";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{REACH_LABEL[reach]}</span>;
}

/** Not started, seen or done, as a ring, a half ring and a filled tick. */
export function ProgressDot({ state, className = "", size = "md" }: { state: State | undefined; className?: string; size?: "md" | "sm" }) {
  const label = state === "done" ? "Done" : state === "seen" ? "Started" : "Not started";
  return (
    <span className={`inline-flex ${size === "sm" ? "h-4 w-4" : "h-5 w-5"} shrink-0 items-center justify-center rounded-full ${state === "done" ? "bg-success text-primary-ink" : state === "seen" ? "border-2 border-primary bg-primary-tint" : "border-2 border-border-strong"} ${className}`} title={label}>
      <span className="sr-only">{label}</span>
      {state === "done" && (
        <svg aria-hidden="true" viewBox="0 0 16 16" className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </span>
  );
}
