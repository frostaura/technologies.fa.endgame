import { useCallback, useMemo, useState, type ReactNode } from "react";
import { CardNotesContext } from "./cardNote";

/** Holds the one note the side panel shows; see {@link useCardNote}. */
export function CardNotesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ card: string | null; note: unknown }>({ card: null, note: null });
  const say = useCallback((card: string, note: unknown) => setState({ card: note === null ? null : card, note }), []);
  const value = useMemo(() => ({ ...state, say }), [state, say]);
  return <CardNotesContext.Provider value={value}>{children}</CardNotesContext.Provider>;
}
