import { useSyncExternalStore } from "react";

/**
 * Hash routing, so every address works under any sub-path and from file://:
 * `#/flow/ID-01/step/3`, `#/path/Core`, `#/search?q=invite`.
 */

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

const snapshot = () => window.location.hash || "#/";

export interface Location {
  parts: string[];
  query: URLSearchParams;
  hash: string;
}

export function parse(hash: string): Location {
  const raw = hash.replace(/^#/, "") || "/";
  const [pathPart = "/", queryPart = ""] = raw.split("?");
  return { parts: pathPart.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(queryPart), hash: raw };
}

export function useLocation(): Location {
  return parse(useSyncExternalStore(subscribe, snapshot, () => "#/"));
}

export function href(path: string): string {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}

export function go(path: string, options: { replace?: boolean } = {}) {
  const target = href(path);
  if (options.replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (options.replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
