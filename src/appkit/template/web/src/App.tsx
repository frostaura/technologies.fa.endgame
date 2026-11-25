import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router";
import { LoadingState } from "@endgame/appkit/ui";
import { UserMenu } from "./UserMenu";
import { NotesPage } from "./notes/NotesPage";
import { NotFoundPage } from "./NotFoundPage";

// Pages other than the first load as separate chunks, on demand.
const NoteDetailPage = lazy(() => import("./notes/NoteDetailPage"));
const NewNotePage = lazy(() => import("./notes/NewNotePage"));

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-surface">
        <div className="mx-auto flex w-full max-w-page items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <nav aria-label="Main">
            <Link to="/" data-testid="nav-home" className="font-display text-lg font-semibold text-ink">
              Notes
            </Link>
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-8 sm:px-8">
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/" element={<NotesPage />} />
            <Route path="/notes/new" element={<NewNotePage />} />
            <Route path="/notes/:id" element={<NoteDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
