import { CLIENT_LEVELS } from "../content/types.ts";
import { figures, flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { PDFS } from "../lib/site.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextOwn, overallNext, trackStats } from "../progress/derive.ts";
import { plain, sentence } from "../content/text.ts";
import { ShareCard } from "../components/ShareCard.tsx";
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
    // Two columns on a wide screen: on the left the introduction, the way in, and the card to hand the
    // academy on (its QR code and address); on the right the four paths, the figures and the PDFs. Each column ends where its content does, so nothing hangs between anchors.
    // On a phone the paths come straight after the introduction, in the first screen.
    <>
    <section className={`${ui.container} grid gap-10 py-8 sm:py-12 lg:grid-cols-12 lg:items-start lg:gap-x-12 xl:gap-x-20`}>
      <div className="min-w-0 animate-rise lg:col-span-7">
        <h1 className="text-balance font-display text-cover-sm font-bold text-ink short:text-title-sm 2xl:text-cover">The Endgame Academy</h1>
        <p className="mt-4 max-w-read text-pretty text-lead-sm text-ink-body sm:mt-5 sm:text-lead">
          Every flow in Endgame, taught step by step beside a live copy of the console, so you watch the product change and then try it yourself.
        </p>
        <ResumeCard className="mt-6 max-w-read" />
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={href("/learn")} className={`${ui.primary} px-6 text-base`}>Start learning</a>
          <a href={href("/demo")} className={`${ui.outline} px-6 text-base`}>Open the live demo</a>
        </div>
        <ShareCard className="mt-10 hidden w-fit max-w-read lg:block" />
      </div>
      <div className="min-w-0 lg:col-span-5 lg:col-start-8">
        <h2 className="font-display text-xl font-semibold text-ink">Four paths, in order</h2>
        <p className="mt-1 text-sm text-ink-muted">Each puts every “learn first” ahead of the flow that needs it.</p>
        <PathRows className="mt-4" />
        <Figures className="mt-8" />
        <PdfLinks className="mt-8" />
      </div>
      {/* Below a wide screen the card to take away comes after the paths. */}
      <ShareCard className="lg:hidden" />
    </section>
    <StartHere />
    </>
  );
}

/**
 * Where to begin, under the hero: the first flows of the path to learn next (Foundation for someone
 * new), so the first screen of a tall window is the academy's content, never an empty band.
 */
