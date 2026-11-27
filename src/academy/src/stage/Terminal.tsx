import { useEffect, useState } from "react";
import type { TerminalStep } from "../content/scripts.ts";
import { useReducedMotion } from "../lib/motion.ts";
import { FrameChrome } from "./DemoFrame.tsx";

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
  // The house palette, sized to what it prints: a light pane in the stage's own frame, never a dark slab.
  return (
    <FrameChrome address={`terminal · ${step.cwd ?? "technologies.fa.endgame"}`} fit>
      <pre className="min-h-0 overflow-auto bg-surface px-5 py-4 font-mono text-xs leading-relaxed text-ink sm:text-sm" aria-label={`Terminal: ${step.command}`} data-testid="terminal">
        <span className="font-semibold text-primary">$ </span>
        <span>{typed}</span>
        {shown < step.command.length && <span className="animate-pulse text-primary">▍</span>}
        {"\n"}
        {step.output.slice(0, lines).map((l, i) => (
          <span key={i} className="block whitespace-pre-wrap text-ink-body">{l || " "}</span>
        ))}
      </pre>
    </FrameChrome>
  );
}
