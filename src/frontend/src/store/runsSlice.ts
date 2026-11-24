import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { mergeEvents } from "@/features/runs/runModel";
import type { RunEvent } from "./types";

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "ended" | "failed";

export interface RunLog {
  events: RunEvent[];
  stream: StreamStatus;
  /** Why the stream is reconnecting or failed, in plain words. */
  streamError: string | null;
}

const empty: RunLog = { events: [], stream: "idle", streamError: null };

export const runsSlice = createSlice({
  name: "runs",
  initialState: {} as Record<string, RunLog>,
  reducers: {
    eventsReceived(state, action: PayloadAction<{ runId: string; events: RunEvent[] }>) {
      const log = state[action.payload.runId] ?? { ...empty };
      log.events = mergeEvents(log.events, action.payload.events);
      state[action.payload.runId] = log;
    },
    streamChanged(state, action: PayloadAction<{ runId: string; stream: StreamStatus; error?: string | null }>) {
      const log = state[action.payload.runId] ?? { ...empty };
      log.stream = action.payload.stream;
      log.streamError = action.payload.error ?? null;
      state[action.payload.runId] = log;
    },
  },
});

export const { eventsReceived, streamChanged } = runsSlice.actions;

export const EMPTY_LOG: RunLog = empty;
