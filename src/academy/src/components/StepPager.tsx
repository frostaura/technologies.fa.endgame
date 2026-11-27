import type { ReactNode } from "react";
import { StepTrack } from "./ProgressMarks.tsx";
import { ui } from "./ui.ts";

const Chevron = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d={back ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * Previous, where you are, and Next — the one control a learner needs on every step, always in one
 * row. `inline`, it is pinned under the console on a wide screen; as a `bar` it sits on the bottom
 * edge of a phone, in reach of a thumb, with the step's words above it; as an `overlay` it rides
 * slim over the console's foot on a short window. On the last step Next becomes `end` (Finish, then
 * the next flow), so going on is always one tap.
 */
export function StepPager({ active, total, furthest, onPrev, onNext, end, text, resumed, variant, extra }: {
  active: number;
  total: number;
  furthest: number;
  onPrev: () => void;
  onNext: () => void;
  /** What stands in for Next on the last step. */
  end: ReactNode;
  /** The step's words, shown in the bar on a phone and in the overlay on a short window. */
  text?: ReactNode;
  /** Set when the flow opened where the learner left it: offers the beginning. */
  resumed?: { step: number; onRestart: () => void };
  variant: "bar" | "inline" | "overlay";
  /** The stage's own actions (Try it yourself, Show me again), set in the same row just before Next. */
  extra?: ReactNode;
}) {
  const bar = variant === "bar";
  const overlay = variant === "overlay";
  const where = (
    <div className="min-w-0 flex-1">
      {overlay && text ? (
        <p className="truncate text-sm text-ink"><span className="mr-2 font-semibold tabular-nums">{active}/{total}</span>{text}</p>
      ) : (
        <p className="text-center text-sm font-semibold tabular-nums text-ink" aria-live="polite">Step {active} of {total}</p>
      )}
      {overlay && <span className="sr-only" aria-live="polite">Step {active} of {total}</span>}
      <StepTrack total={total} furthest={furthest} active={active} className={`mt-1.5 ${overlay ? "" : "mx-auto max-w-md"}`} />
    </div>
  );
  return (
    <div
      role="group"
      aria-label="Step controls"
      className={bar ? "border-t bg-surface px-4 pb-safe-b pt-2 shadow-raised sm:px-6" : ""}
      data-print="hide"
    >
      {resumed && (
        <p className="mb-2 flex flex-wrap items-center justify-between gap-x-3 text-sm text-ink-muted">
          <span>Picked up where you left off, at step {resumed.step}.</span>
          <button type="button" onClick={resumed.onRestart} className={`inline-flex min-h-touch items-center ${ui.textLink}`}>
            Start from the beginning
          </button>
        </p>
      )}
      {bar && text && <p className="mb-2 line-clamp-2 text-sm text-ink" data-testid="bar-text">{text}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onPrev} disabled={active <= 1} className={overlay ? ui.icon : `${ui.quiet} px-4`} aria-label="Previous step">
          <Chevron back />
          {!overlay && <span className="sr-only sm:not-sr-only">Previous</span>}
        </button>
        {where}
        {extra && <span className="flex shrink-0 items-center gap-2">{extra}</span>}
        {active < total ? (
          <button type="button" onClick={onNext} className={overlay ? `${ui.primary} min-w-touch px-0` : `${ui.primary} px-4`} aria-label="Next step">
            {!overlay && <span className="sr-only sm:not-sr-only">Next</span>}
            <Chevron />
          </button>
        ) : (
          end
        )}
      </div>
    </div>
  );
}