function StartHere() {
  const progress = useProgress();
  const next = overallNext(progress, catalogue, CLIENT_LEVELS);
  const level = next?.flow.level && CLIENT_LEVELS.includes(next.flow.level) ? next.flow.level : "Foundation";
  const t = track(level);
  if (!t) return null;
  const ids = t.flows;
  const from = next ? Math.max(0, ids.indexOf(next.flow.id)) : 0;
  const flows = ids.slice(from, from + 6).flatMap((id) => flow(id) ?? []);
  return (
    <section className={`${ui.container} pb-12`} aria-labelledby="start-here">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t pt-8">
        <h2 id="start-here" className="font-display text-xl font-semibold text-ink">{from ? `Next on ${level}` : `Start here: ${level}`}</h2>
        <a href={href(`/path/${level}`)} className={`text-sm ${ui.textLink}`}>All {ids.length} flows on {level}</a>
      </div>
      {/* The cards of a row share their rows (a subgrid): the titles, one line or two, end on one line, and the descriptions start on one. */}
      <ol className="mt-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
        {flows.map((f, i) => (
          <li key={f.id} className="row-span-3 mb-4 grid min-w-0 grid-rows-subgrid">
            <a href={href(`/flow/${f.id}`)} className={`${ui.cardLink} row-span-3 grid grid-rows-subgrid gap-0`}>
              <span className="flex items-center gap-3 text-xs text-ink-muted">
                <span className="font-semibold tabular-nums">{from + i + 1}</span>
                <span className="font-mono font-semibold text-primary-link">{f.id}</span>
              </span>
              <span className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-primary-link">{f.title}</span>
              <span className="mt-1.5 line-clamp-3 text-sm text-ink-muted">{f.whatYouLearn ? sentence(plain(f.whatYouLearn)) : ""}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The four paths as one list of rows: what each covers, on two lines, and how far along it is, once. */
function PathRows({ className = "" }: { className?: string }) {
  const progress = useProgress();
  return (
    <ol className={`divide-y overflow-hidden rounded-lg border bg-surface shadow-card ${className}`}>
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        if (!t) return null;
        const s = trackStats(progress, t);
        return (
          <li key={level}>
            <a href={href(`/path/${level}`)} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ground">
              <span className="w-6 shrink-0 self-start pt-1 text-sm font-semibold tabular-nums text-ink-muted">0{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-display text-lg font-semibold text-ink group-hover:text-primary-link">{level}</span>
                  <span className="text-xs tabular-nums text-ink-muted">{t.flows.length} flows</span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{LEVEL_BLURB[level]}</span>
              </span>
              <ProgressRing done={s.done} total={s.total} label={`${level}: ${s.done} of ${s.total} flows done`} />
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The four client paths as cards: what each covers, its first flows, how much of it is done, and the
 * path's own next flow. The cards share their rows (a subgrid), so the description, the list and the
 * footer start on one line across the row whatever each one's length; a tall window lists more flows.
 */
export function PathCards() {
  const progress = useProgress();
  return (
    <ol className="mt-8 grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        if (!t) return null;
        const s = trackStats(progress, t);
        const next = nextOwn(progress, t, catalogue);
        const shown = t.flows.slice(0, 8).flatMap((id) => flow(id) ?? []);
        const steps = t.flows.reduce((n, id) => n + (flow(id)?.steps.length ?? 0), 0);
        const more = (n: number) => t.flows.length - Math.min(n, shown.length);
        return (
          <li key={level} className="row-span-6 mb-4 grid min-w-0 grid-rows-subgrid">
            <a href={href(`/path/${level}`)} className={`${ui.cardLink} row-span-6 grid grid-rows-subgrid gap-0`}>
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold tabular-nums text-ink-muted">0{i + 1}</span>
                {s.complete && <Medal earned mark={`0${i + 1}`} label={`${level} badge, earned`} />}
              </span>
              <span className="mt-2 font-display text-2xl font-semibold text-ink group-hover:text-primary-link">{level}</span>
              <span className="mt-2 text-pretty text-sm text-ink-body">{LEVEL_BLURB[level]}</span>
              <span className="mt-4 text-xs font-medium tabular-nums text-ink-muted">{t.flows.length} flows · {steps} steps</span>
              <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm text-ink-body">
                {shown.map((f, n) => (
                  <li key={f.id} className={`gap-2 ${n < 4 ? "flex" : "hidden tall:flex"}`}><span className="w-14 shrink-0 font-mono text-xs leading-5 text-ink-muted">{f.id}</span><span className="line-clamp-2 min-w-0">{f.title}</span></li>
                ))}
                {more(4) > 0 && <li className={`pl-16 text-xs text-ink-muted ${more(8) !== more(4) ? "tall:hidden" : ""}`}>and {more(4)} more</li>}
                {more(8) > 0 && more(8) !== more(4) && <li className="hidden pl-16 text-xs text-ink-muted tall:block">and {more(8)} more</li>}
              </ul>
              <span className="mt-5 flex items-center gap-3 self-end border-t pt-4">
                <ProgressRing done={s.done} total={s.total} label={`${level}: ${s.done} of ${s.total} flows done`} />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold tabular-nums text-ink">{s.done} of {s.total} done</span>
                  <span className="block text-xs text-ink-muted">{s.complete ? "Path complete" : next ? <>Next: <span className="font-mono font-semibold text-primary-link">{next.id}</span> {next.title}</> : ""}</span>
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
