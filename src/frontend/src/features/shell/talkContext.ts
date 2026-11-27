import { createContext, useContext } from "react";

/**
 * The conversation's place in the shell (ARCH-012). A page hands its conversation to the shell
 * (`AppShell`'s `talk`); on a desktop the shell docks it at the right edge, and on a tablet or a
 * phone it lives in a sheet the shell owns — a drawer from the right on a tablet, the whole screen
 * on a phone — one tap away: the header's icon, the bottom bar's "Talk", or a page's own launcher.
 */
export interface ShellTalk {
  /** A phone or a tablet: the conversation is drawn in the shell's sheet. */
  compact: boolean;
  /** The element inside the sheet the conversation is drawn into, once it exists. */
  target: HTMLElement | null;
  /** The page's conversation, as its launcher names it ("Talk to {the level}"), or null when the page has none. */
  label: string | null;
  open: () => void;
}

export const ShellTalkContext = createContext<ShellTalk | null>(null);

/** Whether the conversation is being drawn in the sheet: it then fills it, its text box pinned to the foot. */
export const InSheetContext = createContext(false);

export function useInSheet(): boolean {
  return useContext(InSheetContext);
}

/** Set when "Talk" is pressed on a page with no conversation: home opens its conversation as it arrives. */
let openOnArrival = false;
export function askToOpenTalkOnArrival() {
  openOnArrival = true;
}
export function takeOpenTalkOnArrival(): boolean {
  const was = openOnArrival;
  openOnArrival = false;
  return was;
}
