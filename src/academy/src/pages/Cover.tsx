import { CLIENT_LEVELS } from "../content/types.ts";
import { figures, flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { PDFS } from "../lib/site.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp, trackStats } from "../progress/derive.ts";
import { Mark } from "../components/Mark.tsx";
import { ShareCard } from "../components/ShareCard.tsx";
import { Eyebrow } from "../components/Shell.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ui } from "../components/ui.ts";

const PdfIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
);

/** The two downloads, in one style. */
export function PdfLinks({ className = "" }: { className?: string }) {
  if (!PDFS) return null;
  return (
    <p className={`flex flex-wrap gap-2 ${className}`}>
      <a className={ui.small} href="./academy.pdf" download><PdfIcon />The academy (PDF)</a>
      <a className={ui.small} href="./operator-handbook.pdf" download><PdfIcon />Operator handbook, FrostAura (PDF)</a>
    </p>
  );
}

/** The academy's figures as a row of statistics: one typeface, fixed-width digits, the same numbers on every page. */
export function Figures({ className = "" }: { className?: string }) {
  const rows: [number, string][] = [
    [figures.flows, "flows"],
    [figures.steps, "steps"],
    [figures.areas, "areas"],
    [figures.paths, "paths"],
  ];
  return (
    <dl className={`grid grid-cols-4 gap-4 ${className}`} data-testid="figures">
      {rows.map(([n, label]) => (
        <div key={label} className="min-w-0 border-l pl-4 first:border-l-0 first:pl-0">
          <dd className={`${ui.figure} text-2xl sm:text-3xl`} data-figure={label}>{n}</dd>
          <dt className="mt-1 text-sm text-ink-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

export function Cover() {
  return (
    <section className={`${ui.container} grid gap-10 py-8 sm:py-12 lg:min-h-player lg:grid-cols-12 lg:content-center lg:gap-12 xl:gap-20`}>
      <div className="min-w-0 animate-rise lg:col-span-7">
        <div className="flex items-center gap-3">
          <Mark className="hidden h-10 w-10 sm:block" />
          <Eyebrow>Endgame</Eyebrow>
        </div>
        <h1 className="mt-4 text-balance font-display text-cover-sm font-bold text-ink short:text-title-sm sm:mt-6 2xl:text-cover">The Endgame Academy</h1>
        <p className="mt-4 max-w-read text-lead-sm text-ink-body sm:mt-5 sm:text-lead">
          Every flow in Endgame, taught step by step beside a live copy of the console, so you watch the product change and then try it yourself.
        </p>
        <ResumeCard className="mt-6 max-w-read" />
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={href("/learn")} className={`${ui.primary} px-6 text-base`}>Start learning</a>
          <a href={href("/demo")} className={`${ui.outline} px-6 text-base`}>Open the live demo</a>
        </div>
        <Figures className="mt-10 max-w-read" />
        <PdfLinks className="mt-8" />
      </div>
      <div className="min-w-0 space-y-6 lg:col-span-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Four paths, in order</h2>
          <p className="mt-1 text-sm text-ink-muted">Each puts every “learn first” ahead of the flow that needs it.</p>
          <PathRows className="mt-4" />
        </div>
        <ShareCard />
      </div>
    </section>
  );
}

/** The four paths as one list of rows: how far along each is, and what is next on it. */
function PathRows({ className = "" }: { className?: string }) {
  const progress = useProgress();
  return (
    <ol className={`divide-y overflow-hidden rounded-lg border bg-surface shadow-card ${className}`}>
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        if (!t) return null;
        const s = trackStats(progress, t);
        const next = s.done ? nextUp(progress, t, catalogue) : undefined;
        return (
          <li key={level}>
            <a href={href(`/path/${level}`)} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ground">
              <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-ink-muted">0{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-semibold text-ink group-hover:text-primary-link">{level}</span>
                <span className="block truncate text-sm text-ink-muted">{LEVEL_BLURB[level]}</span>
              </span>
              <span className="hidden shrink-0 text-right text-sm sm:block">
                <span className="block font-semibold tabular-nums text-ink">{s.done} of {s.total}</span>
                <span className="block text-xs text-ink-muted">{s.complete ? "Path complete" : next ? `Next: ${next.flow.id}` : "flows done"}</span>
              </span>
              <ProgressRing done={s.done} total={s.total} label={`${level}: ${s.done} of ${s.total} flows done`} />
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** The four client paths as cards: what each covers, its first flows, how much of it is done, and what is next. */
export function PathCards() {
  const progress = useProgress();
  return (
    <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        if (!t) return null;
        const s = trackStats(progress, t);
        const next = nextUp(progress, t, catalogue);
        const first = t.flows.slice(0, 4).flatMap((id) => flow(id) ?? []);
        const steps = t.flows.reduce((n, id) => n + (flow(id)?.steps.length ?? 0), 0);
        return (
          <li key={level} className="min-w-0">
            <a href={href(`/path/${level}`)} className={ui.cardLink}>
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold tabular-nums text-ink-muted">0{i + 1}</span>
                {s.complete && <Medal earned mark={`0${i + 1}`} label={`${level} badge, earned`} />}
              </span>
              <span className="mt-2 font-display text-2xl font-semibold text-ink group-hover:text-primary-link">{level}</span>
              <span className="mt-2 text-sm text-ink-body">{LEVEL_BLURB[level]}</span>
              <span className="mt-4 text-xs font-medium tabular-nums text-ink-muted">{t.flows.length} flows · {steps} steps</span>
              <ul className="mt-3 flex-1 space-y-1.5 border-t pt-3 text-sm text-ink-body">
                {first.map((f) => (
                  <li key={f.id} className="flex gap-2"><span className="w-14 shrink-0 font-mono text-xs leading-5 text-ink-muted">{f.id}</span><span className="min-w-0 truncate">{f.title}</span></li>
                ))}
                {t.flows.length > first.length && <li className="pl-16 text-xs text-ink-muted">and {t.flows.length - first.length} more</li>}
              </ul>
              <span className="mt-5 flex items-center gap-3 border-t pt-4">
                <ProgressRing done={s.done} total={s.total} label={`${level}: ${s.done} of ${s.total} flows done`} />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold tabular-nums text-ink">{s.done} of {s.total} done</span>
                  <span className="block truncate text-xs text-ink-muted">{s.complete ? "Path complete" : next ? `Next: ${next.flow.id}` : ""}</span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
