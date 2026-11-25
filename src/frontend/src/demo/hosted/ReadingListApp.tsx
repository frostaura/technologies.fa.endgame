import { useState, useSyncExternalStore, type FormEvent } from "react";
import { AppNotFound, HostedAppShell, PageHeading, type AppPageProps } from "./AppShell";
import { routeOf } from "./apps";
import { authRest } from "./gate";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, FailedState, FieldError, Input, KitButton, KitLink, Label, Select } from "./kit";
import { readingListFor, STATUS_LABEL, STATUSES, type Book, type BookStatus, type Person } from "./readingList";

export type ReadingListAppProps = AppPageProps;

const TONE: Record<BookStatus, "neutral" | "primary" | "success"> = { want: "neutral", reading: "primary", finished: "success" };

const formatWhen = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));

/**
 * A book club's reading list, built the way the app kit's template builds an app: the platform's
 * sign-in pages under the app's own address, the current user in the header, and a server that
 * refuses what the person may not do.
 */
export function ReadingListApp(props: ReadingListAppProps) {
  const route = routeOf(props.rest);
  return (
    <HostedAppShell {...props} testId="reading-list-app" page="reading-list">
      {route === "" ? <BooksPage {...props} /> : route === "books/new" ? <NewBookPage {...props} /> : <AppNotFound {...props} backTo="the reading list" />}
    </HostedAppShell>
  );
}

function useBooks(appId: string): Book[] {
  const list = readingListFor(appId);
  // The list is replaced, never mutated, on every write: it is its own snapshot.
  return useSyncExternalStore(list.subscribe, list.list);
}

function BooksPage({ appId, me, addressOf, navigate }: ReadingListAppProps) {
  const books = useBooks(appId);
  const [refused, setRefused] = useState<Record<string, string>>({});

  function change(book: Book, status: BookStatus) {
    const result = readingListFor(appId).setStatus(book.id, status, me);
    setRefused((current) => {
      const others = Object.fromEntries(Object.entries(current).filter(([id]) => id !== book.id));
      return result.ok ? others : { ...others, [book.id]: result.problem.detail };
    });
  }

  const reading = books.filter((b) => b.status === "reading").length;
  return (
    <section className="flex flex-col gap-6" data-testid="page-home">
      <PageHeading title="The reading list" summary={`${books.length} ${books.length === 1 ? "book" : "books"} · ${reading} being read now`}>
        <KitLink href={addressOf("books/new")} onFollow={() => navigate("books/new")} data-testid="new-book">
          Add a book
        </KitLink>
      </PageHeading>
      {books.length === 0 ? (
        <div data-testid="book-list">
          <EmptyState title="No books yet">Add the first one with “Add a book”.</EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Books" data-testid="book-list">
          {[...books].reverse().map((book) => (
            <li key={book.id} data-testid="book-item" data-id={book.id}>
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{book.title}</CardTitle>
                    <Badge tone={TONE[book.status]} data-testid="book-status">
                      {STATUS_LABEL[book.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">{book.author}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  {book.note ? <p className="text-sm text-ink">{book.note}</p> : null}
                  <p className="mt-auto text-xs text-ink-muted">
                    Added by {book.addedBy.displayName} · {formatWhen(book.addedAt)}
                  </p>
                  {me ? (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`status-${book.id}`} className="text-xs">
                        Status
                      </Label>
                      <Select
                        id={`status-${book.id}`}
                        data-testid="change-status"
                        value={book.status}
                        onChange={(event) => change(book, event.target.value as BookStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                  {refused[book.id] ? <FailedState title="The status was not changed" message={refused[book.id] ?? ""} className="p-4" /> : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewBookPage(props: ReadingListAppProps) {
  const { me, here, addressOf, navigate } = props;
  if (me === null) {
    const signIn = authRest("sign-in", here);
    const signUp = authRest("sign-up", here);
    return (
      <section data-testid="page-new-book">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Sign in to add a book</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <KitLink href={addressOf(signIn)} onFollow={() => navigate(signIn)}>
              Sign in
            </KitLink>
            <KitLink variant="outline" href={addressOf(signUp)} onFollow={() => navigate(signUp)}>
              Create an account
            </KitLink>
          </CardContent>
        </Card>
      </section>
    );
  }
  return (
    <section data-testid="page-new-book">
      <NewBookForm {...props} me={me} />
    </section>
  );
}

function NewBookForm({ appId, me, navigate }: ReadingListAppProps & { me: Person }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = readingListFor(appId).add({ title, author, note }, me);
    if (result.ok) navigate("");
    else setErrors(result.problem.errors ?? {});
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, error: string | undefined, max: number) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} data-testid={`book-${id}`} value={value} onChange={(e) => set(e.target.value)} invalid={!!error} aria-describedby={`${id}-error`} maxLength={max} />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Add a book</CardTitle>
        <p className="text-sm text-ink-muted">It goes on the list as “Want to read”, added by you.</p>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {field("title", "Title", title, setTitle, errors.Title?.[0], 200)}
          {field("author", "Author", author, setAuthor, errors.Author?.[0], 120)}
          {field("note", "One-line note (optional)", note, setNote, errors.Note?.[0], 160)}
          <div className="flex flex-wrap gap-3">
            <KitButton type="submit" data-testid="save-book">
              Add to the list
            </KitButton>
            <KitButton variant="outline" onClick={() => navigate("")}>
              Cancel
            </KitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
