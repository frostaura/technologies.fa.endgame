import { useMemo } from "react";
import { Check, CircleStop } from "lucide-react";
import { Spinner } from "@/components/states";
import { SECTION, useShowAll } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { buildTimeline } from "../runs/timeline";
import { traceLines } from "./traceModel";
import { useRunStream } from "../runs/useRunStream";

/** How many of research's steps show before "Show all". */
const STEPS_SHOWN = 6;

/**
 * What research has done so far, on the idea's own page: while it runs, each step as it happens; when it did not
 * finish, where it got to and where it stopped. The run's page has every detail; this is the outline of it.
 */
export function ResearchTrace({ runId, stopped }: { runId: string; stopped: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const log = useRunStream(runId);
  const lines = useMemo(() => traceLines(buildTimeline(log.events, mode).items, stopped), [log.events, mode, stopped]);
  const { shown, control } = useShowAll(lines, STEPS_SHOWN, "steps");
  const title = stopped ? "Where research got to" : "What research is doing";
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card sm:p-6">
      <h2 className={SECTION}>{title}</h2>
      {lines.length === 0 ? (
        <p className="text-ink-muted">{stopped ? "Research stopped before it began looking." : "Research is starting; its first strand shows here when it begins."}</p>
      ) : (
        <ol aria-label="Research steps" className="flex flex-col divide-y border-y">
          {shown.map((l) => (
            <li key={l.key} data-state={l.state} className="flex min-w-0 items-start gap-3 py-2.5">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                {l.state === "working" ? <Spinner /> : l.state === "stopped" ? <CircleStop className="size-5 text-attention-text" /> : <Check className="size-5 text-success-text" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("break-words", l.state === "stopped" ? "font-semibold text-ink" : "text-ink")}>{l.title}</span>
                {l.state === "stopped" ? <span className="text-sm text-ink-body">It stopped here.</span> : l.outcome && <span className="break-words text-sm text-ink-muted">{l.outcome}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {control}
    </section>
  );
}
