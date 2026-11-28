import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Flow } from "../content/types.ts";
import type { ScriptStep, StepScript } from "../content/scripts.ts";
import type { BridgeState } from "../bridge/bridge.ts";
import { plan, planExplore, stepOf } from "../bridge/player.ts";
import { codeAddress, mediaOf } from "./media.ts";
import { DemoFrame, FrameChrome, type FrameRequest } from "./DemoFrame.tsx";
import { Terminal } from "./Terminal.tsx";
import { RequestPanel } from "./RequestPanel.tsx";
import { EmailCard } from "./EmailCard.tsx";
import { CodePanel } from "./CodePanel.tsx";
import { Facts } from "./Facts.tsx";
import { fitFrame, type FrameFit } from "./geometry.ts";
import { Inline } from "../components/Inline.tsx";
import { shotFor } from "../lib/data.ts";
import { ui } from "../components/ui.ts";
import type { ConsoleSize } from "../theme/tokens.ts";

/** Said once a visit, the first time the live console cannot be reached. */
let toldUnavailable = false;

/** A branch from "What else can happen" being played instead of the flow's own steps. */
export interface Branch {
  title: string;
  step: number;
  total: number;
  onStep: (n: number) => void;
  onClose: () => void;
}

/**
 * How the player is laid out: `desk`, the frame beside a side column with everything in view;
 * `tablet`, a tablet held upright, the desk's console across the page with the steps under it;
 * `phone`, a phone held upright, the phone frame as the hero; `landscape`, a phone on its side,
 * the frame the whole height with a slim strip of controls beside it.
 */
export type PlayerMode = "desk" | "tablet" | "phone" | "landscape";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const EXPAND = "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5";
const CLOSE = "M6 6l12 12M18 6 6 18";

/** What the stage tells the page about itself: whether the live console is up, and whether this step can be handed over. */
export interface StageStatus {
  frame: BridgeState;
  /** The step is the live console (so "Try it yourself" applies). */
  live: boolean;
  /** The step has something to play again. */
  replayable: boolean;
}

