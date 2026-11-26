import { CLIENT_LEVELS } from "../content/types.ts";
import { content, clientFlows, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { PDFS } from "../lib/site.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp, trackStats } from "../progress/derive.ts";
import { Mark } from "../components/Mark.tsx";
import { Qr } from "../components/Qr.tsx";
import { Eyebrow } from "../components/Shell.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ui } from "../components/ui.ts";

export function Cover() {
  const steps = clientFlows.reduce((n, f) => n + f.steps.length, 0);
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="mx-auto grid max-w-page items-center gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:min-h-stage lg:grid-cols-2 lg:gap-20 lg:py-20">
          <div className="min-w-0 animate-rise">
            <div className="flex items-center gap-3">
              <Mark className="h-10 w-10 sm:h-12 sm:w-12" />
              <Eyebrow>Endgame</Eyebrow>
            </div>
            <h1 className="mt-6 font-display text-cover-sm font-bold text-ink sm:mt-8 sm:text-cover">The Endgame Academy</h1>
            <p className="mt-5 max-w-read text-lead-sm text-ink-body sm:mt-6 sm:text-lead">
              Every flow in Endgame, taught step by step beside a live copy of the console, so you watch the product change and then try it yourself.
            </p>
            <ResumeCard className="mt-8" />
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={href("/learn")} className={`${ui.primary} px-6 text-base`}>
                Start learning
              </a>
              <a href={href("/demo")} className={`${ui.outline} px-6 text-base`}>
                Open the live demo
              </a>
            </div>
            <p className="mt-8 font-mono text-xs text-ink-muted">
              {clientFlows.length} flows · {steps} steps · {content.areas.length} areas
            </p>
            {PDFS && (
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <a className="inline-flex min-h-touch items-center font-medium text-primary-link underline decoration-primary-line underline-offset-4" href="./academy.pdf" download>Download the academy (PDF)</a>
                <a className="inline-flex min-h-touch items-center font-medium text-ink-muted underline decoration-border-strong underline-offset-4" href="./operator-handbook.pdf" download>Operator handbook, for FrostAura (PDF)</a>
              </p>
            )}
          </div>
          <div className="flex justify-center lg:justify-end">
            <div className="flex flex-col items-center gap-4">
              <Qr />
              <p className="max-w-qr text-center text-sm text-ink-muted">Scan to follow along on your phone.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-page px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="font-display text-title-sm font-semibold text-ink">Four paths, in order</h2>
        <p className="mt-2 max-w-read text-ink-muted">Each path puts every “learn first” ahead of the flow that needs it. Start at Foundation, or jump to the path that fits you.</p>
        <PathCards />
      </section>
    </>
  );
}

/** The four client paths, each with how much of it is done, its badge, and what is next on it. */
export function PathCards() {
  const progress = useProgress();
  return (
    <ol className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        if (!t) return null;
        const s = trackStats(progress, t);
        const next = s.done ? nextUp(progress, t, catalogue) : undefined;
        return (
          <li key={level}>
            <a href={href(`/path/${level}`)} className="group flex h-full flex-col rounded-lg border bg-surface p-5 shadow-card transition-shadow hover:shadow-raised sm:p-6">
              <span className="flex items-start justify-between gap-3">
                <span className="font-mono text-xs text-ink-muted">0{i + 1}</span>
                {s.complete && <Medal earned mark={`0${i + 1}`} label={`${level} badge, earned`} />}
              </span>
              <span className="mt-2 font-display text-2xl font-semibold text-ink group-hover:text-primary-link">{level}</span>
              <span className="mt-2 flex-1 text-sm text-ink-muted">{LEVEL_BLURB[level]}</span>
              <span className="mt-5 flex items-center gap-3">
                <ProgressRing done={s.done} total={s.total} label={`${level}: ${s.done} of ${s.total} flows done`} />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold text-ink">{s.done} of {s.total}</span>
                  <span className="block truncate text-xs text-ink-muted">{s.complete ? "Path complete" : next ? `Next: ${next.flow.id}` : "flows done"}</span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
