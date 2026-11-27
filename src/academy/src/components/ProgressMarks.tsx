import { percent } from "../lib/format.ts";

/**
 * How progress is drawn: a ring for a count, a medal for a badge. Both say what they show in words
 * beside them or to a screen reader — never by colour alone — and both have a fixed size, so they
 * take their place before progress is read and nothing moves when it is.
 */

const R = 15.9155; // a circle whose circumference is 100, so a percentage is a dash length

export function ProgressRing({ done, total, size = "md", label, tone = "light" }: { done: number; total: number; size?: "md" | "lg"; label?: string; tone?: "light" | "dark" }) {
  // Any progress draws an arc long enough to see, not a lone dot at twelve o'clock.
  const pct = total && done ? Math.max(4, Math.min(100, (100 * done) / total)) : 0;
  const box = size === "lg" ? "h-ring-lg w-ring-lg" : "h-ring w-ring";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${box}`} role="img" aria-label={label ?? `${done} of ${total} done`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth={size === "lg" ? 2.6 : 3.4} className={tone === "dark" ? "stroke-surface/15" : "stroke-quiet"} />
        {pct > 0 && (
          <circle cx="18" cy="18" r={R} fill="none" strokeWidth={size === "lg" ? 2.6 : 3.4} strokeLinecap="round" strokeDasharray={`${pct} 100`} className={tone === "dark" ? "stroke-live" : "stroke-success"} />
        )}
      </svg>
      <span aria-hidden="true" className={`relative font-sans font-semibold tabular-nums ${size === "lg" ? "text-lg" : "text-xs"} ${tone === "dark" ? "text-primary-ink" : "text-ink"}`}>
        {percent(done, total)}
      </span>
    </span>
  );
}

/**
 * A badge: earned, a filled medal with a tick; not yet, the same medal in quiet grey with its mark —
 * the path's number, or a lock where there is no number — so a locked badge reads as a badge to come.
 */
export function Medal({ earned, mark, label }: { earned: boolean; mark?: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex h-medal w-medal shrink-0 items-center justify-center rounded-full font-display text-base font-bold tabular-nums ${
        earned ? "bg-success-tint text-success-text ring-2 ring-success ring-offset-2 ring-offset-surface" : "bg-quiet text-quiet-text ring-1 ring-border-strong"
      }`}
    >
      {earned ? (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : mark ? (
        <span aria-hidden="true">{mark}</span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
      )}
    </span>
  );
}

/** One bar segment per step: the steps seen are filled, the step being read is marked. */
export function StepTrack({ total, furthest, active, className = "" }: { total: number; furthest: number; active: number; className?: string }) {
  return (
    <span className={`flex gap-0.5 ${className}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1 flex-1 rounded-full ${i + 1 === active ? "bg-primary" : i < furthest ? "bg-primary-line" : "bg-quiet"}`} />
      ))}
    </span>
  );
}
