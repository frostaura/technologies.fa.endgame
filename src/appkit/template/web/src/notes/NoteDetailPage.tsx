import { Link, useParams } from "react-router";
import { NotFoundError, useApiQuery } from "@endgame/appkit";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, FailedState, LoadingState } from "@endgame/appkit/ui";
import { formatWhen, type NoteDetail } from "./types";

/** One note, by id. Lazy-loaded: its code arrives only when someone opens a note. */
export default function NoteDetailPage() {
  const { id } = useParams();
  const note = useApiQuery<NoteDetail>(id ? `notes/${encodeURIComponent(id)}` : null);

  return (
    <section className="flex flex-col gap-6">
      <Link to="/" className="text-sm font-semibold text-primary hover:text-primary-hover">
        ← All notes
      </Link>
      {note.status === "loading" && <LoadingState label="Loading the note…" />}
      {note.status === "failed" &&
        (note.error instanceof NotFoundError ? (
          <EmptyState title="There is no such note">It may have been removed, or the address is wrong.</EmptyState>
        ) : (
          <FailedState error={note.error} onRetry={note.reload} />
        ))}
      {note.status === "loaded" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{note.data.title}</CardTitle>
            <p className="text-sm text-ink-muted">
              {note.data.authorName} · {formatWhen(note.data.createdAt)}
            </p>
          </CardHeader>
          <CardContent>
            {note.data.body ? <p className="whitespace-pre-wrap">{note.data.body}</p> : <p className="text-ink-muted">No body.</p>}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
