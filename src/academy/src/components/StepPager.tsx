import type { ReactNode } from "react";
import { StepTrack } from "./ProgressMarks.tsx";
import { ui } from "./ui.ts";

/**
 * Previous, where you are, and Next — the one control a learner needs on every step. As a `bar` it
 * sits on the bottom edge of a phone, in reach of a thumb and above the home indicator; `inline`, it
 * sits under the stage beside the steps. On the last step Next becomes `end` (Finish, then the next
 * flow), so going on is always one tap.
 */
export function StepPager({ active, total, furthest, onPrev, onNext, end, text, resumed, variant }: {
  active: number;
  total: number;
  furthest: number;
  onPrev: () => void;
  onNext: () => void;
  /** What stands in for Next on the last step. */
  end: ReactNode;
  /** The step's words, shown in the bar while the console is enlarged over the steps. */
  text?: ReactNode;
  /** Set when the flow opened where the learner left it: offers the beginning. */
  resumed?: { step: number; onRestart: () => void };
  variant: "bar" | "inline";
}) {
  const bar = variant === "bar";
  return (
    <div
      role="group"
      aria-label="Step controls"
      className={bar ? "border-t bg-surface/95 px-4 pb-safe-b pt-2 shadow-raised backdrop-blur sm:px-6" : "pt-1"}
      data-print="hide"
    >
      {resumed && (
        <p className="mb-2 flex flex-wrap items-center justify-between gap-x-3 text-sm text-ink-muted">
          <span>Picked up where you left off, at step {resumed.step}.</span>
          <button type="button" onClick={resumed.onRestart} className="inline-flex min-h-touch items-center font-semibold text-primary-link underline decoration-primary-line underline-offset-4">
            Start from the beginning
          </button>
        </p>
      )}
      {text && <p className="mb-2 line-clamp-2 text-sm text-ink">{text}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onPrev} disabled={active <= 1} className={`${ui.quiet} px-4`} aria-label="Previous step">
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className={bar ? "sr-only sm:not-sr-only" : "sr-only xl:not-sr-only short:sr-only"}>Previous</span>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold text-ink" aria-live="polite">Step {active} of {total}</p>
          <StepTrack total={total} furthest={furthest} active={active} className="mx-auto mt-1.5 max-w-xs" />
        </div>
        {active < total ? (
          <button type="button" onClick={onNext} className={`${ui.primary} px-4`} aria-label="Next step">
            <span className={bar ? "sr-only sm:not-sr-only" : "sr-only xl:not-sr-only short:sr-only"}>Next</span>
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        ) : (
          end
        )}
      </div>
    </div>
  );
}
