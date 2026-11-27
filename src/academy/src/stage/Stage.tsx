import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Flow } from "../content/types.ts";
import type { ScriptStep, StepScript } from "../content/scripts.ts";
import type { BridgeState } from "../bridge/bridge.ts";
import { plan, planExplore, stepOf } from "../bridge/player.ts";
import { mediaOf } from "./media.ts";
import { DemoFrame, type FrameRequest } from "./DemoFrame.tsx";
import { Terminal } from "./Terminal.tsx";
import { RequestPanel } from "./RequestPanel.tsx";
import { EmailCard } from "./EmailCard.tsx";
import { CodePanel } from "./CodePanel.tsx";
import { Facts } from "./Facts.tsx";
import { Inline } from "../components/Inline.tsx";
import { shotFor } from "../lib/data.ts";
import { ui } from "../components/ui.ts";

/** Said once a visit, the first time the live console cannot be reached. */
let toldUnavailable = false;

/**
 * The sticky panel beside a flow's steps: the live console, or whatever truly shows the step — a
 * terminal, a request, an e-mail, a captured image — or, with nothing to show, the flow's facts.
 */
/** A branch from "What else can happen" being played instead of the flow's own steps. */
export interface Branch {
  title: string;
  step: number;
  total: number;
  onStep: (n: number) => void;
  onClose: () => void;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const HAND = "M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 15";
const AGAIN = "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4";

/**
 * How the player is laid out: `desk`, the console beside a side column with everything in view;
 * `phone`, a phone or tablet held upright, the console on top with its caption under it; `landscape`,
 * a short window, the console the whole height with a slim step bar over its foot.
 */
export type PlayerMode = "desk" | "phone" | "landscape";

/** A labelled control in the stage's action row: one style for every action. */
function Action({ onClick, icon, label, short, pressed }: { onClick: () => void; icon: string; label: string; short?: string; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={short ? label : undefined} className={`${ui.small} ${pressed ? "border-primary bg-primary-tint text-primary-link" : ""}`}>
      <Icon d={icon} />
      {short ? <><span className="sm:hidden" aria-hidden="true">{short}</span><span className="hidden sm:inline" aria-hidden="true">{label}</span></> : label}
    </button>
  );
}

export function Stage({ flow, script, active, run, interactive, onTry, onReplay, branch, nav, mode, expand, captured = (n) => shotFor(flow.id, n) }: {
  flow: Flow;
  script: StepScript | undefined;
  active: number;
  /** Bumped by "Show me again". */
  run: number;
  interactive: boolean;
  onTry: () => void;
  onReplay: () => void;
  branch?: Branch;
  /** Previous, the step bar and Next: pinned to the stage's bottom edge on a wide screen, over its foot on a short one. */
  nav?: ReactNode;
  mode: PlayerMode;
  /** On a phone: the console enlarged to the whole screen under the header, or back to sharing it. */
  expand?: { on: boolean; toggle: () => void };
  /** The image captured for a step (`make academy-shots`), shown when the live console cannot load. */
  captured?: (n: number) => string | undefined;
}) {
  const [frameState, setFrameState] = useState<BridgeState>("loading");
  const [notice] = useState(() => !toldUnavailable);
  const media = mediaOf(flow, script, active);
  const usesFrame = useMemo(() => flow.steps.some((s) => mediaOf(flow, script, s.n) === "demo"), [flow, script]);
  const played = useRef(0);
  const lastRun = useRef(run);
  // A variation swaps the script being played: the console then starts again from its start.
  const lastScript = useRef(script);
  const [request, setRequest] = useState<FrameRequest | null>(null);
  // Whether the console drew this step's spotlight; a spotlight it could not find leaves its words to the caption here.
  const [spot, setSpot] = useState<{ key: string; found: boolean } | null>(null);
  const step: ScriptStep | undefined = stepOf(script, active);
  // On a phone held upright the note is set under the console, never over it: the console keeps every pixel.
  const noteInFrame = mode !== "phone";
  const modeRef = useRef(noteInFrame);
  useEffect(() => {
    modeRef.current = noteInFrame;
  }, [noteInFrame]);

  useEffect(() => {
    if (!usesFrame || media !== "demo") return;
    const replay = lastRun.current !== run || lastScript.current !== script;
    lastRun.current = run;
    lastScript.current = script;
    const planned = script ? plan(script, played.current, active, replay) : played.current ? [] : planExplore(flow.startRoute ?? "/");
    const ops = modeRef.current ? planned : planned.map((o) => (o.op === "highlight" && "note" in o.args ? { ...o, args: Object.fromEntries(Object.entries(o.args).filter(([k]) => k !== "note")) } : o));
    played.current = active;
    if (ops.length) setRequest({ key: `${flow.id}:${active}:${run}`, ops });
  }, [active, run, media, usesFrame, script, flow]);

  const unavailable = frameState === "unavailable";
  useEffect(() => {
    if (unavailable) toldUnavailable = true;
  }, [unavailable]);
  const highlightNote = step?.kind === "demo" ? step.highlight?.note : undefined;
  const caption = step?.note ?? highlightNote;
  const capturedFile = captured(active);
  const shot = step?.kind === "image" ? { file: step.file, alt: step.alt } : step?.kind === "demo" ? (step.shot ?? (capturedFile ? { file: capturedFile, alt: caption ?? flow.title } : undefined)) : undefined;
  const showFrame = usesFrame && media === "demo" && !unavailable;
  const key = `${flow.id}:${active}:${run}`;
  const lost = spot?.key === key && !spot.found;
  // The caption is shown once: inside the console beside what it names, or here when it cannot be (a phone, a
  // step with nothing to ring, a step whose words are its own rather than its spotlight's).
  const below = !showFrame
    ? caption
    : step?.note && step.note !== highlightNote
      ? step.note
      : highlightNote && (!noteInFrame || lost)
        ? highlightNote
        : undefined;
  const words = unavailable && notice && media === "demo"
    ? "The live console could not be loaded here, so this flow shows its steps and facts instead."
    : below
      ? <Inline text={below} self={flow.id} />
      : showFrame && interactive
        ? "The console is yours: tap around. “Show me again” puts it back on this step."
        : showFrame && !script
          ? "This is the screen the flow starts on. Try it yourself to explore."
          : null;
  const replayable = media === "terminal" || media === "request" || media === "email" || media === "code";
  const actions = (
    <>
      {showFrame && !interactive && <Action onClick={onTry} icon={HAND} label="Try it yourself" short="Try it" />}
      {showFrame && script && <Action onClick={onReplay} icon={AGAIN} label="Show me again" short="Replay" />}
      {replayable && <Action onClick={onReplay} icon={AGAIN} label="Play again" short="Replay" />}
      {expand && (
        <Action
          onClick={expand.toggle}
          pressed={expand.on}
          icon={expand.on ? "M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" : "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"}
          label={expand.on ? "Smaller console" : "Larger console"}
          short={expand.on ? "Smaller" : "Larger"}
        />
      )}
    </>
  );
  const banner = branch && (
    <div role="group" aria-label="What else can happen" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-attention-wash px-4 py-2" data-print="hide">
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
  const picture = (
    // On a phone the console (or its picture) takes its share of the height; a terminal, request, code or e-mail is as tall as what it shows.
    <div className={`relative min-h-0 min-w-0 ${mode === "phone" ? (replayable ? "" : expand?.on ? "h-stage-full" : "h-frame-phone") : "flex-1"}`} data-testid="stage-media">
      {usesFrame && (
        <div className={showFrame ? "h-full" : "hidden"}>
          <DemoFrame request={request} interactive={interactive} onState={setFrameState} onTry={onTry} name={`Live demo console: ${flow.title}`} onSpotlight={(k, found) => setSpot({ key: k, found })} />
        </div>
      )}
      {step?.kind === "terminal" && <Terminal key={`${active}-${run}`} step={step} />}
      {step?.kind === "request" && <RequestPanel step={step} />}
      {step?.kind === "email" && <EmailCard step={step} />}
      {step?.kind === "code" && <CodePanel key={`${active}-${run}`} step={step} />}
      {shot && (media === "image" || (media === "demo" && unavailable)) && (
        <figure className="flex h-full flex-col overflow-hidden rounded-lg border bg-ground shadow-raised">
          <img src={`./shots/${shot.file}`} alt={shot.alt} className="min-h-0 flex-1 object-contain object-top" />
        </figure>
      )}
      {(media === "facts" || (media === "demo" && unavailable && !shot)) && <Facts flow={flow} />}
      {mode === "landscape" && nav && (
        // A short window: the steps ride over the console's foot, slim, so the console keeps the height.
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-2 rounded-md border bg-surface/95 px-2 py-1 shadow-raised backdrop-blur" data-testid="step-overlay" data-print="hide">
          <div className="min-w-0 flex-1">{nav}</div>
          <span className="flex shrink-0 gap-1.5">{actions}</span>
        </div>
      )}
    </div>
  );

  if (mode === "phone") {
    return (
      <div className="flex flex-col gap-2" data-testid="stage">
        {banner}
        {picture}
        {words && <p className="text-sm text-ink-body" aria-live="polite" data-testid="caption">{words}</p>}
        <div className="flex flex-wrap items-center gap-2" data-print="hide">{actions}</div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="stage">
      {banner}
      {picture}
      {mode === "desk" && (
        <div className="shrink-0 space-y-3" data-print="hide">
          <div className="flex min-h-touch flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 text-sm text-ink-body" aria-live="polite" data-testid="caption">{words}</p>
            <span className="flex shrink-0 items-center gap-2">{actions}</span>
          </div>
          {nav}
        </div>
      )}
      {mode === "landscape" && words && <p className="sr-only" aria-live="polite">{words}</p>}
    </div>
  );
}
