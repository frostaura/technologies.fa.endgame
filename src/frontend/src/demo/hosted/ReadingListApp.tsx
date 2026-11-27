import { useState, useSyncExternalStore, type FormEvent } from "react";
import {
  AppNotFound,
  HostedAppShell,
  PageHeading,
  type AppPageProps,
} from "./AppShell";
import { routeOf } from "./apps";
import { authRest } from "./gate";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FailedState,
  FieldError,
  Input,
  KitButton,
  KitLink,
  Label,
  Select,
} from "./kit";
import { useFormErrors } from "./kitParts";
import {
  readingListFor,
  STATUS_LABEL,
  STATUSES,
  type Book,
  type BookStatus,
  type Person,
} from "./readingList";

export type ReadingListAppProps = AppPageProps;

/** The reading list's places, in its header as the kit's `NavItem`s: on a phone, the line of tabs under its name. */
const PLACES = [
  { label: "Books", rest: "" },
  { label: "Add a book", rest: "books/new" },
];

const TONE: Record<BookStatus, "neutral" | "info" | "good"> = {
  want: "neutral",
  reading: "info",
  finished: "good",
};

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(iso),
  );

/**
 * A book club's reading list, built the way the app kit's template builds an app: the platform's
 * sign-in pages under the app's own address, the current user in the header, and a server that
 * refuses what the person may not do.
 */
