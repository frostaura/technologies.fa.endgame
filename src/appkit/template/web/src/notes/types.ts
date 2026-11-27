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
}

/**
 * Whether the signed-in person follows a note: their own record, read on every visit (AGENTS.md, "A person's own record").
 * Reading it requires sign-in, so the page asks only once it knows someone is signed in.
 */
export interface NoteFollow {
  id: string | null;
  following: boolean;
  since: string | null;
}

export const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
