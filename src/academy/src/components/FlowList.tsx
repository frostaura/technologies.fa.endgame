import type { Flow } from "../content/types.ts";
import { href } from "../lib/router.ts";
import { stateOf, useProgress } from "../lib/progress.ts";
import { plain, sentence } from "../content/text.ts";
import { ProgressDot, ReachChip } from "./Chips.tsx";

/**
 * A list of flows as rows: progress, id, title, what it teaches, how it is reached. A flow begun
 * and not finished says how far in it is; `next` marks the one to learn next.
 */
export function FlowList({ flows, numbered = false, next }: { flows: Flow[]; numbered?: boolean; next?: string }) {
  const progress = useProgress();
  return (
    <ol className="divide-y rounded-lg border bg-surface">
      {flows.map((f, i) => {
        const p = progress.flows[f.id];
        const isNext = next === f.id;
        return (
          <li key={f.id}>
            <a href={href(`/flow/${f.id}`)} className={`group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-ground sm:gap-4 sm:px-6 ${isNext ? "bg-primary-tint/60" : ""}`}>
              {numbered && <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-ink-muted">{i + 1}</span>}
              <ProgressDot state={stateOf(progress, f.id)} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-semibold text-primary-link">{f.id}</span>
                  <span className="min-w-0 break-words text-base font-medium text-ink group-hover:text-primary-link">{f.title}</span>
                  {isNext && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-ink">Next up</span>}
                </span>
                {f.whatYouLearn && <span className="mt-1 block text-sm text-ink-muted">{sentence(plain(f.whatYouLearn))}</span>}
                {p && !p.done && f.steps.length > 0 && <span className="mt-1 block font-mono text-xs text-primary-link">Step {p.step} of {f.steps.length}</span>}
              </span>
              <span className="hidden shrink-0 sm:block"><ReachChip reach={f.reach} /></span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
