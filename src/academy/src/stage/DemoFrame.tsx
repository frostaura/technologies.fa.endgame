import { useEffect, useRef, useState, type ReactNode } from "react";
import { DemoBridge, type BridgeState } from "../bridge/bridge.ts";
import type { PlannedOp } from "../bridge/player.ts";

export interface FrameRequest {
  /** Changes whenever a new sequence should play; an older one still running stops between ops. */
  key: string;
  ops: PlannedOp[];
}

export const DEMO_SRC = "./demo/index.html?embed=1";

/** The width the console is drawn at in a wide frame — its desktop layout as on a laptop — and the frame width from which it is. */
const CONSOLE_WIDTH = 1280;
const SCALE_FROM = 1100;
/** Below this height a frame narrower than 1024 px shows the console's phone layout (ARCH-009). */
const MIN_HEIGHT = 520;

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
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; scale: number }>({ width: 0, height: 0, scale: 1 });
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

  // The frame's box, measured: the console's own width and the scale it is drawn at.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      // Wide: drawn at the laptop width and scaled up. Short (a wide frame under the console's phone
      // height): drawn at its least tablet height and scaled down a little, never in its phone layout.
      const scale = width >= SCALE_FROM ? width / CONSOLE_WIDTH : width >= 640 && height >= 400 && height < MIN_HEIGHT ? height / MIN_HEIGHT : 1;
      setFit({ width: Math.round(width / scale), height: Math.round(height / scale), scale });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      {/* The console at a width it was designed for: past 1100 px of frame it is drawn 1280 px wide and
          scaled up to fit, so a wide screen shows it large, never squeezed at a breakpoint. */}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-testid="frame-box">
        <iframe
          ref={frame}
          src={DEMO_SRC}
          aria-label={name}
          className={`absolute left-0 top-0 origin-top-left bg-surface ${state === "unavailable" ? "invisible" : ""}`}
          style={fit.scale === 1 ? { width: "100%", height: "100%" } : { width: `${fit.width}px`, height: `${fit.height}px`, transform: `scale(${fit.scale})` }}
          onError={() => bridge.current?.fail("The live console could not be loaded.")}
          data-testid="demo-frame"
          data-console-width={fit.width || undefined}
        />
        {/* While a lesson plays, a clear shield keeps a stray click from derailing it; it draws nothing over the console. */}
        {state === "ready" && !interactive && (
          <button type="button" onClick={onTry} className="absolute inset-0 cursor-pointer bg-transparent focus-visible:ring-inset" aria-label="Try it yourself: hand the live console to me" />
        )}
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-ground/90" role="status">
            <span className="h-24 w-64 animate-shimmer rounded-md bg-shimmer bg-shimmer" />
            <span className="sr-only">Opening the live console</span>
          </div>
        )}
      </div>
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
