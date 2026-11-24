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

export const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
