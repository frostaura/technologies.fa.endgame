import { Link } from "react-router";
import { formatDateTime, formatNumber, useApiQuery } from "@endgame/appkit";
import { Button, CardGrid, EmptyState, Facts, FailedState, ItemCard, LoadingState, PageHeader, PageLayout, Panel } from "@endgame/appkit/ui";
import { usePageTitle } from "../usePageTitle";
import type { NoteSummary } from "./types";

/**
 * Every note: the list page's shape (AGENTS.md, "What good looks like"). A title with the page's one action beside it; the
 * cards fill the width (as many columns as fit); beside them on a desktop, a summary of the list. Loading, failed, empty and
 * loaded each look different — a failure is never "no notes". Test ids: page-home, new-note, note-list, note-item, open-note.
 */
export function NotesPage() {
  const notes = useApiQuery<NoteSummary[]>("notes");
  usePageTitle("All notes");

  const loaded = notes.status === "loaded" ? notes.data : null;
  return (
    <section data-testid="page-home">
      <PageHeader
        title="All notes"
        description="What the team has written down, newest first."
        actions={
          <Button asChild>
            <Link to="/notes/new" data-testid="new-note">
              New note
            </Link>
          </Button>
        }
      />
      <PageLayout aside={loaded && loaded.length > 0 ? <NotesSummary notes={loaded} /> : undefined} asideLabel="About these notes">
        {notes.status === "loading" && <LoadingState label="Loading notes…" />}
        {notes.status === "failed" && <FailedState error={notes.error} onRetry={notes.reload} />}
        {loaded && loaded.length === 0 && (
          <div data-testid="note-list">
            <EmptyState
              title="No notes yet"
              action={
                <Button asChild variant="outline">
                  <Link to="/notes/new">Write the first note</Link>
                </Button>
              }
            >
              Anything worth keeping — a decision, a list, a plan — goes here for everyone to read.
            </EmptyState>
          </div>
        )}
        {loaded && loaded.length > 0 && (
          <CardGrid aria-label="Notes" data-testid="note-list">
            {loaded.map((note) => (
              <li key={note.id} data-testid="note-item" data-id={note.id}>
                <ItemCard
                  link={<Link to={`/notes/${note.id}`} data-testid="open-note" />}
                  title={note.title}
                  meta={`${note.authorName} · ${formatDateTime(note.createdAt)}`}
                />
              </li>
            ))}
          </CardGrid>
        )}
      </PageLayout>
    </section>
  );
}

/** The side panel: what the list holds at a glance. */
function NotesSummary({ notes }: { notes: NoteSummary[] }) {
  const writers = new Set(notes.map((n) => n.authorName)).size;
  const newest = notes.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  return (
    <Panel title="At a glance">
      <Facts
        items={[
          { label: "Notes", value: formatNumber(notes.length) },
          { label: "Written by", value: `${formatNumber(writers)} ${writers === 1 ? "person" : "people"}` },
          { label: "Newest", value: formatDateTime(newest.createdAt) },
        ]}
      />
    </Panel>
  );
}
