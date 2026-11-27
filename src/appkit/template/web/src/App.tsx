import { lazy, Suspense } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import { AppErrorBoundary, AppHeader, AppMain, LoadingState, NavItem } from "@endgame/appkit/ui";
import { APP_NAME } from "./appName";
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
    // The kit's header (the app's name, its places, who is signed in) and page frame share one width, so their edges line up.
    <div className="flex min-h-dvh flex-col">
      <AppHeader home={<Link to="/">{APP_NAME}</Link>}>
        <NavItem>
          <NavLink to="/" end data-testid="nav-home">
            All notes
          </NavLink>
        </NavItem>
        <NavItem>
          <NavLink to="/notes/new" data-testid="nav-new-note">
            New note
          </NavLink>
        </NavItem>
      </AppHeader>
      <AppMain>
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
      </AppMain>
    </div>
  );
}
