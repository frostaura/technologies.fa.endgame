/** Mirrors api/Notes/NotesEndpoints.cs. Change both together. */
export interface NoteSummary {
  id: string;
  title: string;
  authorName: string;
  createdAt: string;
}

export interface NoteDetail extends NoteSummary {
  body: string;
}

/** Whether the signed-in person follows a note: their own record, read on every visit (AGENTS.md, "A person's own record"). */
export interface NoteFollow {
  id: string | null;
  signedIn: boolean;
  following: boolean;
  since: string | null;
  followers: number;
}

export const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
