import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DemoBridge, type BridgeState } from "../bridge/bridge.ts";
import type { PlannedOp } from "../bridge/player.ts";
import { shortAddress, type FrameFit } from "./geometry.ts";

export interface FrameRequest {
  /** Changes whenever a new sequence should play; an older one still running stops between ops. */
  key: string;
  ops: PlannedOp[];
}

export const DEMO_SRC = "./demo/index.html?embed=1";

/**
 * The live console in a frame, driven only through the bridge. The console is always drawn at its
 * device's fixed size (`fit.inner`: a laptop's 1280 × 800, or a phone's 390 × 640) and scaled to the
 * frame, so a lesson plays on the layout its script was written for at every window size and
 * nothing in it reflows between steps. Requests play strictly in order, so the console never skips
 * a step's state. While the learner watches, a transparent shield keeps a stray click from
 * derailing the tour — on hover it offers "Try it yourself"; that, or a click, lifts it.
 */
export function DemoFrame({
  request,
  interactive,
  onState,
  onTry,
  name,
  onSpotlight,
  fit,
  onRoute,
  onBusy,
}: {
  request: FrameRequest | null;
  interactive: boolean;
  onState: (s: BridgeState) => void;
  onTry: () => void;
  /** The frame's accessible name. Never a `title`: a browser shows that as a tooltip over the page. */
  name: string;
  /** Told, per request, whether the console drew the step's spotlight or found nothing to ring. */
  onSpotlight?: (key: string, found: boolean) => void;
  fit: FrameFit;
  /** The console's address, whenever it changes: shown in the frame's bar. */
  onRoute?: (route: string | null) => void;
  /** Whether a step is still playing. */
  onBusy?: (busy: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<DemoBridge | null>(null);
  const [state, setState] = useState<BridgeState>("loading");
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(onState);
  const spotRef = useRef(onSpotlight);
  const routeRef = useRef(onRoute);
  const busyRef = useRef(onBusy);
  // Ops play one at a time, in order. A newer request supersedes an older one between ops.
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = onState;
    spotRef.current = onSpotlight;
    routeRef.current = onRoute;
    busyRef.current = onBusy;
  }, [onState, onSpotlight, onRoute, onBusy]);

  useEffect(() => {
    busyRef.current?.(state === "ready" && busy);
  }, [busy, state]);

  useEffect(() => {
    const b = new DemoBridge(() => frame.current?.contentWindow ?? null, {
      onState: (s) => {
        setState(s);
        stateRef.current(s);
      },
      onRoute: (r) => routeRef.current?.(r),
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

  // Handed over: the lesson's ring comes off, so the learner drives a clean console.
  useEffect(() => {
    const b = bridge.current;
    if (!b || state !== "ready" || !interactive) return;
    queue.current = queue.current.then(async () => {
      try {
        await b.send("highlight", {});
      } catch {
        // Nothing to clear.
      }
    });
  }, [interactive, state]);

  const inner: CSSProperties = { width: `${fit.inner.width}px`, height: `${fit.inner.height}px`, transform: `scale(${fit.scale})` };
  return (
    <>
      <iframe
        ref={frame}
        src={DEMO_SRC}
        aria-label={name}
        className={`absolute left-0 top-0 origin-top-left bg-surface ${state === "unavailable" ? "invisible" : ""}`}
        style={inner}
        onError={() => bridge.current?.fail("The live console could not be loaded.")}
        data-testid="demo-frame"
        data-console-width={fit.inner.width}
        data-console-height={fit.inner.height}
        data-busy={busy || undefined}
      />
      {/* While a lesson plays, a clear shield keeps a stray click from derailing it; on hover or focus it says it can be taken over. */}
      {state === "ready" && !interactive && (
        <button type="button" onClick={onTry} className="group absolute inset-0 cursor-pointer bg-transparent focus-visible:ring-inset" aria-label="Try it yourself: hand the live console to me" data-testid="frame-shield">
          <span className="pointer-events-none absolute inset-0 bg-ink/0 transition-colors duration-200 group-hover:bg-ink/5 group-focus-visible:bg-ink/5" aria-hidden="true" />
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-primary-ink opacity-0 shadow-raised transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
            Try it yourself
          </span>
        </button>
      )}
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-ground/90" role="status">
          <span className="h-24 w-2/3 max-w-64 animate-shimmer rounded-md bg-shimmer" />
          <span className="sr-only">Opening the live console</span>
        </div>
      )}
    </>
  );
}

/**
 * The frame every stage shares — the console, a terminal, a request, an e-mail, a picture — so the
 * picture keeps one shape and one size whatever a step shows: on a desk, a slim browser bar with
 * the address and whether it is live; on a phone, a phone's own edge. Its size is the fitted size
 * (`fit`), fixed for the window: never changed by a step. `accent` marks a console the learner is
 * driving.
 */
export function FrameChrome({ fit, address, status, busy = false, on = true, accent = false, children }: { fit: FrameFit; address?: string; status?: string; busy?: boolean; on?: boolean; accent?: boolean; children: ReactNode }) {
  const phone = fit.device === "phone";
  const size: CSSProperties = { width: `${fit.width}px`, height: `${fit.height}px` };
  return (
    <div
      style={size}
      className={`relative mx-auto flex shrink-0 flex-col overflow-hidden bg-surface shadow-raised ${phone ? "rounded-xl border-4" : "rounded-lg border"} ${accent ? "border-primary ring-2 ring-primary/40" : phone ? "border-ink" : ""}`}
      data-testid="frame"
      data-device={fit.device}
    >
      {!phone && (
        <div className="flex h-chrome min-w-0 shrink-0 items-center gap-2 border-b bg-surface px-3" aria-hidden="true">
          <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-attention-line sm:block" />
          <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-border-strong sm:block" />
          <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full bg-success/40 sm:block" />
          <span className="w-0 min-w-0 flex-1 truncate rounded-full bg-ground px-3 py-0.5 font-mono text-xs text-ink-muted sm:ml-2">{shortAddress(address ?? "endgame")}</span>
          {status && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span className={`h-2 w-2 rounded-full ${on ? (busy ? "animate-pulse bg-success" : "bg-success") : "bg-border-strong"}`} />
              {status}
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="frame-box">
        {children}
      </div>
    </div>
  );
}
