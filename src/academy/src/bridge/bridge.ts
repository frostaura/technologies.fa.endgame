import { ACADEMY, DEMO, isEnvelope, type Envelope, type Op } from "./protocol.ts";

/**
 * One embedded demo console, driven over postMessage. Messages are accepted only from the frame's
 * own window (its origin is "null" from file://, so the window, not the origin, is the check), and
 * sent with "*" for the same reason; they carry nothing but script steps.
 */

export type BridgeState = "loading" | "ready" | "unavailable";

export interface BridgeEvents {
  onState?: (state: BridgeState, reason?: string) => void;
  onRoute?: (route: string) => void;
  onError?: (message: string) => void;
}

interface Pending {
  op: Op;
  resolve: (e: Envelope) => void;
  reject: (e: Error) => void;
  timer: number;
}

export class DemoBridge {
  private pending = new Map<string, Pending>();
  private seq = 0;
  state: BridgeState = "loading";
  private readyTimer: number;
  private readonly listener = (e: MessageEvent) => this.receive(e);

  constructor(
    private readonly frame: () => Window | null,
    private readonly events: BridgeEvents = {},
    private readonly timeouts = { ready: 8000, op: 10000, act: 30000 },
  ) {
    window.addEventListener("message", this.listener);
    this.readyTimer = window.setTimeout(() => this.fail("The live console did not answer."), this.timeouts.ready);
  }

  dispose() {
    window.removeEventListener("message", this.listener);
    window.clearTimeout(this.readyTimer);
    for (const p of this.pending.values()) {
      window.clearTimeout(p.timer);
      p.reject(new Error("closed"));
    }
    this.pending.clear();
  }

  /** The frame failed to load (an error page, a missing file). */
  fail(reason: string) {
    if (this.state === "unavailable") return;
    window.clearTimeout(this.readyTimer);
    this.state = "unavailable";
    this.events.onState?.("unavailable", reason);
  }

  send(op: Op, args: Record<string, unknown> = {}): Promise<Envelope> {
    if (this.state !== "ready") return Promise.reject(new Error(`the live console is ${this.state}`));
    const win = this.frame();
    if (!win) return Promise.reject(new Error("no frame"));
    const id = `a${++this.seq}`;
    const message: Envelope = { source: ACADEMY, id, op, args };
    return new Promise<Envelope>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${op} was not answered`));
      }, op === "act" ? this.timeouts.act : this.timeouts.op);
      this.pending.set(id, { op, resolve, reject, timer });
      win.postMessage(message, "*");
    });
  }

  private receive(e: MessageEvent) {
    const win = this.frame();
    if (!win || e.source !== win || !isEnvelope(e.data) || e.data.source !== DEMO) return;
    const msg = e.data;
    if (msg.op === "ready") {
      window.clearTimeout(this.readyTimer);
      if (this.state !== "ready") {
        this.state = "ready";
        this.events.onState?.("ready");
      }
      return;
    }
    if (msg.op === "route" && typeof msg.args?.route === "string") this.events.onRoute?.(msg.args.route);
    // step-done carries the act's id in args; every other reply echoes the request's id.
    const key = msg.op === "step-done" && typeof msg.args?.id === "string" ? msg.args.id : msg.id;
    const p = this.pending.get(key);
    if (msg.op === "error") this.events.onError?.(typeof msg.args?.message === "string" ? msg.args.message : "The live console reported an error.");
    if (!p) return;
    if (p.op === "act" && msg.op !== "step-done" && msg.op !== "error") return; // an acknowledgement; wait for step-done
    window.clearTimeout(p.timer);
    this.pending.delete(key);
    if (msg.op === "error") p.reject(new Error(typeof msg.args?.message === "string" ? msg.args.message : "error"));
    else p.resolve(msg);
  }
}
