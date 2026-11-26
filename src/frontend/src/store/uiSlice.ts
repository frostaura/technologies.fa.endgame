import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Mode } from "@/features/runs/runModel";
import { api } from "./api";
import type { OrganisationRef } from "./types";

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
  /**
   * God mode: the organisation an operator entered, remembered so that every screen — and every link
   * that does not carry `?organisation=` — keeps working on it until they leave (OP-04).
   */
  entered: OrganisationRef | null;
  /**
   * Whether this page has held a session. A sign-in screen shown after one (a sign-out, or a session
   * that ended) is not a signed-out arrival, so it keeps no return address for the next person (ID-04).
   */
  hadSession: boolean;
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

const ENTERED_KEY = "endgame.entered";

/** The entered organisation survives a reload of the tab, never a new one. */
export function readStoredEntered(): OrganisationRef | null {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(ENTERED_KEY) : null;
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && "id" in value && "slug" in value && "name" in value) {
      const { id, slug, name } = value as Record<string, unknown>;
      if (typeof id === "string" && typeof slug === "string" && typeof name === "string") return { id, slug, name };
    }
    return null;
  } catch {
    return null;
  }
}

export function storeEntered(entered: OrganisationRef | null) {
  try {
    if (entered) window.sessionStorage.setItem(ENTERED_KEY, JSON.stringify(entered));
    else window.sessionStorage.removeItem(ENTERED_KEY);
  } catch {
    // Storage can be refused; the entry still holds for this page.
  }
}

export function conversationKey(selection: Pick<Selection, "scope" | "employeeId">): string {
  return selection.employeeId ? `${selection.scope}#${selection.employeeId}` : selection.scope;
}

export const uiSlice = createSlice({
  name: "ui",
  initialState: (): UiState => ({ mode: readStoredMode(), selection: null, conversations: {}, entered: readStoredEntered(), hadSession: false }),
  reducers: {
    modeSet(state, action: PayloadAction<Mode>) {
      state.mode = action.payload;
    },
    selected(state, action: PayloadAction<Selection | null>) {
      state.selection = action.payload;
    },
    organisationEntered(state, action: PayloadAction<OrganisationRef>) {
      if (state.entered?.slug !== action.payload.slug) state.selection = null;
      state.entered = action.payload;
    },
    organisationLeft(state) {
      state.entered = null;
      state.selection = null;
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
  extraReducers: (builder) => {
    builder.addMatcher(api.endpoints.getMe.matchFulfilled, (state) => {
      state.hadSession = true;
    });
    // Nothing of one person's session is left for the next to sign in on this tab: not where they
    // were, not what they said, not an organisation they entered.
    builder.addMatcher(api.endpoints.logout.matchFulfilled, (state) => {
      state.selection = null;
      state.conversations = {};
      state.entered = null;
    });
  },
});

export const { modeSet, selected, messageQueued, messageSettled, organisationEntered, organisationLeft } = uiSlice.actions;
