/**
 * The built app behind the Edge's pages: a book club's reading list, kept in memory for the page's
 * life (one list per hosted app). It answers the way an app built on the kit answers — problem
 * details with a status — and enforces its one rule on the server side: only the person who added
 * a book may change its status. Anyone else is told there is no such book (404), never "forbidden",
 * so the app does not confirm what it will not let them touch.
 */

export type BookStatus = "want" | "reading" | "finished";

export const STATUS_LABEL: Record<BookStatus, string> = {
  want: "Want to read",
  reading: "Reading",
  finished: "Finished",
};

export const STATUSES: BookStatus[] = ["want", "reading", "finished"];

export interface Person {
  /** Stable key: the e-mail address, lower-cased. */
  id: string;
  displayName: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  note: string;
  status: BookStatus;
  addedBy: Person;
  addedAt: string;
}

export interface Problem {
  status: number;
  title: string;
  detail: string;
  errors?: Record<string, string[]>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; problem: Problem };

/** The three club members who added the seeded books. */
export const CLUB_MEMBERS: Person[] = [
  { id: "amara.okafor@bookclub.example", displayName: "Amara Okafor" },
  { id: "jonas.lindqvist@bookclub.example", displayName: "Jonas Lindqvist" },
  { id: "priya.raman@bookclub.example", displayName: "Priya Raman" },
];

const [amara, jonas, priya] = CLUB_MEMBERS as [Person, Person, Person];

const SEED: Omit<Book, "id">[] = [
  { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", note: "Our first pick, and still the one we argue about.", status: "finished", addedBy: amara, addedAt: "2026-09-02T18:30:00Z" },
  { title: "The Remains of the Day", author: "Kazuo Ishiguro", note: "Quiet, and it lands harder than you expect.", status: "finished", addedBy: priya, addedAt: "2026-09-20T19:05:00Z" },
  { title: "Piranesi", author: "Susanna Clarke", note: "Short and strange; best read slowly.", status: "reading", addedBy: jonas, addedAt: "2026-10-04T08:12:00Z" },
  { title: "A Gentleman in Moscow", author: "Amor Towles", note: "For the long evenings in November.", status: "reading", addedBy: priya, addedAt: "2026-10-18T20:40:00Z" },
  { title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", note: "Someone asked for non-fiction. This is it.", status: "want", addedBy: amara, addedAt: "2026-11-01T10:00:00Z" },
  { title: "Project Hail Mary", author: "Andy Weir", note: "A palate cleanser after Ishiguro.", status: "want", addedBy: jonas, addedAt: "2026-11-09T21:15:00Z" },
  { title: "Pachinko", author: "Min Jin Lee", note: "Four generations; we may need two meetings.", status: "want", addedBy: priya, addedAt: "2026-11-16T17:45:00Z" },
];

export interface NewBook {
  title: string;
  author: string;
  note: string;
}

export interface ReadingList {
  list(): Book[];
  add(input: NewBook, by: Person | null): Result<Book>;
  setStatus(bookId: string, status: BookStatus, by: Person | null): Result<Book>;
  subscribe(listener: () => void): () => void;
}

const NOT_SIGNED_IN: Problem = { status: 401, title: "Unauthorized", detail: "Sign in to do that." };
const NO_SUCH_BOOK: Problem = { status: 404, title: "Not Found", detail: "There is no such book." };

function createReadingList(): ReadingList {
  let books: Book[] = SEED.map((b, i) => ({ ...b, id: `bk_${String(i + 1).padStart(4, "0")}` }));
  let next = books.length + 1;
  const listeners = new Set<() => void>();
  const changed = () => {
    listeners.forEach((l) => l());
  };

  return {
    list: () => books,
    add(input, by) {
      if (!by) return { ok: false, problem: NOT_SIGNED_IN };
      const title = input.title.trim();
      const author = input.author.trim();
      const note = input.note.trim();
      const errors: Record<string, string[]> = {};
      if (!title) errors.Title = ["Give the book's title."];
      else if (title.length > 200) errors.Title = ["A title is at most 200 characters."];
      if (!author) errors.Author = ["Give the author's name."];
      else if (author.length > 120) errors.Author = ["An author's name is at most 120 characters."];
      if (note.length > 160) errors.Note = ["Keep the note to one line: at most 160 characters."];
      if (Object.keys(errors).length > 0) {
        return { ok: false, problem: { status: 400, title: "Bad Request", detail: "The book was not added.", errors } };
      }
      const book: Book = { id: `bk_${String(next++).padStart(4, "0")}`, title, author, note, status: "want", addedBy: by, addedAt: new Date().toISOString() };
      books = [...books, book];
      changed();
      return { ok: true, value: book };
    },
    setStatus(bookId, status, by) {
      if (!by) return { ok: false, problem: NOT_SIGNED_IN };
      const book = books.find((b) => b.id === bookId);
      // Someone else's book answers exactly as a missing one does.
      if (!book || book.addedBy.id !== by.id) return { ok: false, problem: NO_SUCH_BOOK };
      const updated = { ...book, status };
      books = books.map((b) => (b.id === bookId ? updated : b));
      changed();
      return { ok: true, value: updated };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const lists = new Map<string, ReadingList>();

/** The app's list, created (and seeded) on first use; it lasts as long as the page. */
export function readingListFor(appId: string): ReadingList {
  let list = lists.get(appId);
  if (!list) {
    list = createReadingList();
    lists.set(appId, list);
  }
  return list;
}

/** A fresh, seeded list for tests. */
export function newReadingList(): ReadingList {
  return createReadingList();
}

/** Who the app sees, from the Edge's session: keyed by address, so the same person owns the same books. */
export function personOf(visitor: { displayName: string | null; email: string | null }): Person | null {
  const id = (visitor.email ?? visitor.displayName ?? "").trim().toLowerCase();
  if (!id) return null;
  return { id, displayName: visitor.displayName?.trim() || visitor.email || id };
}
