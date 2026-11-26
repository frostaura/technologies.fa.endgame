import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { CLIENT_LEVELS, type Flow, type Step } from "../content/types.ts";
import { flow as flowById, isOperator, scripts, shotFor, track } from "../lib/data.ts";
import { ROLE_LABEL } from "../lib/labels.ts";
import { go, href } from "../lib/router.ts";
import { catalogue, progressStore, useProgress } from "../lib/progress.ts";
import { resumeStep, type FlowProgress } from "../progress/model.ts";
import { milestones, nextUp, trackStats, type Next } from "../progress/derive.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { isSplit, useSplit } from "../lib/media.ts";
import { useSwipe } from "../lib/swipe.ts";
import { StepPager } from "../components/StepPager.tsx";
import { ui } from "../components/ui.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { LevelBadge, ReachChip } from "../components/Chips.tsx";
import { Eyebrow } from "../components/Shell.tsx";
import { sentence } from "../content/text.ts";
import { variationScript } from "../content/scripts.ts";
import { Stage } from "../stage/Stage.tsx";
import { mediaOf, type Media } from "../stage/media.ts";
import { NotFound } from "./NotFound.tsx";

/** How long a step must be on screen to count as seen: long enough to read that it is there, not a flick past. */
const SEEN_AFTER_MS = 800;

