import "./scripts";
import "./routes/auth";
import "./routes/tree";
import "./routes/work";
import "./routes/factory";
import "./routes/workforce";
import "./routes/breadth";
import "./routes/operator";
import "./routes/platformConsole";
import "./routes/treeManage";
import { listen } from "./engine";
import { match, problem, Refusal, routes, type Reply } from "./http";
import { runRecord, type World } from "./world";
import { logOperatorAction } from "./operatorLog";

/**
 * The fake control plane: a `fetch` and an `EventSource` that answer the console's every request
 * from the in-memory world. Nothing leaves the page. An address nothing answers is a loud console
 * error naming it, so an endpoint added to the console without a handler is caught at once.
 */

export { routes };

export interface ControlPlane {
  base: string;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  EventSource: typeof EventSource;
}

export interface ControlPlaneOptions {
  base: string;
  world: () => World;
  /** Called after every request and every clock step that changed the world. */
  afterChange: (tags: string[]) => void;
  /** Simulated network time, in milliseconds. */
  latency?: (method: string) => number;
}

export async function dispatch(world: World, method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<Reply> {
  const hit = match(method, path);
  if (!hit) {
    console.error(`[endgame demo] No handler for ${method} /api/${path}. Add one in src/demo/server/routes/ (see ARCH-009).`);
    return problem(404, "not_found", "Not found", "There is nothing at this address.");
  }
  world.actedAsOperator = [];
  try {
    const reply = await hit.route.handler({ method, path, query, body, params: hit.params }, { world });
    if (method !== "GET" && reply.status < 400) logOperatorAction(world, method, hit.route.pattern, path);
    return reply;
  } catch (e) {
    if (e instanceof Refusal) return e.reply;
    console.error(`[endgame demo] ${method} /api/${path} failed`, e);
    return problem(500, "internal_error", "Something went wrong", "The control plane failed to handle this request. It has been logged.");
  }
}

export function createControlPlane(options: ControlPlaneOptions): ControlPlane {
  const base = options.base.replace(/\/$/, "");
  const prefix = new URL(base).pathname.replace(/\/$/, "");

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (!request.url.startsWith(base)) {
      console.error(`[endgame demo] A request left the console for ${request.url}; the demo makes none.`);
      return Promise.reject(new TypeError("The demo makes no network requests."));
    }
    const path = url.pathname.slice(prefix.length).replace(/^\/+/, "");
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        return json(problem(400, "invalid_request", "The request could not be read", "The JSON value could not be converted."));
      }
    }
    const world = options.world();
    await wait(options.latency?.(request.method) ?? 0);
    const reply = await dispatch(world, request.method, path, url.searchParams, body);
    const tags = world.changed.splice(0);
    options.afterChange(tags);
    return json(reply);
  };

  class DemoEventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials: boolean;
    readyState = 0;
    onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
    private stop: (() => void) | null = null;

    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      this.url = String(url);
      this.withCredentials = !!init?.withCredentials;
      setTimeout(() => this.open(), 30);
    }

    private open() {
      if (this.readyState === 2) return;
      const u = new URL(this.url);
      const m = u.pathname.slice(prefix.length).match(/^\/?runs\/([^/]+)\/events$/);
      const world = options.world();
      const r = m ? runRecord(world, decodeURIComponent(m[1] ?? "")) : undefined;
      if (!r || !world.sessionUserId) {
        if (!m) console.error(`[endgame demo] No stream at ${this.url}.`);
        this.fail();
        return;
      }
      this.readyState = 1;
      const opened = new Event("open");
      this.onopen?.call(this as unknown as EventSource, opened);
      this.dispatchEvent(opened);
      const after = Number(u.searchParams.get("after") ?? 0);
      for (const e of r.events) if (e.seq > after) this.send(e);
      this.stop = listen(r.run.id, (e) => this.send(e));
    }

    private send(e: { seq: number; type: string; at: string; payload: Record<string, unknown> }) {
      if (this.readyState !== 1) return;
      const message = new MessageEvent(e.type, { data: JSON.stringify(e), lastEventId: String(e.seq) });
      if (e.type === "message") this.onmessage?.call(this as unknown as EventSource, message);
      this.dispatchEvent(message);
    }

    private fail() {
      this.readyState = 2;
      const ev = new Event("error");
      this.onerror?.call(this as unknown as EventSource, ev);
      this.dispatchEvent(ev);
    }

    close() {
      this.readyState = 2;
      this.stop?.();
      this.stop = null;
    }
  }

  return { base, fetch: fakeFetch, EventSource: DemoEventSource as unknown as typeof EventSource };
}

function json(reply: Reply): Response {
  if (reply.status === 204 || reply.body === undefined || reply.body === null) return new Response(null, { status: reply.status === 200 ? 204 : reply.status });
  if (reply.body instanceof Blob) return new Response(reply.body, { status: reply.status, headers: reply.headers });
  const problemType = typeof reply.body === "object" && reply.body !== null && "type" in reply.body && reply.status >= 400;
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": problemType ? "application/problem+json" : "application/json", ...reply.headers } });
}

function wait(ms: number) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
