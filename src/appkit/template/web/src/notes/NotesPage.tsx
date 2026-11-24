import { Link } from "react-router";
import { useApiQuery } from "@endgame/appkit";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, FailedState, LoadingState } from "@endgame/appkit/ui";
import { formatWhen, type NoteSummary } from "./types";

/** Every note. Loading, failed, empty and loaded each look different — a failure is never "no notes". */
export function NotesPage() {
  const notes = useApiQuery<NoteSummary[]>("notes");

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">All notes</h1>
        <Button asChild>
          <Link to="/notes/new">New note</Link>
        </Button>
      </div>

      {notes.status === "loading" && <LoadingState label="Loading notes…" />}
      {notes.status === "failed" && <FailedState error={notes.error} onRetry={notes.reload} />}
      {notes.status === "loaded" && notes.data.length === 0 && (
        <EmptyState title="No notes yet">Write the first one with “New note”.</EmptyState>
      )}
      {notes.status === "loaded" && notes.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Notes">
          {notes.data.map((note) => (
            <li key={note.id}>
              <Link to={`/notes/${note.id}`} className="block rounded-md hover:shadow-raised">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>{note.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-ink-muted">
                    {note.authorName} · {formatWhen(note.createdAt)}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
