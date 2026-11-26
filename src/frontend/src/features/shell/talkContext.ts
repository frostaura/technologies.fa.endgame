import { createContext, useContext } from "react";

/**
 * The conversation's place in the shell. On a desktop or a tablet it sits where the page puts it
 * (beside or under the org chart, among an app's or an employee's sections) — on a tablet the
 * header's "Talk" brings it into view. On a phone it lives in a sheet the shell owns, one tap away
 * from anywhere on the page: the bottom bar's "Talk", or the button the page leaves where it stood.
 */
export interface ShellTalk {
  /** A phone: the conversation is drawn in the shell's sheet. */
  compact: boolean;
  /** A tablet: the conversation stays in the page, and the header's "Talk" brings it into view. */
  announce: boolean;
  /** The element inside the sheet the conversation is drawn into, once it exists. */
  target: HTMLElement | null;
  open: () => void;
  /** A page says it has a conversation, and what to call it ("Talk to {the level}"). */
  register: (label: string) => () => void;
}

export const ShellTalkContext = createContext<ShellTalk | null>(null);

/** Whether the conversation is being drawn in the sheet: it then fills it, its text box pinned to the foot. */
export const InSheetContext = createContext(false);

export function useInSheet(): boolean {
  return useContext(InSheetContext);
}

/** Set when "Talk" is pressed on a page with no conversation: the org chart opens it as it arrives. */
let openOnArrival = false;
export function askToOpenTalkOnArrival() {
  openOnArrival = true;
}
export function takeOpenTalkOnArrival(): boolean {
  const was = openOnArrival;
  openOnArrival = false;
  return was;
}
