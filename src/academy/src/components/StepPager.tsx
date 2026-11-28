import type { ReactNode } from "react";
import { StepTrack } from "./ProgressMarks.tsx";
import { ui } from "./ui.ts";

const Chevron = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d={back ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const HAND = "M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 15";
const AGAIN = "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4";

/** The stage's two actions, each in its own fixed place: disabled on a step where it does not apply, never removed. */
export interface StageActions {
  onTry: () => void;
  canTry: boolean;
  trying: boolean;
  onReplay: () => void;
  canReplay: boolean;
}

/**
 * The one row of controls a learner needs on every step, its places fixed so nothing in it moves
 * from step to step: Previous · where you are · Try it yourself · Show me again · Next. An action
 * that does not apply to a step is disabled in its place, never taken out. `inline`, it sits under
 * the caption on a desk or tablet; `bar`, it is fixed to the bottom edge of a phone; `side`, it is
 * stacked in the strip beside the frame of a phone on its side. On the last step Next becomes `end`
 * (Finish, then the next flow), in the same place and width.
 */
export function StepPager({ active, total, furthest, onPrev, onNext, end, resumed, variant, actions }: {
  active: number;
  total: number;
  furthest: number;
  onPrev: () => void;
  onNext: () => void;
  /** What stands in for Next on the last step. */
  end: ReactNode;
  /** Set when the flow opened where the learner left it: offers the beginning. */
  resumed?: { step: number; onRestart: () => void };
  variant: "bar" | "inline" | "side";
  actions?: StageActions;
}) {
  const compact = variant !== "inline";
  const steps = total === 1 ? "1 step" : `${total} steps`;
  const where = (
    <div className="min-w-0 flex-1">
      <p className="whitespace-nowrap text-center text-sm font-semibold tabular-nums text-ink" aria-live="polite">
        {total > 1 ? `Step ${active} of ${total}` : steps}
      </p>
      <StepTrack total={total} furthest={furthest} active={active} className="mx-auto mt-1.5 max-w-md" />
    </div>
  );
  const tryIt = actions && (
    <button type="button" onClick={actions.onTry} disabled={!actions.canTry || actions.trying} aria-pressed={actions.trying} className={compact ? ui.icon : `${ui.small} w-try`} aria-label={compact ? "Try it yourself" : undefined}>
      <Icon d={HAND} />
      {!compact && "Try it yourself"}
    </button>
  );
  const again = actions && (
    <button type="button" onClick={actions.onReplay} disabled={!actions.canReplay} className={compact ? ui.icon : `${ui.small} w-again`} aria-label={compact ? "Show me again" : undefined}>
      <Icon d={AGAIN} />
      {!compact && "Show me again"}
    </button>
  );
  const prev = (
    <button type="button" onClick={onPrev} disabled={active <= 1} className={compact ? `${ui.quiet} min-w-touch px-0` : `${ui.quiet} w-prev px-4`} aria-label="Previous step">
      <Chevron back />
      {!compact && <span>Previous</span>}
    </button>
  );
  const next = (
    <span className={`flex shrink-0 ${compact ? "w-next-sm" : "w-next"}`}>
      {active < total ? (
        <button type="button" onClick={onNext} className={`${ui.primary} w-full px-4`} aria-label="Next step">
          <span className={compact ? "sr-only" : ""}>Next</span>
          <Chevron />
        </button>
      ) : (
        end
      )}
    </span>
  );
  return (
    <div role="group" aria-label="Step controls" className={variant === "bar" ? "border-t bg-surface px-3 pb-safe-b pt-2 shadow-raised" : ""} data-print="hide" data-testid="step-controls">
      {resumed && (
        <p className="mb-2 flex flex-wrap items-center justify-between gap-x-3 text-sm text-ink-muted">
          <span>Picked up where you left off, at step {resumed.step}.</span>
          <button type="button" onClick={resumed.onRestart} className={`inline-flex min-h-touch items-center ${ui.textLink}`}>
            Start from the beginning
          </button>
        </p>
      )}
      {variant === "side" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">{prev}{where}{next}</div>
          {actions && <div className="flex items-center justify-center gap-2">{tryIt}{again}</div>}
        </div>
      ) : (
        <div className={`flex items-center ${compact ? "gap-1.5" : "gap-3"}`}>
          {prev}
          {where}
          {tryIt}
          {again}
          {next}
        </div>
      )}
    </div>
  );
}