const MEDIA_LABEL: Record<Media, string> = {
  demo: "Live",
  terminal: "Terminal",
  request: "Request",
  email: "E-mail",
  image: "Screenshot",
  code: "Code",
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
  // The address is the one source of truth for the step: the highlighted card, "Step n of m", the
  // console and its caption all read it. Choosing a step, the arrow keys, scrolling, Back and
  // Forward, and a pasted link all move the step by moving the address.
  // Opened with no step named: where the learner left it, if they began it and did not finish.
  const [resumedFrom] = useState(() => (initialStep === null ? resumeStep(progressStore.get().progress, f.id) : null));
  const active = Math.min(Math.max(initialStep ?? resumedFrom ?? 1, 1), Math.max(total, 1));
  const [resumeShown, setResumeShown] = useState(resumedFrom !== null);
  // On a phone, the console enlarged over the steps (the pager then carries the step's words).
  const [big, setBig] = useState(false);
  const split = useSplit();
  const pagerRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [pagerH, setPagerH] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [run, setRun] = useState(0);
  // "Try it yourself" hands the console over on one step; any other step takes it back.
  const [interactiveAt, setInteractiveAt] = useState<number | null>(null);
  const interactive = interactiveAt === active;
  // A branch from "What else can happen" playing in the stage: which one, and its step.
  const [branch, setBranch] = useState<{ index: number; step: number } | null>(null);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const progress = useProgress();
  /** Set while the page scrolls itself (to a chosen step): the reading line then moves nothing. */
  const scrolling = useRef(false);
  /** The step the reader scrolled to: already in place, so the page does not scroll to it again. */
  const scrolledTo = useRef<number | null>(null);
  const landed = useRef(false);
  const operator = isOperator(f);

  const stepAddress = useCallback((n: number) => `/flow/${f.id}/step/${n}`, [f.id]);

  // An address with no step names the first; it is written out, so the step can be linked to.
  useEffect(() => {
    if (total && initialStep !== active) go(stepAddress(active), { replace: true });
  }, [active, initialStep, stepAddress, total]);

  // A step shown for a moment is seen (and the last step makes the flow done); a step flicked past is not.
  useEffect(() => {
    if (!total) return;
    const t = window.setTimeout(() => progressStore.view(f.id, active, total), SEEN_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [active, f.id, total]);

  // The offer to start again stands until the learner moves off the step they came back to.
  if (resumeShown && resumedFrom !== null && active !== resumedFrom) setResumeShown(false);

  // The pager's height, so the enlarged console stops above it at any text size.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPagerH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [split, total]);

  // The end of the flow is in view: Next then takes the learner on to the next flow.
  useEffect(() => {
    const el = finishRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAtEnd(!!e?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [total]);

  /**
   * Where a step should sit to be "the one being read": the middle of the viewport beside the
   * stage on a wide screen; just under the sticky stage on a phone, where the stage sits on top.
   */
  const readingLine = useCallback(() => {
    const stage = stageRef.current;
    if (isSplit() || !stage) return window.innerHeight * 0.42;
    // Where the sticky stage comes to rest (its sticky offset plus its height), not where it sits
    // now: before the page has scrolled, the stage is still lower down in the flow.
    return (parseFloat(getComputedStyle(stage).top) || 0) + stage.offsetHeight + 24;
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

  // The step the address names is the one in view: unless the reader scrolled it there, the page
  // brings it to the reading line — at once when the page opens on it, smoothly after.
  useEffect(() => {
    if (!total) return;
    if (scrolledTo.current === active) {
      scrolledTo.current = null;
      return;
    }
    scrolledTo.current = null;
    const first = !landed.current;
    landed.current = true;
    scrolling.current = true;
    // A flow opened at its first step starts at the top of the page, wherever the last one was left.
    if (first && active <= 1) window.scrollTo({ top: 0, behavior: "auto" });
    else scrollToStep(active, !first && !reduced);
    // Web fonts can reflow the steps after the first scroll; land again once they are in.
    if (first && active > 1) void document.fonts?.ready.then(() => scrollToStep(active, false));
    // The reading line moves nothing until the page has come to rest on the step: a smooth
    // scroll takes as long as it takes, so rest is measured, not timed.
    let last = window.scrollY;
    let still = 0;
    const started = Date.now();
    const watch = window.setInterval(() => {
      if (window.scrollY === last) still += 1;
      else {
        last = window.scrollY;
        still = 0;
      }
      if ((still >= 3 && Date.now() - started > 300) || Date.now() - started > 6000) {
        window.clearInterval(watch);
        scrolling.current = false;
      }
    }, 80);
    return () => {
      window.clearInterval(watch);
      scrolling.current = false;
    };
  }, [active, total, reduced, scrollToStep]);

  // Scrolling moves the step: the first step crossing the reading line is the one in the address.
  useEffect(() => {
    if (!total || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const crossing = new Set<number>();
    const observe = () => {
      io?.disconnect();
      crossing.clear();
      const line = Math.round(readingLine());
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.step);
            if (e.isIntersecting) crossing.add(n);
            else crossing.delete(n);
          }
          if (scrolling.current || !crossing.size) return;
          const n = Math.min(...crossing);
          if (window.location.hash === href(stepAddress(n))) return;
          scrolledTo.current = n;
          go(stepAddress(n), { replace: true });
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
  }, [total, readingLine, stepAddress]);

  // The step asked for last: the address changes a moment after it is set, and a second key
  // press in that moment moves on from the step asked for, not the one still showing.
  const asked = useRef(active);
  useEffect(() => {
    asked.current = active;
  }, [active]);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(n, 1), total);
      setBranch(null);
      if (target === asked.current) {
        scrollToStep(target, !reduced);
      } else {
        asked.current = target;
        go(stepAddress(target));
      }
      refs.current[target - 1]?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    },
    [total, reduced, scrollToStep, stepAddress],
  );

  // Arrow keys (and j / k) walk the steps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        goTo(asked.current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        goTo(asked.current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  // A sideways swipe over the stage or the steps walks them, as the arrow keys do.
  useSwipe(gridRef, { onLeft: () => goTo(asked.current + 1), onRight: () => goTo(asked.current - 1), enabled: total > 1 && !interactive });

  const toFinish = () => {
    const el = finishRef.current;
    if (!el) return;
    scrolling.current = true;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - (isSplit() ? 96 : readingLine() - 8)), behavior: reduced ? "auto" : "smooth" });
    window.setTimeout(() => (scrolling.current = false), reduced ? 50 : 900);
    el.focus({ preventScroll: true });
  };

  const variation = branch && script ? script.variations?.[branch.index] : undefined;
  const branchScript = branch && script ? variationScript(script, branch.index) : undefined;
  const showBranch = (index: number) => {
    setBranch({ index, step: 1 });
    setInteractiveAt(null);
    // The stage sits beside the steps: bring its top, where the branch is named, back into view.
    scrolling.current = true;
    const grid = stageRef.current?.parentElement;
    if (grid) window.scrollTo({ top: Math.max(0, grid.getBoundingClientRect().top + window.scrollY - 88), behavior: reduced ? "auto" : "smooth" });
    window.setTimeout(() => (scrolling.current = false), reduced ? 50 : 700);
  };

  const prereqs = f.learnFirst.flatMap((p) => flowById(p) ?? []);
  const mine = progress.flows[f.id];
  const done = !!mine?.done;
  const furthest = Math.max(mine?.furthest ?? 0, active);
  const pathTitle = f.level ? track(f.level)?.title ?? f.level : null;
  const next = nextUp(progress, f.level ? track(f.level) : undefined, catalogue, f.id);

  const end = atEnd && next ? (
    <a href={href(`/flow/${next.flow.id}`)} className={`${ui.primary} min-w-0 px-4`} aria-label={`Next flow: ${next.flow.id} ${next.flow.title}`}>
      <span className="truncate">Next: {next.flow.id}</span>
    </a>
  ) : atEnd ? (
    <a href={href("/progress")} className={`${ui.primary} px-4`}>Your progress</a>
  ) : (
    <button type="button" onClick={toFinish} className={`${ui.primary} px-4`}>Finish</button>
  );
  const pager =
    total > 0 ? (
      <StepPager
        variant={split ? "inline" : "bar"}
        active={active}
        total={total}
        furthest={furthest}
        onPrev={() => goTo(asked.current - 1)}
        onNext={() => goTo(asked.current + 1)}
        end={end}
        text={!split && big ? <Inline text={f.steps[active - 1]?.text ?? ""} self={f.id} /> : undefined}
        resumed={resumeShown && resumedFrom !== null ? { step: resumedFrom, onRestart: () => goTo(1) } : undefined}
      />
    ) : null;

  return (
    <article className="mx-auto w-full max-w-page px-4 pb-10 sm:px-6 split:pb-20" style={pagerH ? ({ "--pager-h": `${pagerH}px` } as CSSProperties) : undefined}>
      <header className="pb-8 pt-8 sm:pb-10 sm:pt-14">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-ink-muted" data-print="hide">
          {f.level && pathTitle ? <a className="hover:text-ink" href={href(operator ? "/operator" : `/path/${f.level}`)}>{pathTitle}</a> : <a className="hover:text-ink" href={href("/browse")}>Browse</a>}
          <span aria-hidden="true">/</span>
          <a className="hover:text-ink" href={href(`${operator ? "/operator" : ""}/area/${f.area}`)}>Area {f.area}</a>
        </nav>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-ink px-3 py-1 font-mono text-xs font-semibold text-primary-ink">{f.id}{f.aliases.length ? ` – ${f.aliases[f.aliases.length - 1]}` : ""}</span>
          <LevelBadge level={f.level} />
          <ReachChip reach={f.reach} />
          {done ? (
            <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success-text">Done</span>
          ) : mine ? (
            <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary-link">Started · {mine.furthest} of {total} seen</span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
        <h1 className="max-w-prose break-words font-display text-title-sm font-bold text-ink sm:text-title">{f.title}</h1>
        {f.whatYouLearn && (
          <p className="mt-5 max-w-prose text-lead-sm text-ink-body sm:text-lead">
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
        <div ref={gridRef} className="grid gap-6 split:grid-cols-12 split:gap-8 lg:gap-12">
          <div ref={stageRef} className={`sticky top-header-sm z-10 -mx-4 border-b bg-surface/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-header short:top-header-short split:order-2 split:col-span-7 split:mx-0 split:h-stage short:split:h-stage-short split:border-0 split:bg-transparent split:p-0 split:backdrop-blur-none ${big ? "h-stage-full" : "h-stage-sm"}`} data-print="hide">
            <Stage
              flow={f}
              script={branchScript ?? script}
              active={branch && branchScript ? branch.step : active}
              branch={
                variation && branch
                  ? { title: variation.title, step: branch.step, total: variation.steps.length, onStep: (n) => setBranch({ index: branch.index, step: n }), onClose: () => setBranch(null) }
                  : undefined
              }
              captured={(n) => (branch && variation ? (n === variation.steps.length ? shotFor(f.id, `v${branch.index + 1}`) : undefined) : shotFor(f.id, n))}
              run={run}
              pager={split ? pager : undefined}
              expand={split ? undefined : { on: big, toggle: () => setBig((b) => !b) }}
              interactive={interactive}
              onTry={() => setInteractiveAt(active)}
              onReplay={() => {
                setInteractiveAt(null);
                setRun((r) => r + 1);
              }}
            />
          </div>
          <div className="min-w-0 split:order-1 split:col-span-5">
            <p className="mb-4 hidden text-sm text-ink-muted lg:block" data-print="hide">
              Scroll, or press <kbd className="rounded-xxs border px-1 font-mono text-xs">←</kbd> <kbd className="rounded-xxs border px-1 font-mono text-xs">→</kbd>
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
                  seen={s.n <= (mine?.furthest ?? 0)}
                  showSection={!!s.section && s.section !== f.steps[i - 1]?.section}
                  onSelect={() => goTo(s.n)}
                  refCb={(el) => {
                    refs.current[i] = el;
                  }}
                />
              ))}
            </ol>
            <Finish flow={f} entry={mine} next={next} sectionRef={finishRef} />
          </div>
        </div>
      ) : (
        <div className="max-w-prose rounded-lg border bg-ground p-6">
          <p className="text-eyebrow font-semibold uppercase text-ink-muted">What the product does today</p>
          <div className="mt-2 text-ink-body">{f.stepsNote ? <Inline text={f.stepsNote} self={f.id} /> : <Blocks blocks={f.intro} self={f.id} />}</div>
        </div>
      )}

      <Variations flow={f} branches={script?.variations?.map((v) => v.title) ?? []} playing={branch?.index ?? null} onShow={total > 0 ? showBranch : undefined} />
      {!split && pager && (
        // Sticky to the bottom edge of the article: over the steps while they are read, and at rest above the footer at the end.
        <div ref={pagerRef} className="sticky bottom-0 z-20 -mx-4 mt-10 sm:-mx-6">{pager}</div>
      )}
    </article>
  );
}

