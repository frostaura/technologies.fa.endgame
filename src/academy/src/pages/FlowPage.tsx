import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CLIENT_LEVELS, type Flow, type Step } from "../content/types.ts";
import { flow as flowById, isOperator, scripts, shotFor, track } from "../lib/data.ts";
import { ROLE_LABEL } from "../lib/labels.ts";
import { go, href } from "../lib/router.ts";
import { catalogue, progressStore, useProgress } from "../lib/progress.ts";
import { resumeStep, type FlowProgress } from "../progress/model.ts";
import { milestones, nextUp, trackStats, type Next } from "../progress/derive.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { useMedia, useSplit } from "../lib/media.ts";
import { SHORT_QUERY } from "../theme/tokens.ts";
import { useSwipe } from "../lib/swipe.ts";
import { StepPager } from "../components/StepPager.tsx";
import { ui } from "../components/ui.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { LevelBadge, ReachChip } from "../components/Chips.tsx";
import { sentence } from "../content/text.ts";
import { variationScript } from "../content/scripts.ts";
import { Stage, type PlayerMode } from "../stage/Stage.tsx";
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
  // console and its caption all read it. Choosing a step, the arrow keys, scrolling the steps, Back
  // and Forward, and a pasted link all move the step by moving the address.
  // Opened with no step named: where the learner left it, if they began it and did not finish.
  const [resumedFrom] = useState(() => (initialStep === null ? resumeStep(progressStore.get().progress, f.id) : null));
  const active = Math.min(Math.max(initialStep ?? resumedFrom ?? 1, 1), Math.max(total, 1));
  const [resumeShown, setResumeShown] = useState(resumedFrom !== null);
  const split = useSplit();
  const short = useMedia(SHORT_QUERY);
  const mode: PlayerMode = !split ? "phone" : short ? "landscape" : "desk";
  // On a phone the larger console is where a lesson starts: the console is what is being taught.
  const [big, setBig] = useState(false);
  const pagerRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** The side column, which scrolls on its own beside the console on a wide screen. */
  const colRef = useRef<HTMLDivElement>(null);
  const [pagerH, setPagerH] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [run, setRun] = useState(0);
  // "Try it yourself" hands the console over on one step; any other step takes it back.
  const [interactiveAt, setInteractiveAt] = useState<number | null>(null);
  const interactive = interactiveAt === active;
  // A branch from "What else can happen" playing in the stage: which one, and its step.
  const [branch, setBranch] = useState<{ index: number; step: number } | null>(null);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const reduced = useReducedMotion();
  const progress = useProgress();
  /** Set while the column scrolls itself (to a chosen step): the reading line then moves nothing. */
  const scrolling = useRef(false);
  /** The step the reader scrolled to: already in place, so the column does not scroll to it again. */
  const scrolledTo = useRef<number | null>(null);
  const landed = useRef(false);
  const operator = isOperator(f);
  const desk = mode === "desk";

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

  // The pager's height, so the larger console stops above it at any text size.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPagerH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, total]);

  // The end of the flow is in view: Next then takes the learner on to the next flow.
  useEffect(() => {
    const el = finishRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAtEnd(!!e?.isIntersecting), { root: desk ? colRef.current : null, threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [total, desk]);

  /** Where, inside the side column, a step sits to be "the one being read". */
  const readingLine = useCallback(() => Math.round((colRef.current?.clientHeight ?? window.innerHeight) * 0.3), []);

  const scrollToStep = useCallback(
    (n: number, smooth: boolean) => {
      const el = refs.current[n - 1];
      const col = colRef.current;
      if (!el) return;
      if (desk && col) {
        const top = col.scrollTop + el.getBoundingClientRect().top - col.getBoundingClientRect().top - readingLine() + 8;
        col.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
      }
      // On a phone the console is on top of the page and the steps under it: the step's words ride in the bar, so nothing scrolls.
    },
    [desk, readingLine],
  );

  // The step the address names is the one in view: unless the reader scrolled it there, the column
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
    const col = colRef.current;
    // A flow opened at its first step starts at the top, wherever the last one was left.
    if (first) window.scrollTo({ top: 0, behavior: "auto" });
    if (first && active <= 1) col?.scrollTo({ top: 0, behavior: "auto" });
    else scrollToStep(active, !first && !reduced);
    // Web fonts can reflow the steps after the first scroll; land again once they are in.
    if (first && active > 1) void document.fonts?.ready.then(() => scrollToStep(active, false));
    // The reading line moves nothing until the column has come to rest on the step: a smooth
    // scroll takes as long as it takes, so rest is measured, not timed.
    const at = () => col?.scrollTop ?? window.scrollY;
    let last = at();
    let still = 0;
    const started = Date.now();
    const watch = window.setInterval(() => {
      if (at() === last) still += 1;
      else {
        last = at();
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

  // Scrolling the side column moves the step: the first step crossing its reading line is the one in the address.
  useEffect(() => {
    const col = colRef.current;
    if (!total || !desk || !col || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const crossing = new Set<number>();
    const observe = () => {
      io?.disconnect();
      crossing.clear();
      const line = readingLine();
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
        { root: col, rootMargin: `-${line}px 0px -${Math.max(0, col.clientHeight - line - 48)}px 0px` },
      );
      refs.current.forEach((el) => el && io?.observe(el));
    };
    observe();
    window.addEventListener("resize", observe);
    return () => {
      window.removeEventListener("resize", observe);
      io?.disconnect();
    };
  }, [total, desk, readingLine, stepAddress]);

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

  const prevStep = useCallback(() => goTo(asked.current - 1), [goTo]);
  const nextStep = useCallback(() => goTo(asked.current + 1), [goTo]);

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
  useSwipe(gridRef, { onLeft: nextStep, onRight: prevStep, enabled: total > 1 && !interactive });

  const toTop = () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });

  const toFinish = () => {
    const el = finishRef.current;
    if (!el) return;
    scrolling.current = true;
    const col = colRef.current;
    if (desk && col) col.scrollTo({ top: Math.max(0, col.scrollTop + el.getBoundingClientRect().top - col.getBoundingClientRect().top - 16), behavior: reduced ? "auto" : "smooth" });
    else window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80), behavior: reduced ? "auto" : "smooth" });
    window.setTimeout(() => (scrolling.current = false), reduced ? 50 : 900);
    el.focus({ preventScroll: true });
  };

  const variation = branch && script ? script.variations?.[branch.index] : undefined;
  const branchScript = branch && script ? variationScript(script, branch.index) : undefined;
  const showBranch = (index: number) => {
    setBranch({ index, step: 1 });
    setInteractiveAt(null);
    // The console sits beside the steps on a wide screen; elsewhere it is at the top of the page.
    if (!desk) toTop();
  };

  const prereqs = f.learnFirst.flatMap((p) => flowById(p) ?? []);
  const mine = progress.flows[f.id];
  const done = !!mine?.done;
  const furthest = Math.max(mine?.furthest ?? 0, active);
  const pathTitle = f.level ? track(f.level)?.title ?? f.level : null;
  // The next flow is always another flow: never the one being read, done or not.
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
  const stepText = <Inline text={f.steps[active - 1]?.text ?? ""} self={f.id} />;
  const pager = (variant: "bar" | "inline" | "overlay", extra?: ReactNode) =>
    total > 0 ? (
      <StepPager
        variant={variant}
        active={active}
        total={total}
        furthest={furthest}
        onPrev={prevStep}
        onNext={nextStep}
        end={end}
        text={variant === "inline" ? undefined : stepText}
        resumed={resumeShown && resumedFrom !== null ? { step: resumedFrom, onRestart: () => goTo(1) } : undefined}
        extra={extra}
      />
    ) : null;

  const chips = (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-ink-muted">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2" data-print="hide">
        {f.level && pathTitle ? <a className="hover:text-ink" href={href(operator ? "/operator" : `/path/${f.level}`)}>{pathTitle}</a> : <a className="hover:text-ink" href={href("/browse")}>Browse</a>}
        <span aria-hidden="true">/</span>
        <a className="hover:text-ink" href={href(`${operator ? "/operator" : ""}/area/${f.area}`)}>Area {f.area}</a>
      </nav>
      <span className="rounded-full bg-ink px-2.5 py-0.5 font-mono text-xs font-semibold text-primary-ink">{f.id}{f.aliases.length ? ` – ${f.aliases[f.aliases.length - 1]}` : ""}</span>
      <LevelBadge level={f.level} />
      <ReachChip reach={f.reach} />
      {done && <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success-text">Done</span>}
      {prereqs.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>Learn first:</span>
          {prereqs.map((p) => (
            <a key={p.id} href={href(`/flow/${p.id}`)} className="font-mono text-xs font-semibold text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary" aria-label={`Learn first: ${p.id} ${p.title}`}>{p.id}</a>
          ))}
        </span>
      )}
    </div>
  );
  const lead = f.whatYouLearn ? <Inline text={sentence(f.whatYouLearn)} self={f.id} /> : null;

  const steps = total > 0 && (
    <section aria-labelledby="steps-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="steps-h" className={`${ui.eyebrow} text-ink-muted`}>{total} steps</h2>
        <p className="hidden items-center gap-1.5 text-xs text-ink-muted mouse:flex" data-print="hide">
          Move with <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xxs border px-1 font-sans text-xs leading-none">←</kbd>
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xxs border px-1 font-sans text-xs leading-none">→</kbd>
        </p>
      </div>
      <ol className="mt-3 space-y-2" aria-label="Steps">
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
            onSelect={() => {
              goTo(s.n);
              // The console is at the top of a phone's page: choosing a step goes back up to watch it.
              if (!desk) toTop();
            }}
            refCb={(el) => {
              refs.current[i] = el;
            }}
          />
        ))}
      </ol>
    </section>
  );
  const about = <AboutFlow flow={f} />;
  const finish = total > 0 ? <Finish flow={f} entry={mine} next={next} sectionRef={finishRef} /> : null;
  const noSteps = total === 0 && (
    <div className="rounded-lg border bg-ground p-6">
      <p className="text-eyebrow font-semibold uppercase text-ink-muted">What the product does today</p>
      <div className="mt-2 text-ink-body">{f.stepsNote ? <Inline text={f.stepsNote} self={f.id} /> : <Blocks blocks={f.intro} self={f.id} />}</div>
    </div>
  );
  const variations = <Variations flow={f} branches={script?.variations?.map((v) => v.title) ?? []} playing={branch?.index ?? null} onShow={total > 0 ? showBranch : undefined} />;
  const stage = total > 0 && (
    <Stage
      flow={f}
      script={branchScript ?? script}
      active={branch && branchScript ? branch.step : active}
      mode={mode}
      branch={
        variation && branch
          ? { title: variation.title, step: branch.step, total: variation.steps.length, onStep: (n) => setBranch({ index: branch.index, step: n }), onClose: () => setBranch(null) }
          : undefined
      }
      captured={(n) => (branch && variation ? (n === variation.steps.length ? shotFor(f.id, `v${branch.index + 1}`) : undefined) : shotFor(f.id, n))}
      run={run}
      nav={mode === "desk" ? (extra) => pager("inline", extra) : mode === "landscape" ? (extra) => pager("overlay", extra) : undefined}
      expand={mode === "phone" ? { on: big, toggle: () => setBig((b) => !b) } : undefined}
      interactive={interactive}
      onTry={() => setInteractiveAt(active)}
      onReplay={() => {
        setInteractiveAt(null);
        setRun((r) => r + 1);
      }}
    />
  );

  if (desk) {
    return (
      // A wide screen: everything under the header, in one view — a compact title band, the console as
      // the hero with its controls pinned to its foot, and the steps and details in a column beside it.
      <article className={`${ui.container} flex h-player flex-col`} data-testid="player" data-mode="desk">
        <header className="shrink-0 py-4 xl:py-5">
          {chips}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-1">
            <h1 className="line-clamp-2 min-w-0 max-w-5xl break-words font-display text-player-title font-bold text-ink">{f.title}</h1>
            {lead && <p className="line-clamp-1 min-w-0 flex-1 basis-96 text-base text-ink-body 2xl:line-clamp-2">{lead}</p>}
          </div>
        </header>
        <div ref={gridRef} className={`grid min-h-0 flex-1 gap-6 pb-5 ${total > 0 ? "grid-cols-player 2xl:grid-cols-player-xl xl:gap-8" : ""}`}>
          {stage && <div className="flex min-h-0 min-w-0 flex-col" data-print="hide">{stage}</div>}
          <div ref={colRef} className="relative min-h-0 overflow-y-auto overscroll-contain pb-6 pr-1" data-testid="side-column">
            {noSteps}
            {steps}
            {finish}
            <div className="mt-8 space-y-6">
              {variations}
              {about}
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="w-full" style={pagerH ? ({ "--pager-h": `${pagerH}px` } as CSSProperties) : undefined} data-testid="player" data-mode={mode}>
      <div ref={gridRef}>
        {mode === "phone" ? (
          <div className={`${ui.container} pt-2`}>
            <h1 className="mb-2 truncate font-display text-base font-semibold text-ink">
              <span className="mr-2 font-mono text-xs font-semibold text-primary-link">{f.id}</span>
              {f.title}
            </h1>
            {stage}
          </div>
        ) : (
          stage && <div className="h-player-short px-2 pt-2">{stage}</div>
        )}
      </div>
      <div className={`${ui.container} pb-10`}>
        <header className="pb-6 pt-8">
          {chips}
          {mode === "landscape" && <h1 className="mt-3 break-words font-display text-title-sm font-bold text-ink">{f.title}</h1>}
          {lead && <p className="mt-3 max-w-read text-lead-sm text-ink-body">{lead}</p>}
        </header>
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            {noSteps}
            {steps}
            {finish}
          </div>
          <div className="min-w-0 space-y-6">
            {variations}
            {about}
          </div>
        </div>
      </div>
      {mode === "phone" && pager("bar") && (
        // Sticky to the bottom edge of the article: in reach of a thumb while the steps are read.
        <div ref={pagerRef} className="sticky bottom-0 z-20 mt-6">{pager("bar")}</div>
      )}
    </article>
  );
}

