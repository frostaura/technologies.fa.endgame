import { createContext, useCallback, useContext, useState } from "react";

/**
 * How the docked conversation is drawn on a desktop (ARCH-011): narrow or wide, open or collapsed
 * to a rail, or across the whole width. Width and collapsed are remembered per person on this
 * device — a convenience, never state anyone else reads — so it opens as they left it.
 */
export interface DockLayout {
  wide: boolean;
  collapsed: boolean;
  /** Across the whole width, the page hidden behind it; not remembered, so the page is never lost. */
  full: boolean;
  setWide: (wide: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  setFull: (full: boolean) => void;
}

export const DockLayoutContext = createContext<DockLayout | null>(null);

/** The dock's layout, where the conversation is docked; null on a tablet, a phone, or a page that places it inline. */
export function useDockLayout(): DockLayout | null {
  return useContext(DockLayoutContext);
}

const KEY = "endgame.dock";

/** The viewport width from which the pane opens wide until someone chooses. */
export const WIDE_FROM = 1800;

interface Stored {
  wide: boolean;
  collapsed: boolean;
}

function keyFor(person: string | null): string {
  return person ? `${KEY}.${person}` : KEY;
}

export function readDock(person: string | null): Stored {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(keyFor(person));
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      return { wide: v.wide === true, collapsed: v.collapsed === true };
    }
  } catch {
    // Storage can be refused (a private window): the dock opens at its default.
  }
  // Until someone chooses, a wide screen opens the wide pane: on 1800 pixels and more the narrow one leaves the page a sea of space.
  return { wide: typeof window !== "undefined" && window.innerWidth >= WIDE_FROM, collapsed: false };
}

function storeDock(person: string | null, value: Stored) {
  try {
    window.localStorage.setItem(keyFor(person), JSON.stringify(value));
  } catch {
    // Refused storage: the choice holds for this page.
  }
}

/** The dock's layout state for one person; `person` is their user id, or null before it is known. */
export function useDockState(person: string | null): DockLayout {
  const [held, setHeld] = useState<{ person: string | null; value: Stored }>(() => ({ person, value: readDock(person) }));
  const [full, setFullState] = useState(false);
  // Signed in as someone else on this tab: their own choice, not the last person's.
  if (held.person !== person) setHeld({ person, value: readDock(person) });
  const stored = held.value;
  const update = useCallback(
    (next: Partial<Stored>) =>
      setHeld((was) => {
        const value = { ...was.value, ...next };
        storeDock(person, value);
        return { person, value };
      }),
    [person],
  );
  const setWide = useCallback((wide: boolean) => update({ wide }), [update]);
  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      update({ collapsed });
      if (collapsed) setFullState(false);
    },
    [update],
  );
  const setFull = useCallback(
    (value: boolean) => {
      setFullState(value);
      if (value) update({ collapsed: false });
    },
    [update],
  );
  return { wide: stored.wide, collapsed: stored.collapsed, full, setWide, setCollapsed, setFull };
}
