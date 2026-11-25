import { useEffect, useMemo, useRef, useState } from "react";
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

export function Stage({ flow, script, active, run, interactive, onTry, onReplay, branch, captured = (n) => shotFor(flow.id, n) }: {
  flow: Flow;
  script: StepScript | undefined;
  active: number;
  /** Bumped by "Show me again". */
  run: number;
  interactive: boolean;
  onTry: () => void;
  onReplay: () => void;
  branch?: Branch;
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
  const step: ScriptStep | undefined = stepOf(script, active);

  useEffect(() => {
    if (!usesFrame || media !== "demo") return;
    const replay = lastRun.current !== run || lastScript.current !== script;
    lastRun.current = run;
    lastScript.current = script;
    const ops = script ? plan(script, played.current, active, replay) : played.current ? [] : planExplore(flow.startRoute ?? "/");
    played.current = active;
    if (ops.length) setRequest({ key: `${flow.id}:${active}:${run}`, ops });
  }, [active, run, media, usesFrame, script, flow]);

  const unavailable = frameState === "unavailable";
  useEffect(() => {
    if (unavailable) toldUnavailable = true;
  }, [unavailable]);
  const caption = step?.note ?? (step?.kind === "demo" ? step.highlight?.note : undefined);
  const capturedFile = captured(active);
  const shot = step?.kind === "image" ? { file: step.file, alt: step.alt } : step?.kind === "demo" ? (step.shot ?? (capturedFile ? { file: capturedFile, alt: caption ?? flow.title } : undefined)) : undefined;
  const showFrame = usesFrame && media === "demo" && !unavailable;

  return (
    <div className="flex h-full flex-col gap-3">
      {branch && (
        <div role="group" aria-label="What else can happen" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-attention-wash px-4 py-2" data-print="hide">
          <p className="min-w-0 flex-1 text-sm text-ink">
            <span className="text-eyebrow font-semibold uppercase text-attention-text">What else can happen</span>{" "}
            <span className="font-semibold">{branch.title}</span>
            {branch.total > 1 && <span className="text-ink-muted"> · step {branch.step} of {branch.total}</span>}
          </p>
          <span className="flex gap-2">
            {branch.total > 1 && (
              <>
                <button type="button" disabled={branch.step <= 1} onClick={() => branch.onStep(branch.step - 1)} className="min-h-touch rounded-full border px-3 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40">Previous</button>
                <button type="button" disabled={branch.step >= branch.total} onClick={() => branch.onStep(branch.step + 1)} className="min-h-touch rounded-full border px-3 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40">Next</button>
              </>
            )}
            <button type="button" onClick={branch.onClose} className="min-h-touch rounded-full bg-ink px-3 text-sm font-semibold text-primary-ink hover:bg-ink/90">Back to the steps</button>
          </span>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {usesFrame && (
          <div className={showFrame ? "h-full" : "hidden"}>
            <DemoFrame request={request} interactive={interactive} onState={setFrameState} onTry={onTry} title={`Live demo console: ${flow.title}`} />
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
      </div>
      <div className="flex min-h-touch flex-wrap items-center gap-3" data-print="hide">
        <p className="min-w-0 flex-1 text-sm text-ink-muted" aria-live="polite">
          {unavailable && notice && media === "demo" ? (
            "The live console could not be loaded here, so this flow shows its steps and facts instead."
          ) : caption ? (
            <Inline text={caption} self={flow.id} />
          ) : showFrame ? (
            interactive ? "The console is yours: click around. “Show me again” puts it back on this step." : !script ? "This is the screen the flow starts on. Click into it to explore." : ""
          ) : null}
        </p>
        {showFrame && (
          <span className="flex gap-2">
            {!interactive ? (
              <button type="button" onClick={onTry} className="min-h-touch rounded-full border-2 border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-primary-ink">Try it yourself</button>
            ) : null}
            {script && (
              <button type="button" onClick={onReplay} className="min-h-touch rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover">Show me again</button>
            )}
          </span>
        )}
        {(media === "terminal" || media === "request" || media === "email" || media === "code") && (
          <button type="button" onClick={onReplay} className="min-h-touch rounded-full border px-4 text-sm font-semibold text-ink hover:bg-ground">Play again</button>
        )}
      </div>
    </div>
  );
}
