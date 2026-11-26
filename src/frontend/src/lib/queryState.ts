import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import type { Mode } from "@/features/runs/runModel";
import type { MemberRole } from "@/store/types";
import { isPlain } from "./plain";
import { ROLE_NAME, ROLES } from "./roles";

/**
 * The states a read can be in, kept apart. A failed read is never an empty result, and a failed
 * refresh is not a failed first load: the last good answer stays, marked stale.
 */
export type ViewState<T> =
  | { kind: "loading" }
  | { kind: "failed"; reason: string; status: number | null }
  | { kind: "loaded"; data: T; stale: { reason: string } | null };

type AnyError = FetchBaseQueryError | SerializedError | undefined;

/**
 * The console's mode, mirrored here by the store (`makeStore`) so that every failure is worded for
 * the person reading it without each of the screens that word one asking for it. Normal mode gets
 * plain sentences; technical mode gets the server's own detail and the status (CLAUDE.md rule 12).
 */
let errorMode: Mode = "normal";

export function setErrorMode(mode: Mode) {
  errorMode = mode;
}

/** The problem-details `detail` or `title`, when the control plane sent one. */
function problemText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { detail?: unknown; title?: unknown };
  if (typeof d.detail === "string" && d.detail.trim()) return d.detail.trim();
  if (typeof d.title === "string" && d.title.trim()) return d.title.trim();
  return null;
}

export function errorStatus(error: AnyError): number | null {
  return error && "status" in error && typeof error.status === "number" ? error.status : null;
}

function isRole(value: string): value is MemberRole {
  return (ROLES as readonly string[]).includes(value);
}

/** "an Admin", "a Builder". */
function withArticle(role: MemberRole): string {
  return `${role === "admin" || role === "owner" ? "an" : "a"} ${ROLE_NAME[role]}`;
}

/** Who may do a thing that needs at least `required`: "Only an Admin or the Owner". */
function whoMay(required: MemberRole): string {
  const from = ROLES.indexOf(required);
  const names = ROLES.slice(from).map((r) => (r === "owner" ? "the Owner" : withArticle(r)));
  if (names.length === 1) return `Only ${names[0]}`;
  return `Only ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The control plane's role refusal (`AccessService.RequireAsync`), in plain words. Its detail names
 * the scope's path and the roles' wire names, which normal mode never shows.
 */
const ROLE_REFUSAL = /^This needs the (\w+) role at '[^']*'; (?:you are an? (\w+) there \(set at [^)]*\)|this access token acts as an? (\w+) at most)\.?$/;
/** `EndgameProblem.NotFound`: "The scope 'acme/tools' was not found, or you cannot see it." */
const NOT_FOUND = /^The [\w ]+ '[^']*' was not found, or you cannot see it\.?$/;
/** `TreeService.DeleteAsync`'s refusal (D79): a scope with things beneath it, work or credit history is archived, never deleted. */
const DELETE_REFUSAL = /^'[^']*' still has children, work or credit history attached\. Archive it instead\b.*$/;
/** A wire hint in brackets, "(status: archived)": the field to send, which a person never types. */
const WIRE_HINT = /\s*\((?:status|kind|role|stage|state|choice|decision): [\w.-]+\)/gi;
/** A quoted slug path (`'acme/tools'`), which plain words never carry. */
const QUOTED_PATH = /'[a-z0-9][\w.-]*(\/[\w.-]+)+'/gi;

/** A sentence's scope paths retold as words: "at 'acme/tools'" is "here", a leading path is "This". */
function withoutPaths(text: string): string {
  return text
    .replace(/ at '[a-z0-9][\w./-]*'/gi, " here")
    .replace(/^'[a-z0-9][\w.-]*(\/[\w.-]+)+'/i, "This")
    .replace(QUOTED_PATH, "this part");
}

function plainRoleRefusal(text: string): string | null {
  const m = ROLE_REFUSAL.exec(text);
  const required = m?.[1];
  if (!m || !required || !isRole(required)) return null;
  const mine = m[2] ?? m[3];
  const role = mine && isRole(mine) ? mine : null;
  const may = `${whoMay(required)} can do this here.`;
  if (!role) return may;
  return m[2] ? `${may} You are ${withArticle(role)} here.` : `${may} This assistant's key acts as ${withArticle(role)} at most.`;
}

/** What a status means when the server's own words cannot be shown as they are. */
function plainForStatus(status: number): string {
  if (status === 401) return "You are not signed in.";
  if (status === 403) return "You do not have the access this needs.";
  if (status === 404) return "This was not found, or you cannot see it.";
  if (status === 409) return "This changed in the meantime. Load it again and retry.";
  if (status === 429) return "Too many requests just now. Try again in a moment.";
  if (status >= 500) return "Endgame could not be reached just now.";
  return "The request was not accepted.";
}

/**
 * A failure in plain words for normal mode: the server's sentence when it reads as plain language,
 * a role refusal retold without paths or wire names, otherwise what the status means. Never a
 * status code.
 */
function plainProblem(problem: string | null, status: number): string {
  if (!problem) return plainForStatus(status);
  const refusal = plainRoleRefusal(problem);
  if (refusal) return refusal;
  if (NOT_FOUND.test(problem)) return plainForStatus(404);
  if (DELETE_REFUSAL.test(problem)) return "It still has things beneath it, work or credit history. Archive it instead: it keeps everything and can be brought back.";
  const words = withoutPaths(problem.replace(WIRE_HINT, ""));
  if (!isPlain(words)) return plainForStatus(status);
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

/**
 * A failure worded for the mode: technical mode keeps the server's detail and the status, normal
 * mode says it plainly. `mode` defaults to the console's own.
 */
export function describeError(error: AnyError, mode: Mode = errorMode): string {
  if (!error) return "The request failed.";
  if ("status" in error) {
    if (typeof error.status === "number") {
      const problem = problemText(error.data);
      if (mode === "technical") return problem ? `${problem} (${error.status})` : `Endgame answered ${error.status}.`;
      return plainProblem(problem, error.status);
    }
    if (error.status === "FETCH_ERROR") return "Endgame could not be reached.";
    if (error.status === "PARSING_ERROR") return "Endgame sent an answer that could not be read.";
    if (error.status === "TIMEOUT_ERROR") return "Endgame did not answer in time.";
    return error.error;
  }
  return error.message ?? "The request failed.";
}

export function viewOf<T>(query: { data?: T | undefined; isError: boolean; error?: AnyError }): ViewState<T> {
  if (query.data !== undefined) {
    return { kind: "loaded", data: query.data, stale: query.isError ? { reason: describeError(query.error) } : null };
  }
  if (query.isError) return { kind: "failed", reason: describeError(query.error), status: errorStatus(query.error) };
  return { kind: "loading" };
}