/** Who can do it, where it starts, what it needs, the flow's own introduction, and where it comes from. */
function AboutFlow({ flow: f }: { flow: Flow }) {
  const rows: [string, ReactNode][] = [];
  if (f.who) rows.push(["Who can do it", <><Inline text={f.who} self={f.id} />{f.roles.length > 0 && <span className="text-ink-muted"> · {f.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span>}</>]);
  if (f.startsAt) rows.push(["Starts at", <Inline text={f.startsAt} self={f.id} />]);
  if (f.needs) rows.push(["Needs", <Inline text={f.needs} self={f.id} />]);
  return (
    <section aria-labelledby="about-flow" className="rounded-lg border bg-surface p-5">
      <h2 id="about-flow" className="font-display text-lg font-semibold text-ink">About this flow</h2>
      {f.whatYouLearn && <p className="mt-2 text-sm text-ink-body"><Inline text={sentence(f.whatYouLearn)} self={f.id} /></p>}
      {rows.length > 0 && (
        <dl className="mt-4 space-y-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className={`${ui.eyebrow} text-ink-muted`}>{k}</dt>
              <dd className="mt-0.5 text-ink-body">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {f.intro.length > 0 && <div className="mt-4 text-sm"><Blocks blocks={f.intro} self={f.id} /></div>}
      <div className="mt-4 border-t pt-4 text-xs text-ink-muted" data-print="hide">
        This page is built from the flow documents, which were read from the code.
        {f.where && <> Where in the code: <Inline text={f.where} self={f.id} /></>}
      </div>
    </section>
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
    <li ref={refCb} data-step={step.n} id={`step-${step.n}`}>
      {showSection && <p className="mb-3 mt-6 text-eyebrow font-semibold uppercase text-ink-muted">{step.section}</p>}
      {/* One card, one outline: the card's own border marks the step being read, and the keyboard's focus on its button (whose ring would end above the chip). */}
      <div data-testid="step-card" className={`rounded-md border-2 bg-surface transition-colors ${active ? "border-primary shadow-card" : "border-transparent hover:border-border focus-within:border-primary"}`}>
        <button type="button" onClick={onSelect} aria-current={active ? "step" : undefined} className="flex w-full items-start gap-3 rounded-md px-4 pt-3 text-left focus-visible:ring-0 focus-visible:ring-offset-0">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors ${active ? "bg-primary text-primary-ink" : seen ? "bg-primary-tint text-primary-link" : "bg-quiet text-quiet-text"}`}>
            {step.n}
            {seen && !active && <span className="sr-only">, seen</span>}
          </span>
          <span className="min-w-0 flex-1 pt-0.5 text-base leading-relaxed text-ink">
            <Inline text={step.text} self={flow.id} />
          </span>
        </button>
        <div className="min-w-0 pb-3 pl-14 pr-4 text-sm">
          {step.children.length > 0 && <Blocks blocks={step.children} self={flow.id} />}
          {/* The live console is the rule and says so once, on its frame; a step shown another way names it. */}
          {scripted && media !== "demo" && MEDIA_LABEL[media] && (
            <p className={`mt-3 ${ui.chip}`} data-print="hide">{MEDIA_LABEL[media]}</p>
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
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="worked" className="relative mt-6 rounded-lg bg-night p-6 text-primary-ink focus:outline-none">
      <p className="text-eyebrow font-semibold uppercase text-live">You know it worked when</p>
      <p id="worked" className="mt-3 text-lead-sm">{f.workedWhen ? <Inline text={f.workedWhen} self={f.id} plainIds tone="dark" /> : "The last step above is what you see."}</p>
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
        {/* At most one filled action in the card — marking it done — so the step bar's Next stays the one primary. */}
        {done && next && (
          <a href={href(`/flow/${next.flow.id}`)} className={`${ui.lightOutline} min-w-0 px-5`}>
            <span className="truncate">Next: {next.flow.id} {next.flow.title}</span>
          </a>
        )}
        <button type="button" onClick={() => progressStore.setDone(f.id, !done)} className={done ? ui.lightOutline : ui.light} aria-pressed={done}>
          {done ? "Done ✓" : "Mark as done"}
        </button>
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
    <section>
      <details className="group rounded-lg border bg-surface" open={f.steps.length === 0}>
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-display text-lg font-semibold text-ink">
          What else can happen
          <span className="text-sm font-sans font-normal text-ink-muted group-open:hidden">Refusals, limits and other branches</span>
        </summary>
        <div className="border-t px-5 pb-5 pt-2 text-sm">
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
                      className={`${ui.small} h-auto py-2 text-left ${playing === i ? "border-primary bg-primary-tint text-primary-link" : ""}`}
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
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
    </section>
  );
}
