/** Mirrors api/Notes/NotesEndpoints.cs. Change both together. */
export interface NoteSummary {
  id: string;
  title: string;
  authorName: string;
  createdAt: string;
}

export interface NoteDetail extends NoteSummary {
  body: string;
  /** How many people follow it: what anyone may see is on the note itself. */
  followers: number;
  /** When what it is about happens, if it says (ISO, UTC). */
  happensAt: string | null;
}

/** `Note.TitleMax`. */
export const TITLE_MAX = 200;

/**
 * The years a note's date may name (`Note.HappensFrom` … `HappensUntil`), as the date input's own `min` and `max`. The input
 * carries them and the form checks them on submit: a browser lets a person type past both (a six-digit year).
 */
export const HAPPENS_AT_LIMITS = { min: "2000-01-01T00:00", max: "2099-12-31T23:59" } as const;

/**
 * Whether the signed-in person follows a note: their own record, read on every visit (AGENTS.md, "A person's own record").
 * Reading it requires sign-in, so the page asks only once it knows someone is signed in.
 */
export interface NoteFollow {
  id: string | null;
  following: boolean;
  since: string | null;
}
