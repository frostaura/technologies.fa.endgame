import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Provider } from "react-redux";
import { vi } from "vitest";
import { makeStore } from "@/store";

/** TEST ONLY. A fetch stub routed by "METHOD /api/path"; unmatched calls fail loudly. */
export type Route = ((req: { method: string; path: string; body: unknown }) => Response | Promise<Response>) | Response | "pending";

export function json(body: unknown, status = 200): Response {
  if (status === 204 || body === null || body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function problem(status: number, title: string): Response {
  return json({ title, status }, status);
}

export function stubApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    const text = request.method === "GET" ? "" : await request.clone().text();
    // A form (a file upload) is kept as its text; everything else the console sends is JSON.
    const body = text ? (((request.headers.get("content-type") ?? "").startsWith("multipart/") ? text : JSON.parse(text)) as unknown) : null;
    calls.push({ method: request.method, path, body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === request.method && (p === path || p === url.pathname);
    });
    const route = key ? routes[key] : undefined;
    if (route === undefined) return problem(599, `No stub for ${request.method} ${path}`);
    if (route === "pending") return new Promise<Response>(() => {});
    if (route instanceof Response) return route.clone();
    return route({ method: request.method, path, body });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

/** `GET /api/me` as the control plane writes it. */
export const ME = {
  user: { id: "u1", displayName: "Owner", email: "o@example.test" },
  organisation: { id: "o1", slug: "acme", name: "Acme" },
  isOperator: false,
  passkeys: 1,
  memberships: [{ id: "m1", scope: "acme", level: "organisation", role: "owner", organisationId: "o1", organisationSlug: "acme", organisationName: "Acme" }],
};

export function renderWithStore(ui: ReactElement) {
  const store = makeStore();
  return { store, ...render(<Provider store={store}>{ui}</Provider>) };
}

/** TEST ONLY. An EventSource the tests drive by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent<string>) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  /** Deliver one event as the control plane sends it: named, with `id:` the sequence number. */
  emit(seq: number, type: string, payload: Record<string, unknown> = {}) {
    const e = new MessageEvent<string>(type, { data: JSON.stringify({ seq, type, at: "2026-11-24T10:00:00Z", payload }), lastEventId: String(seq) });
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    if (type === "message") this.onmessage?.(e);
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
  static latest(): FakeEventSource {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!es) throw new Error("no EventSource opened");
    return es;
  }
}
