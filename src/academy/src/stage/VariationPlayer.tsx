import { useEffect, useMemo, useRef, useState } from "react";
import type { Flow } from "../content/types.ts";
import type { StepScript, Variation } from "../content/scripts.ts";
import type { BridgeState } from "../bridge/bridge.ts";
import { plan, stepOf } from "../bridge/player.ts";
import { Inline } from "../components/Inline.tsx";
import { DemoFrame, type FrameRequest } from "./DemoFrame.tsx";
import { EmailCard } from "./EmailCard.tsx";
import { RequestPanel } from "./RequestPanel.tsx";
import { Terminal } from "./Terminal.tsx";

/**
 * "What else can happen", played live: each refusal, limit or other branch a step script names,
 * with a "Show me" that opens it in its own console, as its own person and in its own world, and
 * walks its steps. One branch is open at a time, so only one console loads.
 */
export function LiveVariations({ flow, variations }: { flow: Flow; variations: Variation[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-6 flex flex-col gap-3" data-print="hide">
      <p className="text-eyebrow font-semibold uppercase text-ink-muted">Shown live</p>
      <ul className="flex flex-col gap-3" aria-label="Branches shown live">
        {variations.map((v, i) => (
          <li key={v.title} className="rounded-md border bg-ground p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 font-semibold text-ink">{v.title}</p>
              <button
                type="button"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                className={`min-h-touch rounded-full px-4 text-sm font-semibold ${open === i ? "border-2 border-ink text-ink hover:bg-surface" : "bg-primary text-primary-ink hover:bg-primary-hover"}`}
              >
                {open === i ? "Close" : "Show me"}
              </button>
            </div>
            {open === i && <VariationPlayer flow={flow} variation={v} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VariationPlayer({ flow, variation }: { flow: Flow; variation: Variation }) {
  const script = useMemo<StepScript>(() => ({ flow: flow.id, persona: variation.persona, scenario: variation.scenario, start: variation.start, steps: variation.steps }), [flow.id, variation]);
  const total = variation.steps.length;
  const [active, setActive] = useState(1);
  const [run, setRun] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [frame, setFrame] = useState<BridgeState>("loading");
  const [request, setRequest] = useState<FrameRequest | null>(null);
  const played = useRef(0);
  const lastRun = useRef(run);
  const usesFrame = variation.steps.some((s) => s.kind === "demo");
  const step = stepOf(script, active);

  useEffect(() => {
    if (!usesFrame || step?.kind !== "demo") return;
    const replay = lastRun.current !== run;
    lastRun.current = run;
    const ops = plan(script, played.current, active, replay);
    played.current = active;
    if (ops.length) setRequest({ key: `${flow.id}:${variation.title}:${active}:${run}`, ops });
  }, [active, run, script, step, usesFrame, flow.id, variation.title]);

  const caption = step?.note ?? (step?.kind === "demo" ? step.highlight?.note : undefined);
  const move = (n: number) => {
    setInteractive(false);
    setActive(Math.min(Math.max(n, 1), total));
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="relative h-frame-sm sm:h-frame">
        {usesFrame && (
          <div className={step?.kind === "demo" && frame !== "unavailable" ? "h-full" : "hidden"}>
            <DemoFrame request={request} interactive={interactive} onState={setFrame} onTry={() => setInteractive(true)} title={`Live demo console: ${variation.title}`} />
          </div>
        )}
        {step?.kind === "terminal" && <Terminal key={`${active}-${run}`} step={step} />}
        {step?.kind === "request" && <RequestPanel step={step} />}
        {step?.kind === "email" && <EmailCard step={step} />}
        {step?.kind === "demo" && frame === "unavailable" && <p className="rounded-md border bg-surface p-4 text-sm text-ink-body">The live console could not be loaded here.</p>}
      </div>
      <p className="min-h-touch text-sm text-ink-body" aria-live="polite">
        <span className="mr-2 font-mono text-xs text-ink-muted">
          {active}/{total}
        </span>
        {caption ? <Inline text={caption} self={flow.id} /> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={active <= 1} onClick={() => move(active - 1)} className="min-h-touch rounded-full border px-4 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-40">
          Back
        </button>
        <button type="button" disabled={active >= total} onClick={() => move(active + 1)} className="min-h-touch rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-40">
          Next
        </button>
        <button
          type="button"
          onClick={() => {
            setInteractive(false);
            setRun((r) => r + 1);
          }}
          className="min-h-touch rounded-full border px-4 text-sm font-semibold text-ink hover:bg-surface"
        >
          Show me again
        </button>
      </div>
    </div>
  );
}
