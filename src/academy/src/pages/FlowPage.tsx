import { useCallback, useEffect, useRef, useState } from "react";
import type { Flow, Step } from "../content/types.ts";
import { flow as flowById, isOperator, nextInPath, scripts, track } from "../lib/data.ts";
import { ROLE_LABEL } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { markDone, markSeen, useProgress } from "../lib/progress.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { LevelBadge, ReachChip } from "../components/Chips.tsx";
import { Eyebrow } from "../components/Shell.tsx";
import { Stage } from "../stage/Stage.tsx";
import { mediaOf, type Media } from "../stage/media.ts";
import { NotFound } from "./NotFound.tsx";

/** "the band totals…" → "The band totals…": a field fragment shown as a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MEDIA_LABEL: Record<Media, string> = {
  demo: "Live",
  terminal: "Terminal",
  request: "Request",
  email: "E-mail",
  image: "Screenshot",
  facts: "",
};

export function FlowPage({ id, step }: { id: string; step: number | null }) {
  const f = flowById(id);
  if (!f) return <NotFound />;
  // A grouped entry answers to each id inside it; show it under its own.
  return <FlowView key={f.id} flow={f} initialStep={step} />;
}

function FlowView({ flow: f, initialStep }: { flow: Flow; initialStep: number | null }) {
  const script = scripts[f.id];
  const total = f.steps.length;
  const [active, setActive] = useState(() => Math.min(Math.max(initialStep ?? 1, 1), Math.max(total, 1)));
  const [run, setRun] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const progress = useProgress();
  const scrolling = useRef(false);
  const next = nextInPath(f);
  const operator = isOperator(f);

  // The address names the step, so any step can be linked to.
  useEffect(() => {
    if (!total) return;
    const target = href(`/flow/${f.id}/step/${active}`);
    if (window.location.hash !== target) window.history.replaceState(null, "", target);
    markSeen(f.id, active);
  }, [active, f.id, total]);

  /**
   * Where a step should sit to be "the one being read": the middle of the viewport beside the
   * stage on a wide screen; just under the sticky stage on a phone, where the stage sits on top.
   */
  const readingLine = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    const wide = window.matchMedia?.("(min-width: 1024px)").matches ?? true;
    return wide || !stage ? window.innerHeight * 0.42 : stage.bottom + 24;
  }, []);

  const scrollToStep = useCallback(
    (n: number, smooth: boolean) => {
      const el = refs.current[n - 1];
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - readingLine() + 8;
      window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    },
    [readingLine],
  );

  // Land on the linked step.
  useEffect(() => {
    if (!initialStep || initialStep <= 1) return;
    scrolling.current = true;
    scrollToStep(initialStep, false);
    // Web fonts can reflow the steps after the first scroll; land again once they are in.
    void document.fonts?.ready.then(() => scrollToStep(initialStep, false));
    const t = window.setTimeout(() => (scrolling.current = false), 900);
    return () => window.clearTimeout(t);
  }, [initialStep, scrollToStep]);

  // Scrolling moves the stage: the step crossing the reading line is the active one.
  useEffect(() => {
    if (!total || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      const line = Math.round(readingLine());
      io = new IntersectionObserver(
        (entries) => {
          if (scrolling.current) return;
          const visible = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.step));
          if (visible.length) {
            setActive(Math.min(...visible));
            setInteractive(false);
          }
        },
        { rootMargin: `-${line}px 0px -${Math.max(0, window.innerHeight - line - 48)}px 0px` },
      );
      refs.current.forEach((el) => el && io?.observe(el));
    };
    observe();
    window.addEventListener("resize", observe);
    return () => {
      window.removeEventListener("resize", observe);
      io?.disconnect();
    };
  }, [total, readingLine]);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(n, 1), total);
      setActive(target);
      setInteractive(false);
      scrolling.current = true;
      scrollToStep(target, !reduced);
      refs.current[target - 1]?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      window.setTimeout(() => (scrolling.current = false), reduced ? 50 : 700);
    },
    [total, reduced, scrollToStep],
  );

  // Arrow keys (and j / k) walk the steps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        goTo(active - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goTo]);

  const prereqs = f.learnFirst.flatMap((p) => flowById(p) ?? []);
  const done = progress.flows[f.id] === "done";
  const pathTitle = f.level ? track(f.level)?.title ?? f.level : null;

  return (
    <article className="mx-auto w-full max-w-page px-4 pb-20 sm:px-6">
      <header className="pb-10 pt-10 sm:pt-14">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-ink-muted" data-print="hide">
          {f.level && pathTitle ? <a className="hover:text-ink" href={href(operator ? "/operator" : `/path/${f.level}`)}>{pathTitle}</a> : <a className="hover:text-ink" href={href("/browse")}>Browse</a>}
          <span aria-hidden="true">/</span>
          <a className="hover:text-ink" href={href(`${operator ? "/operator" : ""}/area/${f.area}`)}>Area {f.area}</a>
        </nav>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-ink px-3 py-1 font-mono text-xs font-semibold text-primary-ink">{f.id}{f.aliases.length ? ` – ${f.aliases[f.aliases.length - 1]}` : ""}</span>
          <LevelBadge level={f.level} />
          <ReachChip reach={f.reach} />
          {done && <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success-text">Done</span>}
        </div>
        <div className="mt-4 grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
        <h1 className="max-w-prose font-display text-title-sm font-bold text-ink sm:text-title">{f.title}</h1>
        {f.whatYouLearn && (
          <p className="mt-5 max-w-prose text-lead text-ink-body">
            <Inline text={sentence(f.whatYouLearn)} self={f.id} />
          </p>
        )}
        </div>
        <dl className="grid content-start gap-x-8 gap-y-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1 lg:border-l lg:pl-8">
          {f.who && (
            <div>
              <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Who can do it</dt>
              <dd className="mt-1 text-sm text-ink-body"><Inline text={f.who} self={f.id} />{f.roles.length > 0 && <span className="block text-xs text-ink-muted">{f.roles.map((r) => ROLE_LABEL[r]).join(" · ")}</span>}</dd>
            </div>
          )}
          {f.startsAt && (
            <div>
              <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Starts at</dt>
              <dd className="mt-1 text-sm text-ink-body"><Inline text={f.startsAt} self={f.id} /></dd>
            </div>
          )}
          {f.needs && (
            <div>
              <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Needs</dt>
              <dd className="mt-1 text-sm text-ink-body"><Inline text={f.needs} self={f.id} /></dd>
            </div>
          )}
          {prereqs.length > 0 && (
            <div>
              <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Learn first</dt>
              <dd className="mt-1 flex flex-wrap gap-2 text-sm">
                {prereqs.map((p) => (
                  <a key={p.id} href={href(`/flow/${p.id}`)} className="rounded-full border px-3 py-1 hover:border-primary-line hover:bg-primary-tint">
                    <span className="font-mono text-xs font-semibold text-primary-link">{p.id}</span> <span className="text-ink-body">{p.title}</span>
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
        </div>
        {f.intro.length > 0 && <div className="mt-6 max-w-prose"><Blocks blocks={f.intro} self={f.id} /></div>}
      </header>

      {total > 0 ? (
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div ref={stageRef} className="sticky top-header-sm z-10 md:top-header -mx-4 h-stage-sm border-b bg-surface/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:order-2 lg:col-span-7 lg:mx-0 lg:h-stage lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none" data-print="hide">
            <Stage
              flow={f}
              script={script}
              active={active}
              run={run}
              interactive={interactive}
              onTry={() => setInteractive(true)}
              onReplay={() => {
                setInteractive(false);
                setRun((r) => r + 1);
              }}
            />
          </div>
          <div className="lg:order-1 lg:col-span-5">
            <p className="mb-4 flex items-center justify-between text-sm text-ink-muted" data-print="hide">
              <span>Step {active} of {total}</span>
              <span className="hidden lg:inline">Scroll, or press <kbd className="rounded-xxs border px-1 font-mono text-xs">←</kbd> <kbd className="rounded-xxs border px-1 font-mono text-xs">→</kbd></span>
            </p>
            <ol className="space-y-4" aria-label="Steps">
              {f.steps.map((s, i) => (
                <StepCard
                  key={s.n}
                  step={s}
                  flow={f}
                  media={mediaOf(f, script, s.n)}
                  scripted={!!script?.steps.some((x) => x.step === s.n)}
                  active={s.n === active}
                  showSection={!!s.section && s.section !== f.steps[i - 1]?.section}
                  onSelect={() => goTo(s.n)}
                  refCb={(el) => {
                    refs.current[i] = el;
                  }}
                />
              ))}
            </ol>
            <Finish flow={f} done={done} next={next} />
          </div>
        </div>
      ) : (
        <div className="max-w-prose rounded-lg border bg-ground p-6">
          <p className="text-eyebrow font-semibold uppercase text-ink-muted">What the product does today</p>
          <div className="mt-2 text-ink-body">{f.stepsNote ? <Inline text={f.stepsNote} self={f.id} /> : <Blocks blocks={f.intro} self={f.id} />}</div>
        </div>
      )}

      <Variations flow={f} />
    </article>
  );
}

function StepCard({ step, flow, media, scripted, active, showSection, onSelect, refCb }: {
  step: Step;
  flow: Flow;
  media: Media;
  scripted: boolean;
  active: boolean;
  showSection: boolean;
  onSelect: () => void;
  refCb: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li ref={refCb} data-step={step.n} id={`step-${step.n}`} className="scroll-mt-24">
      {showSection && <p className="mb-3 mt-6 text-eyebrow font-semibold uppercase text-ink-muted">{step.section}</p>}
      <div className={`rounded-md border-2 bg-surface transition-colors ${active ? "border-primary shadow-card" : "border-transparent hover:border-border"}`}>
        <button type="button" onClick={onSelect} aria-current={active ? "step" : undefined} className="flex w-full items-start gap-4 rounded-md px-4 pt-4 text-left sm:px-5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold transition-colors ${active ? "bg-primary text-primary-ink" : "bg-quiet text-quiet-text"}`}>{step.n}</span>
          <span className="min-w-0 flex-1 pt-1 text-step text-ink">
            <Inline text={step.text} self={flow.id} />
          </span>
        </button>
        <div className="pb-4 pl-16 pr-4 text-sm sm:pr-5">
          {step.children.length > 0 && <Blocks blocks={step.children} self={flow.id} />}
          {scripted && MEDIA_LABEL[media] && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary-link" data-print="hide">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {MEDIA_LABEL[media]}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function Finish({ flow: f, done, next }: { flow: Flow; done: boolean; next: Flow | undefined }) {
  return (
    <section aria-labelledby="worked" className="mt-10 rounded-lg bg-night p-6 text-primary-ink sm:p-8">
      <p className="text-eyebrow font-semibold uppercase text-live">You know it worked when</p>
      <p id="worked" className="mt-3 text-lead">{f.workedWhen ? <Inline text={f.workedWhen} self={f.id} plainIds /> : "The last step above is what you see."}</p>
      <div className="mt-6 flex flex-wrap gap-3" data-print="hide">
        <button type="button" onClick={() => markDone(f.id, !done)} className={`min-h-touch rounded-full px-5 text-sm font-semibold ${done ? "bg-success text-primary-ink" : "bg-surface text-ink hover:bg-primary-tint"}`} aria-pressed={done}>
          {done ? "Done ✓" : "Mark as done"}
        </button>
        {next && (
          <a href={href(`/flow/${next.id}`)} className="inline-flex min-h-touch items-center rounded-full border-2 border-primary-ink-soft px-5 text-sm font-semibold hover:bg-surface/10">
            Next: {next.id} {next.title}
          </a>
        )}
        {!next && f.level && (
          <a href={href("/finish")} className="inline-flex min-h-touch items-center rounded-full border-2 border-primary-ink-soft px-5 text-sm font-semibold hover:bg-surface/10">End of the path</a>
        )}
      </div>
    </section>
  );
}

function Variations({ flow: f }: { flow: Flow }) {
  if (!f.variations.length && !f.extras.length) return null;
  return (
    <section className="mt-12 max-w-prose">
      <details className="group rounded-lg border bg-surface" open={f.steps.length === 0}>
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 font-display text-xl font-semibold text-ink">
          What else can happen
          <span className="text-sm font-sans font-normal text-ink-muted group-open:hidden">Refusals, limits and other branches</span>
        </summary>
        <div className="border-t px-6 pb-6 pt-2">
          <Blocks blocks={f.variations} self={f.id} />
          {f.extras.map((x) => (
            <div key={x.label} className="mt-4 rounded-md bg-attention-wash p-4">
              <p className="text-eyebrow font-semibold uppercase text-attention-text">{x.label}</p>
              <p className="mt-1 text-sm text-ink-body"><Inline text={x.text} self={f.id} /></p>
              {x.blocks.length > 0 && <Blocks blocks={x.blocks} self={f.id} />}
            </div>
          ))}
        </div>
      </details>
      <div className="mt-6 text-sm text-ink-muted" data-print="hide">
        <Eyebrow>From the docs</Eyebrow>
        <p className="mt-1">
          This page is built from the flow documents, which were read from the code.
          {f.where && <> Where in the code: <Inline text={f.where} self={f.id} /></>}
        </p>
      </div>
    </section>
  );
}
