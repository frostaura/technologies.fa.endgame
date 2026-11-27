import type { Flow } from "../content/types.ts";
import { href } from "../lib/router.ts";
import { stateOf, useProgress } from "../lib/progress.ts";
import { plain, sentence } from "../content/text.ts";
import { ProgressDot, ReachChip } from "./Chips.tsx";

/**
 * A list of flows as rows: progress, id, title, what it teaches, how it is reached. A flow begun
 * and not finished says how far in it is; `next` marks the one to learn next.
 *
 * The id has a column of its own from a tablet up, so every title starts at the same edge; on a phone
 * it always sits on its own line above the title, so neighbouring rows never switch layout. How a
 * flow is reached is said beside its title only when it is not on a screen — the usual way — so the
 * chip means something where it appears, and it appears on a phone too.
 */
export function FlowList({ flows, numbered = false, next, first, hideReach = false }: { flows: Flow[]; numbered?: boolean; next?: string; first?: Flow; hideReach?: boolean }) {
  const progress = useProgress();
  return (
    <ol className="divide-y overflow-hidden rounded-lg border bg-surface shadow-card">
      {first && (
        // A flow from another path that this one needs first: named as such, ahead of the path's own.
        <li>
          <a href={href(`/flow/${first.id}`)} className="group flex items-start gap-3 bg-primary-tint/60 px-4 py-4 transition-colors hover:bg-primary-tint sm:gap-4 sm:px-6">
            {numbered && <span className="w-6 shrink-0" aria-hidden="true" />}
            <ProgressDot state={stateOf(progress, first.id)} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-4">
              <span className="whitespace-nowrap font-mono text-xs font-semibold leading-6 text-primary-link sm:w-20 sm:shrink-0">{first.id}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-eyebrow font-semibold uppercase text-primary-link">Learn first</span>
                  <span className="min-w-0 break-words text-base font-medium leading-6 text-ink group-hover:text-primary-link">{first.title}</span>
                </span>
                <span className="mt-1 block text-sm text-ink-muted">From the {first.level} path; the flows below build on it.</span>
              </span>
            </span>
          </a>
        </li>
      )}
      {flows.map((f, i) => {
        const p = progress.flows[f.id];
        const isNext = next === f.id;
        return (
          <li key={f.id}>
            <a href={href(`/flow/${f.id}`)} className={`group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-ground sm:gap-4 sm:px-6 ${isNext ? "bg-primary-tint/60" : ""}`}>
              {/* Number, mark and title share the title's first line. */}
              {numbered && <span className="w-6 shrink-0 text-right text-sm font-medium leading-6 tabular-nums text-ink-muted">{i + 1}</span>}
              <ProgressDot state={stateOf(progress, f.id)} className="mt-0.5" />
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-4">
                <span className="whitespace-nowrap font-mono text-xs font-semibold leading-6 text-primary-link sm:w-20 sm:shrink-0">{f.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-base font-medium leading-6 text-ink group-hover:text-primary-link">{f.title}</span>
                    {isNext && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-ink">Next up</span>}
                    {!hideReach && f.reach !== "screen" && <ReachChip reach={f.reach} />}
                  </span>
                  {f.whatYouLearn ? <span className="mt-1 block text-sm text-ink-muted">{sentence(plain(f.whatYouLearn))}</span> : f.stepsNote ? <span className="mt-1 block text-sm text-ink-muted">{sentence(plain(f.stepsNote))}</span> : null}
                  {p && !p.done && f.steps.length > 0 && <span className="mt-1 block text-xs font-medium tabular-nums text-primary-link">Step {p.step} of {f.steps.length}</span>}
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
