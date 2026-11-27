import { CLIENT_LEVELS } from "../content/types.ts";
import { pathFlows, flow } from "../lib/data.ts";
import { catalogue, streakNow, useProgressSnapshot } from "../lib/progress.ts";
import { overallNext } from "../progress/derive.ts";
import { href } from "../lib/router.ts";
import { count } from "../lib/format.ts";
import { StepTrack } from "./ProgressMarks.tsx";
import { ui } from "./ui.ts";

/**
 * "Pick up where you left off": the exact flow and step last viewed, with how far in it is — or,
 * when that flow is finished, what is next up. Renders nothing for someone who has not begun.
 */
export function ResumeCard({ className = "" }: { className?: string }) {
  const { progress, persistent } = useProgressSnapshot();
  const { last } = progress;
  const f = last ? flow(last.flow) : undefined;
  if (!f || !last) return null;
  const mine = progress.flows[f.id];
  const finished = !!mine?.done;
  const next = finished ? overallNext(progress, catalogue, CLIENT_LEVELS) : undefined;
  const done = pathFlows.filter((c) => progress.flows[c.id]?.done).length;
  const days = streakNow(progress.days);
  const target = finished && next ? next.flow : f;
  const to = finished && next ? `/flow/${next.flow.id}` : `/flow/${f.id}/step/${last.step}`;
  return (
    <section aria-label="Pick up where you left off" className={className} data-print="hide">
      <a href={href(to)} className="group flex flex-col gap-4 rounded-lg border-2 border-primary bg-primary-tint p-5 transition-shadow hover:shadow-raised sm:flex-row sm:items-center sm:p-6">
        <span className="min-w-0 flex-1">
          <span className={`${ui.eyebrow} text-primary`}>{finished ? (next ? "Next up" : "Every path is done") : "Pick up where you left off"}</span>
          <span className="mt-1 block font-display text-xl font-semibold text-ink">
            <span className="font-mono text-base text-primary-link">{target.id}</span> {target.title}
          </span>
          {finished ? (
            <span className="mt-1 block text-sm text-ink-muted">
              You finished {f.id}.{next?.before ? ` Learn this first, for ${next.before.id}.` : ""}
            </span>
          ) : (
            <>
              <span className="mt-1 block text-sm text-ink-body">Step {last.step} of {f.steps.length}</span>
              <StepTrack total={f.steps.length} furthest={mine?.furthest ?? last.step} active={last.step} className="mt-2 max-w-xs" />
            </>
          )}
          <span className="mt-2 block text-xs text-ink-muted">
            {count(done, "flow")} done so far{days > 1 ? ` · ${days} days in a row` : ""}
            {!persistent ? " · kept for this visit only" : ""}
          </span>
        </span>
        <span className={`${ui.primary} self-start sm:self-auto`}>{finished ? "Start" : "Resume"}</span>
      </a>
    </section>
  );
}
