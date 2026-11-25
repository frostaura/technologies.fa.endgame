import { useMemo, useState } from "react";
import type { Flow } from "../content/types.ts";
import type { StepScript, Variation } from "../content/scripts.ts";
import { shotFor } from "../lib/data.ts";
import { Stage } from "../stage/Stage.tsx";

/** A branch as a flow of its own: its steps are read from their notes, numbered from 1. */
function variationFlow(f: Flow, v: Variation): Flow {
  return {
    ...f,
    steps: v.steps.map((s) => ({ n: s.step, text: s.note ?? (s.kind === "demo" ? s.highlight?.note ?? "" : ""), children: [] })),
  };
}

function variationScript(f: Flow, v: Variation): StepScript {
  return { flow: f.id, persona: v.persona, scenario: v.scenario, start: v.start, steps: v.steps };
}

/**
 * The branches of "What else can happen" that the live console can show: pick one and it plays in
 * a console of its own, from its own start, one step at a time.
 */
export function VariationPlayer({ flow: f, variations }: { flow: Flow; variations: Variation[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [active, setActive] = useState(1);
  const [run, setRun] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const v = chosen === null ? null : variations[chosen];
  const pseudo = useMemo(() => (v ? variationFlow(f, v) : null), [f, v]);
  const script = useMemo(() => (v ? variationScript(f, v) : undefined), [f, v]);
  const total = v?.steps.length ?? 0;
  const go = (n: number) => {
    setActive(Math.min(Math.max(n, 1), total));
    setInteractive(false);
  };

  return (
    <div className="mt-6" data-testid="variations">
      <p className="text-eyebrow font-semibold uppercase text-ink-muted">Watch it happen</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {variations.map((x, i) => (
          <li key={x.title}>
            <button
              type="button"
              onClick={() => {
                setChosen(i);
                setActive(1);
                setRun((r) => r + 1);
                setInteractive(false);
              }}
              aria-pressed={chosen === i}
              className={`min-h-touch rounded-full border-2 px-4 text-left text-sm font-semibold ${chosen === i ? "border-primary bg-primary-tint text-ink" : "border-border text-ink-body hover:border-primary-line"}`}
            >
              {x.title}
            </button>
          </li>
        ))}
      </ul>
      {v && pseudo && script && (
        <div className="mt-5 grid gap-5" key={chosen}>
          <div className="h-frame-sm sm:h-frame">
            <Stage
              flow={pseudo}
              script={script}
              active={active}
              run={run}
              interactive={interactive}
              onTry={() => setInteractive(true)}
              onReplay={() => {
                setInteractive(false);
                setRun((r) => r + 1);
              }}
              captured={(n) => (n === total ? shotFor(f.id, `v${(chosen ?? 0) + 1}`) : undefined)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => go(active - 1)} disabled={active <= 1} className="min-h-touch rounded-full border px-4 text-sm font-semibold text-ink hover:bg-ground disabled:opacity-40">
              Back
            </button>
            <p className="min-w-0 flex-1 text-sm text-ink-body" aria-live="polite">
              <span className="font-semibold text-ink">{v.title}</span> · step {active} of {total}
            </p>
            <button type="button" onClick={() => go(active + 1)} disabled={active >= total} className="min-h-touch rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
