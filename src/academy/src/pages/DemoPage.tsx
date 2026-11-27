import { useEffect, useRef, useState } from "react";
import { DemoBridge, type BridgeState } from "../bridge/bridge.ts";
import { DEMO_SRC } from "../stage/DemoFrame.tsx";
import { href } from "../lib/router.ts";
import { Mark } from "../components/Mark.tsx";

/** The live demo, full screen, with a slim way back. */
export function DemoPage({ back }: { back: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<BridgeState>("loading");
  useEffect(() => {
    const b = new DemoBridge(() => frame.current?.contentWindow ?? null, { onState: setState });
    return () => b.dispose();
  }, []);
  return (
    <div className="flex h-screen-d flex-col bg-surface">
      {/* One slim bar over the console's own header: the way back and what this is, together at the left. */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-ground px-2 text-sm sm:px-4">
        <a href={back} className="-ml-1 inline-flex min-h-touch items-center gap-2 rounded-full px-2 font-medium text-ink hover:text-primary-link">
          <Mark className="h-5 w-5" />
          <span aria-hidden="true">←</span> Back to the academy
        </a>
        <span className="h-4 border-l" aria-hidden="true" />
        <span className="min-w-0 truncate text-ink-muted">Live demo, on sample data — nothing you do here is kept</span>
        <a href={href("/learn")} className="ml-auto hidden shrink-0 font-medium text-primary-link hover:underline sm:inline">Learn it step by step</a>
      </div>
      {state === "unavailable" ? (
        <div className="mx-auto flex max-w-read flex-1 flex-col justify-center px-4">
          <h1 className="font-display text-title-sm font-bold text-ink">The live console could not be loaded</h1>
          <p className="mt-4 text-lead text-ink-body">This copy of the academy was built without the demo beside it. Every flow still teaches its steps.</p>
          <a href={href("/learn")} className="mt-8 inline-flex min-h-touch items-center self-start rounded-full bg-primary px-6 text-sm font-semibold text-primary-ink">Start learning</a>
        </div>
      ) : (
        <iframe ref={frame} src={DEMO_SRC} aria-label="Endgame live demo" className="w-full flex-1 bg-surface" onError={() => setState("unavailable")} />
      )}
    </div>
  );
}
