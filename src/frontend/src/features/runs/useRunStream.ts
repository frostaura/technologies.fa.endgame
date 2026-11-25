import { useEffect } from "react";
import { API_BASE } from "@/store/api";
import { useAppDispatch, useAppSelector, type AppDispatch, type RootState } from "@/store";
import { EMPTY_LOG, eventsReceived, streamChanged, type RunLog } from "@/store/runsSlice";
import type { RunEvent } from "@/store/types";
import { lastSeq } from "./runModel";

/** Every event type in ARCH-004. The stream may name its events or send them all as `message`. */
export const EVENT_TYPES = [
  "run.started",
  "run.paused",
  "run.resumed",
  "run.finished",
  "plan.proposed",
  "plan.accepted",
  "task.created",
  "task.claimed",
  "task.done",
  "task.failed",
  "model.requested",
  "model.replied",
  "tool.requested",
  "tool.permitted",
  "tool.denied",
  "tool.result",
  "subagent.started",
  "subagent.finished",
  "approval.requested",
  "approval.answered",
  "evaluation.passed",
  "evaluation.failed",
  "estimate.made",
  "estimate.scored",
  "message",
] as const;

const MAX_ATTEMPTS = 6;

/**
 * Events are stored in batches, at most this often. A long run replays thousands of events the moment
 * its page opens; stored one by one, each would redraw the whole page (RUN-02).
 */
export const BATCH_MS = 50;

/** Every live follower's flush, so a test can store what is waiting without waiting for the batch. */
const flushes = new Set<() => void>();

/** TEST ONLY in practice: stores every event still waiting for its batch, in every followed run. */
export function flushRunStreams() {
  for (const f of [...flushes]) f();
}

/** Parse one server-sent event. `id:` carries the sequence number when the body omits it. */
export function parseEvent(data: string, lastEventId: string, fallbackType: string): RunEvent | null {
  try {
    const body = JSON.parse(data) as Partial<RunEvent> & Record<string, unknown>;
    const seq = typeof body.seq === "number" ? body.seq : lastEventId.trim() === "" ? Number.NaN : Number(lastEventId);
    if (!Number.isInteger(seq) || seq < 1) return null;
    const type = typeof body.type === "string" ? body.type : fallbackType;
    const payload = body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {};
    return { seq, type, at: typeof body.at === "string" ? body.at : new Date().toISOString(), payload };
  } catch {
    return null;
  }
}

/**
 * Follow one run's event stream. Resumable: every (re)connection asks for events after the last
 * sequence number already held, so a dropped connection loses nothing and repeats nothing.
 * The stream is closed once the run has finished.
 */
export function followRun(runId: string, dispatch: AppDispatch, getState: () => RootState): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;
  let pending: RunEvent[] = [];
  let batch: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (batch) clearTimeout(batch);
    batch = null;
    if (pending.length === 0) return;
    const events = pending;
    pending = [];
    dispatch(eventsReceived({ runId, events }));
  };

  const held = () => {
    flush();
    return getState().runs[runId]?.events ?? [];
  };

  const finished = () => held().some((e) => e.type === "run.finished");

  const close = () => {
    flush();
    source?.close();
    source = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const connect = () => {
    if (stopped) return;
    const after = lastSeq(held());
    dispatch(streamChanged({ runId, stream: attempts === 0 ? "connecting" : "reconnecting", error: attempts === 0 ? null : "The live connection dropped. Reconnecting…" }));
    const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/events?after=${after}`;
    const es = new EventSource(url, { withCredentials: true });
    source = es;

    const onEvent = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data, message.lastEventId, message.type === "message" ? "message" : message.type);
      if (!event) return;
      attempts = 0;
      pending.push(event);
      batch ??= setTimeout(flush, BATCH_MS);
      if (event.type === "run.finished") {
        stopped = true;
        close();
        dispatch(streamChanged({ runId, stream: "ended" }));
      }
    };

    es.onopen = () => {
      attempts = 0;
      dispatch(streamChanged({ runId, stream: "open" }));
    };
    es.onmessage = onEvent;
    for (const type of EVENT_TYPES) if (type !== "message") es.addEventListener(type, onEvent as EventListener);
    es.onerror = () => {
      // The browser would retry on its own, but without our `after=` cursor; take over instead.
      es.close();
      if (source === es) source = null;
      if (stopped || finished()) {
        dispatch(streamChanged({ runId, stream: "ended" }));
        return;
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        dispatch(streamChanged({ runId, stream: "failed", error: "The live connection to this work could not be kept open." }));
        return;
      }
      dispatch(streamChanged({ runId, stream: "reconnecting", error: "The live connection dropped. Reconnecting…" }));
      timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempts));
    };
  };

  flushes.add(flush);
  connect();
  return () => {
    stopped = true;
    close();
    flushes.delete(flush);
  };
}

/** The run's log in the store, kept live while the component is mounted. `retryKey` reopens a failed stream. */
export function useRunStream(runId: string | null, retryKey = 0): RunLog {
  const dispatch = useAppDispatch();
  const log = useAppSelector((s) => (runId ? (s.runs[runId] ?? EMPTY_LOG) : EMPTY_LOG));
  useEffect(() => {
    if (!runId) return;
    // A thunk hands us getState without coupling the hook to a store instance.
    return dispatch((d: AppDispatch, getState: () => RootState) => followRun(runId, d, getState));
  }, [runId, dispatch, retryKey]);
  return log;
}
