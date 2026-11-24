import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Mode } from "@/features/runs/runModel";

/** What the docked conversation is scoped to: a node of the tree, or one employee on it. */
export interface Selection {
  /** Path of slugs: `org`, `org/division`, `org/division/project`, `org/division/project/app`. */
  scope: string;
  kind: "organisation" | "division" | "project" | "app" | "employee";
  /** Display names from the organisation down to the selection, for the breadcrumb. */
  trail: string[];
  employeeId?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  state: "sending" | "sent" | "failed";
  runId: string | null;
  error: string | null;
}

export interface UiState {
  mode: Mode;
  selection: Selection | null;
  /** The owner's own messages, per conversation key; replies are read from each run's log. */
  conversations: Record<string, ChatMessage[]>;
}

const MODE_KEY = "endgame.mode";

export function readStoredMode(): Mode {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MODE_KEY) === "technical" ? "technical" : "normal";
  } catch {
    return "normal";
  }
}

export function storeMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private windows can refuse storage; the mode still holds for this session.
  }
}

export function conversationKey(selection: Pick<Selection, "scope" | "employeeId">): string {
  return selection.employeeId ? `${selection.scope}#${selection.employeeId}` : selection.scope;
}

export const uiSlice = createSlice({
  name: "ui",
  initialState: (): UiState => ({ mode: readStoredMode(), selection: null, conversations: {} }),
  reducers: {
    modeSet(state, action: PayloadAction<Mode>) {
      state.mode = action.payload;
    },
    selected(state, action: PayloadAction<Selection | null>) {
      state.selection = action.payload;
    },
    messageQueued(state, action: PayloadAction<{ key: string; message: ChatMessage }>) {
      (state.conversations[action.payload.key] ??= []).push(action.payload.message);
    },
    messageSettled(state, action: PayloadAction<{ key: string; id: string; runId: string | null; error: string | null }>) {
      const message = state.conversations[action.payload.key]?.find((m) => m.id === action.payload.id);
      if (!message) return;
      message.runId = action.payload.runId;
      message.error = action.payload.error;
      message.state = action.payload.error ? "failed" : "sent";
    },
  },
});

export const { modeSet, selected, messageQueued, messageSettled } = uiSlice.actions;
