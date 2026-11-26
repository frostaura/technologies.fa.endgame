import { createContext, useCallback, useContext, useState } from "react";

/**
 * A panel of cards says one thing at a time (D37) — the app page's side panel, a node's panel on /tree: what the last card did. A card's note is replaced by its
 * next action, and cleared when another card acts, so saved and removed messages never pile up. A card drawn outside
 * the panel keeps its own note.
 */
export interface CardNotes {
  card: string | null;
  note: unknown;
  say: (card: string, note: unknown) => void;
}

export const CardNotesContext = createContext<CardNotes | null>(null);

export function useCardNote<T>(card: string): [T | null, (note: T | null) => void] {
  const shared = useContext(CardNotesContext);
  const [own, setOwn] = useState<T | null>(null);
  const sharedSay = shared?.say;
  const say = useCallback((note: T | null) => (sharedSay ? sharedSay(card, note) : setOwn(note)), [sharedSay, card]);
  if (!shared) return [own, say];
  return [shared.card === card ? ((shared.note as T | null) ?? null) : null, say];
}