export function ReadingListApp(props: ReadingListAppProps) {
  const route = routeOf(props.rest);
  return (
    <HostedAppShell {...props} testId="reading-list-app" page="reading-list" places={PLACES}>
      {route === "" ? (
        <BooksPage {...props} />
      ) : route === "books/new" ? (
        <NewBookPage {...props} />
      ) : (
        <AppNotFound {...props} backTo="the reading list" />
      )}
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
      const others = Object.fromEntries(
        Object.entries(current).filter(([id]) => id !== book.id),
      );
      return result.ok
        ? others
        : { ...others, [book.id]: result.problem.detail };
    });
  }

  const reading = books.filter((b) => b.status === "reading").length;
  const count = (status: BookStatus) =>
    books.filter((b) => b.status === status).length;
  return (
    <section className="flex flex-col gap-6 sm:gap-8" data-testid="page-home">
      <PageHeading
        title="The reading list"
        summary={`${books.length} ${books.length === 1 ? "book" : "books"} · ${reading} being read now`}
      >
        <KitLink
          href={addressOf("books/new")}
          onFollow={() => navigate("books/new")}
          data-testid="new-book"
        >
          Add a book
        </KitLink>
      </PageHeading>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {books.length === 0 ? (
            <div data-testid="book-list">
              <EmptyState title="No books yet">
                Add the first one with “Add a book”.
              </EmptyState>
            </div>
          ) : (
            <ul
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="Books"
              data-testid="book-list"
            >
              {[...books].reverse().map((book) => (
                <li key={book.id} data-testid="book-item" data-id={book.id}>
                  <Card className="flex h-full flex-col">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle>{book.title}</CardTitle>
                        <Badge
                          tone={TONE[book.status]}
                          data-testid="book-status"
                        >
                          {STATUS_LABEL[book.status]}
                        </Badge>
                      </div>
                      <p className="text-sm text-ink-muted">{book.author}</p>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4">
                      {book.note ? (
                        <p className="text-sm text-ink">{book.note}</p>
                      ) : null}
                      <p className="mt-auto text-xs text-ink-muted">
                        Added by {book.addedBy.displayName} ·{" "}
                        {formatWhen(book.addedAt)}
                      </p>
                      {me ? (
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`status-${book.id}`}
                            className="text-xs"
                          >
                            Status
                          </Label>
                          <Select
                            id={`status-${book.id}`}
                            data-testid="change-status"
                            value={book.status}
                            onChange={(event) =>
                              change(book, event.target.value as BookStatus)
                            }
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                      {refused[book.id] ? (
                        <FailedState
                          title="The status was not changed"
                          message={refused[book.id] ?? ""}
                          className="p-4"
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        {books.length > 0 ? (
          <aside
            aria-label="On the list"
            className="flex flex-col gap-4 lg:sticky lg:top-8 lg:w-aside lg:shrink-0"
          >
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="font-display text-base font-semibold text-ink">
                On the list
              </h2>
              <dl className="flex flex-col divide-y">
                {STATUSES.map((status) => (
                  <div
                    key={status}
                    className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <dt>
                      <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    </dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {count(status)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function NewBookPage(props: ReadingListAppProps) {
  const { me, here, addressOf, navigate } = props;
  const header = (
    <div className="flex flex-col gap-2">
      <KitLink
        plain
        href={addressOf("")}
        onFollow={() => navigate("")}
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm px-1 text-sm font-semibold text-primary hover:text-primary-hover"
      >
        <span aria-hidden>←</span> The reading list
      </KitLink>
      <PageHeading
        title="Add a book"
        summary="It goes on the list as “Want to read”, added by you."
      />
    </div>
  );
  if (me === null) {
    const signIn = authRest("sign-in", here);
    const signUp = authRest("sign-up", here);
    return (
      <section
        className="flex flex-col gap-6 sm:gap-8"
        data-testid="page-new-book"
      >
        {header}
        <EmptyState title="Sign in to add a book" className="max-w-form">
          <div className="flex flex-wrap gap-3 pt-2 max-sm:flex-col">
            <KitLink href={addressOf(signIn)} onFollow={() => navigate(signIn)}>
              Sign in
            </KitLink>
            <KitLink
              variant="outline"
              href={addressOf(signUp)}
              onFollow={() => navigate(signUp)}
            >
              Create an account
            </KitLink>
          </div>
        </EmptyState>
      </section>
    );
  }
  return (
    <section
      className="flex flex-col gap-6 sm:gap-8"
      data-testid="page-new-book"
    >
      {header}
      <NewBookForm {...props} me={me} />
    </section>
  );
}

function NewBookForm({
  appId,
  me,
  navigate,
}: ReadingListAppProps & { me: Person }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  // The kit's form errors: each clears as soon as its field changes, and a failed submit puts the focus on the first wrong one.
  const form = useFormErrors();

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = readingListFor(appId).add({ title, author, note }, me);
    if (result.ok) navigate("");
    else form.show(result.problem.errors ?? {});
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    error: string | undefined,
    max: number,
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        data-testid={`book-${id}`}
        value={value}
        onChange={(e) => set(e.target.value)}
        invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        maxLength={max}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );

  // The kit's form page: the fields in a measured column with "Cancel" beside the main action, and the book as it will show
  // on the list beside them (under them on a phone).
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <Card className="w-full max-w-form p-5 sm:p-6">
        <form {...form.formProps} className="flex flex-col gap-5" onSubmit={submit}>
          {field("title", "Title", title, setTitle, form.error("title"), 200)}
          {field(
            "author",
            "Author",
            author,
            setAuthor,
            form.error("author"),
            120,
          )}
          {field(
            "note",
            "One-line note (optional)",
            note,
            setNote,
            form.error("note"),
            160,
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-5 max-sm:flex-col max-sm:items-stretch">
            <KitButton type="submit" data-testid="save-book">
              Add to the list
            </KitButton>
            <KitButton variant="outline" onClick={() => navigate("")}>
              Cancel
            </KitButton>
          </div>
        </form>
      </Card>
      <aside
        aria-label="How it will show"
        className="flex flex-col gap-4 lg:w-aside lg:shrink-0"
      >
        <Card className="flex flex-col gap-2 p-5">
          <p className="text-sm font-semibold text-ink-muted">
            How it will show on the list
          </p>
          <div className="flex items-start justify-between gap-3">
            <p className="break-words font-display text-base font-semibold text-ink">
              {title.trim() || "Untitled"}
            </p>
            <Badge tone={TONE.want}>{STATUS_LABEL.want}</Badge>
          </div>
          <p className="text-sm text-ink-muted">
            {author.trim() || "No author yet"}
          </p>
          {note.trim() ? (
            <p className="break-words text-sm text-ink">{note}</p>
          ) : null}
        </Card>
      </aside>
    </div>
  );
}
