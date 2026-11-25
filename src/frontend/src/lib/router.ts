import { useSyncExternalStore } from "react";

/**
 * The console's router: the History API and a pattern matcher, nothing else. Nine screens do
 * not need a routing library, and every URL stays a real, shareable address.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function snapshot() {
  return window.location.pathname + window.location.search;
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo({ top: 0 });
  for (const listener of listeners) listener();
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, snapshot, () => "/");
  const url = new URL(href, "http://console.local");
  return { pathname: url.pathname, search: url.searchParams };
}

export type Route =
  | { name: "home" }
  | { name: "sign-in" }
  | { name: "start" }
  | { name: "run"; id: string }
  | { name: "idea"; id: string }
  | { name: "app"; id: string }
  | { name: "credits" }
  | { name: "secrets" }
  | { name: "operator-access" }
  | { name: "system" }
  | { name: "employee"; id: string }
  | { name: "hire"; id: string }
  | { name: "hires" }
  | { name: "autonomy" }
  | { name: "not-found" };

const id = "([A-Za-z0-9_-]{1,80})";
const table: [RegExp, (m: RegExpMatchArray) => Route][] = [
  [/^\/$/, () => ({ name: "home" })],
  [/^\/sign-in\/?$/, () => ({ name: "sign-in" })],
  [/^\/start\/?$/, () => ({ name: "start" })],
  [new RegExp(`^/runs/${id}/?$`), (m) => ({ name: "run", id: m[1] ?? "" })],
  [new RegExp(`^/ideas/${id}/?$`), (m) => ({ name: "idea", id: m[1] ?? "" })],
  [new RegExp(`^/apps/${id}/?$`), (m) => ({ name: "app", id: m[1] ?? "" })],
  [/^\/credits\/?$/, () => ({ name: "credits" })],
  [/^\/secrets\/?$/, () => ({ name: "secrets" })],
  [/^\/operator-access\/?$/, () => ({ name: "operator-access" })],
  [/^\/system\/?$/, () => ({ name: "system" })],
  [new RegExp(`^/employees/${id}/?$`), (m) => ({ name: "employee", id: m[1] ?? "" })],
  [new RegExp(`^/hires/${id}/?$`), (m) => ({ name: "hire", id: m[1] ?? "" })],
  [/^\/hires\/?$/, () => ({ name: "hires" })],
  [/^\/autonomy\/?$/, () => ({ name: "autonomy" })],
];

export function matchRoute(pathname: string): Route {
  for (const [pattern, build] of table) {
    const m = pathname.match(pattern);
    if (m) return build(m);
  }
  return { name: "not-found" };
}

export const paths = {
  home: () => "/",
  signIn: () => "/sign-in",
  start: () => "/start",
  run: (runId: string) => `/runs/${encodeURIComponent(runId)}`,
  idea: (ideaId: string) => `/ideas/${encodeURIComponent(ideaId)}`,
  app: (appId: string) => `/apps/${encodeURIComponent(appId)}`,
  credits: () => "/credits",
  /** The secrets that apply at a scope (a path of slugs). */
  secrets: (scope: string) => `/secrets?scope=${encodeURIComponent(scope)}`,
  operatorAccess: () => "/operator-access",
  system: () => "/system",
  employee: (employeeId: string) => `/employees/${encodeURIComponent(employeeId)}`,
  hire: (hireId: string) => `/hires/${encodeURIComponent(hireId)}`,
  /** Hire proposals and recurring contractor roles at a scope. */
  hires: (scope: string) => `/hires?scope=${encodeURIComponent(scope)}`,
  /** Autonomy, checkpoints and stage rule sets at a scope. */
  autonomy: (scope: string) => `/autonomy?scope=${encodeURIComponent(scope)}`,
};
