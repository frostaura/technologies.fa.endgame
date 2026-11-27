import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CLIENT_LEVELS, type Flow, type Step } from "../content/types.ts";
import { area as areaById, flow as flowById, isOperator, scripts, shotFor, track } from "../lib/data.ts";
import { ROLE_LABEL } from "../lib/labels.ts";
import { go, href } from "../lib/router.ts";
import { catalogue, progressStore, useProgress } from "../lib/progress.ts";
import { resumeStep, type FlowProgress } from "../progress/model.ts";
import { milestones, nextUp, trackStats, type Next } from "../progress/derive.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { useMedia, useSplit } from "../lib/media.ts";
import { SHORT_QUERY, type ConsoleSize } from "../theme/tokens.ts";
import { useSwipe } from "../lib/swipe.ts";
import { StepPager, type StageActions } from "../components/StepPager.tsx";
import { Crumbs } from "../components/PageHeader.tsx";
import { ui } from "../components/ui.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { ReachChip } from "../components/Chips.tsx";
import { sentence } from "../content/text.ts";
import { variationScript } from "../content/scripts.ts";
import { stepOf } from "../bridge/player.ts";
import { Stage, type PlayerMode, type StageStatus } from "../stage/Stage.tsx";
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
  const narrow = useMedia("(max-width: 639px)");
  const wide = useMedia("(min-width: 1024px)");
  const mode: PlayerMode = short && !wide ? "landscape" : split ? "desk" : narrow ? "phone" : "tablet";
  // One fixed console per device: a laptop's for a desk or tablet, a phone's for a phone either
  // way up — and a phone's at every size for a flow about the phone itself.
  const device: ConsoleSize = script?.device ?? (mode === "phone" || mode === "landscape" ? "phone" : "desk");
  // The larger console (a phone): the stage over the whole screen, with a visible close.
  const [big, setBig] = useState(false);
  const [status, setStatus] = useState<StageStatus>({ frame: "loading", live: false, replayable: false });
  // "Done" is celebrated once the learner finishes here (or had finished before), never on arrival.
  const [doneAtOpen] = useState(() => !!progressStore.get().progress.flows[f.id]?.done);
  const [finishedHere, setFinishedHere] = useState(false);
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

  // On a phone or tablet the controls are fixed to the bottom edge: the page leaves their height
  // free under its last line, so the footer is never under them.
  useEffect(() => {
    if (mode !== "phone" && mode !== "tablet") return;
    document.body.style.paddingBottom = `${pagerH}px`;
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [mode, pagerH]);

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
    setFinishedHere(true);
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
  const celebrate = !!mine?.done && (doneAtOpen || finishedHere);
  const furthest = Math.max(mine?.furthest ?? 0, active);
  const pathTitle = f.level ? track(f.level)?.title ?? f.level : null;
  // The next flow is always another flow: never the one being read, done or not.
  const next = nextUp(progress, f.level ? track(f.level) : undefined, catalogue, f.id);

  const endClass = `${ui.primary} w-full min-w-0 px-3`;
  const end = atEnd && next ? (
    <a href={href(`/flow/${next.flow.id}`)} className={endClass} aria-label={`Next flow: ${next.flow.id} ${next.flow.title}`}>
      <span className="truncate">Next: {next.flow.id}</span>
    </a>
  ) : atEnd ? (
    <a href={href("/progress")} className={endClass}><span className="truncate">Your progress</span></a>
  ) : (
    <button type="button" onClick={toFinish} className={endClass}>Finish</button>
  );
  const stepText = <Inline text={f.steps[active - 1]?.text ?? ""} self={f.id} />;
  // What the step's ring is about, in the script's words: beside the frame of a phone on its side.
  const played = stepOf(branchScript ?? script, branch && branchScript ? branch.step : active);
  const stepNote = played?.note ?? (played?.kind === "demo" ? played.highlight?.note : undefined);
  const actions: StageActions = {
    onTry: () => setInteractiveAt(active),
    canTry: status.live && status.frame === "ready",
    trying: interactive,
    onReplay: () => {
      setInteractiveAt(null);
      setRun((r) => r + 1);
    },
    canReplay: status.replayable && !interactive,
  };
  const pager = (variant: "bar" | "inline" | "side") =>
    total > 0 ? (
      <StepPager
        variant={variant}
        active={active}
        total={total}
        furthest={furthest}
        onPrev={prevStep}
        onNext={nextStep}
        end={end}
        actions={branch ? undefined : actions}
        resumed={resumeShown && resumedFrom !== null ? { step: resumedFrom, onRestart: () => goTo(1) } : undefined}
      />
    ) : null;

  const areaInfo = areaById(f.area);
  const crumbs = [
    f.level && pathTitle ? { label: pathTitle, to: operator ? "/operator" : `/path/${f.level}` } : { label: "Browse", to: "/browse" },
    { label: areaInfo?.title ?? `Area ${f.area}`, to: `${operator ? "/operator" : ""}/area/${f.area}` },
  ];
  const chips = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
      <span data-print="hide"><Crumbs items={[...crumbs, { label: f.id }]} /></span>
      {f.aliases.length > 0 && <span className={ui.chip}>also {f.aliases[f.aliases.length - 1]}</span>}
      {f.reach !== "screen" && <ReachChip reach={f.reach} />}
      {celebrate && <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success-text">Done</span>}
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
  // A kind named under a step only where a flow shows its steps more than one way.
  const kinds = new Set(f.steps.map((s) => mediaOf(f, script, s.n)));

  const steps = total > 0 && (
    <section aria-labelledby="steps-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="steps-h" className={`${ui.eyebrow} text-ink-muted`}>{total === 1 ? "1 step" : `${total} steps`}</h2>
        <p className="hidden items-center gap-1.5 text-xs text-ink-muted mouse:flex" data-print="hide">
          Move with <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs border px-1.5 font-sans text-sm leading-none text-ink">←</kbd>
          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs border px-1.5 font-sans text-sm leading-none text-ink">→</kbd>
        </p>
      </div>
      <ol className="mt-3 space-y-2" aria-label="Steps">
        {f.steps.map((s, i) => (
          <StepCard
            key={s.n}
            step={s}
            flow={f}
            media={mediaOf(f, script, s.n)}
            labelKind={kinds.size > 1}
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
  const finish = total > 0 ? <Finish flow={f} entry={mine} celebrate={celebrate} next={next} sectionRef={finishRef} /> : null;
  const noSteps = total === 0 && (
    <div className="rounded-lg border bg-surface p-6">
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
      device={device}
      branch={
        variation && branch
          ? { title: variation.title, step: branch.step, total: variation.steps.length, onStep: (n) => setBranch({ index: branch.index, step: n }), onClose: () => setBranch(null) }
          : undefined
      }
      captured={(n) => (branch && variation ? (n === variation.steps.length ? shotFor(f.id, `v${branch.index + 1}`) : undefined) : shotFor(f.id, n))}
      run={run}
      nav={mode === "desk" ? pager("inline") : big ? pager("side") : undefined}
      big={big}
      onBig={mode === "phone" ? setBig : undefined}
      stepText={stepText}
      onStatus={setStatus}
      reserve={mode === "phone" || mode === "tablet" ? pagerH || 64 : 0}
      interactive={interactive}
      onTry={() => setInteractiveAt(active)}
      onBack={() => {
        setInteractiveAt(null);
        setRun((r) => r + 1);
      }}
    />
  );
  const title = (size: string) => (
    <h1 className={`min-w-0 text-balance break-words font-display font-bold text-ink ${size}`}>{f.title}</h1>
  );

  if (desk) {
    return (
      // A wide screen: everything under the header, in one view — a compact title band, the console as
      // the hero with its caption and controls under it, and the steps and details in a column beside it.
      <article className={`${ui.container} flex h-player flex-col`} data-testid="player" data-mode="desk">
        <header className="shrink-0 py-3 xl:py-4">
          {chips}
          <div className="mt-1.5">{title("line-clamp-2 max-w-5xl text-player-title")}</div>
          {/* On a window of laptop height the lede goes to the top of the side column, so the console keeps the height. */}
          {lead && <p className="mt-1 line-clamp-2 max-w-5xl text-pretty text-base text-ink-body compact:hidden">{lead}</p>}
        </header>
        <div ref={gridRef} className={`grid min-h-0 flex-1 gap-6 pb-4 ${total > 0 ? "grid-cols-player-sm 2xl:grid-cols-player-xl xl:gap-8" : ""}`}>
          {stage && <div className="flex min-h-0 min-w-0 flex-col" data-print="hide">{stage}</div>}
          <div className="relative min-h-0">
            <div ref={colRef} className="h-full overflow-y-auto overscroll-contain pb-6 pr-1 pt-2" data-testid="side-column">
              {lead && <p className="mb-5 hidden text-pretty text-base text-ink-body compact:block">{lead}</p>}
              {noSteps}
              {steps}
              {finish}
              <div className="mt-8 space-y-6">
                {variations}
                {about}
              </div>
            </div>
            {/* The column scrolls on its own: its ends fade, so no line is cut hard at the top or the foot. */}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-surface to-surface/0" aria-hidden="true" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-surface/0" aria-hidden="true" />
          </div>
        </div>
      </article>
    );
  }

  if (mode === "landscape") {
    return (
      // A phone on its side: the frame takes the whole height (the site's header steps aside), and a
      // slim strip beside it carries the way back, the title, the step's words and the controls.
      <article className="w-full" data-testid="player" data-mode="landscape">
        <div ref={gridRef} className="flex h-screen-d justify-center gap-5 py-2 pl-safe-l pr-safe-r">
          <div className="w-phone-side shrink-0 pl-2">{stage}</div>
          <aside className="flex min-w-0 max-w-xl flex-1 flex-col gap-2 py-1 pr-3" aria-label="This step">
            <a href={href(operator ? "/operator" : f.level ? `/path/${f.level}` : "/learn")} className={`${ui.textLink} inline-flex min-h-touch items-center text-sm`}>← {pathTitle ?? "Academy"}</a>
            {title("line-clamp-2 text-base leading-snug")}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border bg-surface p-3 text-sm text-ink" data-testid="caption-strip">
              <p className="flex items-start gap-2" aria-live="polite" data-testid="caption">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-ink" aria-hidden="true">{branch ? branch.step : active}</span>
                <span className="min-w-0">{branch && variation ? <Inline text={stepNote ?? variation.title} self={f.id} /> : stepText}</span>
              </p>
              {!branch && stepNote && <p className="mt-2 text-ink-muted"><Inline text={stepNote} self={f.id} /></p>}
            </div>
            {pager("side")}
          </aside>
        </div>
        <div className={`${ui.container} pb-10 pt-6`}>
          {chips}
          {lead && <p className="mt-3 max-w-read text-lead-sm text-ink-body">{lead}</p>}
          <div className="mt-6 grid gap-10 lg:grid-cols-2">
            <div className="min-w-0">{noSteps}{steps}{finish}</div>
            <div className="min-w-0 space-y-6">{variations}{about}</div>
          </div>
        </div>
      </article>
    );
  }

  // A phone or a tablet held upright: the title in full, the frame as the hero, its caption under
  // it, then the steps; the controls fixed to the bottom edge, in reach of a thumb.
  return (
    <article className="w-full" data-testid="player" data-mode={mode}>
      <div ref={gridRef} className={`${ui.container} pt-3`}>
        {mode === "tablet" && <div className="mb-2">{chips}</div>}
        <div className="mb-3 flex items-start gap-2">
          {mode === "phone" && <span className="mt-1 shrink-0 rounded-full bg-ink px-2 py-0.5 font-mono text-xs font-semibold text-primary-ink">{f.id}</span>}
          {title(mode === "tablet" ? "text-title-sm" : "text-player-title-sm")}
        </div>
        {mode === "tablet" && lead && <p className="-mt-1 mb-3 max-w-read text-pretty text-base text-ink-body">{lead}</p>}
        {stage}
      </div>
      <div className={`${ui.container} pb-10`}>
        {mode === "phone" && (
          <header className="pb-4 pt-6">
            {chips}
            {lead && <p className="mt-3 max-w-read text-pretty text-lead-sm text-ink-body">{lead}</p>}
          </header>
        )}
        <div className={`grid gap-10 lg:grid-cols-2 ${mode === "tablet" ? "pt-8" : ""}`}>
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
      {pager("bar") && !big && (
        <div ref={pagerRef} className="fixed inset-x-0 bottom-0 z-30">{pager("bar")}</div>
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

function StepCard({ step, flow, media, labelKind, scripted, active, seen, showSection, onSelect, refCb }: {
  step: Step;
  flow: Flow;
  media: Media;
  labelKind: boolean;
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
      {/* The step being read has the card's outline; the keyboard's focus is a separate ring set off the card, so the two never look alike. */}
      <div data-testid="step-card" className={`rounded-md border-2 bg-surface transition-colors ${active ? "border-primary shadow-card" : "border-transparent hover:border-border"}`}>
        <button type="button" onClick={onSelect} aria-current={active ? "step" : undefined} className="flex w-full items-start gap-3 rounded-md px-4 pt-3 text-left focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink focus-visible:ring-0 focus-visible:ring-offset-0">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors ${active ? "bg-primary text-primary-ink" : seen ? "bg-primary-tint text-primary-link" : "bg-quiet text-quiet-text"}`}>
            {step.n}
            {seen && !active && <span className="sr-only">, seen</span>}
          </span>
          <span className="min-w-0 flex-1 pt-0.5 text-base leading-relaxed text-ink [&_strong]:font-medium">
            <Inline text={step.text} self={flow.id} />
          </span>
        </button>
        <div className="min-w-0 pb-3 pl-14 pr-4 text-sm">
          {step.children.length > 0 && <Blocks blocks={step.children} self={flow.id} />}
          {/* A kind is named only where a flow shows its steps more than one way. */}
          {labelKind && scripted && media !== "demo" && MEDIA_LABEL[media] && (
            <p className={`mt-3 ${ui.chip}`} data-print="hide">{MEDIA_LABEL[media]}</p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The end of a flow: how to know it worked, then — once the learner has finished it here, or had
 * before — the moment that says so, what it added up to, and the next flow one tap away. A light
 * card with the one accent, as every card in the academy.
 */
function Finish({ flow: f, entry, celebrate, next, sectionRef }: { flow: Flow; entry: FlowProgress | undefined; celebrate: boolean; next: Next | undefined; sectionRef: RefObject<HTMLElement | null> }) {
  const progress = useProgress();
  const done = !!entry?.done;
  const t = f.level ? track(f.level) : undefined;
  const stats = t ? trackStats(progress, t) : undefined;
  const earnedNow = celebrate && entry?.doneAt
    ? milestones(progress, catalogue, CLIENT_LEVELS).filter((m) => m.earned && m.at === entry.doneAt && !isOperator(f))
    : [];
  const summary = stats ? `${stats.done} of ${stats.total} on ${t?.title ?? f.level}${stats.complete ? ": path complete" : ""}` : "";
  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="worked" className="relative mt-6 rounded-lg border bg-surface p-6 shadow-card focus:outline-none" data-testid="worked">
      <p className="text-eyebrow font-semibold uppercase text-primary-link">You know it worked when</p>
      <p id="worked" className="mt-3 text-lead-sm text-ink">{f.workedWhen ? <Inline text={f.workedWhen} self={f.id} plainIds /> : "The last step above is what you see."}</p>
      <p role="status" className="sr-only">{celebrate ? `Flow done. ${summary}.` : ""}</p>
      {celebrate && (
        <div className="mt-6 flex items-start gap-4 border-t pt-6" data-print="hide" data-testid="flow-done">
          <span className="flex h-medal w-medal shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary-link" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="min-w-0">
            <p className="font-display text-2xl font-semibold text-ink">Done</p>
            {summary && <p className="mt-1 text-sm text-ink-muted">{summary}</p>}
            {earnedNow.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Milestones earned">
                {earnedNow.map((m) => (
                  <li key={m.id} className="rounded-full border border-primary-line px-3 py-1 text-xs font-semibold text-primary-link">Milestone: {m.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3" data-print="hide">
        {/* The step bar's Next stays the one filled action: here the next flow is a link that wraps, never cut. */}
        {celebrate && next && (
          <a href={href(`/flow/${next.flow.id}`)} className={`${ui.textLink} min-w-0 py-2 text-base`}>
            Next: {next.flow.id} {next.flow.title} →
          </a>
        )}
        {done ? (
          <button type="button" onClick={() => progressStore.setDone(f.id, false)} className={`${ui.textLink} min-h-touch text-sm text-ink-muted`} aria-pressed>
            Mark as not done
          </button>
        ) : (
          <button type="button" onClick={() => progressStore.setDone(f.id, true)} className={ui.quiet} aria-pressed={false}>
            Mark as done
          </button>
        )}
        {!next && f.level && (
          <a href={href("/progress")} className={ui.quiet}>{stats?.complete ? "Path complete: your progress" : "Your progress"}</a>
        )}
      </div>
      {celebrate && next?.before && <p className="mt-3 text-sm text-ink-muted" data-print="hide">{next.flow.id} is a “learn first” for {next.before.id}, the next flow on this path.</p>}
    </section>
  );
}

function Variations({ flow: f, branches, playing, onShow }: { flow: Flow; branches: string[]; playing: number | null; onShow?: (index: number) => void }) {
  if (!f.variations.length && !f.extras.length && !branches.length) return null;
  return (
    <section>
      <details className="group rounded-lg border bg-surface" open={f.steps.length === 0}>
        <summary className="flex min-h-touch cursor-pointer list-none flex-col justify-center gap-0.5 px-5 py-3">
          <span className="font-display text-lg font-semibold text-ink">What else can happen</span>
          <span className="text-sm text-ink-muted group-open:hidden">Refusals, limits and other branches</span>
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
