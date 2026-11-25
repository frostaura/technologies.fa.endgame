import { CLIENT_LEVELS } from "../content/types.ts";
import { content, clientFlows, flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { useProgress } from "../lib/progress.ts";
import { Mark } from "../components/Mark.tsx";
import { Qr } from "../components/Qr.tsx";
import { Eyebrow } from "../components/Shell.tsx";

export const PDFS = import.meta.env.VITE_PDFS === "1";

export function Cover() {
  const steps = clientFlows.reduce((n, f) => n + f.steps.length, 0);
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="mx-auto grid max-w-page items-center gap-12 px-4 py-14 sm:px-6 lg:min-h-stage lg:grid-cols-2 lg:gap-20 lg:py-20">
          <div className="animate-rise">
            <div className="flex items-center gap-3">
              <Mark className="h-12 w-12" />
              <Eyebrow>Endgame</Eyebrow>
            </div>
            <h1 className="mt-8 font-display text-cover-sm font-bold text-ink sm:text-cover">The Endgame Academy</h1>
            <p className="mt-6 max-w-read text-lead text-ink-body">
              Every flow in Endgame, taught step by step beside a live copy of the console, so you watch the product change and then try it yourself.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <a href={href("/learn")} className="inline-flex min-h-touch items-center rounded-full bg-primary px-6 text-base font-semibold text-primary-ink shadow-press transition-colors hover:bg-primary-hover">
                Start learning
              </a>
              <a href={href("/demo")} className="inline-flex min-h-touch items-center rounded-full border-2 border-ink px-6 text-base font-semibold text-ink transition-colors hover:bg-ink hover:text-primary-ink">
                Open the live demo
              </a>
            </div>
            <p className="mt-8 font-mono text-xs text-ink-muted">
              {clientFlows.length} flows · {steps} steps · {content.areas.length} areas
            </p>
            {PDFS && (
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <a className="font-medium text-primary-link underline decoration-primary-line underline-offset-4" href="./academy.pdf" download>Download the academy (PDF)</a>
                <a className="font-medium text-ink-muted underline decoration-border-strong underline-offset-4" href="./operator-handbook.pdf" download>Operator handbook, for FrostAura (PDF)</a>
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
      <Resume />
      <section className="mx-auto max-w-page px-4 py-14 sm:px-6">
        <h2 className="font-display text-title-sm font-semibold text-ink">Four paths, in order</h2>
        <p className="mt-2 max-w-read text-ink-muted">Each path puts every “learn first” ahead of the flow that needs it. Start at Foundation, or jump to the path that fits you.</p>
        <PathCards />
      </section>
    </>
  );
}

export function PathCards() {
  const progress = useProgress();
  return (
    <ol className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CLIENT_LEVELS.map((level, i) => {
        const t = track(level);
        const ids = t?.flows ?? [];
        const done = ids.filter((id) => progress.flows[id] === "done").length;
        return (
          <li key={level}>
            <a href={href(`/path/${level}`)} className="group flex h-full flex-col rounded-lg border bg-surface p-6 shadow-card transition-shadow hover:shadow-raised">
              <span className="font-mono text-xs text-ink-muted">0{i + 1}</span>
              <span className="mt-3 font-display text-2xl font-semibold text-ink group-hover:text-primary-link">{level}</span>
              <span className="mt-2 flex-1 text-sm text-ink-muted">{LEVEL_BLURB[level]}</span>
              <span className="mt-6 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-quiet" aria-hidden="true">
                  <span className="block h-full rounded-full bg-success" style={{ width: `${ids.length ? (100 * done) / ids.length : 0}%` }} />
                </span>
                <span className="font-mono text-xs text-ink-muted">{done}/{ids.length}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** Where the learner left off, if this browser remembers. */
export function Resume() {
  const { last, flows } = useProgress();
  const f = last ? flow(last.flow) : undefined;
  if (!f || !last) return null;
  const done = Object.values(flows).filter((s) => s === "done").length;
  return (
    <section className="mx-auto max-w-page px-4 pt-10 sm:px-6" aria-label="Resume">
      <a href={href(`/flow/${f.id}/step/${last.step}`)} className="flex flex-col gap-4 rounded-lg border-2 border-primary bg-primary-tint p-6 sm:flex-row sm:items-center">
        <span className="min-w-0 flex-1">
          <span className="text-eyebrow font-semibold uppercase text-primary">Pick up where you left off</span>
          <span className="mt-1 block font-display text-xl font-semibold text-ink">
            <span className="font-mono text-base text-primary-link">{f.id}</span> {f.title}
          </span>
          <span className="mt-1 block text-sm text-ink-muted">Step {last.step} of {f.steps.length} · {done} flow{done === 1 ? "" : "s"} done so far</span>
        </span>
        <span className="inline-flex min-h-touch items-center self-start rounded-full bg-primary px-5 text-sm font-semibold text-primary-ink sm:self-auto">Resume</span>
      </a>
    </section>
  );
}
