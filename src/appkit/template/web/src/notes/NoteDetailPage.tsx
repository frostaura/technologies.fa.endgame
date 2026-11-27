import { Link, useParams } from "react-router";
import { formatDateTime, NotFoundError, useApiQuery } from "@endgame/appkit";
import { BackLink, Button, Card, Facts, FailedState, LoadingState, NotFoundState, PageHeader, PageLayout, Panel } from "@endgame/appkit/ui";
import { usePageTitle } from "../usePageTitle";
import { FollowNote } from "./FollowNote";
import type { NoteDetail } from "./types";

/**
 * One note, by id: the detail page's shape — a way back, the record's title, its content, and beside it on a desktop its
 * facts and what a person can do with it. Lazy-loaded: its code arrives only when someone opens a note.
 */
export default function NoteDetailPage() {
  const { id } = useParams();
  const note = useApiQuery<NoteDetail>(id ? `notes/${encodeURIComponent(id)}` : null);
  usePageTitle(note.status === "loaded" ? note.data.title : "A note");
  const back = <Link to="/">All notes</Link>;

  if (note.status === "failed" && note.error instanceof NotFoundError) {
    return (
      <section data-testid="page-note" className="flex flex-1 flex-col">
        <NotFoundState
          title="There is no such note"
          action={
            <Button asChild>
              <Link to="/">Back to all notes</Link>
            </Button>
          }
        >
          It may have been removed, or the address is wrong.
        </NotFoundState>
      </section>
    );
  }

  return (
    <section data-testid="page-note">
      {note.status !== "loaded" ? (
        <div className="flex flex-col gap-4">
          <BackLink>{back}</BackLink>
          {note.status === "loading" ? <LoadingState label="Loading the note…" /> : <FailedState error={note.error} onRetry={note.reload} />}
        </div>
      ) : (
        <>
          <PageHeader back={back} title={note.data.title} description={`Written by ${note.data.authorName}`} />
          <PageLayout
            asideLabel="About this note"
            aside={
              <>
                <Panel title="Details">
                  <Facts
                    items={[
                      { label: "Written", value: formatDateTime(note.data.createdAt) },
                      { label: "Happens", value: formatDateTime(note.data.happensAt, { fallback: "No date" }) },
                    ]}
                  />
                </Panel>
                <Panel title="Follow">
                  <FollowNote noteId={note.data.id} followers={note.data.followers} />
                </Panel>
              </>
            }
          >
            <Card className="p-5 sm:p-6">
              {note.data.body ? <p className="max-w-prose whitespace-pre-wrap break-words text-ink-body">{note.data.body}</p> : <p className="text-ink-muted">No body.</p>}
            </Card>
          </PageLayout>
        </>
      )}
    </section>
  );
}
