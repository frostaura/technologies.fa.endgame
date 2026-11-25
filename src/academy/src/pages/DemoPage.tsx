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
    <div className="flex h-screen flex-col bg-surface">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <a href={back} className="inline-flex min-h-touch items-center gap-2 rounded-full px-3 text-sm font-medium text-ink hover:bg-ground">
          <span aria-hidden="true">←</span> Back to the academy
        </a>
        <span className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
          <Mark className="h-5 w-5" /> Live demo, on sample data
        </span>
      </div>
      {state === "unavailable" ? (
        <div className="mx-auto flex max-w-read flex-1 flex-col justify-center px-4">
          <h1 className="font-display text-title-sm font-bold text-ink">The live console could not be loaded</h1>
          <p className="mt-4 text-lead text-ink-body">This copy of the academy was built without the demo beside it. Every flow still teaches its steps.</p>
          <a href={href("/learn")} className="mt-8 inline-flex min-h-touch items-center self-start rounded-full bg-primary px-6 text-sm font-semibold text-primary-ink">Start learning</a>
        </div>
      ) : (
        <iframe ref={frame} src={DEMO_SRC} title="Endgame live demo" className="w-full flex-1 bg-surface" onError={() => setState("unavailable")} />
      )}
    </div>
  );
}