function StepCard({ step, flow, media, scripted, active, seen, showSection, onSelect, refCb }: {
  step: Step;
  flow: Flow;
  media: Media;
  scripted: boolean;
  active: boolean;
  seen: boolean;
  showSection: boolean;
  onSelect: () => void;
  refCb: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li ref={refCb} data-step={step.n} id={`step-${step.n}`} className="scroll-mt-24">
      {showSection && <p className="mb-3 mt-6 text-eyebrow font-semibold uppercase text-ink-muted">{step.section}</p>}
      {/* One card, one outline: the card's own border marks the step being read, and the keyboard's focus on its button (whose ring would end above the chip). */}
      <div data-testid="step-card" className={`rounded-md border-2 bg-surface transition-colors ${active ? "border-primary shadow-card" : "border-transparent hover:border-border focus-within:border-primary"}`}>
        <button type="button" onClick={onSelect} aria-current={active ? "step" : undefined} className="flex w-full items-start gap-4 rounded-md px-4 pt-4 text-left focus-visible:ring-0 focus-visible:ring-offset-0 sm:px-5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold transition-colors ${active ? "bg-primary text-primary-ink" : seen ? "bg-primary-tint text-primary-link" : "bg-quiet text-quiet-text"}`}>
            {step.n}
            {seen && !active && <span className="sr-only">, seen</span>}
          </span>
          <span className="min-w-0 flex-1 pt-1 text-step text-ink">
            <Inline text={step.text} self={flow.id} />
          </span>
        </button>
        <div className="min-w-0 pb-4 pl-16 pr-4 text-sm sm:pr-5">
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

/**
 * The end of a flow: how to know it worked, then — once it is done — the moment that says so, what
 * it added up to, and the next flow one tap away.
 */
function Finish({ flow: f, entry, next, sectionRef }: { flow: Flow; entry: FlowProgress | undefined; next: Next | undefined; sectionRef: RefObject<HTMLElement | null> }) {
  const progress = useProgress();
  const done = !!entry?.done;
  const t = f.level ? track(f.level) : undefined;
  const stats = t ? trackStats(progress, t) : undefined;
  const earnedNow = done && entry?.doneAt
    ? milestones(progress, catalogue, CLIENT_LEVELS).filter((m) => m.earned && m.at === entry.doneAt && !isOperator(f))
    : [];
  const summary = stats ? `${stats.done} of ${stats.total} on ${t?.title ?? f.level}${stats.complete ? ": path complete" : ""}` : "";
  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="worked" className="mt-10 rounded-lg bg-night p-6 text-primary-ink focus:outline-none sm:p-8">
      <p className="text-eyebrow font-semibold uppercase text-live">You know it worked when</p>
      <p id="worked" className="mt-3 text-lead-sm sm:text-lead">{f.workedWhen ? <Inline text={f.workedWhen} self={f.id} plainIds tone="dark" /> : "The last step above is what you see."}</p>
      <p role="status" className="sr-only">{done ? `Flow done. ${summary}.` : ""}</p>
      {done && (
        <div className="mt-6 flex items-start gap-4 border-t border-surface/15 pt-6" data-print="hide" data-testid="flow-done">
          <span className="flex h-medal w-medal shrink-0 items-center justify-center rounded-full bg-live text-night" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="min-w-0">
            <p className="font-display text-2xl font-semibold">Done{next ? <span className="text-primary-ink-soft"> — next: {next.flow.id}</span> : null}</p>
            {summary && <p className="mt-1 text-sm text-primary-ink-soft">{summary}</p>}
            {earnedNow.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Milestones earned">
                {earnedNow.map((m) => (
                  <li key={m.id} className="rounded-full border border-live/50 px-3 py-1 text-xs font-semibold text-live">Milestone: {m.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3" data-print="hide">
        {done && next && (
          <a href={href(`/flow/${next.flow.id}`)} className={`${ui.light} min-w-0 px-5`}>
            <span className="truncate">Next: {next.flow.id} {next.flow.title}</span>
          </a>
        )}
        <button type="button" onClick={() => progressStore.setDone(f.id, !done)} className={done ? ui.lightOutline : ui.light} aria-pressed={done}>
          {done ? "Done ✓" : "Mark as done"}
        </button>
        {!done && next && (
          <a href={href(`/flow/${next.flow.id}`)} className={`${ui.lightOutline} min-w-0`}>
            <span className="truncate">Next: {next.flow.id} {next.flow.title}</span>
          </a>
        )}
        {!next && f.level && (
          <a href={href("/progress")} className={ui.lightOutline}>{stats?.complete ? "Path complete: your progress" : "Your progress"}</a>
        )}
      </div>
      {done && next?.before && <p className="mt-3 text-sm text-primary-ink-soft" data-print="hide">{next.flow.id} is a “learn first” for {next.before.id}, the next flow on this path.</p>}
    </section>
  );
}

function Variations({ flow: f, branches, playing, onShow }: { flow: Flow; branches: string[]; playing: number | null; onShow?: (index: number) => void }) {
  if (!f.variations.length && !f.extras.length && !branches.length) return null;
  return (
    <section className="mt-12 max-w-prose">
      <details className="group rounded-lg border bg-surface" open={f.steps.length === 0}>
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 font-display text-xl font-semibold text-ink">
          What else can happen
          <span className="text-sm font-sans font-normal text-ink-muted group-open:hidden">Refusals, limits and other branches</span>
        </summary>
        <div className="border-t px-6 pb-6 pt-2">
          {branches.length > 0 && onShow && (
            <div className="mb-4 mt-3" data-print="hide">
              <p className="text-eyebrow font-semibold uppercase text-ink-muted">Watch it in the live console</p>
              <ul aria-label="Branches you can watch" className="mt-2 flex flex-wrap gap-2">
                {branches.map((title, i) => (
                  <li key={title}>
                    <button
                      type="button"
                      onClick={() => onShow(i)}
                      aria-pressed={playing === i}
                      className={`inline-flex min-h-touch items-center gap-2 rounded-full border px-4 text-sm font-medium ${playing === i ? "border-primary bg-primary-tint text-primary-link" : "text-ink hover:border-primary-line hover:bg-primary-tint"}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                      {title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
