import { lazy, Suspense } from "react";
import { Link, Route, Routes, useLocation } from "react-router";
import { AppErrorBoundary, LoadingState } from "@endgame/appkit/ui";
import { APP_NAME } from "./appName";
import { UserMenu } from "./UserMenu";
import { NotesPage } from "./notes/NotesPage";
import { NotFoundPage } from "./NotFoundPage";

// Pages other than the first load as separate chunks, on demand.
const NoteDetailPage = lazy(() => import("./notes/NoteDetailPage"));
const NewNotePage = lazy(() => import("./notes/NewNotePage"));

export function App() {
  // A page that fails to render shows the kit's "Something went wrong on this page" in its place; the header stays, and a
  // link to another page tries afresh (the boundary resets when the address changes).
  const { pathname } = useLocation();
  return (
    // One column on a phone, the whole width on anything larger; the header clears a phone's notch.
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-surface pt-safe-t">
        <div className="mx-auto flex w-full max-w-page items-center justify-between gap-3 px-4 py-2 sm:px-8 sm:py-4">
          <nav aria-label="Main" className="min-w-0">
            <Link to="/" data-testid="nav-home" className="flex min-h-11 items-center truncate font-display text-lg font-semibold text-ink">
              {APP_NAME}
            </Link>
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1 px-4 pb-safe-b pt-6 sm:px-8 sm:py-8">
        <AppErrorBoundary resetKey={pathname}>
          <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route path="/" element={<NotesPage />} />
              <Route path="/notes/new" element={<NewNotePage />} />
              <Route path="/notes/:id" element={<NoteDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </main>
    </div>
  );
}
