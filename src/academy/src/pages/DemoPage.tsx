import { useEffect, useRef, useState } from "react";
import { DemoBridge, type BridgeState } from "../bridge/bridge.ts";
import { DEMO_SRC } from "../stage/DemoFrame.tsx";
import { href } from "../lib/router.ts";

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
      {/* One slim bar over the console's own header, with no logo of its own (the console's is right under it):
          the way back, and that this is sample data. Longer words only where there is room for them. */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-surface px-2 text-sm sm:px-4">
        <a href={back} aria-label="Back to the academy" className="inline-flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 font-medium text-ink hover:text-primary-link">
          <span aria-hidden="true">←</span> Academy
        </a>
        <span className="h-4 border-l" aria-hidden="true" />
        <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-semibold text-ink-body">Sample data</span>
        <span className="hidden min-w-0 truncate text-ink-muted md:inline">Live demo: nothing you do here is kept</span>
        <a href={href("/learn")} className="ml-auto hidden shrink-0 whitespace-nowrap px-2 font-medium text-primary-link hover:underline sm:inline">Learn it step by step</a>
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
