import { errorFor, NetworkError, type Problem } from "./errors.js";

/** Options for {@link api}. A plain object `body` is sent as JSON. */
export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * The absolute URL of one of this app's API endpoints. `path` is relative to the app's `api/`
 * root — `apiUrl("notes/42")` — and is resolved against the page's `<base>`, so it works under
 * `/<org>/<division>/<project>/` and at the root of a subdomain alike.
 */
export function apiUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new Error(`api("${path}"): api() calls this app's own API only. Other hosts are reached from the server, through the platform.`);
  }
  if (path.startsWith("/")) {
    throw new Error(
      `api("${path}"): drop the leading slash — write api("${path.replace(/^\/+/, "")}"). ` +
        "A leading slash escapes the app's address prefix and breaks the app under a path.",
    );
  }
  if (path === "api" || path.startsWith("api/")) {
    throw new Error(`api("${path}"): paths are already inside api/ — write api("${path.replace(/^api\/?/, "")}").`);
  }
  return new URL(`api/${path}`, document.baseURI).toString();
}

/** Everything that re-reads after a write: each mounted `useApiQuery` registers here. */
const afterWriteListeners = new Set<() => void>();

/**
 * Runs `listener` after every successful write through {@link api} (any method but GET). Returns
 * the function that stops it. `useApiQuery` uses this to re-read; apps rarely need it directly.
 */
export function onApiWrite(listener: () => void): () => void {
  afterWriteListeners.add(listener);
  return () => {
    afterWriteListeners.delete(listener);
  };
}

/**
 * Calls the app's own API and returns the parsed JSON body (undefined for 204). On failure it
 * throws a typed error — `NotSignedInError`, `ValidationError`, `NotFoundError`, … — carrying
 * the problem details the server sent. It never returns a failure as data.
 *
 * A write that succeeds (POST, PUT, PATCH or DELETE) makes **every mounted `useApiQuery` re-read**,
 * so every list and count on screen reflects it — not only the one the page reloads itself. Those
 * reads keep showing their data while they re-read; one that fails is shown as failed.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = apiUrl(path);
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, { method: options.method ?? "GET", headers, body, signal: options.signal, credentials: "same-origin" });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new NetworkError(cause);
  }

  if (!response.ok) {
    throw errorFor(response.status, await readProblem(response));
  }
  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if ((options.method ?? "GET") !== "GET") afterWriteListeners.forEach((listener) => listener());
  return data;
}

async function readProblem(response: Response): Promise<Problem> {
  try {
    return (await response.json()) as Problem;
  } catch {
    return { status: response.status, title: response.statusText };
  }
}
