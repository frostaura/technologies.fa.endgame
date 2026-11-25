import { useEffect, useMemo, useRef, useState } from "react";
import type { Flow } from "../content/types.ts";
import { stepCaption, variationScript, type Variation } from "../content/scripts.ts";
import type { BridgeState } from "../bridge/bridge.ts";
import { plan, stepOf } from "../bridge/player.ts";
import { Inline } from "../components/Inline.tsx";
import { DemoFrame, type FrameRequest } from "./DemoFrame.tsx";
import { EmailCard } from "./EmailCard.tsx";
import { RequestPanel } from "./RequestPanel.tsx";
import { Terminal } from "./Terminal.tsx";

/**
 * "What else can happen", shown rather than told: one branch of a flow — a refusal, a limit, an
 * empty state — played in a console of its own, step by step, exactly as the flow's own steps play
 * beside it (the same player: goto, clock, act, then the spotlight).
 */
export function VariationPlayer({ flow, variation, index }: { flow: Flow; variation: Variation; index: number }) {
  const script = useMemo(() => variationScript(flow.id, variation), [flow.id, variation]);
  const total = variation.steps.length;
  const [active, setActive] = useState(1);
  const [run, setRun] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [frameState, setFrameState] = useState<BridgeState>("loading");
  const [request, setRequest] = useState<FrameRequest | null>(null);
  const played = useRef(0);
  const lastRun = useRef(run);
  const step = stepOf(script, active);
  const usesFrame = variation.steps.some((s) => s.kind === "demo");

  useEffect(() => {
    if (!usesFrame || step?.kind !== "demo") return;
    const replay = lastRun.current !== run;
    lastRun.current = run;
    const ops = plan(script, played.current, active, replay);
    played.current = active;
    if (ops.length) setRequest({ key: `${flow.id}:variation-${index}:${active}:${run}`, ops });
  }, [active, run, script, step, usesFrame, flow.id, index]);

  const go = (n: number) => {
    setInteractive(false);
    setActive(Math.min(Math.max(n, 1), total));
  };
  const unavailable = frameState === "unavailable";

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-12" data-testid="variation" data-print="hide">
      <div className="flex flex-col gap-3 lg:col-span-4">
        <p className="text-sm text-ink-muted">
          Step {active} of {total}
        </p>
        <ol className="flex flex-col gap-2" aria-label={`Steps of: ${variation.title}`}>
          {variation.steps.map((s) => (
            <li key={s.step}>
              <button
                type="button"
                onClick={() => go(s.step)}
                aria-current={s.step === active ? "step" : undefined}
                className={`flex w-full items-start gap-3 rounded-md border-2 bg-surface px-3 py-2 text-left text-sm transition-colors ${s.step === active ? "border-primary shadow-card" : "border-transparent hover:border-border"}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold ${s.step === active ? "bg-primary text-primary-ink" : "bg-quiet text-quiet-text"}`}>{s.step}</span>
                <span className="min-w-0 flex-1 text-ink-body">
                  <Inline text={stepCaption(s) ?? ""} self={flow.id} />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => go(active - 1)} disabled={active <= 1} className="min-h-touch rounded-full border px-4 text-sm font-semibold text-ink hover:bg-ground disabled:opacity-50">
            Back
          </button>
          <button type="button" onClick={() => go(active + 1)} disabled={active >= total} className="min-h-touch rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-50">
            Next
          </button>
          {usesFrame && (
            <button
              type="button"
              onClick={() => {
                setInteractive(false);
                setRun((r) => r + 1);
              }}
              className="min-h-touch rounded-full border-2 border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-primary-ink"
            >
              Show me again
            </button>
          )}
        </div>
        {unavailable && <p className="text-sm text-ink-muted">The live console could not be loaded here, so this branch shows its notes only.</p>}
      </div>
      <div className="h-stage-sm lg:col-span-8 lg:h-frame">
        {usesFrame && (
          <div className={step?.kind === "demo" && !unavailable ? "h-full" : "hidden"}>
            <DemoFrame request={request} interactive={interactive} onState={setFrameState} onTry={() => setInteractive(true)} title={`Live demo console: ${variation.title}`} testId="variation-frame" />
          </div>
        )}
        {step?.kind === "terminal" && <Terminal key={`${active}-${run}`} step={step} />}
        {step?.kind === "request" && <RequestPanel step={step} />}
        {step?.kind === "email" && <EmailCard step={step} />}
      </div>
    </div>
  );
}
