import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import { errorStatus } from "@/lib/queryState";
import type { SystemStatus } from "@/store/api";

/** How often the view asks again. Health is live, not a snapshot from page load. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * Four states that must never be confused for one another. A failed read is not an empty list,
 * and a failed refresh is not a failed first load: the last good answer stays, marked stale.
 */
export type StatusViewState =
  | { kind: "loading" }
  | { kind: "failed"; reason: string; status: number | null }
  | { kind: "loaded"; status: SystemStatus; stale: { reason: string } | null };

export function describeError(error: FetchBaseQueryError | SerializedError | undefined): string {
  if (!error) return "The request failed.";
  if ("status" in error) {
    if (typeof error.status === "number") return `The control plane answered ${error.status}.`;
    if (error.status === "FETCH_ERROR") return "The control plane could not be reached.";
    if (error.status === "PARSING_ERROR") return "The control plane sent an answer that could not be read.";
    if (error.status === "TIMEOUT_ERROR") return "The control plane did not answer in time.";
    return error.error;
  }
  return error.message ?? "The request failed.";
}

export function toViewState(query: {
  data?: SystemStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: FetchBaseQueryError | SerializedError | undefined;
}): StatusViewState {
  if (query.data) {
    return { kind: "loaded", status: query.data, stale: query.isError ? { reason: describeError(query.error) } : null };
  }
  if (query.isError) return { kind: "failed", reason: describeError(query.error), status: errorStatus(query.error) };
  return { kind: "loading" };
}

export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
