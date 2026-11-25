import { useEffect, useState } from "react";
import type { TerminalStep } from "../content/scripts.ts";
import { useReducedMotion } from "../lib/motion.ts";

/** A terminal that types the step's command, then prints what it really prints. Keyed by its parent to replay. */
export function Terminal({ step }: { step: TerminalStep }) {
  const reduced = useReducedMotion();
  const total = step.command.length + step.output.length;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      setCount((n) => {
        if (n + 1 >= total) window.clearInterval(timer);
        return Math.min(n + 1, total);
      });
    }, 28);
    return () => window.clearInterval(timer);
  }, [reduced, total]);

  const shown = reduced ? total : count;
  const typed = step.command.slice(0, Math.min(shown, step.command.length));
  const lines = Math.max(0, shown - step.command.length);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg bg-night shadow-raised" data-testid="terminal">
      <div className="flex items-center gap-2 px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-attention-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary-soft" />
        <span className="h-2.5 w-2.5 rounded-full bg-live" />
        <span className="ml-2 font-mono text-xs text-primary-ink-soft">{step.cwd ?? "technologies.fa.endgame"}</span>
      </div>
      <pre className="flex-1 overflow-auto px-5 pb-5 font-mono text-xs leading-relaxed text-primary-ink sm:text-sm" aria-label={`Terminal: ${step.command}`}>
        <span className="text-live">$ </span>
        <span>{typed}</span>
        {shown < step.command.length && <span className="animate-pulse text-live">▍</span>}
        {"\n"}
        {step.output.slice(0, lines).map((l, i) => (
          <span key={i} className="block whitespace-pre-wrap text-primary-ink-soft">{l || " "}</span>
        ))}
      </pre>
    </div>
  );
}
