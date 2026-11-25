import type { Flow } from "../content/types.ts";
import { href } from "../lib/router.ts";
import { useProgress } from "../lib/progress.ts";
import { plain, sentence } from "../content/text.ts";
import { ProgressDot, ReachChip } from "./Chips.tsx";

/** A list of flows as rows: progress, id, title, what it teaches, how it is reached. */
export function FlowList({ flows, numbered = false }: { flows: Flow[]; numbered?: boolean }) {
  const progress = useProgress();
  return (
    <ol className="divide-y rounded-lg border bg-surface">
      {flows.map((f, i) => (
        <li key={f.id}>
          <a href={href(`/flow/${f.id}`)} className="group flex items-start gap-4 px-4 py-4 transition-colors hover:bg-ground sm:px-6">
            {numbered && <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-ink-muted">{i + 1}</span>}
            <ProgressDot state={progress.flows[f.id]} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs font-semibold text-primary-link">{f.id}</span>
                <span className="text-base font-medium text-ink group-hover:text-primary-link">{f.title}</span>
              </span>
              {f.whatYouLearn && <span className="mt-1 block text-sm text-ink-muted">{sentence(plain(f.whatYouLearn))}</span>}
            </span>
            <span className="hidden shrink-0 sm:block"><ReachChip reach={f.reach} /></span>
          </a>
        </li>
      ))}
    </ol>
  );
}