export function Stage({ flow, script, active, run, interactive, onTry, onBack, branch, nav, mode, device, big = false, onBig, stepText, onStatus, reserve = 0, captured = (n) => shotFor(flow.id, n) }: {
  flow: Flow;
  script: StepScript | undefined;
  active: number;
  /** Bumped by "Show me again". */
  run: number;
  interactive: boolean;
  onTry: () => void;
  /** Ends "Try it yourself": the console goes back to the lesson's step. */
  onBack: () => void;
  branch?: Branch;
  /** Previous, the step bar, the actions and Next, under the caption (desk and tablet, and the larger console). */
  nav?: ReactNode;
  mode: PlayerMode;
  /** Which fixed console this flow is taught on. */
  device: ConsoleSize;
  /** The larger console (phone): the stage over the whole screen, with a visible close. */
  big?: boolean;
  onBig?: (on: boolean) => void;
  /** The flow's own words for this step: the caption on a phone, where the steps are not beside the frame. */
  stepText?: ReactNode;
  onStatus?: (s: StageStatus) => void;
  /** On a phone or tablet held upright: the height kept free under the frame for the controls fixed to the bottom edge. */
  reserve?: number;
  /** The image captured for a step (`make academy-shots`), shown when the live console cannot load. */
  captured?: (n: number) => string | undefined;
}) {
  const [frameState, setFrameState] = useState<BridgeState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [notice] = useState(() => !toldUnavailable);
  const [route, setRoute] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const media = mediaOf(flow, script, active);
  const usesFrame = useMemo(() => flow.steps.some((s) => mediaOf(flow, script, s.n) === "demo"), [flow, script]);
  const played = useRef(0);
  const lastRun = useRef(run);
  // A variation swaps the script being played: the console then starts again from its start.
  const lastScript = useRef(script);
  const [request, setRequest] = useState<FrameRequest | null>(null);
  const step: ScriptStep | undefined = stepOf(script, active);
  const marker = branch ? branch.step : active;

  // The frame's size: the space it is given, measured, and the device's fixed console fitted into it.
  const slot = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FrameFit | null>(null);
  const fill = mode === "desk" || mode === "landscape" || big;
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // On a phone or tablet held upright the frame takes the height the screen leaves it: the
      // window, less what is above it on arrival and the caption and the bar below it.
      const below = (mode === "phone" ? 60 : 76) + 10 + reserve + 8;
      const top = r.top + window.scrollY;
      const height = fill ? r.height : Math.max(mode === "tablet" ? 360 : 300, window.innerHeight - top - below);
      setFit(fitFrame({ width: r.width, height }, device));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [device, fill, mode, reserve]);

  useEffect(() => {
    if (!usesFrame || media !== "demo") return;
    const replay = lastRun.current !== run || lastScript.current !== script;
    lastRun.current = run;
    lastScript.current = script;
    const ops = script ? plan(script, played.current, active, replay) : played.current ? [] : planExplore(flow.startRoute ?? "/");
    played.current = active;
    // A spotlight carries the step's number for its ring, and never its words: those are set in the
    // strip under the frame, so nothing is written over the console.
    const spot = (args: Record<string, unknown>) => Object.fromEntries(Object.entries({ ...args, marker }).filter(([k]) => k !== "note"));
    if (ops.length) setRequest({ key: `${flow.id}:${active}:${run}:${attempt}`, ops: ops.map((o) => (o.op === "highlight" && !o.catchUp ? { ...o, args: spot(o.args) } : o)) });
    // The step's words are read again from their start.
    setExpanded(false);
  }, [active, run, media, usesFrame, script, flow, marker, attempt]);

  const unavailable = frameState === "unavailable";
  useEffect(() => {
    if (unavailable) toldUnavailable = true;
  }, [unavailable]);
  const showFrame = usesFrame && media === "demo" && !unavailable;
  const replayable = media === "terminal" || media === "code" || (media === "demo" && !!script);
  useEffect(() => {
    onStatus?.({ frame: frameState, live: showFrame, replayable });
  }, [frameState, showFrame, replayable, onStatus]);

  const highlightNote = step?.kind === "demo" ? step.highlight?.note : undefined;
  const note = step?.note ?? highlightNote;
  const capturedFile = captured(active);
  const shot = step?.kind === "image" ? { file: step.file, alt: step.alt } : step?.kind === "demo" ? (step.shot ?? (capturedFile ? { file: capturedFile, alt: note ?? flow.title } : undefined)) : undefined;

  // One caption, in one strip under the frame at every size, never over the console: the step's
  // number (the same number the ring carries), then what to look at. On a phone the flow's own words
  // for the step lead, since the steps are not beside the frame; the note follows when opened.
  const phoneWords = mode === "phone" || mode === "landscape";
  const lead: ReactNode = unavailable && notice && media === "demo"
    ? "The live console could not be loaded here, so this step shows its picture and its words."
    : interactive
      ? null
      : phoneWords && !branch
        ? stepText ?? (note ? <Inline text={note} self={flow.id} /> : null)
        : note
          ? <Inline text={note} self={flow.id} />
          : showFrame && !script
            ? "This is the screen the flow starts on. Try it yourself to explore."
            : stepText ?? null;
  const more = phoneWords && !branch && note && stepText ? <Inline text={note} self={flow.id} /> : null;

  const address = media === "demo" ? `endgame${route && !route.startsWith("/__app/") ? route : ""}`
    : step?.kind === "terminal" ? `terminal · ${step.cwd ?? "technologies.fa.endgame"}`
      : step?.kind === "request" ? `request · ${step.method} ${step.path}`
        : step?.kind === "email" ? `inbox · ${step.to}`
          : step?.kind === "code" ? codeAddress(step)
            : step?.kind === "image" ? "picture" : "about this flow";

  const banner = branch && (
    <div role="group" aria-label="What else can happen" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-attention-line bg-attention-wash px-4 py-2" data-print="hide">
      <p className="min-w-0 flex-1 text-sm text-ink">
        <span className="text-eyebrow font-semibold uppercase text-attention-text">What else can happen</span>{" "}
        <span className="font-semibold">{branch.title}</span>
        {branch.total > 1 && <span className="text-ink-muted"> · step {branch.step} of {branch.total}</span>}
      </p>
      <span className="flex gap-2">
        {branch.total > 1 && (
          <>
            <button type="button" disabled={branch.step <= 1} onClick={() => branch.onStep(branch.step - 1)} className={ui.small}>Previous</button>
            <button type="button" disabled={branch.step >= branch.total} onClick={() => branch.onStep(branch.step + 1)} className={ui.small}>Next</button>
          </>
        )}
        <button type="button" onClick={branch.onClose} className={ui.small}>Back to the steps</button>
      </span>
    </div>
  );

  const frame = fit && (
    <FrameChrome fit={fit} address={address} status={media === "demo" ? (interactive ? "You're driving" : "Live") : undefined} busy={busy} on={frameState === "ready"} accent={interactive}>
      {usesFrame && !unavailable && (
        // Kept drawn at its full size under any other kind of step, so the console never reflows.
        <div className={`absolute inset-0 ${showFrame ? "" : "invisible"}`} aria-hidden={!showFrame || undefined}>
          <DemoFrame key={attempt} request={request} interactive={interactive} onState={setFrameState} onTry={onTry} name={`Live demo console: ${flow.title}`} fit={fit} onRoute={setRoute} onBusy={setBusy} />
        </div>
      )}
      {step?.kind === "terminal" && <Terminal key={`${active}-${run}`} step={step} />}
      {step?.kind === "request" && <RequestPanel step={step} />}
      {step?.kind === "email" && <EmailCard step={step} />}
      {step?.kind === "code" && <CodePanel key={`${active}-${run}`} step={step} />}
      {shot && (media === "image" || (media === "demo" && unavailable)) && (
        <figure className="absolute inset-0 bg-surface">
          <img src={`./shots/${shot.file}`} alt={shot.alt} className="h-full w-full object-cover object-top" />
        </figure>
      )}
      {(media === "facts" || (media === "demo" && unavailable && !shot)) && <Facts flow={flow} />}
      {media === "demo" && unavailable && (
        <button type="button" onClick={() => { setFrameState("loading"); setAttempt((n) => n + 1); played.current = 0; }} className={`${ui.small} absolute bottom-3 right-3 bg-surface shadow-card`}>Try again</button>
      )}
    </FrameChrome>
  );

  const strip = (
    <div className={`flex shrink-0 items-start gap-3 rounded-md border bg-surface px-3 py-2.5 ${phoneWords ? (expanded ? "min-h-caption-sm w-full" : "h-caption-sm w-full") : "h-caption compact:h-caption-sm"} ${interactive ? "border-primary bg-primary-tint" : ""}`} style={fit && !phoneWords ? { width: `${fit.width}px`, maxWidth: "100%" } : undefined} data-testid="caption-strip" data-print="hide">
      {interactive ? (
        <>
          <p className="min-w-0 flex-1 self-center text-sm text-ink" aria-live="polite" data-testid="caption">
            <span className="font-semibold">You're driving.</span> Click around the console; nothing you do here is kept.
          </p>
          <button type="button" onClick={onBack} className={`${ui.primary} shrink-0 self-center px-4`}>Back to the lesson</button>
        </>
      ) : (
        <>
          <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-ink" aria-hidden="true">{marker}</span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm leading-snug text-ink ${expanded ? "" : phoneWords ? "line-clamp-2" : "line-clamp-3 compact:line-clamp-2"}`} aria-live="polite" data-testid="caption">{lead}</p>
            {expanded && more && <p className="mt-2 text-sm leading-snug text-ink-muted">{more}</p>}
          </div>
          {phoneWords && (lead || more) && (
            <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="-my-1 inline-flex min-h-touch shrink-0 items-center px-1 text-sm font-medium text-primary-link">
              {expanded ? "Less" : "More"}
            </button>
          )}
          {onBig && !big && (
            <button type="button" onClick={() => onBig(true)} className={`${ui.icon} -my-2 -mr-2`} aria-label="Larger console">
              <Icon d={EXPAND} />
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={big ? "fixed inset-0 z-50 flex flex-col gap-2 bg-surface px-3 pb-safe-b pt-2" : `flex min-h-0 flex-col gap-2.5 ${fill ? "h-full" : ""}`} data-testid="stage" data-mode={mode} data-big={big || undefined} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? `Larger console: ${flow.title}` : undefined}>
      {big && (
        <div className="flex shrink-0 items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-ink">{flow.title}</p>
          <button type="button" onClick={() => onBig?.(false)} className={`${ui.quiet} shrink-0 px-4`} autoFocus>
            <Icon d={CLOSE} />
            Close
          </button>
        </div>
      )}
      {banner}
      <div ref={slot} className={`relative min-w-0 ${fill ? "min-h-0 flex-1" : ""}`} style={!fill && fit ? { height: `${fit.height}px` } : undefined} data-testid="stage-media">
        {frame}
      </div>
      {/* A phone on its side gives the frame the whole height: the step's words are in the strip beside it. */}
      {(mode !== "landscape" || big) && <div className="flex shrink-0 justify-center">{strip}</div>}
      {/* Under the frame and as wide as it (or as wide as the controls need), so the three line up. */}
      {nav && (
        <div className="mx-auto w-full shrink-0" style={fit && !big ? { maxWidth: `${Math.max(fit.width, 720)}px` } : undefined} data-print="hide">
          {nav}
        </div>
      )}
    </div>
  );
}
