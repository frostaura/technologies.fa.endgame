import { useEffect, useRef, useState } from "react";
import { DemoBridge, type BridgeState } from "../bridge/bridge.ts";
import type { PlannedOp } from "../bridge/player.ts";

export interface FrameRequest {
  /** Changes whenever a new sequence should play; an older one still running stops between ops. */
  key: string;
  ops: PlannedOp[];
}

export const DEMO_SRC = "./demo/index.html?embed=1";

/**
 * The live console in a frame, driven only through the bridge. Requests play strictly in order,
 * so the console never skips a step's state. While the learner watches, a
 * transparent shield keeps a stray click from derailing the tour; "Try it yourself" lifts it.
 */
export function DemoFrame({
  request,
  interactive,
  onState,
  onTry,
  title,
}: {
  request: FrameRequest | null;
  interactive: boolean;
  onState: (s: BridgeState) => void;
  onTry: () => void;
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<DemoBridge | null>(null);
  const [state, setState] = useState<BridgeState>("loading");
  // The console's address; a hosted app's pages carry their own address bar inside the frame.
  const [route, setRoute] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(onState);
  // Ops play one at a time, in order. A newer request supersedes an older one between ops.
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = onState;
  }, [onState]);

  useEffect(() => {
    const b = new DemoBridge(() => frame.current?.contentWindow ?? null, {
      onState: (s) => {
        setState(s);
        stateRef.current(s);
      },
      onRoute: setRoute,
    });
    bridge.current = b;
    return () => {
      b.dispose();
      bridge.current = null;
    };
  }, []);

  useEffect(() => {
    const b = bridge.current;
    if (!b || state !== "ready" || !request) return;
    const gen = ++generation.current;
    queue.current = queue.current.then(async () => {
      setBusy(true);
      for (const op of request.ops) {
        // A newer step is waiting: still bring the console to this step's state, but instantly
        // and without its spotlight, so the next step starts from the state it expects.
        const superseded = gen !== generation.current;
        if (superseded && op.op === "highlight") continue;
        const args = superseded && op.op === "act" ? { ...op.args, instant: true } : op.args;
        try {
          await b.send(op.op, args);
        } catch {
          // A refused or unanswered op leaves the frame where it is; the step's text still teaches it.
        }
      }
      if (gen === generation.current) setBusy(false);
    });
  }, [request, state]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border bg-ground shadow-raised">
      <div className="flex items-center gap-2 border-b bg-surface px-3 py-2" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-attention-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
        <span className="ml-2 min-w-0 flex-1 truncate rounded-full bg-ground px-3 py-1 font-mono text-xs text-ink-muted">endgame{route && !route.startsWith("/__app/") ? route : ""}</span>
        <span className={`h-2 w-2 rounded-full ${state === "ready" ? (busy ? "animate-pulse bg-success" : "bg-success") : "bg-border-strong"}`} />
      </div>
      <iframe
        ref={frame}
        src={DEMO_SRC}
        title={title}
        className={`h-full w-full flex-1 bg-surface ${state === "unavailable" ? "invisible" : ""}`}
        onError={() => bridge.current?.fail("The live console could not be loaded.")}
        data-testid="demo-frame"
      />
      {state === "ready" && !interactive && (
        <button
          type="button"
          onClick={onTry}
          className="group absolute inset-x-0 bottom-0 top-10 flex cursor-pointer items-end justify-end bg-transparent p-4"
          aria-label="Try it yourself: hand the live console to me"
        >
          <span className="rounded-full bg-ink/80 px-3 py-1.5 text-xs font-medium text-primary-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Click to try it yourself</span>
        </button>
      )}
      {state === "loading" && (
        <div className="absolute inset-x-0 bottom-0 top-10 flex items-center justify-center bg-ground/90" role="status">
          <span className="h-24 w-64 animate-shimmer rounded-md bg-shimmer bg-shimmer" />
          <span className="sr-only">Opening the live console</span>
        </div>
      )}
    </div>
  );
}
