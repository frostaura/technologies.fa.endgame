import type { World } from "./world";

/**
 * The fake control plane's plumbing: a request read from the console's `Request`, a reply turned
 * back into a `Response`, the problem bodies the real one sends (`Endpoints/Problems.cs`), and the
 * route table every area file adds itself to.
 */

export interface DemoRequest {
  method: string;
  /** The path after `/api/`, without the query, e.g. `ideas/abc/decision`. */
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  /** Named captures of the route's pattern. */
  params: Record<string, string>;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** What a handler may touch: the world (`world.changed` collects the tags a change invalidates). */
export interface Context {
  world: World;
}

export type Handler = (req: DemoRequest, ctx: Context) => Reply | Promise<Reply>;

export interface Route {
  method: string;
  /** The console's path, with `{name}` for a segment, e.g. `ideas/{id}/decision`. */
  pattern: string;
  /** The control-plane endpoint file the real handler lives in. */
  area: string;
  handler: Handler;
  regex: RegExp;
  names: string[];
}

export const routes: Route[] = [];

/** Register the handlers of one area (one control-plane endpoint file). */
export function area(name: string, table: Record<string, Handler>) {
  for (const [key, handler] of Object.entries(table)) {
    const [method, pattern] = key.split(" ") as [string, string];
    const names: string[] = [];
    const source = pattern.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\w+)\\?\}|\{(\w+)\}/g, (_m, a: string | undefined, b: string | undefined) => {
      names.push(a ?? b ?? "");
      return "([^/]+)";
    });
    routes.push({ method, pattern, area: name, handler, regex: new RegExp(`^${source}$`), names });
  }
}

export function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  // A literal segment wins over a placeholder (`hires/{id}` must not swallow `hires` lists, and
  // `ideas/suggestions` must not be read as an idea id).
  const candidates = routes.filter((r) => r.method === method).map((r) => ({ r, m: path.match(r.regex) })).filter((x) => x.m);
  candidates.sort((a, b) => a.r.names.length - b.r.names.length);
  const hit = candidates[0];
  if (!hit?.m) return null;
  const params: Record<string, string> = {};
  hit.r.names.forEach((n, i) => (params[n] = decodeURIComponent(hit.m?.[i + 1] ?? "")));
  return { route: hit.r, params };
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

export const ok = (body: unknown, status = 200): Reply => ({ status, body });
export const created = (body: unknown): Reply => ({ status: 201, body });
export const noContent = (): Reply => ({ status: 204 });

/** A problem, as `Problems.cs` writes it: ProblemDetails with a code. */
export function problem(status: number, code: string, title: string, detail: string, extensions: Record<string, unknown> = {}): Reply {
  return { status, body: { type: `https://endgame.frostaura.net/problems/${code}`, title, status, detail, code, ...extensions } };
}

/** Thrown by a rule deep in a handler; the dispatcher turns it into its reply. */
export class Refusal extends Error {
  constructor(public reply: Reply) {
    super(typeof reply.body === "object" && reply.body && "detail" in reply.body ? String((reply.body as { detail: unknown }).detail) : "refused");
  }
}

export const notFound = (what: string) => new Refusal(problem(404, "not_found", "Not found", `${what} was not found, or you cannot see it.`));
export const forbidden = (detail: string) => new Refusal(problem(403, "forbidden", "Forbidden", detail));
export const conflict = (detail: string) => new Refusal(problem(409, "conflict", "Conflict", detail));
export const invalid = (detail: string) => new Refusal(problem(400, "invalid_request", "The request is not valid", detail));
export const unauthenticated = () => new Refusal(problem(401, "unauthenticated", "Sign in first", "This needs a signed-in member."));

// ---------------------------------------------------------------------------------------------
// Reading a body
// ---------------------------------------------------------------------------------------------

export function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

export function num(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function strings(body: Record<string, unknown>, key: string): string[] {
  const v = body[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function isEmail(v: string | undefined): v is string {
  if (!v) return false;
  const at = v.indexOf("@");
  return v.length >= 4 && v.length <= 254 && at > 0 && at === v.lastIndexOf("@") && at < v.length - 1 && !/\s/.test(v);
}

/** A copy of a record without one of its keys (a view leaving out what the world keeps for itself). */
export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}

/** `Words.OneLine`: every line joined into one, runs of whitespace collapsed to a single space. */
export function oneLine(text: string | null | undefined): string {
  return (text ?? "").split(/\s+/).filter(Boolean).join(" ");
}

/**
 * `Words.Clamp`: one line, at most `max` characters, cut at a word boundary with "…" — never mid-word, never "...".
 * Backs up to the last space unless that would leave less than half.
 */
export function clampWords(text: string | null | undefined, max: number): string {
  const line = oneLine(text);
  if (line.length <= max) return line;
  let cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space >= Math.floor(max / 2)) cut = cut.slice(0, space);
  return `${cut.replace(/[ ,;:\-–—.]+$/, "")}…`;
}

/** `Words.Quoted`: the same, in typographic quotes, quotes already around it not doubled. */
export function quotedWords(text: string | null | undefined, max: number): string {
  const inner = oneLine(text).replace(/^["“”'‘’ ]+|["“”'‘’ ]+$/g, "");
  return `“${clampWords(inner, max)}”`;
}

/** A title made from text as the control plane makes one (`ReadModels.IdeaTitle`): its first line, cut at a word at 120. */
export function titleOf(text: string): string {
  return clampWords(text.split("\n")[0] ?? "", 120);
}
