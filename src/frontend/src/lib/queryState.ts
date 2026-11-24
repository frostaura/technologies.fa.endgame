import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";

/**
 * The states a read can be in, kept apart. A failed read is never an empty result, and a failed
 * refresh is not a failed first load: the last good answer stays, marked stale.
 */
export type ViewState<T> =
  | { kind: "loading" }
  | { kind: "failed"; reason: string; status: number | null }
  | { kind: "loaded"; data: T; stale: { reason: string } | null };

type AnyError = FetchBaseQueryError | SerializedError | undefined;

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

export function describeError(error: AnyError): string {
  if (!error) return "The request failed.";
  if ("status" in error) {
    if (typeof error.status === "number") {
      const problem = problemText(error.data);
      return problem ? `${problem} (${error.status})` : `Endgame answered ${error.status}.`;
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
