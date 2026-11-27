import { Link, useParams } from "react-router";
import { formatDateTime, NotFoundError, useApiQuery } from "@endgame/appkit";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, FailedState, LoadingState } from "@endgame/appkit/ui";
import { usePageTitle } from "../usePageTitle";
import { FollowNote } from "./FollowNote";
import type { NoteDetail } from "./types";

/** One note, by id. Lazy-loaded: its code arrives only when someone opens a note. */
export default function NoteDetailPage() {
  const { id } = useParams();
  const note = useApiQuery<NoteDetail>(id ? `notes/${encodeURIComponent(id)}` : null);
  usePageTitle(note.status === "loaded" ? note.data.title : "A note");

  return (
    <section className="flex flex-col gap-6" data-testid="page-note">
      <Link to="/" className="flex min-h-11 items-center self-start text-sm font-semibold text-primary hover:text-primary-hover">
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
              {note.data.authorName} · {formatDateTime(note.data.createdAt)}
            </p>
            {note.data.happensAt && <p className="text-sm font-semibold text-ink">Happens {formatDateTime(note.data.happensAt)}</p>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {note.data.body ? <p className="whitespace-pre-wrap">{note.data.body}</p> : <p className="text-ink-muted">No body.</p>}
            <FollowNote noteId={note.data.id} followers={note.data.followers} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
