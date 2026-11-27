import { useEffect, useRef, useState, type ReactNode } from "react";
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
  name,
  onSpotlight,
}: {
  request: FrameRequest | null;
  interactive: boolean;
  onState: (s: BridgeState) => void;
  onTry: () => void;
  /** The frame's accessible name. Never a `title`: a browser shows that as a tooltip over the page. */
  name: string;
  /** Told, per request, whether the console drew the step's spotlight (and its note) or found nothing to ring. */
  onSpotlight?: (key: string, found: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<DemoBridge | null>(null);
  const [state, setState] = useState<BridgeState>("loading");
  // The console's address; a hosted app's pages carry their own address bar inside the frame.
  const [route, setRoute] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(onState);
  const spotRef = useRef(onSpotlight);
  // Ops play one at a time, in order. A newer request supersedes an older one between ops.
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = onState;
    spotRef.current = onSpotlight;
  }, [onState, onSpotlight]);

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
          const reply = await b.send(op.op, args);
          if (op.op === "highlight" && !superseded && !op.catchUp) spotRef.current?.(request.key, reply.args?.found !== false);
        } catch {
          // A refused or unanswered op leaves the frame where it is; the step's text still teaches it.
        }
      }
      if (gen === generation.current) setBusy(false);
    });
  }, [request, state]);

  return (
    <FrameChrome address={`endgame${route && !route.startsWith("/__app/") ? route : ""}`} status={interactive ? "Yours to try" : "Live"} busy={state === "ready" && busy} on={state === "ready"}>
      <iframe
        ref={frame}
        src={DEMO_SRC}
        aria-label={name}
        className={`h-full w-full flex-1 bg-surface ${state === "unavailable" ? "invisible" : ""}`}
        onError={() => bridge.current?.fail("The live console could not be loaded.")}
        data-testid="demo-frame"
      />
      {/* While a lesson plays, a clear shield keeps a stray click from derailing it; it draws nothing over the console. */}
      {state === "ready" && !interactive && (
        <button type="button" onClick={onTry} className="absolute inset-x-0 bottom-0 top-chrome cursor-pointer bg-transparent focus-visible:ring-inset" aria-label="Try it yourself: hand the live console to me" />
      )}
      {state === "loading" && (
        <div className="absolute inset-x-0 bottom-0 top-chrome flex items-center justify-center bg-ground/90" role="status">
          <span className="h-24 w-64 animate-shimmer rounded-md bg-shimmer bg-shimmer" />
          <span className="sr-only">Opening the live console</span>
        </div>
      )}
    </FrameChrome>
  );
}

/**
 * The frame every stage shares — the console, a terminal, a request, an e-mail — so the picture
 * keeps one shape whatever a step shows: a slim browser bar with the address and whether it is live.
 */
export function FrameChrome({ address, status, busy = false, on = true, children, fit = false }: { address: string; status?: string; busy?: boolean; on?: boolean; children: ReactNode; fit?: boolean }) {
  return (
    <div className={`relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-ground shadow-raised ${fit ? "max-h-full" : "h-full"}`}>
      <div className="flex h-chrome min-w-0 shrink-0 items-center gap-2 border-b bg-surface px-3" aria-hidden="true">
        <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-attention-line sm:block" />
        <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-border-strong sm:block" />
        <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-success/40 sm:block" />
        <span className="w-0 min-w-0 flex-1 truncate rounded-full bg-ground px-3 py-0.5 font-mono text-xs text-ink-muted sm:ml-2">{address}</span>
        {status && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
            <span className={`h-2 w-2 rounded-full ${on ? (busy ? "animate-pulse bg-success" : "bg-success") : "bg-border-strong"}`} />
            {status}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
